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
  console.log('🌐 Frontend URL:', frontendUrl);
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
 * @desc    Initiate Spotify login - MUST show consent screen
 * @route   GET /api/auth/login
 */
export const login = (req, res) => {
  console.log('\n' + '='.repeat(70));
  console.log('🔐 SPOTIFY LOGIN INITIATED');
  console.log('='.repeat(70));
  console.log('📍 Environment:', process.env.NODE_ENV);
  console.log('🔑 Client ID:', process.env.SPOTIFY_CLIENT_ID ? `${process.env.SPOTIFY_CLIENT_ID.substring(0, 15)}...` : '❌ MISSING');
  console.log('🔒 Client Secret:', process.env.SPOTIFY_CLIENT_SECRET ? '✓ Configured' : '❌ MISSING');
  console.log('🔄 Redirect URI:', process.env.SPOTIFY_REDIRECT_URI);
  console.log('🌐 Frontend URL:', process.env.FRONTEND_URL);
  
  if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
    console.error('❌ CRITICAL: Spotify credentials missing!');
    return res.status(500).json({ 
      error: 'Server configuration error',
      message: 'Spotify credentials not configured'
    });
  }
  
  try {
    // CRITICAL: Generate unique state for each request
    const state = Buffer.from(JSON.stringify({ 
      timestamp: Date.now(),
      random: Math.random().toString(36).substring(7)
    })).toString('base64');
    
    // Create authorization URL that will DEFINITELY show consent screen
    // The key is to use show_dialog=true parameter
    const authorizeURL = spotifyApi.createAuthorizeURL(spotifyScopes, state, true);
    
    console.log('✅ Authorization URL generated');
    console.log('🔗 URL:', authorizeURL);
    console.log('📤 Redirecting to Spotify consent screen...');
    console.log('⚠️  USER SHOULD SEE SPOTIFY\'S OFFICIAL CONSENT SCREEN NOW');
    console.log('='.repeat(70) + '\n');
    
    // NO DATABASE OPERATIONS HERE
    res.redirect(authorizeURL);
    
  } catch (err) {
    console.error('❌ Error creating Spotify authorization URL:', err.message);
    console.error('Stack:', err.stack);
    console.log('='.repeat(70) + '\n');
    
    const frontendUrl = getFrontendUrl();
    res.redirect(`${frontendUrl}/?error=spotify_config_error`);
  }
};

/**
 * @desc    Handle Spotify callback - ONLY create user AFTER authorization
 * @route   GET /api/auth/callback
 */
export const spotifyCallback = async (req, res) => {
  console.log('\n' + '='.repeat(70));
  console.log('🔥 SPOTIFY CALLBACK RECEIVED');
  console.log('='.repeat(70));
  console.log('📍 Request URL:', req.url);
  console.log('📦 Query Parameters:', JSON.stringify(req.query, null, 2));
  
  const code = req.query.code || null;
  const error = req.query.error || null;
  const state = req.query.state || null;
  const frontendUrl = getFrontendUrl();

  console.log('🔍 Analysis:');
  console.log('   - Authorization Code:', code ? `Present (${code.length} chars)` : '❌ MISSING');
  console.log('   - Error:', error || 'None');
  console.log('   - State:', state ? 'Present' : 'None');

  // ============================================
  // SCENARIO 1: User Cancelled
  // ============================================
  if (error === 'access_denied') {
    console.log('\n🚫 USER CANCELLED AUTHORIZATION');
    console.log('   Action: Redirecting to homepage');
    console.log('   Note: NO user will be created in database');
    console.log('='.repeat(70) + '\n');
    
    return res.redirect(`${frontendUrl}/?cancelled=true`);
  }

  // ============================================
  // SCENARIO 2: No Code (Invalid Request)
  // ============================================
  if (!code) {
    console.error('\n❌ INVALID CALLBACK - No authorization code');
    console.log('='.repeat(70) + '\n');
    
    return res.redirect(`${frontendUrl}/?error=no_code&message=${encodeURIComponent('Authorization failed')}`);
  }

  // ============================================
  // SCENARIO 3: User Authorized - Proceed
  // ============================================
  console.log('\n✅ User authorized! Processing...');
  
  try {
    // Step 1: Exchange code for tokens
    console.log('\n📤 Step 1: Exchanging authorization code for tokens...');
    
    const data = await spotifyApi.authorizationCodeGrant(code);
    const { access_token, refresh_token, expires_in } = data.body;

    if (!access_token || !refresh_token) {
      throw new Error('Missing tokens in Spotify response');
    }

    console.log('✅ Tokens received:');
    console.log('   - Access Token: ✓ (' + access_token.length + ' chars)');
    console.log('   - Refresh Token: ✓ (' + refresh_token.length + ' chars)');
    console.log('   - Expires In: ' + expires_in + ' seconds');

    spotifyApi.setAccessToken(access_token);
    spotifyApi.setRefreshToken(refresh_token);

    // Step 2: Fetch user profile from Spotify
    console.log('\n📤 Step 2: Fetching user profile from Spotify...');
    
    const me = await spotifyApi.getMe();
    
    if (!me.body || !me.body.id) {
      throw new Error('Invalid user profile response from Spotify');
    }

    const spotifyId = me.body.id;
    const email = me.body.email;
    const displayName = me.body.display_name || 'Spotify User';
    const avatarUrl = me.body.images && me.body.images.length > 0 ? me.body.images[0].url : null;

    console.log('✅ User profile retrieved:');
    console.log('   - Name: ' + displayName);
    console.log('   - Spotify ID: ' + spotifyId);
    console.log('   - Email: ' + email);

    // Step 3: Database operations - ONLY NOW!
    console.log('\n📤 Step 3: Database operations...');
    console.log('⚠️  THIS IS THE ONLY POINT WHERE DATABASE IS TOUCHED');
    
    let user = await User.findOne({ spotifyId });

    if (user) {
      console.log('📝 Existing user found - updating tokens...');
      
      user.accessToken = access_token;
      user.refreshToken = refresh_token;
      user.tokenExpires = Date.now() + expires_in * 1000;
      user.displayName = displayName;
      user.email = email;
      user.avatarUrl = avatarUrl;
      user.lastActive = Date.now();
      
      await user.save();
      
      console.log('✅ User updated (ID: ' + user._id + ')');
      
    } else {
      console.log('🆕 New user - creating in database...');
      console.log('⚠️  USER CREATION HAPPENS ONLY AFTER SPOTIFY AUTHORIZATION');
      
      user = await User.create({
        spotifyId,
        email,
        displayName,
        avatarUrl,
        accessToken: access_token,
        refreshToken: refresh_token,
        tokenExpires: Date.now() + expires_in * 1000,
      });
      
      console.log('✅ New user created (ID: ' + user._id + ')');
    }

    // Step 4: Generate JWT for frontend
    console.log('\n📤 Step 4: Generating JWT token...');
    
    const token = generateToken(user._id);
    console.log('✅ JWT generated (length: ' + token.length + ')');

    // Step 5: Redirect to frontend with token
    console.log('\n📤 Step 5: Final redirect to frontend...');
    
    const redirectUrl = `${frontendUrl}/auth/callback?token=${token}`;
    
    console.log('🔀 Redirecting to: ' + redirectUrl);
    console.log('\n✅ ========== AUTHENTICATION SUCCESSFUL ==========');
    console.log('='.repeat(70) + '\n');
    
    return res.redirect(redirectUrl);

  } catch (err) {
    console.error('\n' + '='.repeat(70));
    console.error('❌ AUTHENTICATION FAILED');
    console.error('='.repeat(70));
    console.error('Error Type:', err.name);
    console.error('Error Message:', err.message);
    
    if (err.response) {
      console.error('Spotify API Error:');
      console.error('  Status:', err.response.status);
      console.error('  Data:', JSON.stringify(err.response.data, null, 2));
    }
    
    console.error('Stack Trace:', err.stack);
    console.error('='.repeat(70) + '\n');
    
    const errorMessage = encodeURIComponent(err.message || 'Authentication failed');
    return res.redirect(`${frontendUrl}/?error=auth_failed&message=${errorMessage}`);
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
  console.log('📺 Initiating YouTube auth for user:', req.user._id);
  
  try {
    const state = Buffer.from(JSON.stringify({ userId: req.user._id })).toString('base64');
    
    const authUrl = googleOAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: googleScopes,
      prompt: 'consent',
      state: state,
    });
    
    console.log('🔗 Redirecting to Google OAuth');
    res.redirect(authUrl);
  } catch (err) {
    console.error('❌ Error creating YouTube auth URL:', err.message);
    const frontendUrl = getFrontendUrl();
    res.redirect(`${frontendUrl}/dashboard?error=youtube_config_error`);
  }
};

export const youtubeCallback = async (req, res) => {
  const code = req.query.code || null;
  const state = req.query.state || null;
  const error = req.query.error || null;
  const frontendUrl = getFrontendUrl();

  console.log('📥 YouTube callback received');

  if (error === 'access_denied') {
    console.log('❌ User denied YouTube access');
    return res.redirect(`${frontendUrl}/dashboard?error=youtube_denied&message=${encodeURIComponent('You cancelled YouTube authorization')}`);
  }

  if (!code) {
    console.log('❌ No authorization code');
    return res.redirect(`${frontendUrl}/dashboard?error=youtube_no_code&message=${encodeURIComponent('No authorization code received')}`);
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
      return res.redirect(`${frontendUrl}/dashboard?error=user_not_found&message=${encodeURIComponent('User session expired')}`);
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

    console.log('✅ YouTube account linked successfully');
    res.redirect(`${frontendUrl}/dashboard?success=youtube_linked&message=${encodeURIComponent('YouTube account linked successfully')}`);

  } catch (err) {
    console.error('❌ Error during YouTube callback:', err.message);
    res.redirect(`${frontendUrl}/dashboard?error=youtube_auth_failed&message=${encodeURIComponent(err.message)}`);
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
    console.error('❌ Error refreshing YouTube token:', err.message);
    res.status(500).json({ message: 'Failed to refresh YouTube token' });
  }
};

export const appleAuth = (req, res) => {
  res.json({
    message: 'Apple Music authentication should be initiated from the frontend using MusicKit.js',
    instructions: 'Use MusicKit.configure() and MusicKit.getInstance().authorize() on the frontend'
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
      message: 'Apple Music account linked successfully' 
    });

  } catch (err) {
    console.error('❌ Error saving Apple Music token:', err.message);
    res.status(500).json({ message: 'Failed to link Apple Music account' });
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
      message: `${service} account unlinked successfully` 
    });

  } catch (err) {
    console.error(`❌ Error unlinking ${service}:`, err.message);
    res.status(500).json({ message: `Failed to unlink ${service} account` });
  }
};