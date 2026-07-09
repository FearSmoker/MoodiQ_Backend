import express from 'express';
import { 
  transferToYouTube, 
  transferToApple,
  getTransferStatus,
} from '../controllers/transferController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// all routes are protected
router.use(protect);

// transfer status
router.get('/status', getTransferStatus);

// transfer routes
router.post('/youtube', transferToYouTube);
router.post('/apple', transferToApple);

export default router;