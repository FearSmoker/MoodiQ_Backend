import SpotifyWebApi from 'spotify-web-api-node';
import * as mlService from '../services/mlService.js';
import { getFromCache, setInCache } from '../services/cacheService.js';
import { broadcastUpdate } from '../services/socketService.js';
import { CACHE_TTL } from '../utils/constants.js';

const getSpotifyApi = (accessToken) => {
  const spotifyApi = new SpotifyWebApi();
  spotifyApi.setAccessToken(accessToken);
  return spotifyApi;
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
 * @desc    Analyze playlist mood using ML API
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
    const cachedData = await getFromCache(cacheKey);
    if (cachedData) {
      console.log('✅ Returning cached mood data');
      return res.json(cachedData);
    }

    console.log('🔍 Fetching fresh mood data from Spotify and ML API');
    
    // Get tracks from Spotify
    const spotifyApi = getSpotifyApi(user.accessToken);
    const tracksData = await spotifyApi.getPlaylistTracks(playlistId, {
      fields: 'items(track(id,name,artists,album,duration_ms,preview_url))',
    });
    
    const tracks = tracksData.body.items
      .filter(item => item.track && item.track.id)
      .map(item => ({
        id: item.track.id,
        name: item.track.name,
        artists: item.track.artists.map(a => a.name),
        album: item.track.album.name,
        duration_ms: item.track.duration_ms,
        preview_url: item.track.preview_url,
      }));

    if (tracks.length === 0) {
      return res.status(400).json({ message: 'No valid tracks found in playlist' });
    }

    const trackIds = tracks.map(t => t.id);

    // Get audio features from Spotify
    const featuresData = await spotifyApi.getAudioFeaturesForTracks(trackIds);
    const features = featuresData.body.audio_features;

    console.log(`📊 Sending ${trackIds.length} tracks to ML API for mood analysis...`);

    // Call ML API to get mood predictions
    const moodResponse = await mlService.analyzePlaylistMood({
      track_ids: trackIds,
      audio_features: features,
      access_token: user.accessToken,
      user_id: user._id.toString(),
    });

    console.log('✅ ML API mood prediction successful');

    const result = {
      playlistId,
      tracks: moodResponse.tracks,
      moodDistribution: moodResponse.moodDistribution || {},
      overallMood: moodResponse.overallMood || 'Mixed',
      totalTracks: tracks.length,
      analyzedAt: new Date().toISOString(),
    };

    // Cache the result
    await setInCache(cacheKey, result, CACHE_TTL.MOOD_ANALYSIS);

    // Send real-time update
    broadcastUpdate({
      type: 'playlist_analyzed',
      userId: user._id.toString(),
      playlistId: playlistId,
      overallMood: result.overallMood,
      trackCount: tracks.length,
    });

    res.json(result);

  } catch (err) {
    console.error('❌ Error analyzing playlist mood:', err.message);
    
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
      return res.status(503).json({ 
        message: 'ML service is currently unavailable. Please try again later.',
        code: 'ML_SERVICE_UNAVAILABLE'
      });
    }
    
    if (err.response) {
      console.error('ML API Error Response:', err.response.data);
      return res.status(err.response.status).json({ 
        message: 'ML API error: ' + (err.response.data?.detail || err.message),
        code: 'ML_API_ERROR'
      });
    }
    
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
    
    // Call ML API's Flow Optimizer
    const flowResponse = await mlService.optimizePlaylistFlow(
      tracks,
      startMood,
      endMood,
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
    
    if (err.response) {
      return res.status(err.response.status).json({ 
        message: 'ML API error: ' + (err.response.data?.detail || err.message) 
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
    
    const gapsResponse = await mlService.detectMoodGaps(tracks, threshold);

    console.log(`✅ Found ${gapsResponse.gaps.length} mood gaps`);

    res.json(gapsResponse);

  } catch (err) {
    console.error('❌ Error detecting mood gaps:', err.message);
    
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
      return res.status(503).json({ 
        message: 'ML service is currently unavailable',
        code: 'ML_SERVICE_UNAVAILABLE'
      });
    }
    
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
    
    const fillResponse = await mlService.fillMoodGaps(
      tracks,
      req.user.accessToken,
      req.user._id.toString()
    );

    console.log(`✅ Generated recommendations for ${fillResponse.total_gaps} gaps`);

    res.json(fillResponse);

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
 * @desc    Generate mood-based playlist
 * @route   POST /api/playlists/generate/mood
 * @access  Protected
 */
export const generateMoodPlaylist = async (req, res) => {
  const { targetMood, limit = 20, seedTracks = [] } = req.body;

  if (!targetMood) {
    return res.status(400).json({ message: 'Target mood is required' });
  }

  try {
    console.log(`🎨 Generating ${targetMood} playlist`);
    
    const playlistResponse = await mlService.generateMoodPlaylist(
      targetMood,
      req.user._id.toString(),
      req.user.accessToken,
      limit,
      seedTracks
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
 * @desc    Generate activity-based playlist
 * @route   POST /api/playlists/generate/activity
 * @access  Protected
 */
export const generateActivityPlaylist = async (req, res) => {
  const { activity, limit = 20 } = req.body;

  if (!activity) {
    return res.status(400).json({ message: 'Activity is required' });
  }

  try {
    console.log(`🏃 Generating ${activity} playlist`);
    
    const playlistResponse = await mlService.generateActivityPlaylist(
      activity,
      req.user._id.toString(),
      req.user.accessToken,
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
 * @desc    Get personalized recommendations using hybrid model
 * @route   POST /api/playlists/recommendations
 * @access  Protected
 */
export const getRecommendations = async (req, res) => {
  const { seed_tracks, seed_genres, target_valence, target_energy, limit } = req.body;
  const user = req.user;

  try {
    console.log('🎯 Fetching hybrid ML recommendations');
    
    // Try hybrid ML model first
    const hybridResponse = await mlService.getHybridRecommendations(
      seed_tracks || [],
      seed_genres || [],
      target_valence,
      target_energy,
      user._id.toString(),
      user.accessToken,
      limit || 20
    );

    console.log('✅ ML recommendations retrieved successfully');

    res.json(hybridResponse);

  } catch (mlError) {
    console.warn(`⚠️ ML recommendations failed: ${mlError.message}. Falling back to Spotify.`);

    try {
      // Fallback to Spotify's recommendation API
      const spotifyApi = getSpotifyApi(user.accessToken);

      const seedTracks = seed_tracks?.slice(0, 3) || [];
      const seedGenres = seed_genres?.slice(0, 2) || [];

      // If no seeds, get user's top tracks
      if (seedTracks.length === 0 && seedGenres.length === 0) {
        const topTracks = await spotifyApi.getMyTopTracks({ limit: 5, time_range: 'short_term' });
        seedTracks.push(...topTracks.body.items.slice(0, 3).map(t => t.id));
      }

      const recommendations = await spotifyApi.getRecommendations({
        seed_tracks: seedTracks,
        seed_genres: seedGenres,
        target_valence,
        target_energy,
        limit: limit || 20,
      });

      console.log('✅ Spotify fallback recommendations retrieved');

      res.json({
        tracks: recommendations.body.tracks,
        source: 'spotify_fallback',
        message: 'Using Spotify recommendations (ML service unavailable)',
      });

    } catch (spotifyError) {
      console.error(`❌ Spotify fallback failed: ${spotifyError.message}`);
      res.status(500).json({ message: 'Failed to get recommendations from all sources' });
    }
  }
};

/**
 * @desc    Get audio features for tracks
 * @route   POST /api/playlists/features
 * @access  Protected
 */
export const getAudioFeatures = async (req, res) => {
  const { trackIds } = req.body;

  if (!trackIds || !Array.isArray(trackIds) || trackIds.length === 0) {
    return res.status(400).json({ message: 'Track IDs array is required' });
  }

  try {
    const spotifyApi = getSpotifyApi(req.user.accessToken);
    
    // Spotify limits to 100 tracks per request
    const batches = [];
    for (let i = 0; i < trackIds.length; i += 100) {
      batches.push(trackIds.slice(i, i + 100));
    }

    const allFeatures = [];
    for (const batch of batches) {
      const featuresData = await spotifyApi.getAudioFeaturesForTracks(batch);
      allFeatures.push(...featuresData.body.audio_features);
    }

    res.json({ features: allFeatures });

  } catch (err) {
    console.error('Error fetching audio features:', err.message);
    
    if (err.statusCode === 401) {
      return res.status(401).json({ 
        message: 'Spotify token expired',
        code: 'SPOTIFY_TOKEN_EXPIRED'
      });
    }
    
    res.status(500).json({ message: 'Failed to fetch audio features' });
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
    
    // Create playlist
    const playlist = await spotifyApi.createPlaylist(name, {
      description: description || 'Created by MoodiQ-AI',
      public: isPublic !== false,
    });

    // Add tracks if provided
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
    
    // Replace all tracks with new order
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