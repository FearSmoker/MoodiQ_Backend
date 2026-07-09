import User from '../models/userModel.js';
import SharedPlaylist from '../models/sharedPlaylistModel.js';
import * as mlService from '../services/mlService.js';

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

export const updatePreferences = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.preferences = {
      ...user.preferences,
      ...req.body,
    };
    
    await user.save();
    
    console.log(`✅ Updated preferences for user: ${user.displayName}`);
    
    res.json({
      preferences: user.preferences,
      message: 'Preferences updated successfully',
    });
  } catch (err) {
    console.error('Error updating preferences:', err.message);
    res.status(500).json({ message: 'Failed to update preferences' });
  }
};

export const submitFeedback = async (req, res) => {
  const { trackId, correctMood, playlistId } = req.body;

  if (!trackId || !correctMood) {
    return res.status(400).json({ message: 'Track ID and correct mood are required' });
  }

  try {
    console.log(`📝 Submitting feedback for track ${trackId}: ${correctMood}`);
    
    const feedbackResponse = await mlService.submitFeedback(
      req.user._id.toString(),
      trackId,
      correctMood,
      playlistId
    );

    console.log('✅ Feedback submitted successfully to ML service');

    res.status(200).json({ 
      message: 'Feedback submitted successfully',
      trackId,
      mood: correctMood,
      feedbackCount: feedbackResponse.user_feedback_count || 0,
      readyForPersonalization: feedbackResponse.ready_for_personalization || false,
      suggestRetrain: feedbackResponse.suggest_retrain || false,
    });
  } catch (err) {
    console.error('❌ Error submitting feedback:', err.message);
    
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
      console.warn('⚠️ ML service unavailable, feedback logged locally only');
      return res.status(200).json({ 
        message: 'Feedback received (ML service temporarily unavailable)',
        trackId,
        mood: correctMood,
        warning: 'Personalization temporarily disabled',
      });
    }
    
    res.status(500).json({ 
      message: 'Failed to submit feedback fully',
      error: err.message 
    });
  }
};

export const submitBatchFeedback = async (req, res) => {
  const { feedbacks } = req.body;

  if (!feedbacks || !Array.isArray(feedbacks) || feedbacks.length === 0) {
    return res.status(400).json({ message: 'Feedbacks array is required' });
  }

  try {
    console.log(`📝 Submitting batch feedback: ${feedbacks.length} items`);
    
    const formattedFeedbacks = feedbacks.map(fb => ({
      user_id: req.user._id.toString(),
      track_id: fb.trackId,
      feedback_mood: fb.correctMood,
      playlist_id: fb.playlistId || null,
      timestamp: new Date().toISOString()
    }));

    const batchResponse = await mlService.submitBatchFeedback(formattedFeedbacks);

    console.log(`✅ Batch feedback submitted: ${batchResponse.successful}/${batchResponse.total}`);

    res.json({
      success: true,
      message: 'Batch feedback submitted',
      total: batchResponse.total,
      successful: batchResponse.successful,
      failed: batchResponse.failed
    });
  } catch (err) {
    console.error('❌ Error submitting batch feedback:', err.message);
    
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
      return res.status(200).json({ 
        success: false,
        message: 'ML service unavailable, feedback not processed',
        warning: 'Please try again later'
      });
    }
    
    res.status(500).json({ 
      message: 'Failed to submit batch feedback',
      error: err.message 
    });
  }
};

export const logUserBehavior = async (req, res) => {
  const { trackId, action, timeOfDay } = req.body;

  if (!trackId || !action) {
    return res.status(400).json({ message: 'Track ID and action are required' });
  }

  try {
    console.log(`📊 Logging behavior: ${action} for track ${trackId}`);
    
    const behaviorResponse = await mlService.logUserBehavior(
      req.user._id.toString(),
      trackId,
      action,
      timeOfDay
    );

    res.json({
      success: true,
      message: 'Behavior logged successfully',
      dailyStats: behaviorResponse.daily_stats
    });
  } catch (err) {
    console.error('❌ Error logging behavior:', err.message);
    
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
      return res.json({ 
        success: false,
        message: 'ML service unavailable, behavior not logged'
      });
    }
    
    res.status(500).json({ 
      message: 'Failed to log behavior',
      error: err.message 
    });
  }
};

export const sharePlaylist = async (req, res) => {
  const { playlistId, moodData, playlistName, playlistImage } = req.body;

  if (!playlistId || !moodData) {
    return res.status(400).json({ message: 'Playlist ID and mood data are required' });
  }

  try {
    const shareId = crypto.randomUUID().replace(/-/g, '').substring(0, 12);

    const sharedPlaylist = await SharedPlaylist.create({
      shareId,
      playlistId,
      moodData,
      playlistName: playlistName || 'Shared Playlist',
      playlistImage: playlistImage || null,
      owner: req.user._id,
    });

    console.log(`✅ Playlist ${playlistId} shared with ID ${shareId}`);

    const fullUrl = `${process.env.FRONTEND_URL || 'https://moodiq.netlify.app'}/share/${shareId}`;

    res.json({
      shareId,
      shareUrl: `/share/${shareId}`,
      fullUrl: fullUrl,
      message: 'Playlist shared successfully',
    });

  } catch (err) {
    console.error('Failed to create share link:', err.message);
    res.status(500).json({ message: 'Failed to create share link' });
  }
};

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

    sharedData.views = (sharedData.views || 0) + 1;
    await sharedData.save();

    console.log(`👁️ Shared playlist ${shareId} viewed (total views: ${sharedData.views})`);

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

export const getUserShares = async (req, res) => {
  try {
    const shares = await SharedPlaylist.find({ owner: req.user._id })
      .sort({ createdAt: -1 })
      .select('shareId playlistId playlistName playlistImage views createdAt');

    res.json({
      shares,
      count: shares.length,
    });

  } catch (err) {
    console.error('Error fetching user shares:', err.message);
    res.status(500).json({ message: 'Failed to fetch shares' });
  }
};

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

    console.log(`🗑️ Deleted share ${shareId}`);

    res.json({ 
      message: 'Share deleted successfully',
      shareId 
    });

  } catch (err) {
    console.error('Error deleting share:', err.message);
    res.status(500).json({ message: 'Failed to delete share' });
  }
};

export const handleVoiceCommand = async (req, res) => {
  const { command, context } = req.body;

  if (!command) {
    return res.status(400).json({ message: 'Command is required' });
  }

  try {
    console.log(`🗣️ Processing voice command: "${command}"`);
    
    const response = await mlService.processNLPCommand(
      command,
      context || {},
      req.user._id.toString()
    );

    console.log(`✅ NLP command processed: ${response.action}`);

    res.json({
      success: true,
      action: response.action,
      parameters: response.parameters,
      response: response.response,
      confidence: response.confidence || 0.85,
    });

  } catch (err) {
    console.error('❌ Error processing voice command:', err.message);
    
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
      return res.json({
        success: false,
        action: 'error',
        response: 'Voice command service is temporarily unavailable. Please try again later.',
        error: 'ML_SERVICE_UNAVAILABLE',
      });
    }

    res.status(500).json({ 
      message: 'Failed to process voice command',
      error: err.message 
    });
  }
};

export const getUserStats = async (req, res) => {
  try {
    const sharesCount = await SharedPlaylist.countDocuments({ owner: req.user._id });

    const shares = await SharedPlaylist.find({ owner: req.user._id });
    const totalViews = shares.reduce((sum, share) => sum + (share.views || 0), 0);

    let mlStats = null;
    try {
      mlStats = await mlService.getUserLearningStats(req.user._id.toString());
    } catch (mlError) {
      console.warn('⚠️ Could not fetch ML stats:', mlError.message);
    }

    const stats = {
      sharesCount,
      totalViews,
      joinedDate: req.user.createdAt,
      lastActive: req.user.lastActive,
      playlistsAnalyzed: req.user.playlistsAnalyzed || 0,
      linkedServices: req.user.authTokens ? Array.from(req.user.authTokens.keys()) : [],
      
      feedbackCount: mlStats?.feedback_count || 0,
      personalizationLevel: mlStats?.personalization_level || 'none',
      hasTrainedModel: mlStats?.has_trained_model || false,
      lastTrainedAt: mlStats?.last_trained || null,
    };

    res.json({ stats });

  } catch (err) {
    console.error('Error fetching user stats:', err.message);
    res.status(500).json({ message: 'Failed to fetch user statistics' });
  }
};

export const getUserMoodTimeline = async (req, res) => {
  const { days = 7 } = req.query;

  try {
    console.log(`📈 Fetching mood timeline for ${days} days`);
    
    const timelineResponse = await mlService.getUserMoodTimeline(
      req.user._id.toString(),
      parseInt(days)
    );

    console.log(`✅ Retrieved timeline with ${timelineResponse.timeline?.length || 0} data points`);

    res.json(timelineResponse);

  } catch (err) {
    console.error('❌ Error fetching mood timeline:', err.message);
    
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
      return res.status(503).json({ 
        message: 'ML service is currently unavailable',
        code: 'ML_SERVICE_UNAVAILABLE'
      });
    }

    res.status(500).json({ 
      message: 'Failed to fetch mood timeline',
      error: err.message 
    });
  }
};

export const getUserPersonalizedModel = async (req, res) => {
  try {
    console.log(`🧠 Fetching personalized model for user ${req.user._id}`);
    
    const modelResponse = await mlService.getUserPersonalizedModel(
      req.user._id.toString()
    );

    res.json(modelResponse);

  } catch (err) {
    console.error('❌ Error fetching personalized model:', err.message);
    
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
      return res.status(503).json({ 
        message: 'ML service is currently unavailable',
        code: 'ML_SERVICE_UNAVAILABLE'
      });
    }

    res.status(500).json({ 
      message: 'Failed to fetch personalized model',
      error: err.message 
    });
  }
};

export const triggerModelRetrain = async (req, res) => {
  const { force = false } = req.body;

  try {
    console.log(`🔄 Triggering model retraining for user ${req.user._id}`);
    
    const response = await mlService.triggerModelRetrain(
      req.user._id.toString(),
      parseInt(process.env.MIN_FEEDBACK_FOR_RETRAIN || '10'),
      force
    );

    console.log('✅ Model retraining initiated');

    res.json({
      success: true,
      message: response.message,
      status: response.status,
      estimatedTime: response.estimated_time,
    });

  } catch (err) {
    console.error('❌ Error triggering model retrain:', err.message);
    
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
      return res.status(503).json({ 
        message: 'ML service is currently unavailable',
        code: 'ML_SERVICE_UNAVAILABLE'
      });
    }

    if (err.response) {
      return res.status(err.response.status).json({ 
        message: err.response.data?.message || 'Failed to trigger retraining',
        code: 'ML_API_ERROR'
      });
    }

    res.status(500).json({ message: 'Failed to trigger model retraining' });
  }
};

export const resetUserPersonalization = async (req, res) => {
  try {
    console.log(`🗑️ Resetting personalization for user ${req.user._id}`);
    
    const response = await mlService.resetUserPersonalization(
      req.user._id.toString()
    );

    console.log('✅ Personalization reset successfully');

    res.json({
      success: true,
      message: 'Personalization reset successfully',
      deletedOverrides: response.deleted_overrides,
      deletedFeedbackLogs: response.deleted_feedback_logs
    });

  } catch (err) {
    console.error('❌ Error resetting personalization:', err.message);
    
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
      return res.status(503).json({ 
        message: 'ML service is currently unavailable',
        code: 'ML_SERVICE_UNAVAILABLE'
      });
    }

    res.status(500).json({ 
      message: 'Failed to reset personalization',
      error: err.message 
    });
  }
};