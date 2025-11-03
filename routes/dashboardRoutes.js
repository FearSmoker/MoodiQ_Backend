import express from 'express';
import {
  getDashboardOverview,
  getListeningStats,
  getNowPlaying,
  getDashboardRecommendations,
  getMoodTrends,
} from '../controllers/dashboardController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// All dashboard routes are protected
router.use(protect);

// ===============================================
// Core Dashboard Endpoints
// ===============================================

// Dashboard overview with comprehensive stats
router.get('/overview', getDashboardOverview);

// Detailed listening statistics (supports time ranges)
router.get('/listening-stats', getListeningStats);

// Currently playing track with mood analysis
router.get('/now-playing', getNowPlaying);

// Personalized recommendations
router.get('/recommendations', getDashboardRecommendations);

// Mood trends over time
router.get('/mood-trends', getMoodTrends);

export default router;