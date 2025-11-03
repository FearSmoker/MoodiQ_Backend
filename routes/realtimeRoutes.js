import express from 'express';
import {
  getCurrentAnalytics,
  getListeningHistory,
} from '../controllers/realtimeController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// All routes are protected
router.use(protect);

// Get current playback analytics
router.get('/current', getCurrentAnalytics);

// Get listening history with mood timeline
router.get('/history', getListeningHistory);

export default router;