import express from 'express';
import { 
  transferToYouTube, 
  transferToApple,
  getTransferStatus,
} from '../controllers/transferController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// All routes are protected
router.use(protect);

// Transfer status
router.get('/status', getTransferStatus);

// Transfer routes
router.post('/youtube', transferToYouTube);
router.post('/apple', transferToApple);

export default router;