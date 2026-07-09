import express from 'express';
import { 
  getPlaylists, 
  getPlaylist,
  getPlaylistMood, 
  getCurrentlyPlayingMood,
  optimizePlaylistFlow, 
  detectMoodGaps,
  fillMoodGaps,
  fillGapsWithSpotify,
  optimizeAndEnrichFlow,
  generateMoodPlaylist,
  generateActivityPlaylist,
  generateFromTopTracks,
  generateFromRecentlyPlayed,
  getRecommendations,
  createPlaylist,
  reorderPlaylist,
} from '../controllers/playlistController.js';
import {
  getSpotifyRecommendations,
  analyzePlaylistDirect,
  getMoodFromRecentlyPlayed,
} from '../controllers/recommendationsController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// all routes are protected
router.use(protect);

// ===============================================
// basic Playlist Operations
// ===============================================

// get user's playlists
router.get('/', getPlaylists);

// get specific playlist details
router.get('/:id', getPlaylist);

// create new playlist
router.post('/create', createPlaylist);

// reorder playlist tracks
router.put('/:id/reorder', reorderPlaylist);

// ===============================================

// ===============================================

// uses: Spotify API + Multi-API Stack
router.post('/mood', getPlaylistMood);

// uses: Spotify currently-playing + Multi-API features
router.get('/currently-playing', getCurrentlyPlayingMood);

// optimize playlist flow
router.post('/optimize', optimizePlaylistFlow);

// detect mood gaps
router.post('/gaps', detectMoodGaps);

// fill mood gaps with recommendations
router.post('/fill-gaps', fillMoodGaps);

router.post('/fill-gaps-smart', fillGapsWithSpotify);

router.post('/optimize-enrich', optimizeAndEnrichFlow);

// ===============================================

// ===============================================

// generate mood-based playlist
// uses: Spotify metadata + Last.fm recommendations
router.post('/generate/mood', generateMoodPlaylist);

// generate activity-based playlist
router.post('/generate/activity', generateActivityPlaylist);

// uses: Spotify top tracks + Last.fm similar tracks
router.post('/generate/from-top-tracks', generateFromTopTracks);

// uses: Spotify recently played + Last.fm recommendations
router.post('/generate/from-recently-played', generateFromRecentlyPlayed);

// ===============================================

// ===============================================

router.post('/recommendations', getRecommendations);

// ===============================================
// spotify-Native Features (no ML required)
// ===============================================

// get recommendations purely from Spotify top/recent tracks + audio features
// supports ?mood=Joyful&limit=30&valence=0.7&energy=0.8
router.get('/recommendations/spotify', getSpotifyRecommendations);

// direct Spotify playlist mood analysis (no ML dependency)
router.post('/analyze-direct', analyzePlaylistDirect);

// mood trends from recently played tracks (no ML history needed)
router.get('/mood-from-recent', getMoodFromRecentlyPlayed);

export default router;