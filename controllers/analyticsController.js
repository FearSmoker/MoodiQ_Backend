import SpotifyWebApi from 'spotify-web-api-node';
import * as mlService from '../services/mlService.js';
import ListeningHistory from '../models/listeningHistoryModel.js';
import { getAudioFeaturesForTracks, inferMoodFromFeatures, getMoodFromRecentlyPlayed as spotifyMoodFromRecent } from '../controllers/recommendationsController.js';

/**
 * Analytics Controller - Complete ML Integration v3.0
 * 
 * Features:
 * - ✅ 12-mood system support
 * - ✅ Aggregated features for graphs
 * - ✅ Multi-tag mood analysis
 * - ✅ Live listening integration
 * - ✅ Enhanced error handling
 * - ✅ Spotify-native fallback when ML has no history data
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

    // Try ML service first
    let timelineResponse = null;
    try {
      timelineResponse = await mlService.getUserMoodTimeline(
        user._id.toString(),
        parseInt(days),
        user.accessToken
      );
    } catch (mlErr) {
      console.warn(`⚠️ ML timeline unavailable (${mlErr.message}), falling back to Spotify recently-played`);
    }

    // If ML has no data, fall back to Spotify recently-played
    if (!timelineResponse?.timeline || timelineResponse.timeline.length === 0) {
      console.log('📊 No ML history — using Spotify recently-played as mood source');
      
      try {
        const spotifyApi = new SpotifyWebApi();
        spotifyApi.setAccessToken(user.accessToken);
        
        const recent = await spotifyApi.getMyRecentlyPlayedTracks({ limit: 50 });
        const items = recent.body.items || [];

        if (items.length === 0) {
          return res.json({
            trends: [],
            moodDistribution: {},
            overallMood: 'Unknown',
            aggregatedFeatures: null,
            message: 'No listening history found. Listen to some music on Spotify first!',
            statistics: { totalTracks: 0, uniqueMoods: 0, analyzedAt: new Date().toISOString(), source: 'spotify_fallback' }
          });
        }

        // Unique tracks
        const trackMap = new Map();
        items.forEach(item => {
          const t = item?.track;
          if (t && t.id) trackMap.set(t.id, { ...t, played_at: item.played_at });
        });

        const featureMap = await getAudioFeaturesForTracks(spotifyApi, Array.from(trackMap.keys()));

        // Build daily mood groups
        const dayMap = {};
        const moodDist = {};

        Array.from(trackMap.values()).forEach(track => {
          const features = featureMap[track.id] || null;
          const mood = features ? inferMoodFromFeatures(features) : 'Unknown';
          moodDist[mood] = (moodDist[mood] || 0) + 1;

          const day = track.played_at
            ? new Date(track.played_at).toISOString().split('T')[0]
            : new Date().toISOString().split('T')[0];

          if (!dayMap[day]) dayMap[day] = { date: day, moods: {}, tracks: [], total_tracks: 0 };
          dayMap[day].moods[mood] = (dayMap[day].moods[mood] || 0) + 1;
          dayMap[day].total_tracks++;
          dayMap[day].tracks.push({ track: track.name, artist: track.artists?.[0]?.name, mood, confidence: features ? null : null, all_moods: [mood] });
        });

        const trends = Object.values(dayMap)
          .sort((a, b) => a.date.localeCompare(b.date))
          .map(day => ({
            date: day.date,
            moods: day.moods,
            totalTracks: day.total_tracks,
            totalMoodTags: day.total_tracks,
            dominantMood: Object.entries(day.moods).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Unknown',
            moodDiversity: Object.keys(day.moods).length,
            tracks: day.tracks
          }));

        const sortedMoods = Object.entries(moodDist).sort((a, b) => b[1] - a[1]);
        const overallMood = sortedMoods[0]?.[0] || 'Unknown';
        const aggregatedFeatures = calculateAggregatedFeatures(trends);

        return res.json({
          trends,
          moodDistribution: moodDist,
          overallMood,
          aggregatedFeatures,
          statistics: {
            totalTracks: trackMap.size,
            uniqueMoods: sortedMoods.length,
            analyzedAt: new Date().toISOString(),
            source: 'spotify_recently_played',
            moodSystem: '12_extended_moods'
          }
        });
      } catch (spotifyErr) {
        console.error('❌ Spotify fallback also failed:', spotifyErr.message);
        return res.json({
          trends: [],
          moodDistribution: {},
          overallMood: 'Unknown',
          aggregatedFeatures: null,
          message: 'Unable to load mood data. Please try again.',
          statistics: { totalTracks: 0, uniqueMoods: 0, analyzedAt: new Date().toISOString() }
        });
      }
    }

    // ML data is available — use it
    const timeline = timelineResponse.timeline;
    const aggregatedFeatures = calculateAggregatedFeatures(timeline);
    const moodDistribution = timelineResponse.overall_statistics?.mood_distribution || {};
    const overallMood = timelineResponse.overall_statistics?.most_common_mood || 'Unknown';

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
      return res.status(401).json({ message: 'Session expired', code: 'SESSION_EXPIRED' });
    }

    res.json({
      trends: [],
      moodDistribution: {},
      overallMood: 'Unknown',
      aggregatedFeatures: null,
      message: 'Mood trends temporarily unavailable',
      statistics: { totalTracks: 0, uniqueMoods: 0, analyzedAt: new Date().toISOString() }
    });
  }
};



/**



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
    let distributionResponse = null;
    try {
      distributionResponse = await mlService.getUserMoodDistribution(
        user._id.toString()
      );
    } catch (mlErr) {
      console.warn(`⚠️ ML distribution unavailable, falling back: ${mlErr.message}`);
    }

    if (!distributionResponse || distributionResponse.total_tracks === 0) {
      console.log('📊 Running Spotify recently-played fallback for mood distribution');
      const spotifyApi = new SpotifyWebApi({
        clientId: process.env.SPOTIFY_CLIENT_ID,
        clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
      });
      spotifyApi.setAccessToken(user.accessToken);

      const recentlyPlayed = await spotifyApi.getMyRecentlyPlayedTracks({ limit: 50 }).catch(() => null);
      if (recentlyPlayed && recentlyPlayed.body && recentlyPlayed.body.items && recentlyPlayed.body.items.length > 0) {
        const items = recentlyPlayed.body.items;
        const trackMap = new Map();
        items.forEach(item => {
          const t = item.track;
          if (t && t.id) trackMap.set(t.id, t);
        });

        const featureMap = await getAudioFeaturesForTracks(spotifyApi, Array.from(trackMap.keys()));
        const moodDist = {};
        let totalTags = 0;

        Array.from(trackMap.values()).forEach(track => {
          const features = featureMap[track.id] || null;
          const mood = features ? inferMoodFromFeatures(features) : 'Unknown';
          if (mood !== 'Unknown') {
            moodDist[mood] = (moodDist[mood] || 0) + 1;
            totalTags++;
          }
        });

        const sortedMoods = Object.entries(moodDist).sort((a, b) => b[1] - a[1]);
        const distribution = {};
        for (const [mood, count] of sortedMoods) {
          distribution[mood] = {
            count,
            percentage: Math.round((count / totalTags) * 100 * 10) / 10,
            avg_confidence: null
          };
        }

        return res.json({
          distribution,
          totalTracks: trackMap.size,
          totalMoodTags: totalTags,
          avgMoodsPerTrack: totalTags > 0 ? (totalTags / trackMap.size) : 0,
          top3Moods: sortedMoods.map(m => m[0]).slice(0, 3),
          moodDiversity: Object.keys(moodDist).length,
          moodSystem: '12_extended_moods'
        });
      }

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
    const userId = user._id;

    console.log('📊 Analyzing listening activity patterns (MongoDB + Spotify)');

    // --- Try MongoDB first (persistent history) ---
    let mongoItems = [];
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      mongoItems = await ListeningHistory.find({
        userId,
        playedAt: { $gte: thirtyDaysAgo }
      }).lean();
    } catch (mongoErr) {
      console.warn('⚠️ MongoDB history read failed:', mongoErr.message);
    }

    // --- Build activity arrays ---
    const buildActivityFromItems = (items, getDate) => {
      const hourlyActivity = Array(24).fill(0);
      const dailyActivity = Array(7).fill(0);
      const artistSet = new Set();
      items.forEach(item => {
        const date = getDate(item);
        if (!date) return;
        hourlyActivity[date.getHours()]++;
        dailyActivity[date.getDay()]++;
        if (item.artistName) artistSet.add(item.artistName);
      });
      return { hourlyActivity, dailyActivity, artistSet, total: items.length };
    };

    if (mongoItems.length > 0) {
      const { hourlyActivity, dailyActivity, artistSet, total } = buildActivityFromItems(
        mongoItems,
        item => new Date(item.playedAt)
      );

      const peakHour = hourlyActivity.indexOf(Math.max(...hourlyActivity));
      const peakDay = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
        dailyActivity.indexOf(Math.max(...dailyActivity))
      ];

      console.log(`✅ Activity from MongoDB (${total} plays): Peak ${peakDay} at ${peakHour}:00`);

      return res.json({
        hourlyActivity: hourlyActivity.map((count, hour) => ({ hour: `${hour}:00`, plays: count })),
        dailyActivity: dailyActivity.map((count, index) => ({
          day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][index],
          plays: count,
        })),
        insights: {
          peakHour: `${peakHour}:00 - ${peakHour + 1}:00`,
          peakDay: peakDay,
          totalPlays: total,
          uniqueArtists: artistSet.size,
          averagePlaysPerDay: Math.round(total / 30),
        },
        source: 'mongodb',
      });
    }

    // --- Fallback: Spotify recently played (no persistent history yet) ---
    console.log('📊 No MongoDB history yet — using Spotify recently-played fallback');
    const spotifyApi = new SpotifyWebApi();
    spotifyApi.setAccessToken(user.accessToken);

    const recentlyPlayed = await spotifyApi.getMyRecentlyPlayedTracks({ limit: 50 });

    if (!recentlyPlayed.body.items || recentlyPlayed.body.items.length === 0) {
      return res.json({
        hourlyActivity: [],
        dailyActivity: [],
        insights: { peakHour: 'N/A', peakDay: 'N/A', totalPlays: 0, uniqueArtists: 0, averagePlaysPerDay: 0 }
      });
    }

    const { hourlyActivity, dailyActivity, artistSet, total } = buildActivityFromItems(
      recentlyPlayed.body.items,
      item => item.played_at ? new Date(item.played_at) : null
    );

    const peakHour = hourlyActivity.indexOf(Math.max(...hourlyActivity));
    const peakDay = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
      dailyActivity.indexOf(Math.max(...dailyActivity))
    ];

    console.log(`✅ Activity from Spotify (${total} plays): Peak ${peakDay} at ${peakHour}:00`);

    res.json({
      hourlyActivity: hourlyActivity.map((count, hour) => ({ hour: `${hour}:00`, plays: count })),
      dailyActivity: dailyActivity.map((count, index) => ({
        day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][index],
        plays: count,
      })),
      insights: {
        peakHour: `${peakHour}:00 - ${peakHour + 1}:00`,
        peakDay: peakDay,
        totalPlays: total,
        uniqueArtists: artistSet.size,
        averagePlaysPerDay: Math.round(total / 7),
      },
      source: 'spotify_fallback',
    });

  } catch (error) {
    console.error('❌ Activity analytics error:', error.message);
    if (error.statusCode === 401) {
      return res.status(401).json({ message: 'Spotify token expired', code: 'SPOTIFY_TOKEN_EXPIRED' });
    }
    res.status(500).json({ message: 'Failed to fetch activity analytics', error: error.message });
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

    const artistsCount = topArtists.body.items.length;

    const genres = Object.entries(genreCount)
      .sort((a, b) => b[1] - a[1])
      .map(([genre, count]) => ({
        genre,
        count,
        percentage: artistsCount > 0 ? Math.round((count / artistsCount) * 100) : 0,
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
    mainCategories.other = artistsCount - categorizedCount;

    console.log(`✅ Genre analysis: ${Object.keys(genreCount).length} unique genres`);

    res.json({
      timeRange,
      allGenres: genres.slice(0, 30),
      mainCategories: Object.entries(mainCategories)
        .map(([category, count]) => ({
          category,
          count,
          percentage: artistsCount > 0 ? Math.round((count / artistsCount) * 100) : 0,
        }))
        .sort((a, b) => b.count - a.count),
      totalGenres: Object.keys(genreCount).length,
      totalArtists: artistsCount,
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
    
    let timelineResponse = null;
    let mlFailed = false;

    try {
      timelineResponse = await mlService.getUserMoodTimeline(
        req.user._id.toString(),
        parseInt(days)
      );
      if (!timelineResponse || !timelineResponse.timeline || timelineResponse.timeline.length === 0) {
        mlFailed = true;
      }
    } catch (mlErr) {
      console.warn(`⚠️ ML timeline unavailable (${mlErr.message}), trying Spotify fallback`);
      mlFailed = true;
    }

    if (mlFailed) {
      console.log('📈 Running direct Spotify fallback for mood timeline');
      const spotifyApi = new SpotifyWebApi();
      spotifyApi.setAccessToken(req.user.accessToken);
      
      const recent = await spotifyApi.getMyRecentlyPlayedTracks({ limit: 50 }).catch(() => null);
      const items = recent?.body?.items || [];
      
      if (items.length === 0) {
        return res.json({
          user_id: req.user._id.toString(),
          period_days: parseInt(days),
          timeline: [],
          total_tracked: 0,
          overall_statistics: {
            most_common_mood: 'Unknown',
            mood_diversity: 0,
            mood_distribution: {},
            average_moods_per_track: 0
          },
          source: 'spotify_fallback'
        });
      }

      // Unique tracks
      const trackMap = new Map();
      items.forEach(item => {
        const t = item?.track;
        if (t && t.id) trackMap.set(t.id, { ...t, played_at: item.played_at });
      });

      const featureMap = await getAudioFeaturesForTracks(spotifyApi, Array.from(trackMap.keys()));

      // Check unique days to decide granularity (by time/HH:MM vs by day/YYYY-MM-DD)
      const uniqueDays = new Set(items.map(item => 
        item.played_at ? item.played_at.split('T')[0] : new Date().toISOString().split('T')[0]
      ));
      const groupByTime = uniqueDays.size <= 1;

      // Build daily/hourly mood groups
      const dayMap = {};
      const moodDist = {};

      Array.from(trackMap.values()).forEach(track => {
        const features = featureMap[track.id] || null;
        const mood = features ? inferMoodFromFeatures(features) : 'Unknown';
        moodDist[mood] = (moodDist[mood] || 0) + 1;

        let dateStr;
        if (groupByTime && track.played_at) {
          try {
            const dt = new Date(track.played_at);
            dateStr = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          } catch (e) {
            dateStr = track.played_at.substring(11, 16);
          }
        } else {
          dateStr = track.played_at
            ? track.played_at.split('T')[0]
            : new Date().toISOString().split('T')[0];
        }

        if (!dayMap[dateStr]) dayMap[dateStr] = { date: dateStr, moods: {}, tracks: [], total_tracks: 0 };
        dayMap[dateStr].moods[mood] = (dayMap[dateStr].moods[mood] || 0) + 1;
        dayMap[dateStr].total_tracks++;
        dayMap[dateStr].tracks.push({ 
          track: track.name, 
          artist: track.artists?.[0]?.name, 
          mood, 
          confidence: null,
          all_moods: [mood],
          features: features
        });
      });

      const timeline = Object.values(dayMap)
        .sort((a, b) => a.date.localeCompare(b.date))
        .map(day => ({
          date: day.date,
          dominantMood: Object.entries(day.moods).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Unknown',
          moodDiversity: Object.keys(day.moods).length,
          totalTracks: day.total_tracks,
          moods: day.moods,
          tracks: day.tracks
        }));

      const sortedMoods = Object.entries(moodDist).sort((a, b) => b[1] - a[1]);
      const overallMood = sortedMoods[0]?.[0] || 'Unknown';

      timelineResponse = {
        user_id: req.user._id.toString(),
        period_days: parseInt(days),
        timeline,
        total_tracked: items.length,
        overall_statistics: {
          most_common_mood: overallMood,
          mood_diversity: sortedMoods.length,
          mood_distribution: moodDist,
          average_moods_per_track: trackMap.size > 0 ? (Array.from(trackMap.keys()).length / trackMap.size) : 0
        },
        source: 'spotify_fallback'
      };
    }

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

    let realtimeAnalysis = null;
    let mlFailed = false;

    try {
      realtimeAnalysis = await mlService.analyzeCurrentlyPlaying(
        user.accessToken,
        user._id.toString()
      );
    } catch (mlErr) {
      console.warn(`⚠️ ML currently-playing failed (${mlErr.message}), trying Spotify direct fallback`);
      mlFailed = true;
    }

    if (mlFailed || !realtimeAnalysis) {
      const spotifyApi = new SpotifyWebApi();
      spotifyApi.setAccessToken(user.accessToken);

      const currentlyPlaying = await spotifyApi.getMyCurrentPlayingTrack().catch(() => null);
      if (!currentlyPlaying || !currentlyPlaying.body || !currentlyPlaying.body.item) {
        return res.json({
          isPlaying: false,
          message: 'No track currently playing',
          timestamp: new Date().toISOString()
        });
      }

      const item = currentlyPlaying.body.item;
      if (currentlyPlaying.body.currently_playing_type === 'episode') {
        return res.json({
          isPlaying: true,
          type: 'episode',
          episode: {
            id: item.id,
            name: item.name,
            show: item.show?.name || 'Podcast'
          },
          device: currentlyPlaying.body.device || { name: 'Spotify Player', type: 'Computer' },
          progress: currentlyPlaying.body.progress_ms,
          message: 'Currently playing podcast episode',
          timestamp: new Date().toISOString()
        });
      }

      // Fetch features
      let features = null;
      try {
        const featResponse = await spotifyApi.getAudioFeaturesForTracks([item.id]);
        features = featResponse.body.audio_features?.[0] || null;
      } catch (featErr) {
        console.warn('⚠️ Fallback features failed in realtime analysis:', featErr.message);
      }

      const inferredMood = features ? inferMoodFromFeatures(features) : 'Unknown';

      console.log(`✅ Real-time (Fallback): ${item.name} - Mood: ${inferredMood}`);

      return res.json({
        isPlaying: currentlyPlaying.body.is_playing,
        type: 'track',
        track: {
          id: item.id,
          name: item.name,
          artists: item.artists.map(a => ({ id: a.id, name: a.name })),
          album: item.album,
          albumImage: item.album?.images?.[0]?.url,
          duration: item.duration_ms,
          progress: currentlyPlaying.body.progress_ms || 0,
          popularity: item.popularity || 50,
          explicit: item.explicit || false,
          externalUrl: item.external_urls?.spotify || ''
        },
        device: currentlyPlaying.body.device || null,
        playback: {
          shuffleState: currentlyPlaying.body.shuffle_state || false,
          repeatState: currentlyPlaying.body.repeat_state || 'off',
          context: currentlyPlaying.body.context || null
        },
        mood: inferredMood !== 'Unknown' ? {
          primary_mood: inferredMood,
          all_moods: [inferredMood],
          mood_scores: { [inferredMood]: features ? 1.0 : null },
          confidence: features ? null : null,
          base_mood: inferredMood,
          lyrics_mood: null,
          source: 'rule_based_fallback'
        } : null,
        audioFeatures: features,
        genre: null,
        timestamp: new Date().toISOString()
      });
    }

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

    // Gracefully handle ML service 503, connection refused, timeouts, or transient 500s with a 200 fallback
    return res.json({
      isPlaying: false,
      message: `Real-time playback analysis temporarily unavailable (${error.message})`,
      timestamp: new Date().toISOString()
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
        // Use track's actual features if present, otherwise estimate from moods
        let trackFeatures = track.features;
        if (!trackFeatures) {
          const moodScores = track.all_moods || [];
          trackFeatures = estimateFeaturesFromMoods(moodScores);
        }
        
        dayFeatures.valence += trackFeatures.valence !== undefined ? Number(trackFeatures.valence) : 0.5;
        dayFeatures.energy += trackFeatures.energy !== undefined ? Number(trackFeatures.energy) : 0.5;
        dayFeatures.danceability += trackFeatures.danceability !== undefined ? Number(trackFeatures.danceability) : 0.5;
        dayFeatures.acousticness += trackFeatures.acousticness !== undefined ? Number(trackFeatures.acousticness) : 0.5;
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
  // Mood to feature mapping (based on 12 extended moods and legacy fallbacks)
  const moodFeatureMap = {
    // 12 Extended Moods (FastAPI / Retrained Model)
    'Happy': { valence: 0.85, energy: 0.725, danceability: 0.80, acousticness: 0.25 },
    'Sad': { valence: 0.15, energy: 0.325, danceability: 0.35, acousticness: 0.60 },
    'Energetic': { valence: 0.75, energy: 0.90, danceability: 0.70, acousticness: 0.175 },
    'Calm': { valence: 0.55, energy: 0.30, danceability: 0.45, acousticness: 0.75 },
    'Focused': { valence: 0.55, energy: 0.50, danceability: 0.55, acousticness: 0.45 },
    'Romantic': { valence: 0.75, energy: 0.525, danceability: 0.55, acousticness: 0.65 },
    'Chill': { valence: 0.65, energy: 0.425, danceability: 0.65, acousticness: 0.55 },
    'Determined': { valence: 0.50, energy: 0.80, danceability: 0.60, acousticness: 0.25 },
    'Reflective': { valence: 0.45, energy: 0.40, danceability: 0.45, acousticness: 0.75 },
    'Confident': { valence: 0.75, energy: 0.80, danceability: 0.725, acousticness: 0.25 },
    'Anxious': { valence: 0.35, energy: 0.60, danceability: 0.40, acousticness: 0.35 },
    'Excited': { valence: 0.85, energy: 0.90, danceability: 0.80, acousticness: 0.20 },

    // Legacy / Fallback Moods
    'Joyful': { valence: 0.85, energy: 0.70, danceability: 0.75, acousticness: 0.30 },
    'Party': { valence: 0.80, energy: 0.90, danceability: 0.90, acousticness: 0.15 },
    'Melancholic': { valence: 0.20, energy: 0.25, danceability: 0.30, acousticness: 0.70 },
    'Dreamy': { valence: 0.40, energy: 0.30, danceability: 0.35, acousticness: 0.65 },
    'Relaxed': { valence: 0.50, energy: 0.25, danceability: 0.30, acousticness: 0.70 },
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

  return { ...features, isEstimate: true };
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