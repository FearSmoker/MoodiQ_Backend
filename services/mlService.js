import axios from 'axios';
import { ML_API_URL } from '../utils/constants.js';

/**
 * ML Service - Centralized ML API Integration
 */

const mlClient = axios.create({
  baseURL: ML_API_URL,
  timeout: 60000, // 60 seconds
  headers: {
    'Content-Type': 'application/json',
  }
});

// Request interceptor for logging
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

// Response interceptor for error handling
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
 * Analyze single track mood
 */
export const analyzeSingleTrack = async (trackData) => {
  const response = await mlClient.post('/predict/track', trackData);
  return response.data;
};

/**
 * Analyze playlist mood
 */
export const analyzePlaylistMood = async (playlistData) => {
  const response = await mlClient.post('/predict/playlist', playlistData);
  return response.data;
};

/**
 * Detect mood gaps in playlist
 */
export const detectMoodGaps = async (tracks, threshold = 1.5) => {
  const response = await mlClient.post('/predict/gaps', {
    tracks,
    threshold
  });
  return response.data;
};

/**
 * Fill mood gaps with recommendations
 */
export const fillMoodGaps = async (tracks, accessToken, userId) => {
  const response = await mlClient.post('/predict/fill-gaps', {
    tracks,
    access_token: accessToken,
    user_id: userId
  });
  return response.data;
};

/**
 * Real-time playback analysis
 */
export const analyzeRealtime = async (trackId, userId, accessToken) => {
  const response = await mlClient.post('/predict/realtime/analyze', {
    track_id: trackId,
    user_id: userId,
    access_token: accessToken
  });
  return response.data;
};

/**
 * Optimize playlist flow
 */
export const optimizePlaylistFlow = async (tracks, startMood, endMood, algorithm = 'dynamic_programming', userId) => {
  const response = await mlClient.post('/optimize/flow', {
    tracks,
    start_mood: startMood,
    end_mood: endMood,
    algorithm,
    user_id: userId
  });
  return response.data;
};

/**
 * Generate mood-based playlist
 */
export const generateMoodPlaylist = async (targetMood, userId, accessToken, limit = 20, seedTracks = []) => {
  const response = await mlClient.post('/generate/playlist', {
    target_mood: targetMood,
    user_id: userId,
    access_token: accessToken,
    limit,
    seed_tracks: seedTracks
  });
  return response.data;
};

/**
 * Generate activity-based playlist
 */
export const generateActivityPlaylist = async (activity, userId, accessToken, limit = 20) => {
  const response = await mlClient.post('/generate/activity', {
    activity,
    user_id: userId,
    access_token: accessToken,
    limit
  });
  return response.data;
};

/**
 * Submit user feedback for model training
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
 * Get hybrid recommendations
 */
export const getHybridRecommendations = async (seedTracks, seedGenres, targetValence, targetEnergy, userId, accessToken, limit = 20) => {
  const response = await mlClient.post('/model/recommend', {
    seed_tracks: seedTracks,
    seed_genres: seedGenres,
    target_valence: targetValence,
    target_energy: targetEnergy,
    user_id: userId,
    access_token: accessToken,
    limit
  });
  return response.data;
};

/**
 * Trigger model retraining
 */
export const triggerModelRetrain = async (userId, minSamples = 10, force = false) => {
  const response = await mlClient.post('/model/retrain', {
    user_id: userId,
    min_samples: minSamples,
    force
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
 * Submit batch feedback
 */
export const submitBatchFeedback = async (feedbackList) => {
  const response = await mlClient.post('/model/batch-feedback', feedbackList);
  return response.data;
};

/**
 * Log user behavior (implicit learning)
 */
export const logUserBehavior = async (userId, trackId, action, timeOfDay = null) => {
  const response = await mlClient.post('/model/behavior/log', {
    user_id: userId,
    track_id: trackId,
    action,
    timestamp: new Date().toISOString(),
    time_of_day: timeOfDay
  });
  return response.data;
};

/**
 * Get user mood timeline
 */
export const getUserMoodTimeline = async (userId, days = 7) => {
  const response = await mlClient.get(`/analytics/user/${userId}/timeline`, {
    params: { days }
  });
  return response.data;
};

/**
 * Process NLP command
 */
export const processNLPCommand = async (command, context, userId) => {
  const response = await mlClient.post('/nlp/command', {
    command,
    context,
    user_id: userId
  });
  return response.data;
};

/**
 * Get ML service stats
 */
export const getMLStats = async () => {
  const response = await mlClient.get('/stats');
  return response.data;
};

export default {
  checkHealth,
  analyzeSingleTrack,
  analyzePlaylistMood,
  detectMoodGaps,
  fillMoodGaps,
  analyzeRealtime,
  optimizePlaylistFlow,
  generateMoodPlaylist,
  generateActivityPlaylist,
  submitFeedback,
  getHybridRecommendations,
  triggerModelRetrain,
  getUserLearningStats,
  getUserPersonalizedModel,
  resetUserPersonalization,
  submitBatchFeedback,
  logUserBehavior,
  getUserMoodTimeline,
  processNLPCommand,
  getMLStats
};