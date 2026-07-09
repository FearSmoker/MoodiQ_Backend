import express from 'express';
import {
  getDashboardOverview,
  getListeningStats,
  getNowPlaying,
  getDashboardRecommendations,
} from '../controllers/dashboardController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// all dashboard routes are protected
router.use(protect);

// ===============================================
// core Dashboard Endpoints
// ===============================================

// dashboard overview with comprehensive stats
router.get('/overview', getDashboardOverview);

router.get('/listening-stats', getListeningStats);

// currently playing track with mood analysis
router.get('/now-playing', getNowPlaying);

// personalized recommendations (ML-powered)
router.get('/recommendations', getDashboardRecommendations);

export default router;