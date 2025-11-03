import express from 'express';
import { 
  getPlaylists, 
  getPlaylist,
  getPlaylistMood, 
  optimizePlaylistFlow, 
  detectMoodGaps,
  fillMoodGaps,
  generateMoodPlaylist,
  generateActivityPlaylist,
  getRecommendations,
  getAudioFeatures,
  createPlaylist,
  reorderPlaylist,
} from '../controllers/playlistController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// All routes are protected
router.use(protect);

// ===============================================
// Basic Playlist Operations
// ===============================================

// Get user's playlists
router.get('/', getPlaylists);

// Get specific playlist details
router.get('/:id', getPlaylist);

// Create new playlist
router.post('/create', createPlaylist);

// Reorder playlist tracks
router.put('/:id/reorder', reorderPlaylist);

// ===============================================
// ML-Powered Mood Features
// ===============================================

// Analyze playlist mood
router.post('/mood', getPlaylistMood);

// Optimize playlist flow
router.post('/optimize', optimizePlaylistFlow);

// Detect mood gaps
router.post('/gaps', detectMoodGaps);

// Fill mood gaps with recommendations
router.post('/fill-gaps', fillMoodGaps);

// ===============================================
// Playlist Generation
// ===============================================

// Generate mood-based playlist
router.post('/generate/mood', generateMoodPlaylist);

// Generate activity-based playlist
router.post('/generate/activity', generateActivityPlaylist);

// ===============================================
// Recommendations & Features
// ===============================================

// Get hybrid recommendations
router.post('/recommendations', getRecommendations);

// Get audio features for tracks
router.post('/features', getAudioFeatures);

export default router;