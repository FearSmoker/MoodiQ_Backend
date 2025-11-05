import express from 'express';
import {
  getMoodTrends,
  getMoodDistribution,
  getMoodPatterns,
  getActivityAnalytics,
  getGenreAnalysis,
  getMoodTimeline,
  getRealtimeAnalysis,
  getGlobalMoodTrends,
  getLiveSessionAnalytics,
} from '../controllers/analyticsController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// All analytics routes are protected
router.use(protect);

// ===============================================
// Analytics Endpoints - Complete Integration
// ===============================================

// Mood trends over time (12-mood system)
router.get('/mood-trends', getMoodTrends);

// Mood distribution analysis
router.get('/mood-distribution', getMoodDistribution);

// Mood pattern co-occurrence
router.get('/mood-patterns', getMoodPatterns);

// Listening activity patterns
router.get('/activity', getActivityAnalytics);

// Genre analysis
router.get('/genres', getGenreAnalysis);

// User mood timeline (PRIMARY ENDPOINT for graphs)
router.get('/mood-timeline', getMoodTimeline);

// Real-time current track analysis
router.get('/realtime', getRealtimeAnalysis);

// Global mood trends
router.get('/global-trends', getGlobalMoodTrends);

// Live listening session analytics
router.get('/live-session/:userId', getLiveSessionAnalytics);

export default router;