import express from 'express';
import {
  getTrackLyrics,
  analyzeLyrics,
  getLyricsSentiment,
  searchLyrics,
} from '../controllers/lyricsController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// all routes are protected
router.use(protect);

// ===============================================
// lyrics Endpoints
// ===============================================

// get lyrics for a single track
router.get('/track/:trackId', getTrackLyrics);

// analyze lyrics for multiple tracks
router.post('/analyze', analyzeLyrics);

// get lyrics with sentiment analysis
router.post('/sentiment', getLyricsSentiment);

// search lyrics
router.get('/search', searchLyrics);

export default router;