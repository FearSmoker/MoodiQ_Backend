import axios from 'axios';
import { ML_API_URL } from '../utils/constants.js';

/**
 * @desc    Get lyrics for a single track
 * @route   GET /api/lyrics/track/:trackId
 * @access  Protected
 */
export const getTrackLyrics = async (req, res) => {
  const { trackId } = req.params;
  const { trackName, artistName } = req.query;

  if (!trackName || !artistName) {
    return res.status(400).json({ 
      message: 'Track name and artist name are required as query parameters' 
    });
  }

  try {
    console.log(`🎤 Fetching lyrics for: ${trackName} by ${artistName}`);

    const response = await axios.get(`${ML_API_URL}/lyrics/track/${trackId}`, {
      params: { trackName, artistName },
      timeout: 15000
    });

    res.json({
      trackId,
      trackName,
      artistName,
      lyrics: response.data.lyrics,
      source: response.data.source,
      sentiment: response.data.sentiment,
      syncedLyrics: response.data.syncedLyrics || null,
    });

  } catch (err) {
    console.error('❌ Error fetching track lyrics:', err.message);
    
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
      return res.status(503).json({
        message: 'Lyrics service temporarily unavailable'
      });
    }
    
    if (err.response?.status === 404) {
      return res.status(404).json({
        message: 'Lyrics not found for this track'
      });
    }
    
    res.status(err.response?.status || 500).json({ 
      message: err.response?.data?.message || 'Failed to fetch lyrics'
    });
  }
};

/**
 * @desc    Analyze lyrics for multiple tracks
 * @route   POST /api/lyrics/analyze
 * @access  Protected
 */
export const analyzeLyrics = async (req, res) => {
  const { tracks } = req.body;

  if (!tracks || !Array.isArray(tracks)) {
    return res.status(400).json({ message: 'Tracks array is required' });
  }

  try {
    console.log(`📝 Analyzing lyrics for ${tracks.length} tracks`);

    const response = await axios.post(`${ML_API_URL}/lyrics/analyze`, {
      tracks,
      user_id: req.user._id.toString(),
    }, {
      timeout: 45000
    });

    res.json({
      lyricsData: response.data.lyricsData,
      sentimentScores: response.data.sentimentScores,
      themes: response.data.themes,
      keywords: response.data.keywords,
    });

  } catch (err) {
    console.error('❌ Error analyzing lyrics:', err.message);
    
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
      return res.json({
        message: 'Lyrics service temporarily unavailable',
        status: 'unavailable',
        lyricsData: []
      });
    }
    
    if (err.response) {
      return res.status(err.response.status).json({ 
        message: 'Lyrics API error: ' + (err.response.data?.message || err.message) 
      });
    }
    
    res.status(500).json({ message: 'Failed to analyze lyrics' });
  }
};

/**
 * @desc    Get lyrics with sentiment analysis
 * @route   POST /api/lyrics/sentiment
 * @access  Protected
 */
export const getLyricsSentiment = async (req, res) => {
  const { trackName, artistName } = req.body;

  if (!trackName || !artistName) {
    return res.status(400).json({ 
      message: 'Track name and artist name are required' 
    });
  }

  try {
    console.log(`💭 Getting lyrics sentiment for: ${trackName} by ${artistName}`);

    // Call ML service for lyrics + sentiment
    const response = await axios.post(`${ML_API_URL}/lyrics/sentiment`, {
      track_name: trackName,
      artist_name: artistName,
      user_id: req.user._id.toString()
    }, {
      timeout: 20000
    });

    res.json({
      trackName,
      artistName,
      lyrics: response.data.lyrics,
      sentiment: response.data.sentiment,
      mood: response.data.mood,
      language: response.data.language,
      translated: response.data.translated || false
    });

  } catch (err) {
    console.error('❌ Error fetching lyrics sentiment:', err.message);
    
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
      return res.status(503).json({
        message: 'Lyrics sentiment service temporarily unavailable'
      });
    }
    
    res.status(500).json({ 
      message: 'Failed to fetch lyrics sentiment',
      error: err.message 
    });
  }
};

/**
 * @desc    Search lyrics by query
 * @route   GET /api/lyrics/search
 * @access  Protected
 */
export const searchLyrics = async (req, res) => {
  const { query, limit = 10 } = req.query;

  if (!query) {
    return res.status(400).json({ message: 'Search query is required' });
  }

  try {
    console.log(`🔍 Searching lyrics for: ${query}`);

    const response = await axios.get(`${ML_API_URL}/lyrics/search`, {
      params: { query, limit },
      timeout: 15000
    });

    res.json({
      query,
      results: response.data.results,
      total: response.data.total
    });

  } catch (err) {
    console.error('❌ Error searching lyrics:', err.message);
    
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
      return res.status(503).json({
        message: 'Lyrics search service temporarily unavailable'
      });
    }
    
    res.status(500).json({ 
      message: 'Failed to search lyrics',
      error: err.message 
    });
  }
};