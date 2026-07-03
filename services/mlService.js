import axios from 'axios';
import { ML_API_URL } from '../utils/constants.js';

/**
 * ML Service Integration - COMPLETE v3.0
 * Updated for new model features:
 * - Advanced playlist aggregation
 * - Live listening queue
 * - MongoDB recommendations
 * - Enhanced analytics
 */

const mlClient = axios.create({
  baseURL: ML_API_URL,
  // Was 180s — far longer than the frontend's 10s analytics poll interval,
  // so a single slow response let requests stack up indefinitely and
  // resolve out of order (stale data overwriting fresh data on screen).
  // Analytics/read endpoints should fail fast so the frontend's own
  // Promise.allSettled fallback/error-banner logic can kick in instead.
  timeout: 20000,
  headers: {
    'Content-Type': 'application/json',
  }
});

const lastLogTimes = {};
const logRateLimited = (key, ...args) => {
  const now = Date.now();
  if (!lastLogTimes[key] || now - lastLogTimes[key] > 20000) {
    lastLogTimes[key] = now;
    console.log(...args);
  }
};

// Request interceptor
mlClient.interceptors.request.use(
  (config) => {
    // Resolve base URL dynamically to prevent ES6 import hoisting time issues with dotenv
    config.baseURL = process.env.ML_API_URL || ML_API_URL;
    logRateLimited(`ml_req_${config.url}`, `🤖 ML API Request: ${config.method.toUpperCase()} ${config.baseURL}${config.url}`);
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
    logRateLimited(`ml_res_${response.config.url}`, `✅ ML API Response: ${response.config.url} - ${response.status}`);
    return response;
  },
  (error) => {
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      console.error('❌ ML Service unavailable');
      error.mlServiceUnavailable = true;
    } else if (error.response) {
      const status = error.response.status;
      const data = error.response.data;
      
      if (status === 401) {
        console.error('❌ ML API Auth Error');
        error.isAuthError = true;
      } else if (status === 429) {
        const retryAfter = error.response.headers?.['retry-after'] || 60;
        console.error(`❌ ML API Rate Limit: Retry after ${retryAfter}s`);
        error.isRateLimitError = true;
        error.retryAfter = parseInt(retryAfter);
      }
    }
    return Promise.reject(error);
  }
);

// ============================================
// 1. MOOD PREDICTION (HYBRID SPOTIFY)
// ============================================

/**
 * Analyze Spotify playlist with ADVANCED AGGREGATION
 * Returns aggregated_features for graphing
 */
export const analyzeSpotifyPlaylist = async (playlistId, accessToken, userId = null, includeUnavailable = false) => {
  try {
    const response = await mlClient.post('/predict/spotify/playlist', {
      playlist_id: playlistId,
      user_id: userId,
      include_unavailable: includeUnavailable
    }, {
      timeout: 60000, // analyzing a full playlist can take longer than a simple analytics read
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    
    // Response now includes aggregated_features and aggregatedMoodTags
    return response.data;
  } catch (error) {
    throw enhanceError(error, 'analyze Spotify playlist');
  }
};

/**
 * Analyze currently playing track
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
 * Batch analyze tracks (legacy Multi-API)
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
// 2. LIVE LISTENING QUEUE (NEW)
// ============================================

/**
 * Start a live listening session
 */
export const startLiveSession = async (userId) => {
  try {
    const response = await mlClient.post('/live/session/start', {
      user_id: userId
    });
    return response.data;
  } catch (error) {
    throw enhanceError(error, 'start live session');
  }
};

/**
 * Add track to live session
 */
export const addTrackToLiveSession = async (userId, sessionId, trackName, artistName, trackId = null) => {
  try {
    const response = await mlClient.post('/live/session/add-track', {
      user_id: userId,
      session_id: sessionId,
      track_id: trackId,
      track_name: trackName,
      artist_name: artistName
    });
    return response.data;
  } catch (error) {
    throw enhanceError(error, 'add track to live session');
  }
};

/**
 * Get current live session analytics
 */
export const getCurrentLiveSession = async (userId) => {
  try {
    const response = await mlClient.get(`/live/session/${userId}/current`);
    return response.data;
  } catch (error) {
    throw enhanceError(error, 'get current live session');
  }
};

/**
 * End live session and save to MongoDB
 */
export const endLiveSession = async (userId, sessionId) => {
  try {
    const response = await mlClient.post('/live/session/end', {
      user_id: userId,
      session_id: sessionId
    });
    return response.data;
  } catch (error) {
    throw enhanceError(error, 'end live session');
  }
};

/**
 * Auto-check for session timeout
 */
export const autoCheckLiveSession = async (userId) => {
  try {
    const response = await mlClient.post(`/live/session/auto-check/${userId}`);
    return response.data;
  } catch (error) {
    // Don't throw for auto-check failures
    console.warn('Failed to auto-check session:', error.message);
    return { auto_ended: false };
  }
};

// ============================================
// 3. PLAYLIST GENERATION
// ============================================

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
// 4. DATABASE RECOMMENDATIONS (NEW)
// ============================================

/**
 * Get MongoDB-powered recommendations based on playlist
 */
export const getDatabaseRecommendations = async (userId, playlistId = null, targetMood = null, limit = 50) => {
  try {
    const response = await mlClient.post('/generate/database-recommendations', {
      user_id: userId,
      playlist_id: playlistId,
      target_mood: targetMood,
      limit: Math.min(limit, 50)
    });
    return response.data;
  } catch (error) {
    throw enhanceError(error, 'get database recommendations');
  }
};

// ============================================
// 5. OPTIMIZATION
// ============================================

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

// ============================================
// 6. TRAINING & PERSONALIZATION
// ============================================

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

export const submitBatchFeedback = async (feedbackList) => {
  try {
    const response = await mlClient.post('/model/batch-feedback', feedbackList);
    return response.data;
  } catch (error) {
    throw enhanceError(error, 'submit batch feedback');
  }
};

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

export const getUserLearningStats = async (userId) => {
  try {
    const response = await mlClient.get(`/model/user/${userId}/stats`);
    return response.data;
  } catch (error) {
    throw enhanceError(error, 'get user learning stats');
  }
};

export const getUserPersonalizedModel = async (userId) => {
  try {
    const response = await mlClient.get(`/model/user/${userId}/model`);
    return response.data;
  } catch (error) {
    throw enhanceError(error, 'get personalized model');
  }
};

export const resetUserPersonalization = async (userId) => {
  try {
    const response = await mlClient.delete(`/model/user/${userId}/reset`);
    return response.data;
  } catch (error) {
    throw enhanceError(error, 'reset personalization');
  }
};

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
    console.warn('Failed to log behavior:', error.message);
    return null;
  }
};

// ============================================
// 7. ANALYTICS (ENHANCED)
// ============================================

/**
 * Get user mood timeline with aggregated features
 * Returns data suitable for graphing
 */
export const getUserMoodTimeline = async (userId, days = 7, accessToken = null) => {
  try {
    const response = await mlClient.get(`/analytics/user/${userId}/timeline`, {
      params: { days: days },
      headers: accessToken ? {
                'Authorization': `Bearer ${accessToken}`
            } : {}
    });
    return response.data;
  } catch (error) {
    throw enhanceError(error, 'get mood timeline');
  }
};

/**
 * Get user mood distribution
 */
export const getUserMoodDistribution = async (userId) => {
  try {
    const response = await mlClient.get(`/analytics/user/${userId}/mood-distribution`);
    return response.data;
  } catch (error) {
    throw enhanceError(error, 'get mood distribution');
  }
};

/**
 * Get mood patterns (co-occurrence analysis)
 */
export const getUserMoodPatterns = async (userId) => {
  try {
    const response = await mlClient.get(`/analytics/user/${userId}/mood-patterns`);
    return response.data;
  } catch (error) {
    throw enhanceError(error, 'get mood patterns');
  }
};

/**
 * Get feedback statistics
 */
export const getUserFeedbackStats = async (userId) => {
  try {
    const response = await mlClient.get(`/analytics/user/${userId}/feedback-stats`);
    return response.data;
  } catch (error) {
    throw enhanceError(error, 'get feedback stats');
  }
};

/**
 * Get global mood trends
 */
export const getGlobalMoodTrends = async (limit = 100) => {
  try {
    const response = await mlClient.get('/analytics/global/mood-trends', {
      params: { limit: limit }
    });
    return response.data;
  } catch (error) {
    throw enhanceError(error, 'get global trends');
  }
};

/**
 * Get MongoDB session history (for long-term graphs)
 */
export const getUserSessionHistory = async (userId, days = 30) => {
  try {
    // This would query MongoDB directly via your backend
    // For now, use timeline endpoint
    const response = await mlClient.get(`/analytics/user/${userId}/timeline`, {
      params: { days: days }
    });
    return response.data;
  } catch (error) {
    throw enhanceError(error, 'get session history');
  }
};

// ============================================
// 8. NLP COMMANDS
// ============================================

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
// 9. HEALTH & STATS
// ============================================

export const checkHealth = async () => {
  try {
    const response = await mlClient.get('/health');
    return { available: true, data: response.data };
  } catch (error) {
    return { available: false, error: error.message };
  }
};

export const getMLStats = async () => {
  try {
    const response = await mlClient.get('/stats');
    return response.data;
  } catch (error) {
    throw enhanceError(error, 'get ML stats');
  }
};

// ============================================
// 10. HELPER FUNCTIONS
// ============================================

const enhanceError = (error, operation) => {
  const enhanced = new Error(`Failed to ${operation}: ${error.message}`);
  enhanced.original = error;
  enhanced.operation = operation;
  enhanced.isAuthError = error.isAuthError || false;
  enhanced.isRateLimitError = error.isRateLimitError || false;
  enhanced.mlServiceUnavailable = error.mlServiceUnavailable || false;
  enhanced.retryAfter = error.retryAfter || null;
  enhanced.statusCode = error.response?.status || null;
  return enhanced;
};

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
      message: `Rate limit exceeded. Retry in ${error.retryAfter || 60}s.`,
      retryAfter: error.retryAfter || 60,
      status: 429
    };
  }

  return {
    success: false,
    error: 'UNKNOWN_ERROR',
    message: error.message
  };
};

export default {
  // Spotify Integration
  analyzeSpotifyPlaylist,
  analyzeCurrentlyPlaying,
  batchAnalyzeTracks,

  // Live Listening (NEW)
  startLiveSession,
  addTrackToLiveSession,
  getCurrentLiveSession,
  endLiveSession,
  autoCheckLiveSession,

  // Playlist Generation
  generateMoodPlaylist,
  generateActivityPlaylist,
  generateFromTopTracks,
  generateFromRecentlyPlayed,
  generatePersonalizedPlaylist,

  // Database Recommendations (NEW)
  getDatabaseRecommendations,

  // Optimization
  optimizePlaylistFlow,

  // Training & Personalization
  submitFeedback,
  submitBatchFeedback,
  triggerModelRetrain,
  getUserLearningStats,
  getUserPersonalizedModel,
  resetUserPersonalization,
  logUserBehavior,

  // Analytics (ENHANCED)
  getUserMoodTimeline,
  getUserMoodDistribution,
  getUserMoodPatterns,
  getUserFeedbackStats,
  getGlobalMoodTrends,
  getUserSessionHistory,

  // NLP
  processNLPCommand,

  // Health
  checkHealth,
  getMLStats,

  // Helpers
  formatTracksForML,
  handleMLError
};