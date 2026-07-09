import * as mlService from '../services/mlService.js';

export const startLiveSession = async (req, res) => {
  try {
    const user = req.user;

    const sessionData = await mlService.startLiveSession(user._id.toString());

    res.json(sessionData);

  } catch (error) {
    console.error('❌ Start session error:', error.message);
    res.status(500).json({ 
      message: 'Failed to start live session',
      error: error.message 
    });
  }
};

export const addTrackToSession = async (req, res) => {
  try {
    const user = req.user;
    const { sessionId, trackId, trackName, artistName } = req.body;

    if (!sessionId || !trackName || !artistName) {
      return res.status(400).json({ 
        message: 'Session ID, track name, and artist name are required' 
      });
    }

    const sessionData = await mlService.addTrackToLiveSession(
      user._id.toString(),
      sessionId,
      {
        track_id: trackId,
        track_name: trackName,
        artist_name: artistName
      }
    );

    res.json(sessionData);

  } catch (error) {
    console.error('❌ Add track error:', error.message);
    res.status(500).json({ 
      message: 'Failed to add track to session',
      error: error.message 
    });
  }
};

export const getCurrentSession = async (req, res) => {
  try {
    const user = req.user;

    const sessionData = await mlService.getCurrentLiveSession(
      user._id.toString()
    );

    res.json(sessionData);

  } catch (error) {
    console.error('❌ Get session error:', error.message);
    res.status(500).json({ 
      message: 'Failed to get current session',
      error: error.message 
    });
  }
};

export const endSession = async (req, res) => {
  try {
    const user = req.user;
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ 
        message: 'Session ID is required' 
      });
    }

    const finalAnalytics = await mlService.endLiveSession(
      user._id.toString(),
      sessionId
    );

    res.json(finalAnalytics);

  } catch (error) {
    console.error('❌ End session error:', error.message);
    res.status(500).json({ 
      message: 'Failed to end session',
      error: error.message 
    });
  }
};

export const autoCheckSession = async (req, res) => {
  try {
    const user = req.user;

    const result = await mlService.autoCheckLiveSession(
      user._id.toString()
    );

    res.json(result);

  } catch (error) {
    console.error('❌ Auto-check error:', error.message);
    res.status(500).json({ 
      message: 'Failed to auto-check session',
      error: error.message 
    });
  }
};

export default {
  startLiveSession,
  addTrackToSession,
  getCurrentSession,
  endSession,
  autoCheckSession
};