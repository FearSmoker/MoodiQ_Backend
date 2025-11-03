import express from 'express';
import {
  optimizePlaylistFlow,
  applyOptimizedFlow,
} from '../controllers/flowOptimizerController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// All routes are protected
router.use(protect);

// Optimize playlist flow
router.post('/optimize', optimizePlaylistFlow);

// Apply optimized order to Spotify playlist
router.put('/apply/:playlistId', applyOptimizedFlow);

export default router;