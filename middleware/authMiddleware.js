import jwt from 'jsonwebtoken';
import User from '../models/userModel.js';
import SpotifyWebApi from 'spotify-web-api-node';

const refreshSpotifyToken = async (user) => {
  try {
    console.log('🔄 Refreshing Spotify token for user:', user.displayName);
    
    const spotifyApi = new SpotifyWebApi({
      clientId: process.env.SPOTIFY_CLIENT_ID,
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
      refreshToken: user.refreshToken,
    });

    const data = await spotifyApi.refreshAccessToken();
    const { access_token, expires_in } = data.body;
    
    // update user in database
    user.accessToken = access_token;
    user.tokenExpires = new Date(Date.now() + expires_in * 1000);
    await user.save();
    
    console.log('✅ Token refreshed successfully');
    
    return access_token;
  } catch (error) {
    console.error('❌ Token refresh failed:', error.message);
    throw error;
  }
};

export const protect = async (req, res, next) => {
  let token;

  console.log(`🔒 Auth: ${req.method} ${req.path}`);

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      // get token from header
      token = req.headers.authorization.split(' ')[1];

      // verify JWT token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // get user from token
      req.user = await User.findById(decoded.id).select('-password');
      
      if (!req.user) {
        console.error('❌ Auth: User not found for token');
        return res.status(401).json({ 
          message: 'Not authorized, user not found',
          code: 'USER_NOT_FOUND' 
        });
      }

      // ⭐ CRITICAL: Check if Spotify token is expired or about to expire
      const now = Date.now();
      const tokenExpires = req.user.tokenExpires ? new Date(req.user.tokenExpires).getTime() : 0;
      const timeUntilExpiry = tokenExpires - now;
      
      // refresh if token expired or expires in less than 5 minutes
      if (timeUntilExpiry < 5 * 60 * 1000) {
        console.log('⚠️ Spotify token expired or expiring soon, refreshing...');
        
        try {
          const newAccessToken = await refreshSpotifyToken(req.user);
          req.user.accessToken = newAccessToken;
          console.log('✅ Token auto-refreshed successfully');
        } catch (refreshError) {
          console.error('❌ Token refresh failed:', refreshError.message);
          return res.status(401).json({ 
            message: 'Your Spotify session has expired. Please log in again.',
            code: 'SPOTIFY_TOKEN_REFRESH_FAILED'
          });
        }
      } else {
        console.log(`✅ Token valid for ${Math.floor(timeUntilExpiry / 60000)} more minutes`);
      }

      console.log('✅ Auth: User authenticated:', req.user.displayName);
      next();

    } catch (error) {
      console.error('❌ Auth error:', error.message);
      
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
        code: 'AUTH_FAILED',
        error: error.message
      });
    }
  } else {
    console.error('❌ Auth: No token provided');
    res.status(401).json({ 
      message: 'Not authorized, no token provided',
      code: 'NO_TOKEN' 
    });
  }
};

export const optionalAuth = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = await User.findById(decoded.id).select('-password');
      
      // also check and refresh Spotify token if needed
      if (req.user) {
        const now = Date.now();
        const tokenExpires = req.user.tokenExpires ? new Date(req.user.tokenExpires).getTime() : 0;
        const timeUntilExpiry = tokenExpires - now;
        
        if (timeUntilExpiry < 5 * 60 * 1000) {
          try {
            const newAccessToken = await refreshSpotifyToken(req.user);
            req.user.accessToken = newAccessToken;
          } catch (refreshError) {
            console.warn('⚠️ Optional auth token refresh failed:', refreshError.message);
          }
        }
      }
    } catch (error) {
      console.log('⚠️ Optional auth failed:', error.message);
    }
  }

  next();
};