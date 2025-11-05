import axios from 'axios';
import { ML_API_URL } from '../utils/constants.js';

/**
 * ML Service Integration - Updated for Spotify Service v2.5.1
 * 
 * Updates:
 * - ✅ Better error handling for new Spotify exceptions
 * - ✅ Rate limit detection and handling
 * - ✅ Token expiration handling
 * - ✅ Retry logic for transient failures
 * - ✅ Support for paginated responses
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

// Response interceptor with enhanced error handling
mlClient.interceptors.response.use(
  (response) => {
    console.log(`✅ ML API Response: ${response.config.url} - ${response.status}`);
    return response;
  },
  (error) => {
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      console.error('❌ ML Service unavailable');
      error.mlServiceUnavailable = true;
    } else if (error.response) {
      const status = error.response.status;
      const data = error.response.data;
      
      // Enhanced error logging
      if (status === 401) {
        console.error('❌ ML API Auth Error: Token expired or invalid');
        error.isAuthError = true;
      } else if (status === 429) {
        const retryAfter = error.response.headers?.['retry-after'] || 60;
        console.error(`❌ ML API Rate Limit: Retry after ${retryAfter}s`);
        error.isRateLimitError = true;
        error.retryAfter = parseInt(retryAfter);
      } else if (status === 404) {
        console.error('❌ ML API Not Found:', data?.detail || 'Resource not found');
        error.isNotFoundError = true;
      } else {
        console.error(`❌ ML API Error: ${status} - ${data?.detail || error.message}`);
      }
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
  try {
    const response = await mlClient.post('/predict/spotify/track', {
      track_id: trackId,
      user_id: userId
    }, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    return response.data;
  } catch (error) {
    throw enhanceError(error, 'analyze Spotify track');
  }
};

/**
 * Analyze Spotify playlist (HYBRID APPROACH) - UPDATED
 * Now supports playlists with 100+ tracks via pagination
 */
export const analyzeSpotifyPlaylist = async (playlistId, accessToken, userId = null, includeUnavailable = false) => {
  try {
    const response = await mlClient.post('/predict/spotify/playlist', {
      playlist_id: playlistId,
      user_id: userId,
      include_unavailable: includeUnavailable
    }, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    return response.data;
  } catch (error) {
    throw enhanceError(error, 'analyze Spotify playlist');
  }
};

/**
 * Analyze currently playing track (HYBRID APPROACH) - UPDATED
 * Now supports podcasts and enhanced device info
 */
export const analyzeCurrentlyPlaying = async (accessToken, userId = null) => {
  try {
    const response = await mlClient.get('/predict/spotify/currently-playing', {
      params: { user_id: userId },
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    return response.data;
  } catch (error) {
    throw enhanceError(error, 'analyze currently playing');
  }
};

/**
 * Get user's Spotify playlists with mood data - UPDATED
 * Now supports pagination for 50+ playlists
 */
export const getUserSpotifyPlaylists = async (accessToken, fetchAll = true) => {
  try {
    const response = await mlClient.get('/predict/spotify/playlists', {
      params: { fetch_all: fetchAll },
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    return response.data;
  } catch (error) {
    throw enhanceError(error, 'get Spotify playlists');
  }
};

/**
 * Test Spotify connection and token validity - NEW
 */
export const testSpotifyConnection = async (accessToken) => {
  try {
    const response = await mlClient.get('/predict/spotify/test-connection', {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    return response.data;
  } catch (error) {
    throw enhanceError(error, 'test Spotify connection');
  }
};

/**
 * Legacy: Analyze single track by name (Multi-API only)
 */
export const analyzeSingleTrack = async (trackName, artistName, userId = null, genre = null) => {
  try {
    const response = await mlClient.post('/predict/track', {
      track_name: trackName,
      artist_name: artistName,
      user_id: userId,
      genre: genre
    });
    return response.data;
  } catch (error) {
    throw enhanceError(error, 'analyze track');
  }
};

/**
 * Legacy: Analyze playlist by track list (Multi-API only)
 */
export const analyzePlaylistMood = async (tracks, userId = null) => {
  try {
    const formattedTracks = tracks.map(track => ({
      name: track.name || track.track_name,
      artist: track.artist || track.artist_name || (track.artists?.[0]?.name) || (track.artists?.[0])
    }));

    const response = await mlClient.post('/predict/playlist', {
      tracks: formattedTracks,
      user_id: userId
    });
    return response.data;
  } catch (error) {
    throw enhanceError(error, 'analyze playlist');
  }
};

/**
 * Search and analyze track
 */
export const searchAndAnalyze = async (query, userId = null) => {
  try {
    const response = await mlClient.post('/predict/search-and-analyze', {
      query: query,
      user_id: userId
    });
    return response.data;
  } catch (error) {
    throw enhanceError(error, 'search and analyze');
  }
};

/**
 * Batch analyze tracks
 */
export const batchAnalyzeTracks = async (tracks, userId = null) => {
  try {
    const response = await mlClient.post('/predict/batch-analyze', {
      tracks: tracks,
      user_id: userId
    });
    return response.data;
  } catch (error) {
    throw enhanceError(error, 'batch analyze tracks');
  }
};

// ============================================
// 2. PLAYLIST GENERATION ENDPOINTS (WITH SPOTIFY TOKEN)
// ============================================

/**
 * Generate mood-based playlist (HYBRID)
 */
export const generateMoodPlaylist = async (targetMood, userId, accessToken, seedTrackId = null, limit = 20) => {
  try {
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
  } catch (error) {
    throw enhanceError(error, 'generate mood playlist');
  }
};

/**
 * Generate activity-based playlist (HYBRID)
 */
export const generateActivityPlaylist = async (activity, userId, accessToken, seedTrackId = null, limit = 20) => {
  try {
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
  } catch (error) {
    throw enhanceError(error, 'generate activity playlist');
  }
};

/**
 * Generate from user's top tracks (SPOTIFY INTEGRATION)
 */
export const generateFromTopTracks = async (userId, accessToken, targetMood = null, limit = 20, timeRange = 'medium_term') => {
  try {
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
  } catch (error) {
    throw enhanceError(error, 'generate from top tracks');
  }
};

/**
 * Generate from recently played (SPOTIFY INTEGRATION)
 */
export const generateFromRecentlyPlayed = async (userId, accessToken, targetMood = null, limit = 20) => {
  try {
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
  } catch (error) {
    throw enhanceError(error, 'generate from recently played');
  }
};

/**
 * Discover new tracks based on artist
 */
export const discoverTracks = async (artistName, userId, limit = 20) => {
  try {
    const response = await mlClient.post('/generate/discover', {
      artist_name: artistName,
      user_id: userId,
      limit: limit
    });
    return response.data;
  } catch (error) {
    throw enhanceError(error, 'discover tracks');
  }
};

/**
 * Generate personalized playlist based on user history
 */
export const generatePersonalizedPlaylist = async (userId, accessToken, limit = 30) => {
  try {
    const response = await mlClient.post('/generate/personalized', {
      user_id: userId,
      limit: limit
    }, {
      headers: accessToken ? {
        'Authorization': `Bearer ${accessToken}`
      } : {}
    });
    return response.data;
  } catch (error) {
    throw enhanceError(error, 'generate personalized playlist');
  }
};

// ============================================
// 3. OPTIMIZATION ENDPOINTS
// ============================================

/**
 * Optimize playlist flow
 */
export const optimizePlaylistFlow = async (tracks, startMood = null, endMood = null, algorithm = 'dynamic_programming', userId = null) => {
  try {
    const response = await mlClient.post('/optimize/flow', {
      tracks: tracks,
      start_mood: startMood,
      end_mood: endMood,
      algorithm: algorithm,
      user_id: userId
    });
    return response.data;
  } catch (error) {
    throw enhanceError(error, 'optimize playlist flow');
  }
};

/**
 * Get available optimization algorithms
 */
export const getOptimizationAlgorithms = async () => {
  try {
    const response = await mlClient.get('/optimize/algorithms');
    return response.data;
  } catch (error) {
    throw enhanceError(error, 'get optimization algorithms');
  }
};

// ============================================
// 4. TRAINING & PERSONALIZATION ENDPOINTS
// ============================================

/**
 * Submit user feedback
 */
export const submitFeedback = async (userId, trackId, feedbackMood, playlistId = null) => {
  try {
    const response = await mlClient.post('/model/feedback', {
      user_id: userId,
      track_id: trackId,
      feedback_mood: feedbackMood,
      playlist_id: playlistId,
      timestamp: new Date().toISOString()
    });
    return response.data;
  } catch (error) {
    throw enhanceError(error, 'submit feedback');
  }
};

/**
 * Submit batch feedback
 */
export const submitBatchFeedback = async (feedbackList) => {
  try {
    const response = await mlClient.post('/model/batch-feedback', feedbackList);
    return response.data;
  } catch (error) {
    throw enhanceError(error, 'submit batch feedback');
  }
};

/**
 * Trigger model retraining
 */
export const triggerModelRetrain = async (userId, minSamples = 10, force = false) => {
  try {
    const response = await mlClient.post('/model/retrain', {
      user_id: userId,
      min_samples: minSamples,
      force: force
    });
    return response.data;
  } catch (error) {
    throw enhanceError(error, 'trigger model retrain');
  }
};

/**
 * Get user learning stats
 */
export const getUserLearningStats = async (userId) => {
  try {
    const response = await mlClient.get(`/model/user/${userId}/stats`);
    return response.data;
  } catch (error) {
    throw enhanceError(error, 'get user learning stats');
  }
};

/**
 * Get user personalized model
 */
export const getUserPersonalizedModel = async (userId) => {
  try {
    const response = await mlClient.get(`/model/user/${userId}/model`);
    return response.data;
  } catch (error) {
    throw enhanceError(error, 'get personalized model');
  }
};

/**
 * Reset user personalization
 */
export const resetUserPersonalization = async (userId) => {
  try {
    const response = await mlClient.delete(`/model/user/${userId}/reset`);
    return response.data;
  } catch (error) {
    throw enhanceError(error, 'reset personalization');
  }
};

/**
 * Log user behavior (implicit learning)
 */
export const logUserBehavior = async (userId, trackId, action, timeOfDay = null) => {
  try {
    const response = await mlClient.post('/model/behavior/log', {
      user_id: userId,
      track_id: trackId,
      action: action,
      timestamp: new Date().toISOString(),
      time_of_day: timeOfDay
    });
    return response.data;
  } catch (error) {
    // Don't throw for behavior logging - fail silently
    console.warn('Failed to log behavior:', error.message);
    return null;
  }
};

// ============================================
// 5. ANALYTICS ENDPOINTS
// ============================================

/**
 * Get user mood timeline
 */
export const getUserMoodTimeline = async (userId, days = 7) => {
  try {
    const response = await mlClient.get(`/analytics/user/${userId}/timeline`, {
      params: { days: days }
    });
    return response.data;
  } catch (error) {
    throw enhanceError(error, 'get mood timeline');
  }
};

/**
 * Analyze real-time playback (SPOTIFY INTEGRATION)
 */
export const analyzeRealtime = async (accessToken, userId) => {
  try {
    const response = await mlClient.get('/predict/spotify/currently-playing', {
      params: { user_id: userId },
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    return response.data;
  } catch (error) {
    throw enhanceError(error, 'analyze realtime');
  }
};

// ============================================
// 6. NLP COMMAND PROCESSING
// ============================================

/**
 * Process NLP command
 */
export const processNLPCommand = async (command, context, userId) => {
  try {
    const response = await mlClient.post('/nlp/command', {
      command: command,
      context: context || {},
      user_id: userId
    });
    return response.data;
  } catch (error) {
    throw enhanceError(error, 'process NLP command');
  }
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
  try {
    const response = await mlClient.get('/stats');
    return response.data;
  } catch (error) {
    throw enhanceError(error, 'get ML stats');
  }
};

/**
 * Get API integration info
 */
export const getAPIInfo = async () => {
  try {
    const response = await mlClient.get('/api-info');
    return response.data;
  } catch (error) {
    throw enhanceError(error, 'get API info');
  }
};

/**
 * Get rate limit status - NEW
 */
export const getRateLimitStatus = async () => {
  try {
    const response = await mlClient.get('/predict/spotify/rate-limit-status');
    return response.data;
  } catch (error) {
    throw enhanceError(error, 'get rate limit status');
  }
};

// ============================================
// 8. HELPER FUNCTIONS
// ============================================

/**
 * Enhance error with additional context
 */
const enhanceError = (error, operation) => {
  const enhanced = new Error(`Failed to ${operation}: ${error.message}`);
  enhanced.original = error;
  enhanced.operation = operation;
  
  // Copy over special properties
  enhanced.isAuthError = error.isAuthError || false;
  enhanced.isRateLimitError = error.isRateLimitError || false;
  enhanced.isNotFoundError = error.isNotFoundError || false;
  enhanced.mlServiceUnavailable = error.mlServiceUnavailable || false;
  enhanced.retryAfter = error.retryAfter || null;
  enhanced.statusCode = error.response?.status || null;
  
  return enhanced;
};

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
    'Focus': '#9370DB',
    'Melancholic': '#4682B4',
    'Excited': '#FF6347',
    'Relaxed': '#98FB98'
  };
  return colors[mood] || '#808080';
};

/**
 * Handle ML service errors gracefully - UPDATED
 */
export const handleMLError = (error, fallbackMessage = 'ML service temporarily unavailable') => {
  if (error.mlServiceUnavailable) {
    return {
      success: false,
      error: 'ML_SERVICE_UNAVAILABLE',
      message: fallbackMessage,
      fallback: true
    };
  }

  if (error.isAuthError) {
    return {
      success: false,
      error: 'AUTH_ERROR',
      message: 'Authentication failed. Please re-authenticate.',
      status: 401
    };
  }

  if (error.isRateLimitError) {
    return {
      success: false,
      error: 'RATE_LIMIT_EXCEEDED',
      message: `Rate limit exceeded. Please try again in ${error.retryAfter || 60} seconds.`,
      retryAfter: error.retryAfter || 60,
      status: 429
    };
  }

  if (error.isNotFoundError) {
    return {
      success: false,
      error: 'NOT_FOUND',
      message: 'Resource not found',
      status: 404
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

/**
 * Retry function with exponential backoff
 */
export const retryWithBackoff = async (fn, maxRetries = 3, baseDelay = 1000) => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      // Don't retry auth or rate limit errors
      if (error.isAuthError || error.isRateLimitError) {
        throw error;
      }

      // Don't retry on last attempt
      if (i === maxRetries - 1) {
        throw error;
      }

      // Exponential backoff
      const delay = baseDelay * Math.pow(2, i);
      console.log(`Retry attempt ${i + 1}/${maxRetries} after ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
};

export default {
  // Spotify Integration (HYBRID)
  analyzeSpotifyTrack,
  analyzeSpotifyPlaylist,
  analyzeCurrentlyPlaying,
  getUserSpotifyPlaylists,
  testSpotifyConnection,
  
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
  getRateLimitStatus,

  // Helpers
  formatTracksForML,
  isMLServiceAvailable,
  getMoodColor,
  handleMLError,
  retryWithBackoff
};