import express from 'express';
import {
  generateMoodPlaylist,
  saveMoodPlaylist,
} from '../controllers/moodGeneratorController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// All routes are protected
router.use(protect);

// Generate mood-based playlist
router.post('/generate', generateMoodPlaylist);

// Save generated playlist to Spotify
router.post('/save', saveMoodPlaylist);

export default router;