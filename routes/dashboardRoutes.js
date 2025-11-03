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

// Dashboard overview with all stats
router.get('/overview', getDashboardOverview);

// Detailed listening statistics
router.get('/listening-stats', getListeningStats);

// Currently playing track
router.get('/now-playing', getNowPlaying);

// Personalized recommendations
router.get('/recommendations', getDashboardRecommendations);

export default router;