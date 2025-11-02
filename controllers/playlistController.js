import SpotifyWebApi from 'spotify-web-api-node';
import axios from 'axios';
import { getFromCache, setInCache } from '../services/cacheService.js';
import { broadcastUpdate } from '../services/socketService.js';

const ML_API_URL = process.env.ML_API_URL || 'http://localhost:8000';

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
      console.log('Returning cached mood data');
      return res.json(cachedData);
    }

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

    // Call ML API to get mood predictions
    const moodResponse = await axios.post(`${ML_API_URL}/predict/playlist`, {
      track_ids: trackIds,
      audio_features: features,
      access_token: user.accessToken,
      user_id: user._id.toString(),
    }, {
      timeout: 30000 // 30 second timeout
    });

    const result = {
      playlistId,
      tracks: tracks.map((track, idx) => ({
        ...track,
        features: features[idx],
        mood: moodResponse.data.tracks[idx]?.mood || 'Unknown',
        moodScore: moodResponse.data.tracks[idx]?.score || 0,
      })),
      moodDistribution: moodResponse.data.moodDistribution || {},
      overallMood: moodResponse.data.overallMood || 'Mixed',
    };

    // Cache the result
    await setInCache(cacheKey, result, 3600); // Cache for 1 hour

    // Send real-time update
    broadcastUpdate({
      type: 'playlist_analyzed',
      userId: user._id.toString(),
      playlistId: playlistId,
      moods: result.tracks.map(t => t.mood),
    });

    res.json(result);

  } catch (err) {
    console.error('Error analyzing playlist mood:', err.message);
    
    if (err.response) {
      return res.status(err.response.status).json({ 
        message: 'ML API error: ' + (err.response.data?.message || err.message) 
      });
    }
    
    res.status(500).json({ message: 'Failed to analyze playlist mood' });
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
    // Call ML API's Flow Optimizer
    const flowResponse = await axios.post(`${ML_API_URL}/optimize/flow`, {
      tracks,
      start_mood: startMood || null,
      end_mood: endMood || null,
      algorithm: algorithm || 'dynamic_programming',
      user_id: req.user._id.toString(),
    }, {
      timeout: 30000
    });

    res.json({
      optimizedOrder: flowResponse.data.optimizedOrder,
      flowScore: flowResponse.data.flowScore,
      transitions: flowResponse.data.transitions,
    });

  } catch (err) {
    console.error('Error optimizing playlist flow:', err.message);
    
    if (err.response) {
      return res.status(err.response.status).json({ 
        message: 'ML API error: ' + (err.response.data?.message || err.message) 
      });
    }
    
    res.status(500).json({ message: 'Failed to optimize playlist flow' });
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
    // Try hybrid ML model first (content-based + collaborative filtering)
    const hybridResponse = await axios.post(`${ML_API_URL}/recommend`, {
      seed_tracks: seed_tracks || [],
      seed_genres: seed_genres || [],
      target_valence: target_valence,
      target_energy: target_energy,
      user_id: user._id.toString(),
      limit: limit || 20,
    }, {
      timeout: 20000
    });

    res.json({
      tracks: hybridResponse.data.tracks,
      source: 'ml_hybrid',
    });

  } catch (mlError) {
    // Fallback to Spotify's recommendation API
    console.warn(`ML recommendations failed: ${mlError.message}. Falling back to Spotify.`);

    try {
      const spotifyApi = getSpotifyApi(user.accessToken);

      // Spotify's seed limits (max 5 total seeds)
      const seedTracks = seed_tracks?.slice(0, 3) || [];
      const seedGenres = seed_genres?.slice(0, 2) || [];

      const recommendations = await spotifyApi.getRecommendations({
        seed_tracks: seedTracks,
        seed_genres: seedGenres,
        target_valence,
        target_energy,
        limit: limit || 20,
      });

      res.json({
        tracks: recommendations.body.tracks,
        source: 'spotify',
      });

    } catch (spotifyError) {
      console.error(`Spotify fallback failed: ${spotifyError.message}`);
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
      description: description || '',
      public: isPublic !== false, // Default to public
    });

    // Add tracks if provided
    if (trackUris && Array.isArray(trackUris) && trackUris.length > 0) {
      // Spotify limits to 100 tracks per request
      const batches = [];
      for (let i = 0; i < trackUris.length; i += 100) {
        batches.push(trackUris.slice(i, i + 100));
      }

      for (const batch of batches) {
        await spotifyApi.addTracksToPlaylist(playlist.body.id, batch);
      }
    }

    res.json({
      id: playlist.body.id,
      name: playlist.body.name,
      url: playlist.body.external_urls.spotify,
      tracksAdded: trackUris?.length || 0,
    });

  } catch (err) {
    console.error('Error creating playlist:', err.message);
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

    res.json({ 
      success: true, 
      message: 'Playlist reordered successfully',
      trackCount: trackUris.length 
    });

  } catch (err) {
    console.error('Error reordering playlist:', err.message);
    res.status(500).json({ message: 'Failed to reorder playlist' });
  }
};