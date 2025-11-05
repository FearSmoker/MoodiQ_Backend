import express from 'express';
import {
  startLiveSession,
  addTrackToSession,
  getCurrentSession,
  endSession,
  autoCheckSession,
} from '../controllers/liveListeningController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// All routes are protected
router.use(protect);

// ===============================================
// Live Listening Endpoints
// ===============================================

// Start new live session
router.post('/session/start', startLiveSession);

// Add track to session
router.post('/session/add-track', addTrackToSession);

// Get current session
router.get('/session/current', getCurrentSession);

// End session
router.post('/session/end', endSession);

// Auto-check session (inactivity timeout)
router.post('/session/auto-check', autoCheckSession);

export default router;