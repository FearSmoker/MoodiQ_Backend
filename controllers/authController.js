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
  // Use FRONTEND_URL from environment, with fallback
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  
  // Log the frontend URL being used
  console.log('🌐 Frontend URL:', frontendUrl);
  
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
  console.log('Spotify Client ID:', process.env.SPOTIFY_CLIENT_ID ? 'Set ✓' : 'Missing ✗');
  console.log('Spotify Client Secret:', process.env.SPOTIFY_CLIENT_SECRET ? 'Set ✓' : 'Missing ✗');
  console.log('Spotify Redirect URI:', process.env.SPOTIFY_REDIRECT_URI);
  
  const authorizeURL = spotifyApi.createAuthorizeURL(spotifyScopes, 'state');
  console.log('🔗 Redirecting to Spotify authorization:', authorizeURL);
  
  res.redirect(authorizeURL);
};

/**
 * @desc    Handle Spotify callback, log in or create user, send JWT
 * @route   GET /api/auth/callback
 */
export const spotifyCallback = async (req, res) => {
  const code = req.query.code || null;
  const error = req.query.error || null;
  const frontendUrl = getFrontendUrl();

  console.log('📥 Spotify callback received');
  console.log('Code present:', !!code);
  console.log('Error:', error);
  console.log('Frontend URL:', frontendUrl);

  // Handle user denial
  if (error === 'access_denied') {
    console.log('❌ User denied access');
    return res.redirect(`${frontendUrl}/login?error=access_denied`);
  }

  if (!code) {
    console.error('❌ No authorization code received');
    return res.redirect(`${frontendUrl}/login?error=no_code`);
  }

  try {
    console.log('🔄 Exchanging code for tokens...');
    const data = await spotifyApi.authorizationCodeGrant(code);
    const { access_token, refresh_token, expires_in } = data.body;

    console.log('✅ Token exchange successful');
    console.log('Access token length:', access_token?.length);
    console.log('Refresh token present:', !!refresh_token);
    console.log('Expires in:', expires_in, 'seconds');

    spotifyApi.setAccessToken(access_token);
    spotifyApi.setRefreshToken(refresh_token);

    console.log('👤 Fetching user profile...');
    const me = await spotifyApi.getMe();
    const spotifyId = me.body.id;
    const email = me.body.email;
    const displayName = me.body.display_name;
    const avatarUrl = me.body.images && me.body.images.length > 0 ? me.body.images[0].url : null;

    console.log('✅ Successfully authenticated user:', displayName);
    console.log('Spotify ID:', spotifyId);
    console.log('Email:', email);

    let user = await User.findOne({ spotifyId });

    if (user) {
      // Update existing user
      console.log('🔄 Updating existing user...');
      user.accessToken = access_token;
      user.refreshToken = refresh_token;
      user.tokenExpires = Date.now() + expires_in * 1000;
      user.displayName = displayName;
      user.email = email;
      user.avatarUrl = avatarUrl;
      await user.save();
      console.log('✅ Updated existing user');
    } else {
      // Create new user
      console.log('🆕 Creating new user...');
      user = await User.create({
        spotifyId,
        email,
        displayName,
        avatarUrl,
        accessToken: access_token,
        refreshToken: refresh_token,
        tokenExpires: Date.now() + expires_in * 1000,
      });
      console.log('✅ Created new user with ID:', user._id);
    }

    console.log('🔑 Generating JWT token...');
    const token = generateToken(user._id);
    console.log('JWT token length:', token?.length);

    // Redirect to frontend callback page with JWT
    const redirectUrl = `${frontendUrl}/callback?token=${token}`;
    console.log('🔀 Redirecting to:', redirectUrl);
    
    res.redirect(redirectUrl);

  } catch (err) {
    console.error('❌ Error during Spotify callback:', err.message);
    console.error('Error name:', err.name);
    console.error('Error stack:', err.stack);
    
    if (err.response) {
      console.error('Spotify API Response Error:', err.response.data);
      console.error('Status:', err.response.status);
    }
    
    res.redirect(`${frontendUrl}/login?error=auth_failed&details=${encodeURIComponent(err.message)}`);
  }
};

/**
 * @desc    Refresh Spotify access token
 * @route   POST /api/auth/refresh
 */
export const refreshToken = async (req, res) => {
  const { refreshToken } = req.body;
  
  console.log('🔄 Token refresh requested');
  
  if (!refreshToken) {
    console.log('❌ No refresh token provided');
    return res.status(401).json({ message: 'No refresh token provided' });
  }

  const spotifyRefreshApi = new SpotifyWebApi({
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    refreshToken: refreshToken,
  });

  try {
    console.log('🔄 Refreshing access token...');
    const data = await spotifyRefreshApi.refreshAccessToken();
    const { access_token, expires_in } = data.body;
    
    console.log('✅ Token refresh successful');
    console.log('New access token length:', access_token?.length);
    
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
      console.log('❌ User not found for refresh token');
      return res.status(404).json({ message: 'User not found' });
    }
    
    console.log('✅ User tokens updated in database');
    
    res.json({
      accessToken: access_token,
      expiresIn: expires_in,
    });
  } catch (err) {
    console.error('❌ Could not refresh access token:', err.message);
    console.error('Error details:', err);
    res.status(400).json({ message: 'Failed to refresh token' });
  }
};

/**
 * @desc    Get logged in user's details
 * @route   GET /api/auth/me
 */
export const getMe = async (req, res) => {
  try {
    console.log('👤 Fetching user details for ID:', req.user._id);
    
    const user = await User.findById(req.user._id).select('-accessToken -refreshToken');
    
    if (!user) {
      console.log('❌ User not found');
      return res.status(404).json({ message: 'User not found' });
    }

    console.log('✅ User details retrieved:', user.displayName);
    res.status(200).json(user);
  } catch (err) {
    console.error('❌ Error fetching user:', err.message);
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
  console.log('📺 Initiating YouTube auth for user:', req.user._id);
  
  // Store user ID in state to retrieve after callback
  const state = Buffer.from(JSON.stringify({ userId: req.user._id })).toString('base64');
  
  const authUrl = googleOAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: googleScopes,
    prompt: 'consent',
    state: state,
  });
  
  console.log('🔗 Redirecting to Google OAuth:', authUrl);
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

  console.log('📥 YouTube callback received');
  console.log('Code present:', !!code);
  console.log('State present:', !!state);
  console.log('Frontend URL:', frontendUrl);

  if (!code) {
    console.log('❌ No authorization code');
    return res.redirect(`${frontendUrl}/dashboard?error=youtube_no_code`);
  }

  try {
    // Decode state to get user ID
    let userId;
    if (state) {
      const decoded = JSON.parse(Buffer.from(state, 'base64').toString());
      userId = decoded.userId;
      console.log('👤 User ID from state:', userId);
    }

    console.log('🔄 Exchanging code for tokens...');
    const { tokens } = await googleOAuth2Client.getToken(code);
    const { access_token, refresh_token, expiry_date } = tokens;

    console.log('✅ Token exchange successful');
    console.log('Access token length:', access_token?.length);
    console.log('Refresh token present:', !!refresh_token);

    // Find the user
    const user = await User.findById(userId);
    if (!user) {
      console.log('❌ User not found:', userId);
      return res.redirect(`${frontendUrl}/dashboard?error=user_not_found`);
    }

    console.log('✅ User found:', user.displayName);

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

    console.log('✅ YouTube account linked successfully');
    res.redirect(`${frontendUrl}/dashboard?linked=youtube`);

  } catch (err) {
    console.error('❌ Error during YouTube callback:', err.message);
    console.error('Error stack:', err.stack);
    res.redirect(`${frontendUrl}/dashboard?error=youtube_auth_failed&details=${encodeURIComponent(err.message)}`);
  }
};

/**
 * @desc    Refresh YouTube access token
 * @route   POST /api/auth/youtube/refresh
 */
export const refreshYoutubeToken = async (req, res) => {
  console.log('🔄 YouTube token refresh requested for user:', req.user._id);
  
  try {
    const user = await User.findById(req.user._id);
    
    if (!user || !user.authTokens || !user.authTokens.get('youtube')) {
      console.log('❌ YouTube account not linked');
      return res.status(404).json({ message: 'YouTube account not linked' });
    }

    const youtubeTokens = user.authTokens.get('youtube');
    
    if (!youtubeTokens.refreshToken) {
      console.log('❌ No refresh token available');
      return res.status(400).json({ message: 'No refresh token available' });
    }

    console.log('🔄 Refreshing YouTube access token...');
    googleOAuth2Client.setCredentials({
      refresh_token: youtubeTokens.refreshToken
    });

    const { credentials } = await googleOAuth2Client.refreshAccessToken();
    
    console.log('✅ YouTube token refresh successful');
    
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
    console.error('❌ Error refreshing YouTube token:', err.message);
    res.status(500).json({ message: 'Failed to refresh YouTube token' });
  }
};

// --- Apple Music ---

/**
 * @desc    Initiate Apple Music auth flow
 * @route   GET /api/auth/apple/auth
 */
export const appleAuth = (req, res) => {
  console.log('🍎 Apple Music auth requested');
  console.log('Note: Apple Music uses MusicKit.js on frontend');
  
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

  console.log('🍎 Saving Apple Music token for user:', req.user._id);
  console.log('Token present:', !!musicUserToken);

  if (!musicUserToken) {
    console.log('❌ No Apple Music user token provided');
    return res.status(400).json({ message: 'No Apple Music user token provided' });
  }

  try {
    const user = await User.findById(req.user._id);
    
    if (!user) {
      console.log('❌ User not found');
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

    console.log('✅ Apple Music account linked successfully');

    res.json({ 
      success: true, 
      message: 'Apple Music account linked successfully' 
    });

  } catch (err) {
    console.error('❌ Error saving Apple Music token:', err.message);
    res.status(500).json({ message: 'Failed to link Apple Music account' });
  }
};

/**
 * @desc    Unlink a service from user account
 * @route   DELETE /api/auth/:service/unlink
 */
export const unlinkService = async (req, res) => {
  const { service } = req.params;
  
  console.log('🔓 Unlinking service:', service, 'for user:', req.user._id);
  
  if (!['youtube', 'apple'].includes(service)) {
    console.log('❌ Invalid service:', service);
    return res.status(400).json({ message: 'Invalid service' });
  }

  try {
    const user = await User.findById(req.user._id);
    
    if (!user) {
      console.log('❌ User not found');
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.authTokens && user.authTokens.has(service)) {
      user.authTokens.delete(service);
      await user.save();
      console.log('✅ Service unlinked successfully');
    } else {
      console.log('⚠️ Service was not linked');
    }

    res.json({ 
      success: true, 
      message: `${service} account unlinked successfully` 
    });

  } catch (err) {
    console.error(`❌ Error unlinking ${service}:`, err.message);
    res.status(500).json({ message: `Failed to unlink ${service} account` });
  }
};