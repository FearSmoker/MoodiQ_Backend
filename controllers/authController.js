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
  const frontendUrl = process.env.FRONTEND_URL || 'https://moodiq.netlify.app';
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
 * @access  Public
 */
export const login = (req, res) => {
  console.log('\n🔐 ========== SPOTIFY LOGIN INITIATED ==========');
  console.log('Environment:', process.env.NODE_ENV);
  console.log('Spotify Client ID:', process.env.SPOTIFY_CLIENT_ID ? 'Set ✓' : '❌ MISSING');
  console.log('Spotify Redirect URI:', process.env.SPOTIFY_REDIRECT_URI);
  console.log('Frontend URL:', process.env.FRONTEND_URL);
  
  if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
    console.error('❌ Spotify credentials missing!');
    return res.status(500).json({ 
      error: 'Server configuration error',
      message: 'Spotify credentials not configured'
    });
  }

  // CRITICAL: Validate redirect URI matches environment
  const configuredRedirectUri = process.env.SPOTIFY_REDIRECT_URI;
  if (!configuredRedirectUri || !configuredRedirectUri.includes('moodiq-backend')) {
    console.error('❌ Invalid redirect URI configuration!');
    console.error('Expected: https://moodiq-backend.onrender.com/api/auth/callback');
    console.error('Got:', configuredRedirectUri);
    return res.status(500).json({
      error: 'Configuration error',
      message: 'Redirect URI mismatch'
    });
  }
  
  try {
    // Generate state for security
    const state = Buffer.from(JSON.stringify({ 
      timestamp: Date.now(),
      random: Math.random().toString(36).substring(7)
    })).toString('base64');
    
    // Create authorization URL with show_dialog=true to force consent screen
    const authorizeURL = spotifyApi.createAuthorizeURL(spotifyScopes, state, true);
    
    console.log('✅ Redirecting to Spotify consent screen...');
    console.log('Auth URL:', authorizeURL);
    res.redirect(authorizeURL);
    
  } catch (err) {
    console.error('❌ Error:', err.message);
    console.error('Stack:', err.stack);
    const frontendUrl = getFrontendUrl();
    res.redirect(`${frontendUrl}/?error=config_error&message=${encodeURIComponent('Failed to initialize login')}`);
  }
};

/**
 * @desc    Handle Spotify callback
 * @route   GET /api/auth/callback
 * @access  Public
 */
export const spotifyCallback = async (req, res) => {
  console.log('\n🔥 ========== SPOTIFY CALLBACK RECEIVED ==========');
  console.log('Query params:', JSON.stringify(req.query, null, 2));
  
  const code = req.query.code || null;
  const error = req.query.error || null;
  const frontendUrl = getFrontendUrl();

  // User cancelled authorization
  if (error === 'access_denied') {
    console.log('❌ User cancelled authorization');
    return res.redirect(`${frontendUrl}/?cancelled=true`);
  }

  // No authorization code
  if (!code) {
    console.error('❌ No authorization code received');
    console.error('Full query:', req.query);
    return res.redirect(`${frontendUrl}/?error=no_code&message=${encodeURIComponent('Authorization failed - no code received')}`);
  }

  try {
    // Step 1: Exchange code for tokens
    console.log('🔄 Exchanging code for tokens...');
    console.log('Using redirect URI:', process.env.SPOTIFY_REDIRECT_URI);
    
    const data = await spotifyApi.authorizationCodeGrant(code);
    const { access_token, refresh_token, expires_in } = data.body;

    if (!access_token || !refresh_token) {
      throw new Error('Missing tokens from Spotify response');
    }

    console.log('✅ Tokens received successfully');
    console.log('Token expires in:', expires_in, 'seconds');

    // Set tokens for API calls
    spotifyApi.setAccessToken(access_token);
    spotifyApi.setRefreshToken(refresh_token);

    // Step 2: Fetch user profile
    console.log('👤 Fetching user profile...');
    const me = await spotifyApi.getMe();
    
    const spotifyId = me.body.id;
    const email = me.body.email;
    const displayName = me.body.display_name || 'Spotify User';
    const avatarUrl = me.body.images?.[0]?.url || null;

    console.log('✅ User profile retrieved:', displayName, '(', email, ')');

    // Step 3: Create or update user in database
    console.log('💾 Database operation...');
    
    let user = await User.findOne({ spotifyId });

    if (user) {
      console.log('🔄 Updating existing user...');
      user.accessToken = access_token;
      user.refreshToken = refresh_token;
      user.tokenExpires = Date.now() + expires_in * 1000;
      user.displayName = displayName;
      user.email = email;
      user.avatarUrl = avatarUrl;
      user.lastActive = Date.now();
      await user.save();
      console.log('✅ User updated successfully');
    } else {
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
      console.log('✅ New user created successfully');
    }

    // Step 4: Generate JWT token
    console.log('🔐 Generating JWT...');
    const token = generateToken(user._id);
    console.log('✅ JWT generated');

    // Step 5: Redirect to frontend with token
    const redirectUrl = `${frontendUrl}/auth/callback?token=${token}`;
    console.log('✅ Redirecting to frontend:', redirectUrl);
    console.log('='.repeat(50) + '\n');
    
    return res.redirect(redirectUrl);

  } catch (err) {
    console.error('\n❌ ========== AUTH FAILED ==========');
    console.error('Error name:', err.name);
    console.error('Error message:', err.message);
    console.error('Stack:', err.stack);
    
    if (err.response) {
      console.error('Spotify API Response Status:', err.response.status);
      console.error('Spotify API Response Data:', JSON.stringify(err.response.data, null, 2));
    }
    
    if (err.body) {
      console.error('Spotify Error Body:', JSON.stringify(err.body, null, 2));
    }
    
    // Send detailed error message for debugging
    let errorMsg = 'Authentication failed';
    if (err.message.includes('invalid_grant')) {
      errorMsg = 'Authorization code expired or invalid. Please try again.';
    } else if (err.message.includes('redirect_uri')) {
      errorMsg = 'Redirect URI mismatch. Please contact support.';
    } else {
      errorMsg = err.message || 'Authentication failed';
    }
    
    return res.redirect(`${frontendUrl}/?error=auth_failed&message=${encodeURIComponent(errorMsg)}`);
  }
};

/**
 * @desc    Refresh Spotify access token
 * @route   POST /api/auth/refresh
 * @access  Public
 */
export const refreshToken = async (req, res) => {
  const { refreshToken } = req.body;
  
  console.log('🔄 Token refresh requested');
  
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
    
    console.log('✅ Token refreshed for user:', user.displayName);
    
    res.json({
      accessToken: access_token,
      expiresIn: expires_in,
    });
  } catch (err) {
    console.error('❌ Token refresh failed:', err.message);
    res.status(400).json({ message: 'Failed to refresh token' });
  }
};

/**
 * @desc    Get logged in user's details
 * @route   GET /api/auth/me
 * @access  Protected
 */
export const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-accessToken -refreshToken');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.status(200).json(user);
  } catch (err) {
    console.error('❌ Error fetching user:', err.message);
    res.status(500).json({ message: 'Server error' });
  }
};

// =================================================================
// ### 2. Secondary Service Linking (Protected Routes) ###
// =================================================================

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

export const youtubeAuth = (req, res) => {
  console.log('📺 YouTube auth for user:', req.user._id);
  
  try {
    const state = Buffer.from(JSON.stringify({ userId: req.user._id })).toString('base64');
    
    const authUrl = googleOAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: googleScopes,
      prompt: 'consent',
      state: state,
    });
    
    res.redirect(authUrl);
  } catch (err) {
    console.error('❌ YouTube auth error:', err.message);
    const frontendUrl = getFrontendUrl();
    res.redirect(`${frontendUrl}/dashboard?error=youtube_config_error`);
  }
};

export const youtubeCallback = async (req, res) => {
  const code = req.query.code || null;
  const state = req.query.state || null;
  const error = req.query.error || null;
  const frontendUrl = getFrontendUrl();

  if (error === 'access_denied') {
    return res.redirect(`${frontendUrl}/dashboard?error=youtube_denied&message=${encodeURIComponent('YouTube authorization cancelled')}`);
  }

  if (!code) {
    return res.redirect(`${frontendUrl}/dashboard?error=youtube_no_code&message=${encodeURIComponent('No authorization code')}`);
  }

  try {
    let userId;
    if (state) {
      const decoded = JSON.parse(Buffer.from(state, 'base64').toString());
      userId = decoded.userId;
    }

    const { tokens } = await googleOAuth2Client.getToken(code);
    const { access_token, refresh_token, expiry_date } = tokens;

    const user = await User.findById(userId);
    if (!user) {
      return res.redirect(`${frontendUrl}/dashboard?error=user_not_found`);
    }

    if (!user.authTokens) {
      user.authTokens = new Map();
    }

    user.authTokens.set('youtube', {
      accessToken: access_token,
      refreshToken: refresh_token || user.authTokens.get('youtube')?.refreshToken || null,
      tokenExpires: expiry_date ? new Date(expiry_date) : null,
    });
    
    await user.save();

    console.log('✅ YouTube linked for:', user.displayName);
    res.redirect(`${frontendUrl}/dashboard?success=youtube_linked`);

  } catch (err) {
    console.error('❌ YouTube callback error:', err.message);
    res.redirect(`${frontendUrl}/dashboard?error=youtube_failed&message=${encodeURIComponent(err.message)}`);
  }
};

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
    console.error('❌ YouTube token refresh failed:', err.message);
    res.status(500).json({ message: 'Failed to refresh YouTube token' });
  }
};

export const appleAuth = (req, res) => {
  res.json({
    message: 'Apple Music authentication should be initiated from the frontend using MusicKit.js',
  });
};

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

    if (!user.authTokens) {
      user.authTokens = new Map();
    }

    user.authTokens.set('apple', {
      accessToken: musicUserToken,
      refreshToken: null,
      tokenExpires: null,
    });
    
    await user.save();

    res.json({ 
      success: true, 
      message: 'Apple Music linked successfully' 
    });

  } catch (err) {
    console.error('❌ Apple Music link failed:', err.message);
    res.status(500).json({ message: 'Failed to link Apple Music' });
  }
};

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
      message: `${service} unlinked successfully` 
    });

  } catch (err) {
    console.error(`❌ Unlink ${service} failed:`, err.message);
    res.status(500).json({ message: `Failed to unlink ${service}` });
  }
};