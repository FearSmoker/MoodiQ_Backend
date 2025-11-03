import express from 'express';
import {
  analyzeLyrics,
  getTrackLyrics,
} from '../controllers/lyricsFusionController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// All routes are protected
router.use(protect);

// Analyze lyrics for multiple tracks
router.post('/analyze', analyzeLyrics);

// Get lyrics for a single track
router.get('/track/:trackId', getTrackLyrics);

export default router;