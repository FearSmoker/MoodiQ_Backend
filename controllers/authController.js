import SpotifyWebApi from 'spotify-web-api-node';
import jwt from 'jsonwebtoken';
import { google } from 'googleapis';
import User from '../models/userModel.js';

// --- Helper Functions ---

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '30d',
  });
};

const getFrontendUrl = () => {
  // IMPORTANT: Make sure FRONTEND_URL is set in production
  const frontendUrl = process.env.FRONTEND_URL;
  
  if (!frontendUrl) {
    console.error('⚠️ WARNING: FRONTEND_URL environment variable is not set!');
    console.error('Falling back to localhost - this will NOT work in production!');
    return 'http://localhost:5173';
  }
  
  // Remove trailing slash if present
  return frontendUrl.replace(/\/$/, '');
};

// =================================================================
// ### 1. Primary Authentication (Spotify) ###
// =================================================================

const spotifyScopes = [
  'user-read-private',
  'user-read-email',
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-public',
  'playlist-modify-private',
  'user-top-read',
  'user-read-playback-state',
  'user-read-currently-playing',
  'user-read-recently-played',
  'user-library-read',
  'user-library-modify',
];

const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  redirectUri: process.env.SPOTIFY_REDIRECT_URI,
});

/**
 * @desc    Initiate Spotify login
 * @route   GET /api/auth/login
 */
export const login = (req, res) => {
  console.log('🔐 Initiating Spotify login...');
  console.log('Redirect URI configured:', process.env.SPOTIFY_REDIRECT_URI);
  
  const authorizeURL = spotifyApi.createAuthorizeURL(spotifyScopes, 'state');
  res.redirect(authorizeURL);
};

/**
 * @desc    Handle Spotify callback, log in or create user, send JWT
 * @route   GET /api/auth/callback
 */
export const spotifyCallback = async (req, res) => {
  const code = req.query.code || null;
  const frontendUrl = getFrontendUrl();

  console.log('📥 Spotify callback received');
  console.log('Frontend URL:', frontendUrl);
  console.log('Code present:', !!code);

  if (!code) {
    console.error('❌ No authorization code received');
    return res.redirect(`${frontendUrl}/login?error=no_code`);
  }

  try {
    const data = await spotifyApi.authorizationCodeGrant(code);
    const { access_token, refresh_token, expires_in } = data.body;

    spotifyApi.setAccessToken(access_token);
    spotifyApi.setRefreshToken(refresh_token);

    const me = await spotifyApi.getMe();
    const spotifyId = me.body.id;
    const email = me.body.email;
    const displayName = me.body.display_name;
    const avatarUrl = me.body.images && me.body.images.length > 0 ? me.body.images[0].url : null;

    console.log('✅ Successfully authenticated user:', displayName);

    let user = await User.findOne({ spotifyId });

    if (user) {
      // Update existing user
      user.accessToken = access_token;
      user.refreshToken = refresh_token;
      user.tokenExpires = Date.now() + expires_in * 1000;
      user.displayName = displayName;
      user.email = email;
      user.avatarUrl = avatarUrl;
      await user.save();
      console.log('🔄 Updated existing user');
    } else {
      // Create new user
      user = await User.create({
        spotifyId,
        email,
        displayName,
        avatarUrl,
        accessToken: access_token,
        refreshToken: refresh_token,
        tokenExpires: Date.now() + expires_in * 1000,
      });
      console.log('🆕 Created new user');
    }

    const token = generateToken(user._id);

    // Redirect to frontend with JWT
    const redirectUrl = `${frontendUrl}/callback?token=${token}`;
    console.log('🔀 Redirecting to:', redirectUrl);
    
    res.redirect(redirectUrl);

  } catch (err) {
    console.error('❌ Error during Spotify callback:', err.message);
    res.redirect(`${frontendUrl}/login?error=auth_failed`);
  }
};

/**
 * @desc    Refresh Spotify access token
 * @route   POST /api/auth/refresh
 */
export const refreshToken = async (req, res) => {
  const { refreshToken } = req.body;
  
  if (!refreshToken) {
    return res.status(401).json({ message: 'No refresh token provided' });
  }

  const spotifyRefreshApi = new SpotifyWebApi({
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    refreshToken: refreshToken,
  });

  try {
    const data = await spotifyRefreshApi.refreshAccessToken();
    const { access_token, expires_in } = data.body;
    
    // Update user in DB
    const user = await User.findOneAndUpdate(
      { refreshToken }, 
      {
        accessToken: access_token,
        tokenExpires: Date.now() + expires_in * 1000,
      },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    res.json({
      accessToken: access_token,
      expiresIn: expires_in,
    });
  } catch (err) {
    console.error('Could not refresh access token:', err.message);
    res.status(400).json({ message: 'Failed to refresh token' });
  }
};

/**
 * @desc    Get logged in user's details
 * @route   GET /api/auth/me
 */
export const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-accessToken -refreshToken');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.status(200).json(user);
  } catch (err) {
    console.error('Error fetching user:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
};

// =================================================================
// ### 2. Secondary Service Linking (Protected Routes) ###
// =================================================================

// --- YouTube / Google ---

const googleOAuth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

const googleScopes = [
  'https://www.googleapis.com/auth/youtube',
  'https://www.googleapis.com/auth/youtube.force-ssl',
  'https://www.googleapis.com/auth/userinfo.email',
];

/**
 * @desc    Initiate YouTube (Google) auth flow
 * @route   GET /api/auth/youtube/auth
 */
export const youtubeAuth = (req, res) => {
  // Store user ID in state to retrieve after callback
  const state = Buffer.from(JSON.stringify({ userId: req.user._id })).toString('base64');
  
  const authUrl = googleOAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: googleScopes,
    prompt: 'consent',
    state: state,
  });
  
  res.redirect(authUrl);
};

/**
 * @desc    Handle YouTube (Google) callback, link to existing user
 * @route   GET /api/auth/youtube/callback
 */
export const youtubeCallback = async (req, res) => {
  const code = req.query.code || null;
  const state = req.query.state || null;
  const frontendUrl = getFrontendUrl();

  if (!code) {
    return res.redirect(`${frontendUrl}/dashboard?error=youtube_no_code`);
  }

  try {
    // Decode state to get user ID
    let userId;
    if (state) {
      const decoded = JSON.parse(Buffer.from(state, 'base64').toString());
      userId = decoded.userId;
    }

    // Exchange code for tokens
    const { tokens } = await googleOAuth2Client.getToken(code);
    const { access_token, refresh_token, expiry_date } = tokens;

    // Find the user
    const user = await User.findById(userId);
    if (!user) {
      return res.redirect(`${frontendUrl}/dashboard?error=user_not_found`);
    }

    // Initialize authTokens if it doesn't exist
    if (!user.authTokens) {
      user.authTokens = new Map();
    }

    // Save YouTube/Google tokens
    user.authTokens.set('youtube', {
      accessToken: access_token,
      refreshToken: refresh_token || user.authTokens.get('youtube')?.refreshToken || null,
      tokenExpires: expiry_date ? new Date(expiry_date) : null,
    });
    
    await user.save();

    res.redirect(`${frontendUrl}/dashboard?linked=youtube`);

  } catch (err) {
    console.error('Error during YouTube callback:', err.message);
    res.redirect(`${frontendUrl}/dashboard?error=youtube_auth_failed`);
  }
};

/**
 * @desc    Refresh YouTube access token
 * @route   POST /api/auth/youtube/refresh
 */
export const refreshYoutubeToken = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    
    if (!user || !user.authTokens || !user.authTokens.get('youtube')) {
      return res.status(404).json({ message: 'YouTube account not linked' });
    }

    const youtubeTokens = user.authTokens.get('youtube');
    
    if (!youtubeTokens.refreshToken) {
      return res.status(400).json({ message: 'No refresh token available' });
    }

    googleOAuth2Client.setCredentials({
      refresh_token: youtubeTokens.refreshToken
    });

    const { credentials } = await googleOAuth2Client.refreshAccessToken();
    
    user.authTokens.set('youtube', {
      accessToken: credentials.access_token,
      refreshToken: credentials.refresh_token || youtubeTokens.refreshToken,
      tokenExpires: credentials.expiry_date ? new Date(credentials.expiry_date) : null,
    });
    
    await user.save();

    res.json({
      accessToken: credentials.access_token,
      expiresIn: credentials.expiry_date,
    });

  } catch (err) {
    console.error('Error refreshing YouTube token:', err.message);
    res.status(500).json({ message: 'Failed to refresh YouTube token' });
  }
};

// --- Apple Music ---

/**
 * @desc    Initiate Apple Music auth flow
 * @route   GET /api/auth/apple/auth
 */
export const appleAuth = (req, res) => {
  // Apple Music uses MusicKit.js on frontend for authentication
  // This endpoint can be used to generate developer token if needed
  // For now, return instructions
  res.json({
    message: 'Apple Music authentication should be initiated from the frontend using MusicKit.js',
    instructions: 'Use MusicKit.configure() and MusicKit.getInstance().authorize() on the frontend'
  });
};

/**
 * @desc    Save Apple Music user token
 * @route   POST /api/auth/apple/token
 */
export const appleToken = async (req, res) => {
  const { musicUserToken } = req.body;

  if (!musicUserToken) {
    return res.status(400).json({ message: 'No Apple Music user token provided' });
  }

  try {
    const user = await User.findById(req.user._id);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Initialize authTokens if it doesn't exist
    if (!user.authTokens) {
      user.authTokens = new Map();
    }

    // Save Apple Music token
    user.authTokens.set('apple', {
      accessToken: musicUserToken,
      refreshToken: null, // Apple Music tokens are handled by MusicKit
      tokenExpires: null, // MusicKit handles expiration
    });
    
    await user.save();

    res.json({ 
      success: true, 
      message: 'Apple Music account linked successfully' 
    });

  } catch (err) {
    console.error('Error saving Apple Music token:', err.message);
    res.status(500).json({ message: 'Failed to link Apple Music account' });
  }
};

/**
 * @desc    Unlink a service from user account
 * @route   DELETE /api/auth/:service/unlink
 */
export const unlinkService = async (req, res) => {
  const { service } = req.params;
  
  if (!['youtube', 'apple'].includes(service)) {
    return res.status(400).json({ message: 'Invalid service' });
  }

  try {
    const user = await User.findById(req.user._id);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.authTokens && user.authTokens.has(service)) {
      user.authTokens.delete(service);
      await user.save();
    }

    res.json({ 
      success: true, 
      message: `${service} account unlinked successfully` 
    });

  } catch (err) {
    console.error(`Error unlinking ${service}:`, err.message);
    res.status(500).json({ message: `Failed to unlink ${service} account` });
  }
};