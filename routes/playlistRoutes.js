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
// ML-Powered Mood Features (HYBRID APPROACH)
// ===============================================

// Analyze playlist mood using HYBRID approach
// Uses: Spotify API + Multi-API Stack
router.post('/mood', getPlaylistMood);

// Analyze currently playing track (NEW - HYBRID)
// Uses: Spotify currently-playing + Multi-API features
router.get('/currently-playing', getCurrentlyPlayingMood);

// Optimize playlist flow
router.post('/optimize', optimizePlaylistFlow);

// Detect mood gaps
router.post('/gaps', detectMoodGaps);

// Fill mood gaps with recommendations
router.post('/fill-gaps', fillMoodGaps);

// Fill mood gaps with targeted Spotify catalog bridging tracks (per-gap, returns augmentedTracks)
router.post('/fill-gaps-smart', fillGapsWithSpotify);

// AI-powered optimization: picks existing tracks that fit the arc + fills from Spotify catalog
router.post('/optimize-enrich', optimizeAndEnrichFlow);

// ===============================================
// Playlist Generation (HYBRID SPOTIFY INTEGRATION)
// ===============================================

// Generate mood-based playlist
// Uses: Spotify metadata + Last.fm recommendations
router.post('/generate/mood', generateMoodPlaylist);

// Generate activity-based playlist
router.post('/generate/activity', generateActivityPlaylist);

// Generate from user's top tracks (NEW - SPOTIFY)
// Uses: Spotify top tracks + Last.fm similar tracks
router.post('/generate/from-top-tracks', generateFromTopTracks);

// Generate from recently played (NEW - SPOTIFY)
// Uses: Spotify recently played + Last.fm recommendations
router.post('/generate/from-recently-played', generateFromRecentlyPlayed);

// ===============================================
// Recommendations (HYBRID)
// ===============================================

// Get personalized hybrid recommendations (ML-based, may be unavailable)
router.post('/recommendations', getRecommendations);

// ===============================================
// Spotify-Native Features (no ML required)
// ===============================================

// Get recommendations purely from Spotify top/recent tracks + audio features
// Supports ?mood=Joyful&limit=30&valence=0.7&energy=0.8
router.get('/recommendations/spotify', getSpotifyRecommendations);

// Direct Spotify playlist mood analysis (no ML dependency)
router.post('/analyze-direct', analyzePlaylistDirect);

// Mood trends from recently played tracks (no ML history needed)
router.get('/mood-from-recent', getMoodFromRecentlyPlayed);

export default router;