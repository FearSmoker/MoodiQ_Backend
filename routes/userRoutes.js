import express from 'express';
import { 
  getPreferences, 
  updatePreferences, 
  sharePlaylist, 
  getSharedPlaylist,
  getUserShares,
  deleteShare,
  submitFeedback,
  submitBatchFeedback,
  logUserBehavior,
  handleVoiceCommand,
  getUserStats,
  getUserPersonalizedModel,
  triggerModelRetrain,
  resetUserPersonalization,
} from '../controllers/userController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// ===============================================
// User Preferences
// ===============================================

router.get('/preferences', protect, getPreferences);
router.put('/preferences', protect, updatePreferences);

// ===============================================
// User Statistics
// ===============================================

router.get('/stats', protect, getUserStats);

// ===============================================
// ML Feedback & Learning
// ===============================================

// Submit single feedback
router.post('/feedback', protect, submitFeedback);

// Submit batch feedback
router.post('/feedback/batch', protect, submitBatchFeedback);

// Log user behavior (implicit learning)
router.post('/behavior', protect, logUserBehavior);

// ===============================================
// Personalization & Model Training
// ===============================================

// Get personalized model info
router.get('/personalized-model', protect, getUserPersonalizedModel);

// Trigger model retraining
router.post('/retrain-model', protect, triggerModelRetrain);

// Reset personalization
router.delete('/reset-personalization', protect, resetUserPersonalization);

// ===============================================
// Voice/NLP Commands
// ===============================================

router.post('/voice-command', protect, handleVoiceCommand);

// ===============================================
// Playlist Sharing
// ===============================================

router.post('/share', protect, sharePlaylist);
router.get('/shares', protect, getUserShares);
router.get('/share/:shareId', getSharedPlaylist); // Public route
router.delete('/share/:shareId', protect, deleteShare);

export default router;