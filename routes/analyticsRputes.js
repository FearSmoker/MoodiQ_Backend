import express from 'express';
import {
  getMoodTrends,
  getActivityAnalytics,
  getGenreAnalysis,
} from '../controllers/analyticsController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// All analytics routes are protected
router.use(protect);

// Mood trends over time
router.get('/mood-trends', getMoodTrends);

// Listening activity patterns
router.get('/activity', getActivityAnalytics);

// Genre analysis
router.get('/genres', getGenreAnalysis);

export default router;