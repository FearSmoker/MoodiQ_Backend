import express from 'express';
import { 
  getPreferences, 
  updatePreferences, 
  sharePlaylist, 
  getSharedPlaylist,
  getUserShares,
  deleteShare,
  submitFeedback,
  handleVoiceCommand,
  getUserStats,
} from '../controllers/userController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Preferences
router.get('/preferences', protect, getPreferences);
router.put('/preferences', protect, updatePreferences);

// User statistics
router.get('/stats', protect, getUserStats);

// Feedback for ML model
router.post('/feedback', protect, submitFeedback);

// Voice/Chat interface
router.post('/voice-command', protect, handleVoiceCommand);

// Playlist sharing
router.post('/share', protect, sharePlaylist);
router.get('/shares', protect, getUserShares);
router.get('/share/:shareId', getSharedPlaylist); // Public route
router.delete('/share/:shareId', protect, deleteShare);

export default router;