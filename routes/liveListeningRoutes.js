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

// all routes are protected
router.use(protect);

// ===============================================
// live Listening Endpoints
// ===============================================

// start new live session
router.post('/session/start', startLiveSession);

// add track to session
router.post('/session/add-track', addTrackToSession);

// get current session
router.get('/session/current', getCurrentSession);

// end session
router.post('/session/end', endSession);

// auto-check session (inactivity timeout)
router.post('/session/auto-check', autoCheckSession);

export default router;