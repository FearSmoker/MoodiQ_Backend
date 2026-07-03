import SpotifyWebApi from 'spotify-web-api-node';
import * as mlService from '../services/mlService.js';
import { getFromCache, setInCache } from '../services/cacheService.js';
import { broadcastUpdate } from '../services/socketService.js';
import { CACHE_TTL } from '../utils/constants.js';
import { analyzePlaylistDirect } from './recommendationsController.js';

const getSpotifyApi = (accessToken) => {
  const spotifyApi = new SpotifyWebApi();
  spotifyApi.setAccessToken(accessToken);
  return spotifyApi;
};

/**
 * Maps the mood names shown in the FlowOptimizer dropdown (MOOD_OPTIONS in
 * FlowOptimizer.jsx) to approximate {valence, energy, danceability} scores.
 * The Python /optimize/flow endpoint (optimize_router.py) requires
 * start_mood/end_mood as Dict[str, float] — it cannot accept a bare mood
 * name string. Without this conversion, every optimize request fails
 * Pydantic validation (422) and the frontend just shows a generic
 * "Failed to optimize flow" toast.
 */
const MOOD_PROFILES = {
  joyful:      { valence: 0.85, energy: 0.70, danceability: 0.70 },
  excited:     { valence: 0.80, energy: 0.85, danceability: 0.75 },
  party:       { valence: 0.75, energy: 0.85, danceability: 0.90 },
  melancholic: { valence: 0.20, energy: 0.30, danceability: 0.30 },
  dreamy:      { valence: 0.55, energy: 0.25, danceability: 0.30 },
  relaxed:     { valence: 0.60, energy: 0.25, danceability: 0.40 },
  chill:       { valence: 0.55, energy: 0.35, danceability: 0.45 },
  focused:     { valence: 0.50, energy: 0.30, danceability: 0.30 },
  romantic:    { valence: 0.65, energy: 0.35, danceability: 0.45 },
  motivated:   { valence: 0.70, energy: 0.80, danceability: 0.60 },
  angry:       { valence: 0.15, energy: 0.85, danceability: 0.40 },
  ambient:     { valence: 0.50, energy: 0.15, danceability: 0.20 },
};

/**
 * Normalizes a mood value coming from the frontend into the
 * {valence, energy, danceability} shape the ML service expects.
 * Accepts a mood name string (current frontend behavior), a feature
 * dict already in the right shape, or null/undefined.
 */
const resolveMoodProfile = (moodValue) => {
  if (!moodValue) return null;

  if (typeof moodValue === 'object') {
    // Already a feature dict (e.g. {valence, energy, danceability})
    return moodValue;
  }

  if (typeof moodValue === 'string') {
    const profile = MOOD_PROFILES[moodValue.toLowerCase()];
    if (profile) return profile;
    console.warn(`⚠️ Unknown mood name "${moodValue}", letting ML service use its default`);
    return null;
  }

  return null;
};

/**
 * Reconciles two known track shapes into the one FlowOptimizer.jsx actually
 * reads (`track.mood` as a string, `track.features.{valence,energy,...}`):
 *
 *  - ML hybrid path (mlService.analyzeSpotifyPlaylist -> Python
 *    /predict/spotify/playlist): tracks come back as
 *    { moodDetails: { primary_mood, scores: {valence, energy, ...} }, ... }
 *  - Direct fallback path (recommendationsController.analyzePlaylistDirect):
 *    tracks come back as { mood: "Chill", features: {valence, energy, ...} }
 *
 * Without this, FlowOptimizer silently shows "Unknown" mood tags and no
 * energy/valence badges whenever the ML hybrid path succeeds (the common
 * case), since it never reads `.moodDetails`.
 */
const normalizeTrackForFlow = (track) => {
  if (!track) return track;

  const features = track.features || track.moodDetails?.scores || null;

  const mood =
    typeof track.mood === 'string'
      ? track.mood
      : track.moodDetails?.primary_mood || track.mood?.primary_mood || 'Unknown';

  return { ...track, mood, features };
};

/**
 * @desc    Get user's playlists
 * @route   GET /api/playlists
 * @access  Protected
 */
export const getPlaylists = async (req, res) => {
  try {
    const spotifyApi = getSpotifyApi(req.user.accessToken);
    const data = await spotifyApi.getUserPlaylists(req.user.spotifyId);
    
    res.json({
      playlists: data.body.items,
      total: data.body.total
    });
  } catch (err) {
    console.error('Error fetching playlists:', err.message);
    
    if (err.statusCode === 401) {
      return res.status(401).json({ 
        message: 'Spotify token expired',
        code: 'SPOTIFY_TOKEN_EXPIRED'
      });
    }
    
    res.status(500).json({ message: 'Failed to fetch playlists' });
  }
};

/**
 * @desc    Get a specific playlist with tracks
 * @route   GET /api/playlists/:id
 * @access  Protected
 */
export const getPlaylist = async (req, res) => {
  const { id } = req.params;

  try {
    const spotifyApi = getSpotifyApi(req.user.accessToken);
    const playlist = await spotifyApi.getPlaylist(id);
    
    res.json(playlist.body);
  } catch (err) {
    console.error('Error fetching playlist:', err.message);
    
    if (err.statusCode === 401) {
      return res.status(401).json({ 
        message: 'Spotify token expired',
        code: 'SPOTIFY_TOKEN_EXPIRED'
      });
    }
    
    res.status(500).json({ message: 'Failed to fetch playlist details' });
  }
};

/**
 * @desc    Analyze playlist mood using ML API (HYBRID APPROACH)
 * @route   POST /api/playlists/mood
 * @access  Protected
 */
export const getPlaylistMood = async (req, res) => {
  const { playlistId } = req.body;
  const user = req.user;
  const cacheKey = `playlist:mood:${playlistId}:${user._id}`;

  if (!playlistId) {
    return res.status(400).json({ message: 'Playlist ID is required' });
  }

  try {
    // Check cache first
    const cachedData = await getFromCache(cacheKey).catch(() => null);
    if (cachedData) {
      console.log('✅ Returning cached mood data');
      return res.json(cachedData);
    }

    console.log('🔍 Analyzing Spotify playlist via ML API (HYBRID)...');

    let result = null;
    let mlFailed = false;

    // 1. Try ML service first
    try {
      const moodResponse = await mlService.analyzeSpotifyPlaylist(
        playlistId,
        user.accessToken,
        user._id.toString()
      );

      console.log('✅ ML API mood prediction successful (HYBRID)');
      result = {
        playlistId,
        tracks: moodResponse.tracks,
        total_tracks: moodResponse.total_tracks,
        moodDistribution: moodResponse.moodDistribution || {},
        overallMood: moodResponse.overallMood || 'Mixed',
        mood_diversity: moodResponse.mood_diversity,
        dominant_percentage: moodResponse.dominant_percentage,
        source: 'ml_hybrid',
        analyzedAt: new Date().toISOString(),
      };
    } catch (mlErr) {
      console.warn(`⚠️ ML unavailable (${mlErr.message}), falling back to direct Spotify analysis`);
      mlFailed = true;
    }

    // 2. Fallback: direct Spotify audio features + rule-based mood (no ML required)
    if (mlFailed || !result) {
      console.log('🎵 Running direct Spotify playlist analysis...');
      // Simulate a req/res pair to reuse analyzePlaylistDirect
      const fakeReq = { body: { playlistId }, user };
      let directResult = null;
      const fakeRes = {
        json: (data) => { directResult = data; },
        status: () => ({ json: () => {} })
      };
      await analyzePlaylistDirect(fakeReq, fakeRes);
      
      if (directResult) {
        result = directResult;
        console.log(`✅ Direct Spotify analysis: ${result.total_tracks} tracks, mood: ${result.overallMood}`);
      }
    }

    if (!result) {
      return res.status(503).json({
        message: 'Playlist analysis temporarily unavailable. Please try again.',
        code: 'ANALYSIS_UNAVAILABLE'
      });
    }

    // Normalize track shape once, regardless of whether ML hybrid or the
    // direct fallback produced it, so every downstream consumer
    // (FlowOptimizer, MoodCloud, detectMoodGaps, etc.) sees the same shape.
    if (Array.isArray(result.tracks)) {
      result.tracks = result.tracks.map(normalizeTrackForFlow);
    }

    // Cache the result — but not if it's a degraded fallback (no audio
    // features available), since that would keep serving an "all Unknown"
    // analysis for the full TTL even after the ML service or Spotify's API
    // recovers.
    if (result.features_available !== false) {
      await setInCache(cacheKey, result, CACHE_TTL.MOOD_ANALYSIS).catch(() => {});
    }

    // Send real-time update
    try {
      broadcastUpdate({
        type: 'playlist_analyzed',
        userId: user._id.toString(),
        playlistId: playlistId,
        overallMood: result.overallMood,
        trackCount: result.total_tracks,
      });
    } catch (_) {}

    res.json(result);

  } catch (err) {
    console.error('❌ Error analyzing playlist mood:', err.message);
    
    if (err.statusCode === 401) {
      return res.status(401).json({ 
        message: 'Spotify token expired',
        code: 'SPOTIFY_TOKEN_EXPIRED'
      });
    }
    
    res.status(500).json({ 
      message: 'Failed to analyze playlist mood',
      error: err.message 
    });
  }
};

/**
 * @desc    Analyze currently playing track (HYBRID APPROACH)
 * @route   GET /api/playlists/currently-playing
 * @access  Protected
 */
export const getCurrentlyPlayingMood = async (req, res) => {
  const user = req.user;

  try {
    console.log('🎧 Analyzing currently playing track (HYBRID)...');
    
    // Use ML Service HYBRID approach
    const analysis = await mlService.analyzeCurrentlyPlaying(
      user.accessToken,
      user._id.toString()
    );

    if (!analysis.is_playing) {
      return res.json({
        is_playing: false,
        message: 'No track currently playing'
      });
    }

    console.log('✅ Currently playing analysis complete');

    res.json(analysis);

  } catch (err) {
    console.error('❌ Error analyzing currently playing:', err.message);
    
    if (err.statusCode === 401) {
      return res.status(401).json({ 
        message: 'Spotify token expired',
        code: 'SPOTIFY_TOKEN_EXPIRED'
      });
    }
    
    // Return a graceful 200 fallback for 503 / 500 or connection errors
    return res.json({
      is_playing: false,
      message: `Currently playing mood temporarily unavailable (${err.message})`
    });
  }
};

/**
 * @desc    Optimize playlist flow for smooth transitions
 * @route   POST /api/playlists/optimize
 * @access  Protected
 */
export const optimizePlaylistFlow = async (req, res) => {
  const { tracks, startMood, endMood, algorithm } = req.body;

  if (!tracks || !Array.isArray(tracks) || tracks.length === 0) {
    return res.status(400).json({ message: 'Tracks array is required' });
  }

  try {
    console.log(`🔄 Optimizing playlist flow with ${tracks.length} tracks using ${algorithm || 'dynamic_programming'}`);

    // Frontend sends mood NAMES (e.g. "Chill", "Joyful") from the
    // FlowOptimizer dropdowns. The ML service needs feature score dicts.
    const startMoodProfile = resolveMoodProfile(startMood);
    const endMoodProfile = resolveMoodProfile(endMood);

    const flowResponse = await mlService.optimizePlaylistFlow(
      tracks,
      startMoodProfile,
      endMoodProfile,
      algorithm || 'dynamic_programming',
      req.user._id.toString()
    );

    console.log('✅ Flow optimization successful');

    res.json({
      optimizedOrder: flowResponse.optimizedOrder,
      flowScore: flowResponse.flowScore,
      transitions: flowResponse.transitions,
      algorithm: algorithm || 'dynamic_programming',
    });

  } catch (err) {
    console.error('❌ Error optimizing playlist flow:', err.message);
    
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
      return res.status(503).json({ 
        message: 'ML service is currently unavailable',
        code: 'ML_SERVICE_UNAVAILABLE'
      });
    }

    if (err.response?.status === 422) {
      console.error('❌ ML service rejected the request payload:', JSON.stringify(err.response.data));
      return res.status(422).json({
        message: 'Invalid optimization request',
        code: 'ML_VALIDATION_ERROR',
        details: err.response.data
      });
    }
    
    res.status(500).json({ message: 'Failed to optimize playlist flow' });
  }
};

/**
 * @desc    Detect mood gaps in playlist
 * @route   POST /api/playlists/gaps
 * @access  Protected
 */
export const detectMoodGaps = async (req, res) => {
  const { tracks, threshold = 1.5 } = req.body;

  if (!tracks || !Array.isArray(tracks) || tracks.length === 0) {
    return res.status(400).json({ message: 'Tracks array is required' });
  }

  try {
    console.log(`🔍 Detecting mood gaps in ${tracks.length} tracks`);
    
    const gaps = [];
    let tracksMissingFeatures = 0;
    
    for (let i = 0; i < tracks.length - 1; i++) {
      const currentMood = tracks[i].moodDetails?.scores || tracks[i].features;
      const nextMood = tracks[i + 1].moodDetails?.scores || tracks[i + 1].features;
      
      if (currentMood && nextMood) {
        const v1 = currentMood.valence || 0.5;
        const e1 = currentMood.energy || 0.5;
        const v2 = nextMood.valence || 0.5;
        const e2 = nextMood.energy || 0.5;
        
        const distance = Math.sqrt((v1 - v2) ** 2 + (e1 - e2) ** 2);
        
        if (distance > threshold) {
          gaps.push({
            position: i + 1,
            from_track: tracks[i].name,
            to_track: tracks[i + 1].name,
            distance: distance,
            severity: distance > 2.0 ? 'high' : 'medium',
            recommended_bridge_mood: {
              valence: (v1 + v2) / 2,
              energy: (e1 + e2) / 2
            }
          });
        }
      } else {
        tracksMissingFeatures++;
      }
    }

    if (tracksMissingFeatures > 0) {
      console.warn(`⚠️ ${tracksMissingFeatures} track pair(s) had no mood/feature data — skipped in gap detection`);
    }

    console.log(`✅ Found ${gaps.length} mood gaps`);

    res.json({
      gaps,
      total_gaps: gaps.length,
      threshold,
      tracks_missing_features: tracksMissingFeatures,
      // True if literally none of the tracks had usable mood/feature data,
      // as opposed to genuinely having no gaps.
      analysis_incomplete: tracksMissingFeatures === tracks.length - 1 && tracks.length > 1
    });

  } catch (err) {
    console.error('❌ Error detecting mood gaps:', err.message);
    res.status(500).json({ message: 'Failed to detect mood gaps' });
  }
};

/**
 * @desc    Fill mood gaps with recommendations
 * @route   POST /api/playlists/fill-gaps
 * @access  Protected
 */
export const fillMoodGaps = async (req, res) => {
  const { tracks } = req.body;

  if (!tracks || !Array.isArray(tracks) || tracks.length === 0) {
    return res.status(400).json({ message: 'Tracks array is required' });
  }

  try {
    console.log(`🎵 Filling mood gaps for ${tracks.length} tracks`);
    
    const fillResponse = await mlService.generatePersonalizedPlaylist(
      req.user._id.toString(),
      req.user.accessToken,
      20
    );

    console.log(`✅ Generated recommendations for gap filling`);

    res.json({
      recommendations: fillResponse.tracks || [],
      total: fillResponse.tracks?.length || 0,
      message: 'Use these tracks to smooth transitions'
    });

  } catch (err) {
    console.error('❌ Error filling mood gaps:', err.message);
    
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
      return res.status(503).json({ 
        message: 'ML service is currently unavailable',
        code: 'ML_SERVICE_UNAVAILABLE'
      });
    }
    
    res.status(500).json({ message: 'Failed to fill mood gaps' });
  }
};

/**
 * @desc    Generate mood-based playlist (HYBRID)
 * @route   POST /api/playlists/generate/mood
 * @access  Protected
 */
export const generateMoodPlaylist = async (req, res) => {
  const { targetMood, limit = 20, seedTrackId } = req.body;

  if (!targetMood) {
    return res.status(400).json({ message: 'Target mood is required' });
  }

  try {
    console.log(`🎨 Generating ${targetMood} playlist (HYBRID)`);
    
    const playlistResponse = await mlService.generateMoodPlaylist(
      targetMood,
      req.user._id.toString(),
      req.user.accessToken,
      seedTrackId,
      limit
    );

    console.log(`✅ Generated ${playlistResponse.total} tracks`);

    res.json(playlistResponse);

  } catch (err) {
    console.error('❌ Error generating mood playlist:', err.message);
    
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
      return res.status(503).json({ 
        message: 'ML service is currently unavailable',
        code: 'ML_SERVICE_UNAVAILABLE'
      });
    }
    
    res.status(500).json({ message: 'Failed to generate mood playlist' });
  }
};

/**
 * @desc    Generate activity-based playlist (HYBRID)
 * @route   POST /api/playlists/generate/activity
 * @access  Protected
 */
export const generateActivityPlaylist = async (req, res) => {
  const { activity, limit = 20, seedTrackId } = req.body;

  if (!activity) {
    return res.status(400).json({ message: 'Activity is required' });
  }

  try {
    console.log(`🏃 Generating ${activity} playlist (HYBRID)`);
    
    const playlistResponse = await mlService.generateActivityPlaylist(
      activity,
      req.user._id.toString(),
      req.user.accessToken,
      seedTrackId,
      limit
    );

    console.log(`✅ Generated ${playlistResponse.total} tracks`);

    res.json(playlistResponse);

  } catch (err) {
    console.error('❌ Error generating activity playlist:', err.message);
    
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
      return res.status(503).json({ 
        message: 'ML service is currently unavailable',
        code: 'ML_SERVICE_UNAVAILABLE'
      });
    }
    
    res.status(500).json({ message: 'Failed to generate activity playlist' });
  }
};

/**
 * @desc    Generate from user's top tracks (HYBRID SPOTIFY INTEGRATION)
 * @route   POST /api/playlists/generate/from-top-tracks
 * @access  Protected
 */
export const generateFromTopTracks = async (req, res) => {
  const { targetMood, limit = 20, timeRange = 'medium_term' } = req.body;

  try {
    console.log(`🎵 Generating playlist from top tracks (HYBRID)`);
    
    const playlistResponse = await mlService.generateFromTopTracks(
      req.user._id.toString(),
      req.user.accessToken,
      targetMood,
      limit,
      timeRange
    );

    console.log(`✅ Generated ${playlistResponse.total} tracks from top tracks`);

    res.json(playlistResponse);

  } catch (err) {
    console.error('❌ Error generating from top tracks:', err.message);
    
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
      return res.status(503).json({ 
        message: 'ML service is currently unavailable',
        code: 'ML_SERVICE_UNAVAILABLE'
      });
    }
    
    res.status(500).json({ message: 'Failed to generate from top tracks' });
  }
};

/**
 * @desc    Generate from recently played (HYBRID SPOTIFY INTEGRATION)
 * @route   POST /api/playlists/generate/from-recently-played
 * @access  Protected
 */
export const generateFromRecentlyPlayed = async (req, res) => {
  const { targetMood, limit = 20 } = req.body;

  try {
    console.log(`⏮️ Generating playlist from recently played (HYBRID)`);
    
    const playlistResponse = await mlService.generateFromRecentlyPlayed(
      req.user._id.toString(),
      req.user.accessToken,
      targetMood,
      limit
    );

    console.log(`✅ Generated ${playlistResponse.total} tracks from recently played`);

    res.json(playlistResponse);

  } catch (err) {
    console.error('❌ Error generating from recently played:', err.message);
    
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
      return res.status(503).json({ 
        message: 'ML service is currently unavailable',
        code: 'ML_SERVICE_UNAVAILABLE'
      });
    }
    
    res.status(500).json({ message: 'Failed to generate from recently played' });
  }
};

/**
 * @desc    Get personalized recommendations (HYBRID)
 * @route   POST /api/playlists/recommendations
 * @access  Protected
 */
export const getRecommendations = async (req, res) => {
  const { limit = 20 } = req.body;
  const user = req.user;

  try {
    console.log('🎯 Fetching personalized recommendations (HYBRID)');
    
    const recommendations = await mlService.generatePersonalizedPlaylist(
      user._id.toString(),
      user.accessToken,
      limit
    );

    console.log('✅ Recommendations retrieved successfully');

    res.json({
      tracks: recommendations.tracks || [],
      source: 'ml_personalized',
      personalized: recommendations.personalized || false,
      user_preferences: recommendations.user_preferences || {},
      message: recommendations.message,
      total: recommendations.total
    });

  } catch (err) {
    console.error('❌ Error getting recommendations:', err.message);
    
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
      return res.status(503).json({ 
        message: 'ML service is currently unavailable',
        code: 'ML_SERVICE_UNAVAILABLE'
      });
    }
    
    res.status(500).json({ message: 'Failed to get recommendations' });
  }
};

/**
 * @desc    Create a new playlist on Spotify
 * @route   POST /api/playlists/create
 * @access  Protected
 */
export const createPlaylist = async (req, res) => {
  const { name, description, trackUris, isPublic } = req.body;

  if (!name) {
    return res.status(400).json({ message: 'Playlist name is required' });
  }

  try {
    const spotifyApi = getSpotifyApi(req.user.accessToken);
    
    const playlist = await spotifyApi.createPlaylist(name, {
      description: description || 'Created by MoodiQ-AI',
      public: isPublic !== false,
    });

    if (trackUris && Array.isArray(trackUris) && trackUris.length > 0) {
      const batches = [];
      for (let i = 0; i < trackUris.length; i += 100) {
        batches.push(trackUris.slice(i, i + 100));
      }

      for (const batch of batches) {
        await spotifyApi.addTracksToPlaylist(playlist.body.id, batch);
      }
    }

    console.log(`✅ Created playlist: ${name} with ${trackUris?.length || 0} tracks`);

    res.json({
      id: playlist.body.id,
      name: playlist.body.name,
      url: playlist.body.external_urls.spotify,
      tracksAdded: trackUris?.length || 0,
    });

  } catch (err) {
    console.error('Error creating playlist:', err.message);
    
    if (err.statusCode === 401) {
      return res.status(401).json({ 
        message: 'Spotify token expired',
        code: 'SPOTIFY_TOKEN_EXPIRED'
      });
    }
    
    res.status(500).json({ message: 'Failed to create playlist' });
  }
};

/**
 * @desc    Update playlist order
 * @route   PUT /api/playlists/:id/reorder
 * @access  Protected
 */
export const reorderPlaylist = async (req, res) => {
  const { id } = req.params;
  const { trackUris } = req.body;

  if (!trackUris || !Array.isArray(trackUris)) {
    return res.status(400).json({ message: 'Track URIs array is required' });
  }

  try {
    const spotifyApi = getSpotifyApi(req.user.accessToken);
    await spotifyApi.replaceTracksInPlaylist(id, trackUris);

    console.log(`✅ Reordered playlist ${id} with ${trackUris.length} tracks`);

    res.json({ 
      success: true, 
      message: 'Playlist reordered successfully',
      trackCount: trackUris.length 
    });

  } catch (err) {
    console.error('Error reordering playlist:', err.message);
    
    if (err.statusCode === 401) {
      return res.status(401).json({ 
        message: 'Spotify token expired',
        code: 'SPOTIFY_TOKEN_EXPIRED'
      });
    }
    
    res.status(500).json({ message: 'Failed to reorder playlist' });
  }
};