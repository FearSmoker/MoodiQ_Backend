import SpotifyWebApi from 'spotify-web-api-node';
import * as mlService from '../services/mlService.js';

/**
 * Analytics Controller - Complete ML Integration v2.0
 * Uses HYBRID approach: Spotify API + ML Service
 */

/**
 * @desc    Get real-time mood analysis from recent listening
 * @route   GET /api/analytics/mood-trends
 * @access  Protected
 */
export const getMoodTrends = async (req, res) => {
  try {
    const user = req.user;
    const { limit = 50 } = req.query;

    const spotifyApi = new SpotifyWebApi();
    spotifyApi.setAccessToken(user.accessToken);

    console.log(`📊 Fetching mood trends for ${limit} tracks`);

    // Get recently played tracks
    const recentlyPlayed = await spotifyApi.getMyRecentlyPlayedTracks({ 
      limit: parseInt(limit) 
    });

    if (!recentlyPlayed.body.items || recentlyPlayed.body.items.length === 0) {
      return res.json({
        trends: [],
        moodDistribution: {},
        overallMood: 'Unknown',
        message: 'No recent listening history'
      });
    }

    // Prepare tracks for ML analysis
    const tracks = recentlyPlayed.body.items.map(item => ({
      id: item.track.id,
      name: item.track.name,
      artist: item.track.artists[0]?.name || 'Unknown',
      played_at: item.played_at
    }));

    console.log(`🤖 Analyzing ${tracks.length} tracks with ML service`);

    try {
      // Use ML service for mood analysis (HYBRID approach)
      const moodAnalysis = await mlService.batchAnalyzeTracks(
        tracks,
        user._id.toString()
      );

      // Combine Spotify playback data with ML mood analysis
      const tracksWithMood = recentlyPlayed.body.items.map((item, index) => {
        const trackMood = moodAnalysis.tracks?.[index];
        
        return {
          timestamp: item.played_at,
          trackId: item.track.id,
          trackName: item.track.name,
          artistName: item.track.artists[0]?.name || 'Unknown',
          albumName: item.track.album?.name || 'Unknown',
          albumImage: item.track.album?.images?.[0]?.url || null,
          duration_ms: item.track.duration_ms,
          popularity: item.track.popularity,
          mood: trackMood?.mood || 'Unknown',
          confidence: trackMood?.moodScore || 0,
          moodScores: trackMood?.moodDetails?.scores || {},
        };
      });

      // Calculate mood distribution
      const moodCounts = {};
      tracksWithMood.forEach(track => {
        const mood = track.mood;
        moodCounts[mood] = (moodCounts[mood] || 0) + 1;
      });

      // Overall mood (most common)
      const overallMood = Object.entries(moodCounts)
        .sort((a, b) => b[1] - a[1])[0]?.[0] || 'Mixed';

      // Mood distribution percentages
      const total = tracksWithMood.length;
      const moodDistribution = {};
      Object.entries(moodCounts).forEach(([mood, count]) => {
        moodDistribution[mood] = Math.round((count / total) * 100);
      });

      console.log(`✅ Mood trends analyzed: ${overallMood} (${total} tracks)`);

      res.json({
        trends: tracksWithMood,
        moodDistribution,
        overallMood,
        statistics: {
          totalTracks: tracksWithMood.length,
          uniqueMoods: Object.keys(moodCounts).length,
          analyzedAt: new Date().toISOString(),
          source: 'ml_hybrid'
        }
      });

    } catch (mlError) {
      console.warn('⚠️ ML analysis unavailable, using simplified analysis');
      
      // Simplified fallback (just return tracks without detailed mood)
      const simpleTrends = recentlyPlayed.body.items.map(item => ({
        timestamp: item.played_at,
        trackId: item.track.id,
        trackName: item.track.name,
        artistName: item.track.artists[0]?.name || 'Unknown',
        albumName: item.track.album?.name || 'Unknown',
        albumImage: item.track.album?.images?.[0]?.url || null,
        mood: 'Unknown',
        confidence: 0,
        moodScores: {}
      }));

      res.json({
        trends: simpleTrends,
        moodDistribution: { 'Unknown': 100 },
        overallMood: 'Unknown',
        message: 'ML service temporarily unavailable',
        source: 'fallback'
      });
    }

  } catch (error) {
    console.error('❌ Mood trends error:', error.message);
    
    if (error.statusCode === 401) {
      return res.status(401).json({ 
        message: 'Spotify token expired',
        code: 'SPOTIFY_TOKEN_EXPIRED'
      });
    }

    res.status(500).json({ 
      message: 'Failed to fetch mood trends',
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

    // Get recently played tracks
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

    // Analyze listening patterns
    const hourlyActivity = Array(24).fill(0);
    const dailyActivity = Array(7).fill(0);
    
    recentlyPlayed.body.items.forEach(item => {
      const date = new Date(item.played_at);
      const hour = date.getHours();
      const day = date.getDay();
      
      hourlyActivity[hour]++;
      dailyActivity[day]++;
    });

    // Peak listening times
    const peakHour = hourlyActivity.indexOf(Math.max(...hourlyActivity));
    const peakDay = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
      dailyActivity.indexOf(Math.max(...dailyActivity))
    ];

    // Artist diversity
    const uniqueArtists = new Set(
      recentlyPlayed.body.items.map(item => item.track.artists[0]?.id).filter(Boolean)
    );

    console.log(`✅ Activity analysis complete: Peak ${peakDay} at ${peakHour}:00`);

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

    // Get top artists
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

    // Collect all genres
    const genreCount = {};
    topArtists.body.items.forEach(artist => {
      artist.genres.forEach(genre => {
        genreCount[genre] = (genreCount[genre] || 0) + 1;
      });
    });

    // Sort and format
    const genres = Object.entries(genreCount)
      .sort((a, b) => b[1] - a[1])
      .map(([genre, count]) => ({
        genre,
        count,
        percentage: Math.round((count / topArtists.body.items.length) * 100),
      }));

    // Group into main categories
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

    console.log(`✅ Genre analysis complete: ${Object.keys(genreCount).length} unique genres`);

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
 * @desc    Get user's mood timeline (ML-powered)
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

/**
 * @desc    Get real-time current track analysis (HYBRID)
 * @route   GET /api/analytics/realtime
 * @access  Protected
 */
export const getRealtimeAnalysis = async (req, res) => {
  try {
    const user = req.user;
    
    console.log(`🎵 Analyzing real-time playback for user: ${user.displayName}`);

    // Use ML service's currently playing analysis (HYBRID approach)
    const realtimeAnalysis = await mlService.analyzeCurrentlyPlaying(
      user.accessToken,
      user._id.toString()
    );

    if (!realtimeAnalysis.is_playing) {
      return res.json({
        isPlaying: false,
        message: 'No track currently playing',
      });
    }

    console.log(`✅ Real-time analysis complete: ${realtimeAnalysis.track.name}`);

    // Format response for frontend
    res.json({
      isPlaying: realtimeAnalysis.is_playing,
      track: {
        id: realtimeAnalysis.track.id,
        name: realtimeAnalysis.track.name,
        artists: realtimeAnalysis.track.artists,
        album: realtimeAnalysis.track.album,
        albumImage: realtimeAnalysis.track.images?.[0]?.url || realtimeAnalysis.track.album?.images?.[0]?.url,
        duration: realtimeAnalysis.track.duration_ms,
        progress: realtimeAnalysis.progress_ms,
        popularity: realtimeAnalysis.track.popularity,
        externalUrl: realtimeAnalysis.track.external_url
      },
      device: realtimeAnalysis.device,
      mood: {
        fused_mood: realtimeAnalysis.mood_analysis?.fused_mood || 'Unknown',
        confidence: realtimeAnalysis.mood_analysis?.confidence || 0,
        audio_mood: realtimeAnalysis.mood_analysis?.audio_mood || 'Unknown',
        lyrics_mood: realtimeAnalysis.mood_analysis?.lyrics_mood || 'Neutral',
        scores: realtimeAnalysis.mood_analysis?.scores || {}
      },
      timestamp: realtimeAnalysis.timestamp || new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Real-time analysis error:', error.message);
    
    if (error.statusCode === 401) {
      return res.status(401).json({ 
        message: 'Spotify token expired',
        code: 'SPOTIFY_TOKEN_EXPIRED'
      });
    }

    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      return res.status(503).json({ 
        message: 'ML service is currently unavailable',
        code: 'ML_SERVICE_UNAVAILABLE'
      });
    }

    res.status(500).json({ 
      message: 'Failed to analyze real-time playback',
      error: error.message 
    });
  }
};