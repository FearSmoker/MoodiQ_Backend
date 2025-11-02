import express from 'express';
import { 
  login, 
  spotifyCallback, 
  refreshToken, 
  getMe,
  youtubeAuth,
  youtubeCallback,
  refreshYoutubeToken,
  appleAuth,
  appleToken,
  unlinkService,
} from '../controllers/authController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Spotify OAuth routes
router.get('/login', login);
router.get('/callback', spotifyCallback);
router.post('/refresh', refreshToken);
router.get('/me', protect, getMe);

// YouTube Music OAuth routes
router.get('/youtube/auth', protect, youtubeAuth);
router.get('/youtube/callback', youtubeCallback);
router.post('/youtube/refresh', protect, refreshYoutubeToken);

// Apple Music auth routes (uses MusicKit.js on frontend)
router.get('/apple/auth', protect, appleAuth);
router.post('/apple/token', protect, appleToken);

// Unlink service
router.delete('/:service/unlink', protect, unlinkService);

export default router;