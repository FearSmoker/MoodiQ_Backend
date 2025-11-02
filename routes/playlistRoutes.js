import express from 'express';
import { 
  getPlaylists, 
  getPlaylist,
  getPlaylistMood, 
  optimizePlaylistFlow, 
  getRecommendations,
  getAudioFeatures,
  createPlaylist,
  reorderPlaylist,
} from '../controllers/playlistController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// All routes are protected
router.use(protect);

// Playlist operations
router.get('/', getPlaylists);
router.get('/:id', getPlaylist);
router.post('/create', createPlaylist);
router.put('/:id/reorder', reorderPlaylist);

// Mood and ML features
router.post('/mood', getPlaylistMood);
router.post('/optimize', optimizePlaylistFlow);
router.post('/recommendations', getRecommendations);
router.post('/features', getAudioFeatures);

export default router;