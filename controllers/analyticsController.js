import SpotifyWebApi from 'spotify-web-api-node';
import User from '../models/userModel.js';

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

    // Get recently played tracks
    const recentlyPlayed = await spotifyApi.getMyRecentlyPlayedTracks({ limit: parseInt(limit) });

    // Get audio features for all tracks
    const trackIds = recentlyPlayed.body.items.map(item => item.track.id);
    const audioFeatures = await spotifyApi.getAudioFeaturesForTracks(trackIds);

    // Combine data
    const tracksWithFeatures = recentlyPlayed.body.items.map((item, index) => ({
      trackName: item.track.name,
      artistName: item.track.artists[0].name,
      playedAt: item.played_at,
      features: audioFeatures.body.audio_features[index],
    }));

    // Calculate mood trends over time
    const moodTrends = tracksWithFeatures.map(track => {
      const features = track.features;
      
      // Calculate mood score based on audio features
      const happiness = features.valence;
      const energy = features.energy;
      const danceability = features.danceability;
      
      let mood = 'Neutral';
      if (happiness > 0.7 && energy > 0.6) mood = 'Happy';
      else if (happiness < 0.3 && energy < 0.4) mood = 'Sad';
      else if (energy > 0.8) mood = 'Energetic';
      else if (energy < 0.3 && happiness > 0.5) mood = 'Calm';
      else if (happiness < 0.3 && energy > 0.6) mood = 'Angry';

      return {
        timestamp: track.playedAt,
        trackName: track.trackName,
        artistName: track.artistName,
        mood,
        moodScores: {
          valence: happiness,
          energy: energy,
          danceability: danceability,
        },
      };
    });

    // Calculate overall statistics
    const avgValence = tracksWithFeatures.reduce((sum, t) => sum + t.features.valence, 0) / tracksWithFeatures.length;
    const avgEnergy = tracksWithFeatures.reduce((sum, t) => sum + t.features.energy, 0) / tracksWithFeatures.length;
    const avgDanceability = tracksWithFeatures.reduce((sum, t) => sum + t.features.danceability, 0) / tracksWithFeatures.length;

    // Mood distribution
    const moodCount = moodTrends.reduce((acc, item) => {
      acc[item.mood] = (acc[item.mood] || 0) + 1;
      return acc;
    }, {});

    res.json({
      trends: moodTrends,
      statistics: {
        averageValence: avgValence,
        averageEnergy: avgEnergy,
        averageDanceability: avgDanceability,
      },
      moodDistribution: Object.entries(moodCount).map(([mood, count]) => ({
        mood,
        count,
        percentage: Math.round((count / moodTrends.length) * 100),
      })),
    });

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

    // Get recently played tracks
    const recentlyPlayed = await spotifyApi.getMyRecentlyPlayedTracks({ limit: 50 });

    // Analyze listening patterns
    const hourlyActivity = Array(24).fill(0);
    const dailyActivity = Array(7).fill(0);
    
    recentlyPlayed.body.items.forEach(item => {
      const date = new Date(item.played_at);
      const hour = date.getHours();
      const day = date.getDay(); // 0 = Sunday, 6 = Saturday
      
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
      recentlyPlayed.body.items.map(item => item.track.artists[0].id)
    );

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

    // Get top artists
    const topArtists = await spotifyApi.getMyTopArtists({ 
      limit: 50, 
      time_range: timeRange 
    });

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