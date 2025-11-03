import express from 'express';
import {
  getTrackLyrics,
  analyzeLyrics,
  getLyricsSentiment,
  searchLyrics,
} from '../controllers/lyricsController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// All routes are protected
router.use(protect);

// ===============================================
// Lyrics Endpoints
// ===============================================

// Get lyrics for a single track
router.get('/track/:trackId', getTrackLyrics);

// Analyze lyrics for multiple tracks
router.post('/analyze', analyzeLyrics);

// Get lyrics with sentiment analysis
router.post('/sentiment', getLyricsSentiment);

// Search lyrics
router.get('/search', searchLyrics);

export default router;