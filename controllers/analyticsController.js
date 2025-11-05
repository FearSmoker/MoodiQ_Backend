import SpotifyWebApi from 'spotify-web-api-node';
import * as mlService from '../services/mlService.js';

/**
 * Analytics Controller - Complete ML Integration v3.0
 * 
 * Features:
 * - ✅ 12-mood system support
 * - ✅ Aggregated features for graphs
 * - ✅ Multi-tag mood analysis
 * - ✅ Live listening integration
 * - ✅ Enhanced error handling
 */

/**
 * @desc    Get comprehensive mood trends with aggregated features
 * @route   GET /api/analytics/mood-trends
 * @access  Protected
 */
export const getMoodTrends = async (req, res) => {
  try {
    const user = req.user;
    const { limit = 50, days = 7 } = req.query;

    console.log(`📊 Fetching mood trends for ${days} days, ${limit} tracks`);

    // Use ML service's mood timeline (12-mood system)
    const timelineResponse = await mlService.getUserMoodTimeline(
      user._id.toString(),
      parseInt(days)
    );

    if (!timelineResponse.timeline || timelineResponse.timeline.length === 0) {
      return res.json({
        trends: [],
        moodDistribution: {},
        overallMood: 'Unknown',
        aggregatedFeatures: null,
        message: 'No mood history found',
        statistics: {
          totalTracks: 0,
          uniqueMoods: 0,
          analyzedAt: new Date().toISOString()
        }
      });
    }

    // Extract timeline data
    const timeline = timelineResponse.timeline;
    
    // Calculate aggregated features for graphs
    const aggregatedFeatures = calculateAggregatedFeatures(timeline);
    
    // Build mood distribution (12-mood system)
    const moodDistribution = timelineResponse.overall_statistics?.mood_distribution || {};
    const overallMood = timelineResponse.overall_statistics?.most_common_mood || 'Unknown';

    // Format trends for frontend
    const trends = timeline.map(day => ({
      date: day.date,
      moods: day.moods,
      totalTracks: day.total_tracks,
      totalMoodTags: day.total_mood_tags,
      dominantMood: day.dominant_mood,
      moodDiversity: day.mood_diversity,
      tracks: day.tracks.map(t => ({
        track: t.track,
        artist: t.artist,
        mood: t.mood,
        allMoods: t.all_moods,
        confidence: t.confidence
      }))
    }));

    console.log(`✅ Mood trends analyzed: ${overallMood} (${trends.length} days)`);

    res.json({
      trends,
      moodDistribution,
      overallMood,
      aggregatedFeatures,
      statistics: {
        totalTracks: timelineResponse.total_tracked,
        uniqueMoods: timelineResponse.overall_statistics?.mood_diversity || 0,
        avgMoodsPerTrack: timelineResponse.overall_statistics?.average_moods_per_track || 0,
        analyzedAt: new Date().toISOString(),
        source: 'ml_timeline',
        moodSystem: '12_extended_moods'
      }
    });

  } catch (error) {
    console.error('❌ Mood trends error:', error.message);
    
    if (error.statusCode === 401 || error.isAuthError) {
      return res.status(401).json({ 
        message: 'Session expired',
        code: 'SESSION_EXPIRED'
      });
    }

    if (error.statusCode === 429 || error.isRateLimitError) {
      return res.status(429).json({
        message: 'Rate limit exceeded',
        code: 'RATE_LIMIT',
        retryAfter: error.retryAfter || 60
      });
    }

    res.status(500).json({ 
      message: 'Failed to fetch mood trends',
      error: error.message 
    });
  }
};

/**
 * @desc    Get mood distribution analysis (12-mood system)
 * @route   GET /api/analytics/mood-distribution
 * @access  Protected
 */
export const getMoodDistribution = async (req, res) => {
  try {
    const user = req.user;

    console.log(`📊 Fetching mood distribution for user: ${user._id}`);

    // Use ML service's mood distribution endpoint
    const distributionResponse = await mlService.getUserMoodDistribution(
      user._id.toString()
    );

    if (distributionResponse.total_tracks === 0) {
      return res.json({
        distribution: {},
        totalTracks: 0,
        totalMoodTags: 0,
        avgMoodsPerTrack: 0,
        top3Moods: [],
        moodDiversity: 0,
        message: 'No mood data available'
      });
    }

    console.log(`✅ Distribution: ${distributionResponse.mood_diversity} moods`);

    res.json({
      distribution: distributionResponse.distribution,
      totalTracks: distributionResponse.total_tracks,
      totalMoodTags: distributionResponse.total_mood_tags,
      avgMoodsPerTrack: distributionResponse.avg_moods_per_track,
      top3Moods: distributionResponse.top_3_moods,
      moodDiversity: distributionResponse.mood_diversity,
      moodSystem: distributionResponse.mood_system
    });

  } catch (error) {
    console.error('❌ Mood distribution error:', error.message);
    res.status(500).json({ 
      message: 'Failed to fetch mood distribution',
      error: error.message 
    });
  }
};

/**
 * @desc    Get mood patterns (co-occurrence analysis)
 * @route   GET /api/analytics/mood-patterns
 * @access  Protected
 */
export const getMoodPatterns = async (req, res) => {
  try {
    const user = req.user;

    console.log(`🔍 Analyzing mood patterns for user: ${user._id}`);

    const patternsResponse = await mlService.getUserMoodPatterns(
      user._id.toString()
    );

    console.log(`✅ Found ${patternsResponse.patterns?.length || 0} mood patterns`);

    res.json(patternsResponse);

  } catch (error) {
    console.error('❌ Mood patterns error:', error.message);
    res.status(500).json({ 
      message: 'Failed to analyze mood patterns',
      error: error.message 
    });
  }
};

/**
 * @desc    Get listening activity analytics
 * @route   GET /api/analytics/activity
 * @access  Protected
 */
export const getActivityAnalytics = async (req, res) => {
  try {
    const user = req.user;

    const spotifyApi = new SpotifyWebApi();
    spotifyApi.setAccessToken(user.accessToken);

    console.log('📊 Analyzing listening activity patterns');

    const recentlyPlayed = await spotifyApi.getMyRecentlyPlayedTracks({ limit: 50 });

    if (!recentlyPlayed.body.items || recentlyPlayed.body.items.length === 0) {
      return res.json({
        hourlyActivity: [],
        dailyActivity: [],
        insights: {
          peakHour: 'N/A',
          peakDay: 'N/A',
          totalPlays: 0,
          uniqueArtists: 0,
          averagePlaysPerDay: 0
        }
      });
    }

    const hourlyActivity = Array(24).fill(0);
    const dailyActivity = Array(7).fill(0);
    
    recentlyPlayed.body.items.forEach(item => {
      const date = new Date(item.played_at);
      const hour = date.getHours();
      const day = date.getDay();
      
      hourlyActivity[hour]++;
      dailyActivity[day]++;
    });

    const peakHour = hourlyActivity.indexOf(Math.max(...hourlyActivity));
    const peakDay = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
      dailyActivity.indexOf(Math.max(...dailyActivity))
    ];

    const uniqueArtists = new Set(
      recentlyPlayed.body.items.map(item => item.track.artists[0]?.id).filter(Boolean)
    );

    console.log(`✅ Activity analysis: Peak ${peakDay} at ${peakHour}:00`);

    res.json({
      hourlyActivity: hourlyActivity.map((count, hour) => ({
        hour: `${hour}:00`,
        plays: count,
      })),
      dailyActivity: dailyActivity.map((count, index) => ({
        day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][index],
        plays: count,
      })),
      insights: {
        peakHour: `${peakHour}:00 - ${peakHour + 1}:00`,
        peakDay: peakDay,
        totalPlays: recentlyPlayed.body.items.length,
        uniqueArtists: uniqueArtists.size,
        averagePlaysPerDay: Math.round(recentlyPlayed.body.items.length / 7),
      },
    });

  } catch (error) {
    console.error('❌ Activity analytics error:', error.message);
    
    if (error.statusCode === 401) {
      return res.status(401).json({ 
        message: 'Spotify token expired',
        code: 'SPOTIFY_TOKEN_EXPIRED'
      });
    }

    res.status(500).json({ 
      message: 'Failed to fetch activity analytics',
      error: error.message 
    });
  }
};

/**
 * @desc    Get genre analysis
 * @route   GET /api/analytics/genres
 * @access  Protected
 */
export const getGenreAnalysis = async (req, res) => {
  try {
    const user = req.user;
    const { timeRange = 'medium_term' } = req.query;

    const spotifyApi = new SpotifyWebApi();
    spotifyApi.setAccessToken(user.accessToken);

    console.log(`📊 Analyzing genres for time range: ${timeRange}`);

    const topArtists = await spotifyApi.getMyTopArtists({ 
      limit: 50, 
      time_range: timeRange 
    });

    if (!topArtists.body.items || topArtists.body.items.length === 0) {
      return res.json({
        timeRange,
        allGenres: [],
        mainCategories: [],
        totalGenres: 0,
        totalArtists: 0
      });
    }

    const genreCount = {};
    topArtists.body.items.forEach(artist => {
      artist.genres.forEach(genre => {
        genreCount[genre] = (genreCount[genre] || 0) + 1;
      });
    });

    const genres = Object.entries(genreCount)
      .sort((a, b) => b[1] - a[1])
      .map(([genre, count]) => ({
        genre,
        count,
        percentage: Math.round((count / topArtists.body.items.length) * 100),
      }));

    const mainCategories = {
      rock: genres.filter(g => g.genre.includes('rock')).reduce((sum, g) => sum + g.count, 0),
      pop: genres.filter(g => g.genre.includes('pop')).reduce((sum, g) => sum + g.count, 0),
      hip_hop: genres.filter(g => g.genre.includes('hip hop') || g.genre.includes('rap')).reduce((sum, g) => sum + g.count, 0),
      electronic: genres.filter(g => g.genre.includes('electronic') || g.genre.includes('edm')).reduce((sum, g) => sum + g.count, 0),
      indie: genres.filter(g => g.genre.includes('indie')).reduce((sum, g) => sum + g.count, 0),
      jazz: genres.filter(g => g.genre.includes('jazz')).reduce((sum, g) => sum + g.count, 0),
      classical: genres.filter(g => g.genre.includes('classical')).reduce((sum, g) => sum + g.count, 0),
      other: 0,
    };

    const categorizedCount = Object.values(mainCategories).reduce((sum, count) => sum + count, 0);
    mainCategories.other = topArtists.body.items.length - categorizedCount;

    console.log(`✅ Genre analysis: ${Object.keys(genreCount).length} unique genres`);

    res.json({
      timeRange,
      allGenres: genres.slice(0, 30),
      mainCategories: Object.entries(mainCategories)
        .map(([category, count]) => ({
          category,
          count,
          percentage: Math.round((count / topArtists.body.items.length) * 100),
        }))
        .sort((a, b) => b.count - a.count),
      totalGenres: Object.keys(genreCount).length,
      totalArtists: topArtists.body.items.length,
    });

  } catch (error) {
    console.error('❌ Genre analysis error:', error.message);
    
    if (error.statusCode === 401) {
      return res.status(401).json({ 
        message: 'Spotify token expired',
        code: 'SPOTIFY_TOKEN_EXPIRED'
      });
    }

    res.status(500).json({ 
      message: 'Failed to fetch genre analysis',
      error: error.message 
    });
  }
};

/**
 * @desc    Get user's mood timeline (ML-powered) - PRIMARY ENDPOINT
 * @route   GET /api/analytics/mood-timeline
 * @access  Protected
 */
export const getMoodTimeline = async (req, res) => {
  const { days = 7 } = req.query;

  try {
    console.log(`📈 Fetching mood timeline for ${days} days`);
    
    const timelineResponse = await mlService.getUserMoodTimeline(
      req.user._id.toString(),
      parseInt(days)
    );

    console.log(`✅ Timeline: ${timelineResponse.timeline?.length || 0} data points`);

    // Add aggregated features for frontend graphs
    if (timelineResponse.timeline && timelineResponse.timeline.length > 0) {
      timelineResponse.aggregatedFeatures = calculateAggregatedFeatures(
        timelineResponse.timeline
      );
    }

    res.json(timelineResponse);

  } catch (err) {
    console.error('❌ Error fetching mood timeline:', err.message);
    
    if (err.response?.status === 429 || err.isRateLimitError) {
      return res.status(429).json({
        message: 'Rate limit exceeded',
        code: 'RATE_LIMIT',
        retryAfter: err.retryAfter || 60
      });
    }

    if (err.response?.status === 401 || err.isAuthError) {
      return res.status(401).json({
        message: 'Authentication failed',
        code: 'AUTH_ERROR'
      });
    }
    
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

/**
 * @desc    Get real-time current track analysis (UPDATED)
 * @route   GET /api/analytics/realtime
 * @access  Protected
 */
export const getRealtimeAnalysis = async (req, res) => {
  try {
    const user = req.user;
    
    console.log(`🎵 Real-time analysis for user: ${user.displayName}`);

    const realtimeAnalysis = await mlService.analyzeCurrentlyPlaying(
      user.accessToken,
      user._id.toString()
    );

    if (!realtimeAnalysis.is_playing) {
      return res.json({
        isPlaying: false,
        message: realtimeAnalysis.message || 'No track currently playing',
        timestamp: realtimeAnalysis.timestamp || new Date().toISOString()
      });
    }

    if (realtimeAnalysis.type === 'episode') {
      return res.json({
        isPlaying: true,
        type: 'episode',
        episode: realtimeAnalysis.episode,
        device: realtimeAnalysis.device,
        progress: realtimeAnalysis.progress_ms,
        message: 'Currently playing podcast episode',
        timestamp: realtimeAnalysis.timestamp
      });
    }

    console.log(`✅ Real-time: ${realtimeAnalysis.track.name}`);

    res.json({
      isPlaying: realtimeAnalysis.is_playing,
      type: 'track',
      track: {
        id: realtimeAnalysis.track.id,
        name: realtimeAnalysis.track.name,
        artists: realtimeAnalysis.track.artists,
        album: realtimeAnalysis.track.album,
        albumImage: realtimeAnalysis.track.album?.images?.[0]?.url,
        duration: realtimeAnalysis.track.duration_ms,
        progress: realtimeAnalysis.progress_ms,
        popularity: realtimeAnalysis.track.popularity,
        explicit: realtimeAnalysis.track.explicit,
        externalUrl: realtimeAnalysis.track.external_url
      },
      device: realtimeAnalysis.device,
      playback: {
        shuffleState: realtimeAnalysis.shuffle_state,
        repeatState: realtimeAnalysis.repeat_state,
        context: realtimeAnalysis.context
      },
      mood: {
        primary_mood: realtimeAnalysis.mood_analysis?.primary_mood || 'Unknown',
        all_moods: realtimeAnalysis.mood_analysis?.all_moods || [],
        mood_scores: realtimeAnalysis.mood_analysis?.mood_scores || {},
        confidence: realtimeAnalysis.mood_analysis?.confidence || 0,
        base_mood: realtimeAnalysis.mood_analysis?.base_mood || 'Unknown',
        lyrics_mood: realtimeAnalysis.mood_analysis?.lyrics_mood || 'Neutral',
        source: realtimeAnalysis.mood_analysis?.source || 'ml_model'
      },
      audioFeatures: realtimeAnalysis.audio_features || null,
      genre: realtimeAnalysis.genre || null,
      timestamp: realtimeAnalysis.timestamp || new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Real-time analysis error:', error.message);
    
    if (error.statusCode === 401 || error.response?.status === 401 || error.isAuthError) {
      return res.status(401).json({ 
        message: 'Session expired',
        code: 'SESSION_EXPIRED'
      });
    }

    if (error.statusCode === 429 || error.response?.status === 429 || error.isRateLimitError) {
      const retryAfter = error.retryAfter || error.response?.headers?.['retry-after'] || 60;
      return res.status(429).json({
        message: 'Rate limit exceeded',
        code: 'RATE_LIMIT',
        retryAfter: parseInt(retryAfter)
      });
    }

    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      return res.status(503).json({ 
        message: 'ML service unavailable',
        code: 'ML_SERVICE_UNAVAILABLE'
      });
    }

    if (error.response?.status === 404 || error.isNotFoundError) {
      return res.status(404).json({
        message: 'Resource not found',
        code: 'NOT_FOUND'
      });
    }

    res.status(500).json({ 
      message: 'Failed to analyze real-time playback',
      error: error.message,
      code: 'INTERNAL_ERROR'
    });
  }
};

/**
 * @desc    Get global mood trends
 * @route   GET /api/analytics/global-trends
 * @access  Protected
 */
export const getGlobalMoodTrends = async (req, res) => {
  try {
    const { limit = 100 } = req.query;

    console.log(`🌍 Fetching global mood trends`);

    const globalTrends = await mlService.getGlobalMoodTrends(parseInt(limit));

    console.log(`✅ Global trends: ${globalTrends.mood_diversity} moods`);

    res.json(globalTrends);

  } catch (error) {
    console.error('❌ Global trends error:', error.message);
    res.status(500).json({ 
      message: 'Failed to fetch global trends',
      error: error.message 
    });
  }
};

/**
 * @desc    Get live listening session analytics
 * @route   GET /api/analytics/live-session/:userId
 * @access  Protected
 */
export const getLiveSessionAnalytics = async (req, res) => {
  try {
    const { userId } = req.params;

    // Ensure user can only access their own session
    if (userId !== req.user._id.toString()) {
      return res.status(403).json({ 
        message: 'Access denied',
        code: 'FORBIDDEN'
      });
    }

    console.log(`🎧 Fetching live session for user: ${userId}`);

    const sessionData = await mlService.getCurrentLiveSession(userId);

    res.json(sessionData);

  } catch (error) {
    console.error('❌ Live session error:', error.message);
    res.status(500).json({ 
      message: 'Failed to fetch live session',
      error: error.message 
    });
  }
};

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Calculate aggregated audio features for frontend graphs
 */
function calculateAggregatedFeatures(timeline) {
  if (!timeline || timeline.length === 0) {
    return null;
  }

  const features = {
    valence: [],
    energy: [],
    danceability: [],
    acousticness: [],
    dates: []
  };

  timeline.forEach(day => {
    if (day.tracks && day.tracks.length > 0) {
      // Calculate average features for the day
      const dayFeatures = {
        valence: 0,
        energy: 0,
        danceability: 0,
        acousticness: 0,
        count: 0
      };

      day.tracks.forEach(track => {
        // Extract features from mood scores or use defaults
        const moodScores = track.all_moods || [];
        
        // Map moods to estimated features (you can enhance this mapping)
        const estimatedFeatures = estimateFeaturesFromMoods(moodScores);
        
        dayFeatures.valence += estimatedFeatures.valence;
        dayFeatures.energy += estimatedFeatures.energy;
        dayFeatures.danceability += estimatedFeatures.danceability;
        dayFeatures.acousticness += estimatedFeatures.acousticness;
        dayFeatures.count++;
      });

      if (dayFeatures.count > 0) {
        features.dates.push(day.date);
        features.valence.push((dayFeatures.valence / dayFeatures.count).toFixed(2));
        features.energy.push((dayFeatures.energy / dayFeatures.count).toFixed(2));
        features.danceability.push((dayFeatures.danceability / dayFeatures.count).toFixed(2));
        features.acousticness.push((dayFeatures.acousticness / dayFeatures.count).toFixed(2));
      }
    }
  });

  return {
    timeline: features,
    summary: {
      avgValence: calculateAverage(features.valence),
      avgEnergy: calculateAverage(features.energy),
      avgDanceability: calculateAverage(features.danceability),
      avgAcousticness: calculateAverage(features.acousticness)
    }
  };
}

/**
 * Estimate audio features from mood labels
 */
function estimateFeaturesFromMoods(moods) {
  // Mood to feature mapping (based on 12 extended moods)
  const moodFeatureMap = {
    'Joyful': { valence: 0.85, energy: 0.70, danceability: 0.75, acousticness: 0.30 },
    'Excited': { valence: 0.80, energy: 0.85, danceability: 0.80, acousticness: 0.20 },
    'Party': { valence: 0.80, energy: 0.90, danceability: 0.90, acousticness: 0.15 },
    'Melancholic': { valence: 0.20, energy: 0.25, danceability: 0.30, acousticness: 0.70 },
    'Dreamy': { valence: 0.40, energy: 0.30, danceability: 0.35, acousticness: 0.65 },
    'Relaxed': { valence: 0.50, energy: 0.25, danceability: 0.30, acousticness: 0.70 },
    'Chill': { valence: 0.60, energy: 0.30, danceability: 0.45, acousticness: 0.55 },
    'Focused': { valence: 0.45, energy: 0.40, danceability: 0.35, acousticness: 0.50 },
    'Romantic': { valence: 0.60, energy: 0.35, danceability: 0.40, acousticness: 0.60 },
    'Motivated': { valence: 0.65, energy: 0.75, danceability: 0.65, acousticness: 0.30 },
    'Angry': { valence: 0.25, energy: 0.85, danceability: 0.50, acousticness: 0.20 },
    'Ambient': { valence: 0.50, energy: 0.20, danceability: 0.25, acousticness: 0.80 }
  };

  // Default features
  let features = { valence: 0.5, energy: 0.5, danceability: 0.5, acousticness: 0.5 };

  if (moods && moods.length > 0) {
    // Average features from all moods
    const moodFeatures = moods
      .map(mood => moodFeatureMap[mood])
      .filter(f => f !== undefined);

    if (moodFeatures.length > 0) {
      features = {
        valence: moodFeatures.reduce((sum, f) => sum + f.valence, 0) / moodFeatures.length,
        energy: moodFeatures.reduce((sum, f) => sum + f.energy, 0) / moodFeatures.length,
        danceability: moodFeatures.reduce((sum, f) => sum + f.danceability, 0) / moodFeatures.length,
        acousticness: moodFeatures.reduce((sum, f) => sum + f.acousticness, 0) / moodFeatures.length
      };
    }
  }

  return features;
}

/**
 * Calculate average of array values
 */
function calculateAverage(arr) {
  if (!arr || arr.length === 0) return 0;
  const sum = arr.reduce((acc, val) => acc + parseFloat(val), 0);
  return (sum / arr.length).toFixed(2);
}

// Export all functions
export default {
  getMoodTrends,
  getMoodDistribution,
  getMoodPatterns,
  getActivityAnalytics,
  getGenreAnalysis,
  getMoodTimeline,
  getRealtimeAnalysis,
  getGlobalMoodTrends,
  getLiveSessionAnalytics
};