import { WebSocket } from 'ws';
import User from '../models/userModel.js';
import ListeningHistory from '../models/listeningHistoryModel.js';
import SpotifyWebApi from 'spotify-web-api-node';
import * as mlService from './mlService.js';
import { inferMoodFromFeatures } from '../controllers/recommendationsController.js';

let wssInstance;
let pollingInterval;

// prevents overlapping polls for the same user (a poll that hasn't
// finished yet is skipped rather than queued, so slow requests never
// pile up and cause drift).
const activePolls = new Set();

// tuning knobs for real-time sync.
const POLL_INTERVAL_MS = 500;   // how often we check Spotify per user
const SEEK_THRESHOLD_MS = 1500; // gap between predicted & actual progress that counts as a seek
const HEARTBEAT_MS = 4000;      // force a resync push at least this often even with no change

// per-user last-known playback state. Used to (a) predict where progress
// "should" be so we can detect seeks/skips without extra API calls, and
// (b) cache mood analysis per track so we don't re-run ML/audio-feature
// analysis on every 500ms tick — only when the track actually changes.
const userState = new Map();

// backs off polling for a user after repeated request failures (e.g. a
// burst of 429 rate limits) instead of hammering Spotify at full speed
// forever, which would only make the rate limiting worse and cause more
// of the flicker this is meant to prevent.
const failureState = new Map(); 
const MAX_BACKOFF_MS = 8000;

export const initSocketService = (wss) => {
  wssInstance = wss;
  startBackgroundPolling();

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({
      type: 'connection',
      message: 'Connected to Moodify-AI Real-time Server',
      timestamp: new Date().toISOString(),
    }));

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());

        switch (data.type) {
          case 'ping':
            ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
            break;

          case 'subscribe':
            ws.userId = data.userId;
            ws.send(JSON.stringify({
              type: 'subscribed',
              userId: data.userId,
              timestamp: new Date().toISOString(),
            }));
            // immediately kick a poll for this user so a newly-opened
            // tab doesn't have to wait for the next interval tick.
            pollUserSafe(data.userId, { force: true });
            break;

          default:
            break;
        }
      } catch (err) {
        console.error('WS message parse error:', err.message);
      }
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error.message);
    });
  });
};

export const broadcastUpdate = (data) => {
  if (!wssInstance) return;

  const message = JSON.stringify({
    ...data,
    timestamp: new Date().toISOString(),
  });

  wssInstance.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      if (data.userId && client.userId && client.userId !== data.userId) return;
      client.send(message);
    }
  });
};

export const sendToUser = (userId, data) => {
  if (!wssInstance) return;

  const message = JSON.stringify({
    ...data,
    timestamp: new Date().toISOString(),
  });

  wssInstance.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && client.userId === userId) {
      client.send(message);
    }
  });
};

export const getConnectedCount = () => {
  if (!wssInstance) return 0;
  return Array.from(wssInstance.clients).filter(
    client => client.readyState === WebSocket.OPEN
  ).length;
};

const pushNowPlaying = (userId, data) => {
  if (!wssInstance) return;

  const payload = JSON.stringify({
    type: 'now_playing_update',
    userId,
    data: { ...data, timestamp: new Date().toISOString() },
    timestamp: new Date().toISOString(),
  });

  wssInstance.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && client.userId === userId) {
      client.send(payload);
    }
  });
};

const resolveMoodForTrack = async (accessToken, userId, spotifyApi, trackItem) => {
  try {
    const analysis = await mlService.analyzeCurrentlyPlaying(accessToken, userId);
    if (analysis?.mood_analysis) {
      return {
        fused_mood: analysis.mood_analysis.fused_mood || 'Unknown',
        confidence: analysis.mood_analysis.confidence || 0,
        audio_mood: analysis.mood_analysis.audio_mood || 'Unknown',
        lyrics_mood: analysis.mood_analysis.lyrics_mood || 'Neutral',
        scores: analysis.mood_analysis.scores || {},
        audioFeatures: analysis.audio_features || null,
      };
    }
  } catch (_) {
    // fall through to rule-based fallback below
  }

  try {
    const featResponse = await spotifyApi.getAudioFeaturesForTracks([trackItem.id]);
    const features = featResponse.body.audio_features?.[0] || null;
    const mood = features ? inferMoodFromFeatures(features) : 'Chill';
    return {
      fused_mood: mood,
      confidence: 0.8,
      audio_mood: mood,
      lyrics_mood: 'Neutral',
      scores: { [mood]: 0.8 },
      audioFeatures: features,
    };
  } catch (_) {
    return {
      fused_mood: 'Chill',
      confidence: 0,
      audio_mood: 'Chill',
      lyrics_mood: 'Neutral',
      scores: {},
      audioFeatures: null,
    };
  }
};

const recordListeningHistory = (userId, trackId, item, mood, audioFeatures, progressMs) => {
  const dayBucket = new Date().toISOString().slice(0, 10);
  ListeningHistory.findOneAndUpdate(
    { userId, trackId, dayBucket },
    {
      $set: {
        trackName: item.name,
        artistName: item.artists?.[0]?.name || 'Unknown',
        albumName: item.album?.name || 'Unknown',
        albumImage: item.album?.images?.[0]?.url || null,
        mood: mood.fused_mood,
        confidence: mood.confidence,
        features: {
          valence: audioFeatures?.valence ?? 0.5,
          energy: audioFeatures?.energy ?? 0.5,
          danceability: audioFeatures?.danceability ?? 0.5,
          acousticness: audioFeatures?.acousticness ?? 0.5,
          tempo: audioFeatures?.tempo ?? 120,
          speechiness: audioFeatures?.speechiness ?? 0.05,
          instrumentalness: audioFeatures?.instrumentalness ?? 0.0,
          liveness: audioFeatures?.liveness ?? 0.1,
          loudness: audioFeatures?.loudness ?? -8,
        },
        progressMs,
        durationMs: item.duration_ms || 0,
        playedAt: new Date(),
        dayBucket,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).catch(() => {});
};

const pollUser = async (userId, { force = false } = {}) => {
  const user = await User.findById(userId).select('accessToken displayName');
  if (!user || !user.accessToken) return;

  const spotifyApi = new SpotifyWebApi({
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  });
  spotifyApi.setAccessToken(user.accessToken);

  const current = await spotifyApi.getMyCurrentPlayingTrack().catch(() => undefined);
  const now = Date.now();
  const prev = userState.get(userId);

  // `undefined` means the request itself failed (network blip, transient
  // 429 rate limit, momentarily stale token, etc). This is NOT the same
  // as Spotify legitimately telling us nothing is playing — treating a
  // failed request as "stopped" is what caused the bar to flicker off
  // and on. Just skip this tick and back off briefly; the next allowed
  // poll retries.
  if (current === undefined) {
    const fs = failureState.get(userId) || { consecutiveFailures: 0, cooldownUntil: 0 };
    fs.consecutiveFailures += 1;
    fs.cooldownUntil = now + Math.min(POLL_INTERVAL_MS * 2 ** fs.consecutiveFailures, MAX_BACKOFF_MS);
    failureState.set(userId, fs);
    return;
  }
  failureState.delete(userId);

  // nothing playing right now
  if (!current || !current.body || !current.body.item) {
    if (force || (prev && prev.isPlaying)) {
      userState.set(userId, { trackId: null, isPlaying: false, progressMs: 0, lastPollAt: now, lastPushAt: now, mood: null, audioFeatures: null });
      pushNowPlaying(userId, { isPlaying: false, track: null, mood: null, audioFeatures: null, device: null });
    }
    return;
  }

  const item = current.body.item;
  const trackId = item.id;
  const isPlaying = current.body.is_playing;

  // iMPORTANT: `progress_ms` from Spotify is already the live, current
  // position — it does not need (and must not get) any elapsed-time
  // correction added to it. `timestamp` is "when playback state was
  // last changed" (play/pause/seek/skip), NOT "when this response was
  
  // double-counts elapsed time and makes the bar drift further and
  // further ahead of real playback the longer it's been since the last
  // seek/play event. Trust progress_ms as-is.
  const progressMs = current.body.progress_ms || 0;

  const trackChanged = !prev || prev.trackId !== trackId;
  const playStateChanged = !prev || prev.isPlaying !== isPlaying;

  // predict where progress "should" be based on the last poll to detect
  // manual seeks/rewinds within the same track.
  let seekDetected = false;
  if (prev && !trackChanged && prev.isPlaying && isPlaying) {
    const predicted = prev.progressMs + (now - prev.lastPollAt);
    if (Math.abs(progressMs - predicted) > SEEK_THRESHOLD_MS) {
      seekDetected = true;
    }
  }

  // reuse cached mood/audio-features unless the track changed.
  let mood = prev && !trackChanged ? prev.mood : null;
  let audioFeatures = prev && !trackChanged ? prev.audioFeatures : null;
  if (trackChanged || !mood) {
    const resolved = await resolveMoodForTrack(user.accessToken, userId, spotifyApi, item);
    mood = resolved;
    audioFeatures = resolved.audioFeatures;
  }

  const lastPushAt = prev?.lastPushAt || 0;
  const heartbeatDue = now - lastPushAt >= HEARTBEAT_MS;
  const shouldPush = force || trackChanged || playStateChanged || seekDetected || heartbeatDue;

  userState.set(userId, {
    trackId,
    isPlaying,
    progressMs,
    lastPollAt: now,
    lastPushAt: shouldPush ? now : lastPushAt,
    mood,
    audioFeatures,
  });

  if (!shouldPush) return;

  const standardizedTrack = {
    id: item.id,
    name: item.name,
    artists: item.artists.map(a => ({ id: a.id, name: a.name })),
    album: {
      name: item.album?.name || 'Unknown',
      images: item.album?.images || [],
    },
    albumImage: item.album?.images?.[0]?.url || null,
    duration: item.duration_ms,
    progress: progressMs,
    progressPercentage: item.duration_ms > 0 ? Math.round((progressMs / item.duration_ms) * 100) : 0,
    externalUrl: item.external_urls?.spotify || '',
  };

  const standardizedMood = {
    fused_mood: mood.fused_mood,
    primary_mood: mood.fused_mood,
    confidence: mood.confidence,
    audio_mood: mood.audio_mood,
    lyrics_mood: mood.lyrics_mood,
    scores: mood.scores,
  };

  pushNowPlaying(userId, {
    isPlaying,
    track: standardizedTrack,
    mood: standardizedMood,
    audioFeatures,
    device: current.body.device || null,
    // lets the client tell "this is a fresh authoritative position"
    // (track change / seek / heartbeat) apart from a routine tick.
    seek: seekDetected || trackChanged,
  });

  if (isPlaying && trackId && mood.fused_mood && mood.fused_mood !== 'Unknown') {
    recordListeningHistory(userId, trackId, item, mood, audioFeatures, progressMs);
  }
};

const pollUserSafe = (userId, opts) => {
  if (activePolls.has(userId)) return;
  const fs = failureState.get(userId);
  if (fs && fs.cooldownUntil > Date.now() && !opts?.force) return;

  activePolls.add(userId);
  pollUser(userId, opts)
    .catch((err) => console.error(`Live sync poll failed for user ${userId}:`, err.message))
    .finally(() => activePolls.delete(userId));
};

const startBackgroundPolling = () => {
  if (pollingInterval) return;

  pollingInterval = setInterval(() => {
    if (!wssInstance) return;

    const activeUserIds = new Set(
      Array.from(wssInstance.clients)
        .filter(c => c.readyState === WebSocket.OPEN)
        .map(c => c.userId)
        .filter(Boolean)
    );

    if (activeUserIds.size === 0) return;

    // poll every active user concurrently (not sequentially) so one
    // slow user never delays updates for everyone else.
    activeUserIds.forEach((userId) => pollUserSafe(userId));
  }, POLL_INTERVAL_MS);
};

// example usage in other files:
// import { broadcastUpdate, sendToUser } from './services/socketService.js';

// broadcastUpdate({
// type: 'playlist_analyzed',
// userId: '123',
// moods: ['Happy', 'Energetic']
// });

// sendToUser('123', {
// type: 'notification',
// message: 'Your playlist is ready!'
// });