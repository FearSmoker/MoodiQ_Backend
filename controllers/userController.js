import User from '../models/userModel.js';
import SharedPlaylist from '../models/sharedPlaylistModel.js';
import axios from 'axios';

const ML_API_URL = process.env.ML_API_URL || 'http://localhost:8000';

/**
 * @desc    Get user preferences
 * @route   GET /api/user/preferences
 * @access  Protected
 */
export const getPreferences = async (req, res) => {
  try {
    res.json({
      preferences: req.user.preferences || {},
      userId: req.user._id,
    });
  } catch (err) {
    console.error('Error getting preferences:', err.message);
    res.status(500).json({ message: 'Failed to get preferences' });
  }
};

/**
 * @desc    Update user preferences
 * @route   PUT /api/user/preferences
 * @access  Protected
 */
export const updatePreferences = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Merge new preferences with existing ones
    user.preferences = {
      ...user.preferences,
      ...req.body,
    };
    
    await user.save();
    
    res.json({
      preferences: user.preferences,
      message: 'Preferences updated successfully',
    });
  } catch (err) {
    console.error('Error updating preferences:', err.message);
    res.status(500).json({ message: 'Failed to update preferences' });
  }
};

/**
 * @desc    Submit feedback for mood prediction (for ML model retraining)
 * @route   POST /api/user/feedback
 * @access  Protected
 */
export const submitFeedback = async (req, res) => {
  const { trackId, correctMood, playlistId } = req.body;

  if (!trackId || !correctMood) {
    return res.status(400).json({ message: 'Track ID and correct mood are required' });
  }

  try {
    // Send feedback to ML API for incremental learning
    await axios.post(`${ML_API_URL}/model/feedback`, {
      user_id: req.user._id.toString(),
      track_id: trackId,
      feedback_mood: correctMood,
      playlist_id: playlistId,
      timestamp: new Date().toISOString(),
    }, {
      timeout: 10000
    });

    res.status(200).json({ 
      message: 'Feedback submitted successfully',
      trackId,
      mood: correctMood,
    });
  } catch (err) {
    console.error('Error submitting feedback:', err.message);
    
    // Don't fail the request if ML API is down
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
      return res.status(200).json({ 
        message: 'Feedback received (ML service unavailable)',
        warning: 'ML service is currently unavailable',
      });
    }
    
    res.status(500).json({ message: 'Failed to submit feedback' });
  }
};

/**
 * @desc    Share a playlist with mood data
 * @route   POST /api/user/share
 * @access  Protected
 */
export const sharePlaylist = async (req, res) => {
  const { playlistId, moodData, playlistName, playlistImage } = req.body;

  if (!playlistId || !moodData) {
    return res.status(400).json({ message: 'Playlist ID and mood data are required' });
  }

  try {
    // Generate unique share ID
    const shareId = Math.random().toString(36).substring(2, 10);

    // Save to database
    const sharedPlaylist = await SharedPlaylist.create({
      shareId,
      playlistId,
      moodData,
      playlistName: playlistName || 'Shared Playlist',
      playlistImage: playlistImage || null,
      owner: req.user._id,
    });

    console.log(`Playlist ${playlistId} shared with ID ${shareId}`);

    res.json({
      shareId,
      shareUrl: `/share/${shareId}`,
      fullUrl: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/share/${shareId}`,
    });

  } catch (err) {
    console.error('Failed to create share link:', err.message);
    res.status(500).json({ message: 'Failed to create share link' });
  }
};

/**
 * @desc    Get shared playlist data
 * @route   GET /api/user/share/:shareId
 * @access  Public
 */
export const getSharedPlaylist = async (req, res) => {
  const { shareId } = req.params;

  if (!shareId) {
    return res.status(400).json({ message: 'Share ID is required' });
  }

  try {
    const sharedData = await SharedPlaylist.findOne({ shareId })
      .populate('owner', 'displayName avatarUrl');

    if (!sharedData) {
      return res.status(404).json({ message: 'Shared playlist not found' });
    }

    // Increment view count
    sharedData.views = (sharedData.views || 0) + 1;
    await sharedData.save();

    res.json({
      shareId: sharedData.shareId,
      playlistId: sharedData.playlistId,
      playlistName: sharedData.playlistName,
      playlistImage: sharedData.playlistImage,
      moodData: sharedData.moodData,
      owner: sharedData.owner,
      createdAt: sharedData.createdAt,
      views: sharedData.views,
    });

  } catch (err) {
    console.error('Failed to fetch shared playlist:', err.message);
    res.status(500).json({ message: 'Failed to fetch shared data' });
  }
};

/**
 * @desc    Get user's shared playlists
 * @route   GET /api/user/shares
 * @access  Protected
 */
export const getUserShares = async (req, res) => {
  try {
    const shares = await SharedPlaylist.find({ owner: req.user._id })
      .sort({ createdAt: -1 })
      .select('shareId playlistId playlistName views createdAt');

    res.json({
      shares,
      count: shares.length,
    });

  } catch (err) {
    console.error('Error fetching user shares:', err.message);
    res.status(500).json({ message: 'Failed to fetch shares' });
  }
};

/**
 * @desc    Delete a shared playlist
 * @route   DELETE /api/user/share/:shareId
 * @access  Protected
 */
export const deleteShare = async (req, res) => {
  const { shareId } = req.params;

  try {
    const share = await SharedPlaylist.findOne({ 
      shareId, 
      owner: req.user._id 
    });

    if (!share) {
      return res.status(404).json({ message: 'Shared playlist not found' });
    }

    await share.deleteOne();

    res.json({ 
      message: 'Share deleted successfully',
      shareId 
    });

  } catch (err) {
    console.error('Error deleting share:', err.message);
    res.status(500).json({ message: 'Failed to delete share' });
  }
};

/**
 * @desc    Handle voice/chat commands
 * @route   POST /api/user/voice-command
 * @access  Protected
 */
export const handleVoiceCommand = async (req, res) => {
  const { command, context } = req.body;

  if (!command) {
    return res.status(400).json({ message: 'Command is required' });
  }

  try {
    // Send command to ML API for natural language processing
    const response = await axios.post(`${ML_API_URL}/nlp/command`, {
      command,
      context: context || {},
      user_id: req.user._id.toString(),
    }, {
      timeout: 15000
    });

    res.json({
      success: true,
      action: response.data.action,
      parameters: response.data.parameters,
      response: response.data.response,
    });

  } catch (err) {
    console.error('Error processing voice command:', err.message);
    
    // Provide a fallback response if ML API is unavailable
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
      return res.json({
        success: false,
        message: 'Voice command service is currently unavailable',
        error: 'ML_SERVICE_UNAVAILABLE',
      });
    }

    res.status(500).json({ message: 'Failed to process voice command' });
  }
};

/**
 * @desc    Get user statistics
 * @route   GET /api/user/stats
 * @access  Protected
 */
export const getUserStats = async (req, res) => {
  try {
    // Get shares count
    const sharesCount = await SharedPlaylist.countDocuments({ owner: req.user._id });

    // Get total views on shares
    const shares = await SharedPlaylist.find({ owner: req.user._id });
    const totalViews = shares.reduce((sum, share) => sum + (share.views || 0), 0);

    res.json({
      stats: {
        sharesCount,
        totalViews,
        joinedDate: req.user.createdAt,
        linkedServices: req.user.authTokens ? Array.from(req.user.authTokens.keys()) : [],
      },
    });

  } catch (err) {
    console.error('Error fetching user stats:', err.message);
    res.status(500).json({ message: 'Failed to fetch user statistics' });
  }
};