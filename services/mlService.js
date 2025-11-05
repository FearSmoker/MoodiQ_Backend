import axios from 'axios';
import { ML_API_URL } from '../utils/constants.js';

/**
 * Complete ML Service Integration with Spotify Token Passing
 * All endpoints now receive and pass Spotify access tokens
 */

const mlClient = axios.create({
  baseURL: ML_API_URL,
  timeout: 90000,
  headers: {
    'Content-Type': 'application/json',
  }
});

// Request interceptor
mlClient.interceptors.request.use(
  (config) => {
    console.log(`🤖 ML API Request: ${config.method.toUpperCase()} ${config.url}`);
    return config;
  },
  (error) => {
    console.error('❌ ML API Request Error:', error.message);
    return Promise.reject(error);
  }
);

// Response interceptor
mlClient.interceptors.response.use(
  (response) => {
    console.log(`✅ ML API Response: ${response.config.url} - ${response.status}`);
    return response;
  },
  (error) => {
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      console.error('❌ ML Service unavailable');
    } else if (error.response) {
      console.error(`❌ ML API Error: ${error.response.status} - ${error.response.data?.detail || error.message}`);
    }
    return Promise.reject(error);
  }
);

// ============================================
// 1. MOOD PREDICTION ENDPOINTS (WITH SPOTIFY TOKEN)
// ============================================

/**
 * Analyze Spotify track by ID (HYBRID APPROACH)
 * Uses Spotify metadata + Multi-API features
 */
export const analyzeSpotifyTrack = async (trackId, accessToken, userId = null) => {
  const response = await mlClient.post('/predict/spotify/track', {
    track_id: trackId,
    user_id: userId
  }, {
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });
  return response.data;
};

/**
 * Analyze Spotify playlist (HYBRID APPROACH)
 */
export const analyzeSpotifyPlaylist = async (playlistId, accessToken, userId = null) => {
  const response = await mlClient.post('/predict/spotify/playlist', {
    playlist_id: playlistId,
    user_id: userId
  }, {
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });
  return response.data;
};

/**
 * Analyze currently playing track (HYBRID APPROACH)
 */
export const analyzeCurrentlyPlaying = async (accessToken, userId = null) => {
  const response = await mlClient.get('/predict/spotify/currently-playing', {
    params: { user_id: userId },
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });
  return response.data;
};

/**
 * Get user's Spotify playlists with mood data
 */
export const getUserSpotifyPlaylists = async (accessToken) => {
  const response = await mlClient.get('/predict/spotify/playlists', {
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });
  return response.data;
};

/**
 * Legacy: Analyze single track by name (Multi-API only)
 */
export const analyzeSingleTrack = async (trackName, artistName, userId = null, genre = null) => {
  const response = await mlClient.post('/predict/track', {
    track_name: trackName,
    artist_name: artistName,
    user_id: userId,
    genre: genre
  });
  return response.data;
};

/**
 * Legacy: Analyze playlist by track list (Multi-API only)
 */
export const analyzePlaylistMood = async (tracks, userId = null) => {
  const formattedTracks = tracks.map(track => ({
    name: track.name || track.track_name,
    artist: track.artist || track.artist_name || (track.artists?.[0]?.name) || (track.artists?.[0])
  }));

  const response = await mlClient.post('/predict/playlist', {
    tracks: formattedTracks,
    user_id: userId
  });
  return response.data;
};

/**
 * Search and analyze track
 */
export const searchAndAnalyze = async (query, userId = null) => {
  const response = await mlClient.post('/predict/search-and-analyze', {
    query: query,
    user_id: userId
  });
  return response.data;
};

/**
 * Batch analyze tracks
 */
export const batchAnalyzeTracks = async (tracks, userId = null) => {
  const response = await mlClient.post('/predict/batch-analyze', {
    tracks: tracks,
    user_id: userId
  });
  return response.data;
};

// ============================================
// 2. PLAYLIST GENERATION ENDPOINTS (WITH SPOTIFY TOKEN)
// ============================================

/**
 * Generate mood-based playlist (HYBRID)
 */
export const generateMoodPlaylist = async (targetMood, userId, accessToken, seedTrackId = null, limit = 20) => {
  const response = await mlClient.post('/generate/playlist', {
    target_mood: targetMood,
    user_id: userId,
    seed_track_id: seedTrackId,
    limit: limit
  }, {
    headers: accessToken ? {
      'Authorization': `Bearer ${accessToken}`
    } : {}
  });
  return response.data;
};

/**
 * Generate activity-based playlist (HYBRID)
 */
export const generateActivityPlaylist = async (activity, userId, accessToken, seedTrackId = null, limit = 20) => {
  const response = await mlClient.post('/generate/activity', {
    activity: activity,
    user_id: userId,
    seed_track_id: seedTrackId,
    limit: limit
  }, {
    headers: accessToken ? {
      'Authorization': `Bearer ${accessToken}`
    } : {}
  });
  return response.data;
};

/**
 * Generate from user's top tracks (SPOTIFY INTEGRATION)
 */
export const generateFromTopTracks = async (userId, accessToken, targetMood = null, limit = 20, timeRange = 'medium_term') => {
  const response = await mlClient.post('/generate/spotify/from-top-tracks', {
    user_id: userId,
    target_mood: targetMood,
    limit: limit,
    time_range: timeRange
  }, {
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });
  return response.data;
};

/**
 * Generate from recently played (SPOTIFY INTEGRATION)
 */
export const generateFromRecentlyPlayed = async (userId, accessToken, targetMood = null, limit = 20) => {
  const response = await mlClient.post('/generate/spotify/from-recently-played', {
    user_id: userId,
    target_mood: targetMood,
    limit: limit
  }, {
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });
  return response.data;
};

/**
 * Discover new tracks based on artist
 */
export const discoverTracks = async (artistName, userId, limit = 20) => {
  const response = await mlClient.post('/generate/discover', {
    artist_name: artistName,
    user_id: userId,
    limit: limit
  });
  return response.data;
};

/**
 * Generate personalized playlist based on user history
 */
export const generatePersonalizedPlaylist = async (userId, accessToken, limit = 30) => {
  const response = await mlClient.post('/generate/personalized', {
    user_id: userId,
    limit: limit
  }, {
    headers: accessToken ? {
      'Authorization': `Bearer ${accessToken}`
    } : {}
  });
  return response.data;
};

// ============================================
// 3. OPTIMIZATION ENDPOINTS
// ============================================

/**
 * Optimize playlist flow
 */
export const optimizePlaylistFlow = async (tracks, startMood = null, endMood = null, algorithm = 'dynamic_programming', userId = null) => {
  const response = await mlClient.post('/optimize/flow', {
    tracks: tracks,
    start_mood: startMood,
    end_mood: endMood,
    algorithm: algorithm,
    user_id: userId
  });
  return response.data;
};

/**
 * Get available optimization algorithms
 */
export const getOptimizationAlgorithms = async () => {
  const response = await mlClient.get('/optimize/algorithms');
  return response.data;
};

// ============================================
// 4. TRAINING & PERSONALIZATION ENDPOINTS
// ============================================

/**
 * Submit user feedback
 */
export const submitFeedback = async (userId, trackId, feedbackMood, playlistId = null) => {
  const response = await mlClient.post('/model/feedback', {
    user_id: userId,
    track_id: trackId,
    feedback_mood: feedbackMood,
    playlist_id: playlistId,
    timestamp: new Date().toISOString()
  });
  return response.data;
};

/**
 * Submit batch feedback
 */
export const submitBatchFeedback = async (feedbackList) => {
  const response = await mlClient.post('/model/batch-feedback', feedbackList);
  return response.data;
};

/**
 * Trigger model retraining
 */
export const triggerModelRetrain = async (userId, minSamples = 10, force = false) => {
  const response = await mlClient.post('/model/retrain', {
    user_id: userId,
    min_samples: minSamples,
    force: force
  });
  return response.data;
};

/**
 * Get user learning stats
 */
export const getUserLearningStats = async (userId) => {
  const response = await mlClient.get(`/model/user/${userId}/stats`);
  return response.data;
};

/**
 * Get user personalized model
 */
export const getUserPersonalizedModel = async (userId) => {
  const response = await mlClient.get(`/model/user/${userId}/model`);
  return response.data;
};

/**
 * Reset user personalization
 */
export const resetUserPersonalization = async (userId) => {
  const response = await mlClient.delete(`/model/user/${userId}/reset`);
  return response.data;
};

/**
 * Log user behavior (implicit learning)
 */
export const logUserBehavior = async (userId, trackId, action, timeOfDay = null) => {
  const response = await mlClient.post('/model/behavior/log', {
    user_id: userId,
    track_id: trackId,
    action: action,
    timestamp: new Date().toISOString(),
    time_of_day: timeOfDay
  });
  return response.data;
};

// ============================================
// 5. ANALYTICS ENDPOINTS
// ============================================

/**
 * Get user mood timeline
 */
export const getUserMoodTimeline = async (userId, days = 7) => {
  const response = await mlClient.get(`/analytics/user/${userId}/timeline`, {
    params: { days: days }
  });
  return response.data;
};

/**
 * Analyze real-time playback (SPOTIFY INTEGRATION)
 */
export const analyzeRealtime = async (accessToken, userId) => {
  const response = await mlClient.get('/predict/spotify/currently-playing', {
    params: { user_id: userId },
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });
  return response.data;
};

// ============================================
// 6. NLP COMMAND PROCESSING
// ============================================

/**
 * Process NLP command
 */
export const processNLPCommand = async (command, context, userId) => {
  const response = await mlClient.post('/nlp/command', {
    command: command,
    context: context || {},
    user_id: userId
  });
  return response.data;
};

// ============================================
// 7. HEALTH & STATS ENDPOINTS
// ============================================

/**
 * Check ML service health
 */
export const checkHealth = async () => {
  try {
    const response = await mlClient.get('/health');
    return { available: true, data: response.data };
  } catch (error) {
    return { available: false, error: error.message };
  }
};

/**
 * Get ML service stats
 */
export const getMLStats = async () => {
  const response = await mlClient.get('/stats');
  return response.data;
};

/**
 * Get API integration info
 */
export const getAPIInfo = async () => {
  const response = await mlClient.get('/api-info');
  return response.data;
};

// ============================================
// 8. HELPER FUNCTIONS
// ============================================

/**
 * Format tracks for ML API
 */
export const formatTracksForML = (spotifyTracks) => {
  return spotifyTracks.map(track => ({
    id: track.id,
    name: track.name,
    artist: track.artists?.[0]?.name || 'Unknown Artist',
    artists: track.artists?.map(a => a.name) || [],
    features: track.features || null,
    mood: track.mood || null
  }));
};

/**
 * Check if ML service is available
 */
export const isMLServiceAvailable = async () => {
  const health = await checkHealth();
  return health.available;
};

/**
 * Get mood color for visualization
 */
export const getMoodColor = (mood) => {
  const colors = {
    'Happy': '#FFD700',
    'Sad': '#4169E1',
    'Calm': '#90EE90',
    'Energetic': '#FF4500',
    'Angry': '#DC143C',
    'Focus': '#9370DB'
  };
  return colors[mood] || '#808080';
};

/**
 * Handle ML service errors gracefully
 */
export const handleMLError = (error, fallbackMessage = 'ML service temporarily unavailable') => {
  if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
    return {
      success: false,
      error: 'ML_SERVICE_UNAVAILABLE',
      message: fallbackMessage,
      fallback: true
    };
  }

  if (error.response) {
    return {
      success: false,
      error: 'ML_API_ERROR',
      message: error.response.data?.detail || error.message,
      status: error.response.status
    };
  }

  return {
    success: false,
    error: 'UNKNOWN_ERROR',
    message: error.message
  };
};

export default {
  // Spotify Integration (HYBRID)
  analyzeSpotifyTrack,
  analyzeSpotifyPlaylist,
  analyzeCurrentlyPlaying,
  getUserSpotifyPlaylists,
  
  // Legacy Multi-API
  analyzeSingleTrack,
  analyzePlaylistMood,
  searchAndAnalyze,
  batchAnalyzeTracks,

  // Playlist Generation (HYBRID)
  generateMoodPlaylist,
  generateActivityPlaylist,
  generateFromTopTracks,
  generateFromRecentlyPlayed,
  discoverTracks,
  generatePersonalizedPlaylist,

  // Optimization
  optimizePlaylistFlow,
  getOptimizationAlgorithms,

  // Training & Personalization
  submitFeedback,
  submitBatchFeedback,
  triggerModelRetrain,
  getUserLearningStats,
  getUserPersonalizedModel,
  resetUserPersonalization,
  logUserBehavior,

  // Analytics
  getUserMoodTimeline,
  analyzeRealtime,

  // NLP
  processNLPCommand,

  // Health & Stats
  checkHealth,
  getMLStats,
  getAPIInfo,

  // Helpers
  formatTracksForML,
  isMLServiceAvailable,
  getMoodColor,
  handleMLError
};