import express from 'express';
import {
  getMoodTrends,
  getActivityAnalytics,
  getGenreAnalysis,
  getMoodTimeline,
  getRealtimeAnalysis,
} from '../controllers/analyticsController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// All analytics routes are protected
router.use(protect);

// ===============================================
// Analytics Endpoints
// ===============================================

// Mood trends over time
router.get('/mood-trends', getMoodTrends);

// Listening activity patterns
router.get('/activity', getActivityAnalytics);

// Genre analysis
router.get('/genres', getGenreAnalysis);

// User mood timeline (ML-powered)
router.get('/mood-timeline', getMoodTimeline);

// Real-time current track analysis
router.get('/realtime', getRealtimeAnalysis);

export default router;