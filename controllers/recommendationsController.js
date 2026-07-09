import SpotifyWebApi from 'spotify-web-api-node';
import { getFromCache, setInCache } from '../services/cacheService.js';

const getSpotifyApi = (accessToken) => {
  const api = new SpotifyWebApi();
  api.setAccessToken(accessToken);
  return api;
};

// =====================================================
// mOOD → AUDIO FEATURE RANGES
// =====================================================
export const MOOD_FEATURE_MAP = {
  'Joyful':     { valence: [0.7, 1.0], energy: [0.5, 0.9], danceability: [0.5, 1.0] },
  'Excited':    { valence: [0.6, 1.0], energy: [0.75, 1.0], danceability: [0.6, 1.0] },
  'Party':      { valence: [0.65, 1.0], energy: [0.8, 1.0], danceability: [0.7, 1.0] },
  'Melancholic':{ valence: [0.0, 0.35], energy: [0.1, 0.5], danceability: [0.0, 0.55] },
  'Dreamy':     { valence: [0.25, 0.6], energy: [0.1, 0.45], danceability: [0.2, 0.6] },
  'Relaxed':    { valence: [0.35, 0.7], energy: [0.1, 0.4], danceability: [0.2, 0.6] },
  'Chill':      { valence: [0.4, 0.75], energy: [0.2, 0.55], danceability: [0.3, 0.7] },
  'Focused':    { valence: [0.3, 0.65], energy: [0.3, 0.65], danceability: [0.25, 0.6] },
  'Romantic':   { valence: [0.4, 0.75], energy: [0.2, 0.6], danceability: [0.3, 0.65] },
  'Motivated':  { valence: [0.5, 0.85], energy: [0.65, 1.0], danceability: [0.55, 0.9] },
  'Angry':      { valence: [0.0, 0.4], energy: [0.7, 1.0], danceability: [0.3, 0.75] },
  'Ambient':    { valence: [0.3, 0.65], energy: [0.0, 0.35], danceability: [0.0, 0.45] },
  // legacy
  'Happy':      { valence: [0.6, 1.0], energy: [0.5, 1.0], danceability: [0.5, 1.0] },
  'Sad':        { valence: [0.0, 0.4], energy: [0.0, 0.5], danceability: [0.0, 0.6] },
  'Calm':       { valence: [0.35, 0.7], energy: [0.0, 0.45], danceability: [0.2, 0.6] },
  'Energetic':  { valence: [0.5, 1.0], energy: [0.7, 1.0], danceability: [0.6, 1.0] },
  'Focus':      { valence: [0.3, 0.65], energy: [0.3, 0.65], danceability: [0.2, 0.6] },
};

export function inferMoodFromFeatures(features) {
  if (!features) return 'Unknown';
  const { valence = 0.5, energy = 0.5, danceability = 0.5, acousticness = 0.5, speechiness = 0.05 } = features;
  
  if (energy > 0.8 && valence > 0.7) return 'Excited';
  if (energy > 0.7 && valence < 0.4) return 'Anxious';
  if (energy > 0.7 && valence >= 0.6) return 'Confident';
  if (energy > 0.7) return 'Energetic';
  
  if (energy > 0.5 && valence < 0.4) return 'Sad';
  if (energy > 0.5 && valence > 0.6 && danceability > 0.6) return 'Happy';
  if (energy > 0.5 && valence > 0.5) return 'Romantic';
  if (energy > 0.5 && speechiness > 0.1) return 'Determined';
  if (energy > 0.5) return 'Focused';
  
  if (valence < 0.3) return 'Sad';
  if (valence > 0.6 && acousticness > 0.5) return 'Romantic';
  if (valence > 0.5 && danceability > 0.5) return 'Chill';
  if (valence > 0.4 && acousticness > 0.6) return 'Reflective';
  if (energy < 0.3 && acousticness > 0.7) return 'Calm';
  
  return 'Calm';
}

function matchesMood(features, moodName) {
  if (!features || !moodName) return true;
  const ranges = MOOD_FEATURE_MAP[moodName];
  if (!ranges) return true;
  for (const [feature, [min, max]] of Object.entries(ranges)) {
    const val = features[feature];
    if (val !== undefined && val !== null) {
      if (val < min || val > max) return false;
    }
  }
  return true;
}

// =====================================================
// cATALOG DISCOVERY (replaces the deprecated /v1/recommendations call)
// =====================================================

// app that didn't already have "Extended Quota Mode" before Nov 27, 2024:
// https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api
// calling those endpoints now just 403s silently (caught below), which is why
// "recommendations" used to quietly collapse into a re-sort of whatever was
// already in trackMap (the user's own last ~30-150 top/recent tracks) — the

// there were no real audio features to filter on. GET /v1/search is NOT
// deprecated, so we use genre-filtered catalog search to pull real, fresh
// tracks from Spotify's full library instead.
const MOOD_GENRE_SEEDS = {
  'Joyful':      ['pop', 'dance pop', 'feel good'],
  'Excited':     ['edm', 'electropop', 'dance'],
  'Party':       ['party', 'hip hop', 'dance pop'],
  'Melancholic': ['sad', 'indie folk', 'singer-songwriter'],
  'Dreamy':      ['dream pop', 'shoegaze', 'ambient pop'],
  'Relaxed':     ['acoustic', 'chill', 'lo-fi'],
  'Chill':       ['chillhop', 'chill', 'indie pop'],
  'Focused':     ['instrumental', 'study beats', 'ambient'],
  'Romantic':    ['r&b', 'soul', 'love songs'],
  'Motivated':   ['workout', 'power pop', 'rock'],
  'Angry':       ['metal', 'punk', 'hard rock'],
  'Ambient':     ['ambient', 'atmospheric', 'drone'],
  // legacy aliases
  'Happy':       ['pop', 'feel good'],
  'Sad':         ['sad', 'singer-songwriter'],
  'Calm':        ['acoustic', 'chill'],
  'Energetic':   ['edm', 'dance'],
  'Focus':       ['instrumental', 'study beats'],
};
const ANY_MOOD_GENRES = ['pop', 'indie', 'rock', 'hip hop', 'electronic', 'r&b', 'alternative', 'folk'];

function sample(arr, n) {
  const copy = [...arr];
  const out = [];
  while (copy.length && out.length < n) {
    out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
  }
  return out;
}

function pickMoodFromValenceEnergy(valence, energy) {
  if (valence == null && energy == null) return null;
  const v = valence ?? 0.5;
  const e = energy ?? 0.5;
  let best = null;
  let bestDist = Infinity;
  for (const [mood, ranges] of Object.entries(MOOD_FEATURE_MAP)) {
    const vMid = (ranges.valence[0] + ranges.valence[1]) / 2;
    const eMid = (ranges.energy[0] + ranges.energy[1]) / 2;
    const dist = Math.hypot(v - vMid, e - eMid);
    if (dist < bestDist) {
      bestDist = dist;
      best = mood;
    }
  }
  return best;
}

export async function searchCatalogForMood(spotifyApi, moodKey, count, excludeIds) {
  const genres = moodKey
    ? (MOOD_GENRE_SEEDS[moodKey] || [moodKey.toLowerCase()])
    : sample(ANY_MOOD_GENRES, 3);

  const results = [];
  const seen = new Set(excludeIds);
  const perGenre = Math.min(50, Math.ceil(count / genres.length) + 10);

  for (const genre of genres) {
    if (results.length >= count) break;
    try {
      const randomOffset = Math.floor(Math.random() * 150); // dip into different parts of the catalog, not just top hits
      const res = await spotifyApi.searchTracks(`genre:"${genre}"`, {
        limit: perGenre,
        offset: randomOffset,
      });
      const tracks = res.body?.tracks?.items || [];
      for (const track of tracks) {
        if (track && track.id && !seen.has(track.id)) {
          seen.add(track.id);
          results.push({
            id: track.id,
            name: track.name,
            artists: track.artists,
            album: track.album,
            duration_ms: track.duration_ms,
            popularity: track.popularity || 0,
            explicit: track.explicit,
            external_urls: track.external_urls,
            preview_url: track.preview_url,
            features: null,
            mood: moodKey || null,
            source: 'catalog_search',
            searchedGenre: genre,
            rank: 50,
          });
        }
      }
    } catch (err) {
      console.warn(`⚠️ Catalog search failed for genre "${genre}":`, err.message);
    }
  }

  // shuffle so results aren't strictly grouped by genre order
  return sample(results, Math.min(count, results.length));
}

export async function getAudioFeaturesForTracks(spotifyApi, trackIds) {
  if (!trackIds || trackIds.length === 0) return {};
  const featureMap = {};

  const cleanTrackIds = trackIds.filter(id => typeof id === 'string' && /^[a-zA-Z0-9]{22}$/.test(id));
  
  for (let i = 0; i < cleanTrackIds.length; i += 100) {
    const batch = cleanTrackIds.slice(i, i + 100);
    try {
      const response = await spotifyApi.getAudioFeaturesForTracks(batch);
      const audioFeatures = response.body.audio_features || [];
      audioFeatures.forEach(feature => {
        if (feature && feature.id) {
          featureMap[feature.id] = {
            valence: feature.valence,
            energy: feature.energy,
            danceability: feature.danceability,
            acousticness: feature.acousticness,
            tempo: feature.tempo,
            loudness: feature.loudness,
            speechiness: feature.speechiness,
            instrumentalness: feature.instrumentalness,
          };
        }
      });
    } catch (err) {
      console.warn(`⚠️ Audio features batch of size ${batch.length} failed:`, err.message, `- trying individual retrieval`);
      for (const trackId of batch) {
        try {
          const singleRes = await spotifyApi.getAudioFeaturesForTracks([trackId]);
          const feature = singleRes.body.audio_features?.[0];
          if (feature && feature.id) {
            featureMap[feature.id] = {
              valence: feature.valence,
              energy: feature.energy,
              danceability: feature.danceability,
              acousticness: feature.acousticness,
              tempo: feature.tempo,
              loudness: feature.loudness,
              speechiness: feature.speechiness,
              instrumentalness: feature.instrumentalness,
            };
          }
        } catch (singleErr) {
          console.warn(`⚠️ Failed individual feature fetch for ${trackId}:`, singleErr.message);
        }
      }
    }
  }
  return featureMap;
}

export const getSpotifyRecommendations = async (req, res) => {
  const { limit = 30, mood = null, energy = null, valence = null } = req.query;
  const user = req.user;

  // fix: cache key includes valence/energy so slider changes invalidate cache
  // fix: parseFloat(null) returns NaN, which is fine — we check with != null
  const vParam = valence != null && valence !== '' ? parseFloat(valence) : null;
  const eParam = energy != null && energy !== '' ? parseFloat(energy) : null;
  const vKey = vParam != null ? Math.round(vParam * 10) : 'x';
  const eKey = eParam != null ? Math.round(eParam * 10) : 'x';
  const cacheKey = `spotify:recs:${user._id}:${mood || 'any'}:${vKey}:${eKey}:${limit}`;

  try {
    const cached = await getFromCache(cacheKey).catch(() => null);
    if (cached) {
      console.log('✅ Returning cached Spotify recommendations');
      return res.json(cached);
    }

    console.log(`🎯 Spotify-native recommendations (mood: ${mood || 'any'}, valence: ${vParam}, energy: ${eParam}, limit: ${limit})`);
    const spotifyApi = getSpotifyApi(user.accessToken);

    // determine mood-based target features for Spotify /recommendations API
    const targetMoodKey = mood
      ? Object.keys(MOOD_FEATURE_MAP).find(k => k.toLowerCase() === mood.toLowerCase()) || mood
      : null;
    const [topShort, topMedium, recentlyPlayed, savedTracks] = await Promise.all([
      spotifyApi.getMyTopTracks({ limit: 50, time_range: 'short_term' }).catch(() => ({ body: { items: [] } })),
      spotifyApi.getMyTopTracks({ limit: 50, time_range: 'medium_term' }).catch(() => ({ body: { items: [] } })),
      spotifyApi.getMyRecentlyPlayedTracks({ limit: 50 }).catch(() => ({ body: { items: [] } })),
      // liked Songs — the user's actual saved library, not just recent listening
      spotifyApi.getMySavedTracks({ limit: 50 }).catch(() => ({ body: { items: [] } })),
    ]);

    const trackMap = new Map();
    (topShort.body.items || []).forEach((track, i) => {
      if (track && track.id) trackMap.set(track.id, { ...track, source: 'top_short', rank: i });
    });
    (topMedium.body.items || []).forEach((track, i) => {
      if (track && track.id && !trackMap.has(track.id))
        trackMap.set(track.id, { ...track, source: 'top_medium', rank: i });
    });
    (savedTracks.body.items || []).forEach((item, i) => {
      const track = item?.track;
      if (track && track.id && !trackMap.has(track.id))
        trackMap.set(track.id, { ...track, source: 'saved', rank: i });
    });
    (recentlyPlayed.body.items || []).forEach(item => {
      const track = item?.track;
      if (track && track.id && !trackMap.has(track.id))
        trackMap.set(track.id, { ...track, source: 'recent', rank: 99 });
    });

    let discoveryTracks = [];
    try {
      const discoveryCount = Math.ceil(parseInt(limit) * 0.7); // catalog-driven, not history-driven
      const moodForSearch = targetMoodKey || pickMoodFromValenceEnergy(vParam, eParam);
      discoveryTracks = await searchCatalogForMood(spotifyApi, moodForSearch, discoveryCount, trackMap.keys());
      console.log(`🔍 Catalog discovery (mood: ${moodForSearch || 'any'}): ${discoveryTracks.length} new tracks`);
    } catch (discErr) {
      console.warn('⚠️ Catalog discovery failed:', discErr.message);
    }

    if (trackMap.size === 0 && discoveryTracks.length === 0) {
      return res.json({
        tracks: [], total: 0,
        message: 'No listening history found. Start listening on Spotify and try again!',
        source: 'spotify_native'
      });
    }

    // fetch audio features for library tracks
    const allTrackIds = Array.from(trackMap.keys());
    console.log(`🎵 Fetching audio features for ${allTrackIds.length} library tracks...`);
    const featureMap = await getAudioFeaturesForTracks(spotifyApi, allTrackIds);

    // mood tag they were searched under instead of silently losing it.)
    const discTrackIds = discoveryTracks.map(t => t.id);
    const discFeatureMap = discTrackIds.length > 0
      ? await getAudioFeaturesForTracks(spotifyApi, discTrackIds).catch(() => ({}))
      : {};

    const featuresAvailable = allTrackIds.length > 0 && Object.keys(featureMap).length > 0;

    discoveryTracks = discoveryTracks.map(t => ({
      ...t,
      features: discFeatureMap[t.id] || null,
      mood: discFeatureMap[t.id] ? inferMoodFromFeatures(discFeatureMap[t.id]) : t.mood,
    }));

    let enrichedTracks = Array.from(trackMap.values()).map(track => ({
      id: track.id,
      name: track.name,
      artists: track.artists,
      album: track.album,
      duration_ms: track.duration_ms,
      popularity: track.popularity || 0,
      explicit: track.explicit,
      external_urls: track.external_urls,
      preview_url: track.preview_url,
      features: featureMap[track.id] || null,
      mood: featureMap[track.id] ? inferMoodFromFeatures(featureMap[track.id]) : null,
      source: track.source,
      rank: track.rank,
    }));

    if (targetMoodKey && featuresAvailable) {
      enrichedTracks = enrichedTracks.filter(t => matchesMood(t.features, targetMoodKey));
      console.log(`🎭 Mood filter "${targetMoodKey}": ${enrichedTracks.length} library tracks match`);
    } else if (targetMoodKey && !featuresAvailable) {
      console.log('⚠️ Audio features unavailable from Spotify — library tracks are not mood-filtered, relying on catalog search for mood accuracy');
    }

    // slider filter — only meaningful with real feature data
    if ((vParam != null || eParam != null) && featuresAvailable) {
      const vTarget = vParam ?? 0.5;
      const eTarget = eParam ?? 0.5;
      const tolerance = 0.3;
      enrichedTracks = enrichedTracks.filter(t => {
        if (!t.features) return true;
        return Math.abs((t.features.valence ?? 0.5) - vTarget) <= tolerance
            && Math.abs((t.features.energy ?? 0.5) - eTarget) <= tolerance;
      });
    }

    // score and sort library tracks
    const sourceScore = { top_short: 3, saved: 2.5, top_medium: 2, recent: 1 };
    enrichedTracks.sort((a, b) => {
      const aS = (sourceScore[a.source] || 0) * 10 + (a.popularity || 0) * 0.1 - a.rank;
      const bS = (sourceScore[b.source] || 0) * 10 + (b.popularity || 0) * 0.1 - b.rank;
      return bS - aS;
    });

    const discoverySlice = discoveryTracks.slice(0, parseInt(limit));
    const librarySlice = enrichedTracks.slice(0, Math.max(0, parseInt(limit) - discoverySlice.length));
    const finalTracks = [...discoverySlice, ...librarySlice].slice(0, parseInt(limit));

    const moodDist = {};
    finalTracks.forEach(t => { if (t.mood) moodDist[t.mood] = (moodDist[t.mood] || 0) + 1; });

    const result = {
      tracks: finalTracks,
      total: finalTracks.length,
      moodDistribution: moodDist,
      dominantMood: Object.keys(moodDist).sort((a, b) => moodDist[b] - moodDist[a])[0] || null,
      source: 'spotify_native',
      featuresAvailable,
      message: finalTracks.length > 0
        ? `Found ${finalTracks.length} tracks (${discoverySlice.length} from the Spotify catalog + ${librarySlice.length} from your library)${featuresAvailable ? '' : ' — Spotify audio-features API is unavailable for this app, so mood matching is based on genre search rather than precise valence/energy filtering'}`
        : 'No tracks matched. Try adjusting the mood filter.',
      metadata: {
        tracksAnalyzed: trackMap.size,
        featuresLoaded: Object.keys(featureMap).length,
        moodFilter: targetMoodKey || null,
        discoveryCount: discoverySlice.length,
        generatedAt: new Date().toISOString()
      }
    };

    await setInCache(cacheKey, result, 300).catch(() => {}); // shorter TTL so refreshes actually surface new catalog picks
    console.log(`✅ Spotify recs: ${finalTracks.length} tracks (${discoverySlice.length} catalog + ${librarySlice.length} library)`);
    res.json(result);

  } catch (err) {
    console.error('❌ Spotify recommendations error:', err.message);
    if (err.statusCode === 401) {
      return res.status(401).json({ message: 'Spotify token expired', code: 'SPOTIFY_TOKEN_EXPIRED' });
    }
    res.status(500).json({ message: 'Failed to generate recommendations', error: err.message });
  }
};

export const analyzePlaylistDirect = async (req, res) => {
  const { playlistId } = req.body;
  if (!playlistId) return res.status(400).json({ message: 'playlistId is required' });

  const user = req.user;
  const cacheKey = `direct:playlist:mood:${playlistId}`;

  try {
    const cached = await getFromCache(cacheKey).catch(() => null);
    if (cached) return res.json(cached);

    console.log(`🎵 Direct Spotify playlist analysis: ${playlistId}`);
    const spotifyApi = getSpotifyApi(user.accessToken);

    // fetch all tracks (paginate)
    const tracks = [];
    let offset = 0;
    const pageLimit = 100;
    let total = 1;

    while (offset < total) {
      const page = await spotifyApi.getPlaylistTracks(playlistId, { limit: pageLimit, offset });
      const items = page.body.items || [];
      total = page.body.total;
      items.forEach(item => {
        const t = item?.track;
        if (t && t.id && t.type === 'track') tracks.push(t);
      });
      offset += pageLimit;
      if (items.length < pageLimit) break;
    }

    if (tracks.length === 0) {
      return res.json({ playlistId, tracks: [], total_tracks: 0, overallMood: 'Unknown', moodDistribution: {} });
    }

    // get audio features
    const trackIds = tracks.map(t => t.id);
    const featureMap = await getAudioFeaturesForTracks(spotifyApi, trackIds);

    // gET /v1/audio-features is deprecated for apps without Extended Quota
    // mode (see getAudioFeaturesForTracks above) and typically 403s silently,
    // returning an empty featureMap for every track. Without this check,
    // that reads as "we analyzed your playlist and every track is Unknown",
    // which looks like a real result instead of a degraded one.
    const featuresAvailable = Object.keys(featureMap).length > 0;
    if (!featuresAvailable) {
      console.warn('⚠️ Spotify audio-features API returned no usable data (likely deprecated/403 for this app). Direct playlist analysis will report all tracks as Unknown.');
    }

    // annotate with mood
    const moodDist = {};
    const analyzedTracks = tracks.map(track => {
      const features = featureMap[track.id] || null;
      const mood = features ? inferMoodFromFeatures(features) : 'Unknown';
      moodDist[mood] = (moodDist[mood] || 0) + 1;
      return {
        id: track.id,
        name: track.name,
        artist: track.artists?.[0]?.name || 'Unknown',
        artists: track.artists,
        album: track.album,
        mood,
        features,
        confidence: null, // no real confidence score in rule-based fallback
        source: 'spotify_direct'
      };
    });

    const sortedMoods = Object.entries(moodDist).sort((a, b) => b[1] - a[1]);
    const overallMood = sortedMoods[0]?.[0] || 'Unknown';
    const total_tracks = analyzedTracks.length;
    const dominantPct = total_tracks > 0 ? Math.round((sortedMoods[0]?.[1] || 0) / total_tracks * 100) : 0;

    const result = {
      playlistId,
      tracks: analyzedTracks,
      total_tracks,
      moodDistribution: moodDist,
      overallMood,
      dominant_percentage: dominantPct,
      mood_diversity: sortedMoods.length,
      source: 'spotify_direct',
      features_available: featuresAvailable,
      message: featuresAvailable
        ? undefined
        : 'Mood analysis is degraded: Spotify\'s audio-features API is unavailable for this app, so tracks could not be tagged by mood. Try again once the primary analysis service is back up.',
      analyzedAt: new Date().toISOString()
    };

    // don't cache a fully-degraded result — caching it would keep serving
    // "all Unknown" for an hour even after the ML service (or Spotify's
    // aPI) recovers.
    if (featuresAvailable) {
      await setInCache(cacheKey, result, 3600).catch(() => {});
    }
    console.log(`✅ Direct analysis: ${total_tracks} tracks, mood: ${overallMood}${featuresAvailable ? '' : ' (degraded — no audio features available)'}`);
    res.json(result);

  } catch (err) {
    console.error('❌ Direct playlist analysis error:', err.message);
    if (err.statusCode === 401) return res.status(401).json({ message: 'Spotify token expired', code: 'SPOTIFY_TOKEN_EXPIRED' });
    res.status(500).json({ message: 'Failed to analyze playlist', error: err.message });
  }
};

export const getMoodFromRecentlyPlayed = async (req, res) => {
  const user = req.user;
  try {
    console.log('📊 Computing mood trends from recently played...');
    const spotifyApi = getSpotifyApi(user.accessToken);

    const recent = await spotifyApi.getMyRecentlyPlayedTracks({ limit: 50 });
    const items = recent.body.items || [];

    if (items.length === 0) {
      return res.json({ trends: [], moodDistribution: {}, overallMood: 'Unknown', totalTracks: 0, message: 'No recent listening history found' });
    }

    // get unique tracks
    const trackMap = new Map();
    items.forEach(item => {
      const t = item?.track;
      if (t && t.id) trackMap.set(t.id, { ...t, played_at: item.played_at });
    });

    const trackIds = Array.from(trackMap.keys());
    const featureMap = await getAudioFeaturesForTracks(spotifyApi, trackIds);

    // build mood timeline grouped by day
    const dayMap = {};
    const moodDist = {};

    Array.from(trackMap.values()).forEach(track => {
      const features = featureMap[track.id] || null;
      const mood = features ? inferMoodFromFeatures(features) : 'Unknown';
      moodDist[mood] = (moodDist[mood] || 0) + 1;

      const day = track.played_at ? new Date(track.played_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
      if (!dayMap[day]) dayMap[day] = { date: day, moods: {}, tracks: [], total_tracks: 0 };
      dayMap[day].moods[mood] = (dayMap[day].moods[mood] || 0) + 1;
      dayMap[day].total_tracks++;
      dayMap[day].tracks.push({ track: track.name, artist: track.artists?.[0]?.name, mood, features });
    });

    const trends = Object.values(dayMap)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(day => ({
        ...day,
        dominant_mood: Object.entries(day.moods).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Unknown'
      }));

    const sortedMoods = Object.entries(moodDist).sort((a, b) => b[1] - a[1]);
    const overallMood = sortedMoods[0]?.[0] || 'Unknown';

    res.json({
      trends,
      moodDistribution: moodDist,
      overallMood,
      totalTracks: trackMap.size,
      source: 'recently_played',
      statistics: { analyzedAt: new Date().toISOString(), uniqueMoods: sortedMoods.length }
    });

  } catch (err) {
    console.error('❌ Recent mood trends error:', err.message);
    if (err.statusCode === 401) return res.status(401).json({ message: 'Spotify token expired', code: 'SPOTIFY_TOKEN_EXPIRED' });
    res.status(500).json({ message: 'Failed to compute mood trends', error: err.message });
  }
};

export default {
  getSpotifyRecommendations,
  analyzePlaylistDirect,
  getMoodFromRecentlyPlayed,
  MOOD_FEATURE_MAP,
  inferMoodFromFeatures,
  getAudioFeaturesForTracks,
};