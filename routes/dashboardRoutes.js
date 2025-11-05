import express from 'express';
import {
  getDashboardOverview,
  getListeningStats,
  getNowPlaying,
  getDashboardRecommendations,
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

// Detailed listening statistics (supports time ranges: short_term, medium_term, long_term)
router.get('/listening-stats', getListeningStats);

// Currently playing track with mood analysis
router.get('/now-playing', getNowPlaying);

// Personalized recommendations (ML-powered)
router.get('/recommendations', getDashboardRecommendations);

export default router;