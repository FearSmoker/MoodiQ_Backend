/**
 * @desc    Get smart mood-based recommendations
 * @route   POST /api/recommendations/mood-based
 * @access  Protected
 */
export const getMoodBasedRecommendations = async (req, res) => {
  const { 
    targetMood, 
    seedTracks, 
    seedGenres, 
    limit = 20,
    diversity = 0.5 
  } = req.body;

  try {
    // Call ML API for smart recommendations
    const response = await axios.post(`${ML_API_URL}/recommend/mood-based`, {
      target_mood: targetMood,
      seed_tracks: seedTracks || [],
      seed_genres: seedGenres || [],
      limit,
      diversity,
      user_id: req.user._id.toString(),
    }, {
      timeout: 20000
    });

    res.json({
      recommendations: response.data.recommendations,
      targetMood: targetMood,
      moodScore: response.data.moodScore,
      diversity: response.data.diversity,
      source: 'ml',
    });

  } catch (err) {
    console.error('Error getting mood-based recommendations:', err.message);
    
    // Fallback to Spotify recommendations
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
      return fallbackMoodRecommendations(req, res, targetMood, seedTracks, seedGenres, limit);
    }
    
    if (err.response) {
      return res.status(err.response.status).json({ 
        message: 'Recommendations API error: ' + (err.response.data?.message || err.message) 
      });
    }
    
    res.status(500).json({ message: 'Failed to get recommendations' });
  }
};

async function fallbackMoodRecommendations(req, res, targetMood, seedTracks, seedGenres, limit) {
  try {
    const spotifyApi = new SpotifyWebApi();
    spotifyApi.setAccessToken(req.user.accessToken);

    // If no seeds, get user's top tracks
    if (!seedTracks || seedTracks.length === 0) {
      const topTracks = await spotifyApi.getMyTopTracks({ limit: 5, time_range: 'short_term' });
      seedTracks = topTracks.body.items.slice(0, 3).map(t => t.id);
    }

    // Get mood features
    const moodFeatures = getMoodFeatures(targetMood);

    // Get recommendations
    const recommendations = await spotifyApi.getRecommendations({
      seed_tracks: seedTracks.slice(0, 3),
      seed_genres: seedGenres ? seedGenres.slice(0, 2) : [],
      limit: limit,
      ...moodFeatures
    });

    res.json({
      recommendations: recommendations.body.tracks,
      targetMood: targetMood,
      source: 'fallback',
      message: 'Using Spotify recommendations (ML service unavailable)'
    });

  } catch (err) {
    console.error('Fallback recommendations failed:', err.message);
    res.status(500).json({ message: 'Failed to get recommendations' });
  }
}

/**
 * @desc    Get personalized learning-based recommendations
 * @route   GET /api/recommendations/personalized
 * @access  Protected
 */
export const getPersonalizedRecommendations = async (req, res) => {
  const { limit = 30, includeNew = true } = req.query;

  try {
    // Call ML API for personalized recommendations
    const response = await axios.post(`${ML_API_URL}/recommend/personalized`, {
      user_id: req.user._id.toString(),
      limit: parseInt(limit),
      include_new: includeNew === 'true',
    }, {
      timeout: 20000
    });

    res.json({
      recommendations: response.data.recommendations,
      userProfile: response.data.userProfile,
      explainability: response.data.explainability,
      source: 'ml',
    });

  } catch (err) {
    console.error('Error getting personalized recommendations:', err.message);
    
    // Fallback: Use Spotify's personalized recommendations
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
      return fallbackPersonalizedRecommendations(req, res, limit);
    }
    
    if (err.response) {
      return res.status(err.response.status).json({ 
        message: 'Recommendations API error: ' + (err.response.data?.message || err.message) 
      });
    }
    
    res.status(500).json({ message: 'Failed to get personalized recommendations' });
  }
};

async function fallbackPersonalizedRecommendations(req, res, limit) {
  try {
    const spotifyApi = new SpotifyWebApi();
    spotifyApi.setAccessToken(req.user.accessToken);

    // Get user's top tracks and artists
    const [topTracks, topArtists] = await Promise.all([
      spotifyApi.getMyTopTracks({ limit: 5, time_range: 'medium_term' }),
      spotifyApi.getMyTopArtists({ limit: 5, time_range: 'medium_term' })
    ]);

    const seedTracks = topTracks.body.items.slice(0, 3).map(t => t.id);
    const seedArtists = topArtists.body.items.slice(0, 2).map(a => a.id);

    // Get recommendations
    const recommendations = await spotifyApi.getRecommendations({
      seed_tracks: seedTracks,
      seed_artists: seedArtists,
      limit: parseInt(limit),
    });

    res.json({
      recommendations: recommendations.body.tracks,
      source: 'fallback',
      message: 'Using Spotify recommendations (ML service unavailable)'
    });

  } catch (err) {
    console.error('Fallback personalized recommendations failed:', err.message);
    res.status(500).json({ message: 'Failed to get recommendations' });
  }
}

/**
 * @desc    Provide feedback on recommendation
 * @route   POST /api/recommendations/feedback
 * @access  Protected
 */
export const submitRecommendationFeedback = async (req, res) => {
  const { trackId, liked, reason } = req.body;

  if (!trackId || liked === undefined) {
    return res.status(400).json({ 
      message: 'Track ID and feedback (liked) are required' 
    });
  }

  try {
    // Send feedback to ML API for learning
    await axios.post(`${ML_API_URL}/recommend/feedback`, {
      user_id: req.user._id.toString(),
      track_id: trackId,
      liked: liked,
      reason: reason || null,
      timestamp: new Date().toISOString(),
    }, {
      timeout: 10000
    });

    res.json({ 
      success: true,
      message: 'Feedback recorded successfully',
      trackId,
      liked
    });

  } catch (err) {
    console.error('Error submitting recommendation feedback:', err.message);
    
    // Don't fail the request if ML API is down
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
      return res.json({ 
        success: true,
        message: 'Feedback received (ML service unavailable)',
        warning: 'Learning temporarily disabled'
      });
    }
    
    res.status(500).json({ message: 'Failed to submit feedback' });
  }
};