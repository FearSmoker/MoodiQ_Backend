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

// all analytics routes are protected
router.use(protect);

// ===============================================

// ===============================================

// mood trends over time (12-mood system)
router.get('/mood-trends', getMoodTrends);

// mood distribution analysis
router.get('/mood-distribution', getMoodDistribution);

// mood pattern co-occurrence
router.get('/mood-patterns', getMoodPatterns);

// listening activity patterns
router.get('/activity', getActivityAnalytics);

// genre analysis
router.get('/genres', getGenreAnalysis);

// user mood timeline (PRIMARY ENDPOINT for graphs)
router.get('/mood-timeline', getMoodTimeline);

// real-time current track analysis
router.get('/realtime', getRealtimeAnalysis);

// global mood trends
router.get('/global-trends', getGlobalMoodTrends);

// live listening session analytics
router.get('/live-session/:userId', getLiveSessionAnalytics);

export default router;