

export const ML_API_URL = process.env.ML_API_URL || 'https://moodiq-model.onrender.com';

export const MOOD_CLASSES = ['Happy', 'Sad', 'Calm', 'Energetic'];

export const ACTIVITY_TYPES = {
  STUDY: 'study',
  WORKOUT: 'workout',
  PARTY: 'party',
  SLEEP: 'sleep',
  WORK: 'work',
  MEDITATION: 'meditation'
};

export const TIME_RANGES = {
  SHORT: 'short_term',      // last 4 weeks
  MEDIUM: 'medium_term',    // last 6 months
  LONG: 'long_term'         // all time
};

export const OPTIMIZATION_ALGORITHMS = {
  DYNAMIC_PROGRAMMING: 'dynamic_programming',
  GREEDY: 'greedy',
  SIMULATED_ANNEALING: 'simulated_annealing'
};

export const CACHE_TTL = {
  AUDIO_FEATURES: 86400,    // 1 day
  MOOD_ANALYSIS: 3600,      // 1 hour
  LYRICS: 604800,           // 1 week
  USER_STATS: 3600          // 1 hour
};