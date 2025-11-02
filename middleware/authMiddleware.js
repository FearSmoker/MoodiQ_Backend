import jwt from 'jsonwebtoken';
import User from '../models/userModel.js';

/**
 * Protect routes - verify JWT token and attach user to request
 */
export const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      // Get token from header
      token = req.headers.authorization.split(' ')[1];

      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // Get user from token
      req.user = await User.findById(decoded.id).select('-password');
      
      if (!req.user) {
        return res.status(401).json({ 
          message: 'Not authorized, user not found',
          code: 'USER_NOT_FOUND' 
        });
      }

      // Check if Spotify token is expired
      if (req.user.tokenExpires && req.user.tokenExpires < Date.now()) {
        console.log('Spotify token expired for user:', req.user.spotifyId);
        return res.status(401).json({ 
          message: 'Spotify token expired. Please refresh your token.',
          code: 'SPOTIFY_TOKEN_EXPIRED',
          refreshToken: req.user.refreshToken,
        });
      }

      next();
    } catch (error) {
      console.error('Auth middleware error:', error.message);
      
      if (error.name === 'JsonWebTokenError') {
        return res.status(401).json({ 
          message: 'Not authorized, invalid token',
          code: 'INVALID_TOKEN' 
        });
      }
      
      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({ 
          message: 'Not authorized, token expired',
          code: 'JWT_EXPIRED' 
        });
      }
      
      res.status(401).json({ 
        message: 'Not authorized, token failed',
        code: 'AUTH_FAILED' 
      });
    }
  } else {
    res.status(401).json({ 
      message: 'Not authorized, no token provided',
      code: 'NO_TOKEN' 
    });
  }
};

/**
 * Optional auth - doesn't fail if no token, but attaches user if valid token exists
 */
export const optionalAuth = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = await User.findById(decoded.id).select('-password');
    } catch (error) {
      // Silently fail - route will work without user
      console.log('Optional auth failed:', error.message);
    }
  }

  next();
};