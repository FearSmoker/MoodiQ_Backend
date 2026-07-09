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
// user Preferences
// ===============================================

router.get('/preferences', protect, getPreferences);
router.put('/preferences', protect, updatePreferences);

// ===============================================
// user Statistics
// ===============================================

router.get('/stats', protect, getUserStats);

// ===============================================
// mL Feedback & Learning
// ===============================================

// submit single feedback
router.post('/feedback', protect, submitFeedback);

// submit batch feedback
router.post('/feedback/batch', protect, submitBatchFeedback);

// log user behavior (implicit learning)
router.post('/behavior', protect, logUserBehavior);

// ===============================================
// personalization & Model Training
// ===============================================

// get personalized model info
router.get('/personalized-model', protect, getUserPersonalizedModel);

// trigger model retraining
router.post('/retrain-model', protect, triggerModelRetrain);

// reset personalization
router.delete('/reset-personalization', protect, resetUserPersonalization);

// ===============================================
// voice/NLP Commands
// ===============================================

router.post('/voice-command', protect, handleVoiceCommand);

// ===============================================
// playlist Sharing
// ===============================================

router.post('/share', protect, sharePlaylist);
router.get('/shares', protect, getUserShares);
router.get('/share/:shareId', getSharedPlaylist); // public route
router.delete('/share/:shareId', protect, deleteShare);

export default router;