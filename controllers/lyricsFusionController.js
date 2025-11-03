/**
 * @desc    Fetch and analyze lyrics for tracks
 * @route   POST /api/lyrics/analyze
 * @access  Protected
 */
export const analyzeLyrics = async (req, res) => {
  const { tracks } = req.body;

  if (!tracks || !Array.isArray(tracks)) {
    return res.status(400).json({ message: 'Tracks array is required' });
  }

  try {
    // Call ML API for lyrics analysis
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
    console.error('Error analyzing lyrics:', err.message);
    
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
 * @desc    Get lyrics for a single track
 * @route   GET /api/lyrics/track/:trackId
 * @access  Protected
 */
export const getTrackLyrics = async (req, res) => {
  const { trackId } = req.params;
  const { trackName, artistName } = req.query;

  try {
    // Call ML API to fetch lyrics
    const response = await axios.get(`${ML_API_URL}/lyrics/track/${trackId}`, {
      params: { trackName, artistName },
      timeout: 15000
    });

    res.json({
      lyrics: response.data.lyrics,
      source: response.data.source,
      sentiment: response.data.sentiment,
      syncedLyrics: response.data.syncedLyrics || null,
    });

  } catch (err) {
    console.error('Error fetching track lyrics:', err.message);
    
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
      return res.status(503).json({
        message: 'Lyrics service temporarily unavailable'
      });
    }
    
    res.status(err.response?.status || 500).json({ 
      message: err.response?.data?.message || 'Failed to fetch lyrics'
    });
  }
};