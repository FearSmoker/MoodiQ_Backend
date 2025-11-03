import express from 'express';
import {
  getMoodBasedRecommendations,
  getPersonalizedRecommendations,
  submitRecommendationFeedback,
} from '../controllers/recommendationsController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// All routes are protected
router.use(protect);

// Get mood-based recommendations
router.post('/mood-based', getMoodBasedRecommendations);

// Get personalized recommendations
router.get('/personalized', getPersonalizedRecommendations);

// Submit feedback on recommendation
router.post('/feedback', submitRecommendationFeedback);

export default router;