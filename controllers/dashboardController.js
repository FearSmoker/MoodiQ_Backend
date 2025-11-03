import SpotifyWebApi from 'spotify-web-api-node';
import User from '../models/userModel.js';
import SharedPlaylist from '../models/sharedPlaylistModel.js';
import axios from 'axios';

const ML_API_URL = process.env.ML_API_URL || 'http://localhost:8000';

/**
 * @desc    Get comprehensive dashboard overview data
 * @route   GET /api/dashboard/overview
 * @access  Protected
 */
export const getDashboardOverview = async (req, res) => {
  try {
    console.log('📊 Dashboard: Fetching overview for user:', req.user.displayName);
    const user = req.user;
    
    // Initialize Spotify API with user's token
    const spotifyApi = new SpotifyWebApi();
    spotifyApi.setAccessToken(user.accessToken);

    // Fetch data in parallel for better performance
    const [
      userPlaylists,
      topArtists,
      topTracks,
      recentlyPlayed,
      savedTracks,
      userProfile,
      userShares,
      currentlyPlaying
    ] = await Promise.all([
      spotifyApi.getUserPlaylists(user.spotifyId, { limit: 50 }),
      spotifyApi.getMyTopArtists({ limit: 20, time_range: 'medium_term' }),
      spotifyApi.getMyTopTracks({ limit: 20, time_range: 'medium_term' }),
      spotifyApi.getMyRecentlyPlayedTracks({ limit: 50 }),
      spotifyApi.getMySavedTracks({ limit: 1 }),
      spotifyApi.getMe(),
      SharedPlaylist.find({ owner: user._id }).sort({ createdAt: -1 }).limit(10),
      spotifyApi.getMyCurrentPlayingTrack().catch(() => null)
    ]);

    // Calculate comprehensive statistics
    const stats = {
      totalPlaylists: userPlaylists.body.total || 0,
      totalTracks: savedTracks.body.total || 0,
      totalShares: userShares.length,
      totalShareViews: userShares.reduce((sum, share) => sum + (share.views || 0), 0),
      followersCount: userProfile.body.followers?.total || 0,
      accountType: userProfile.body.product || 'free',
      totalArtists: new Set(recentlyPlayed.body.items.map(item => item.track.artists[0].id)).size,
      recentlyPlayedCount: recentlyPlayed.body.items.length,
    };

    // Genre analysis from top artists
    const genreCount = {};
    topArtists.body.items.forEach(artist => {
      artist.genres.forEach(genre => {
        genreCount[genre] = (genreCount[genre] || 0) + 1;
      });
    });

    const topGenres = Object.entries(genreCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([genre, count]) => ({ 
        genre, 
        count,
        percentage: Math.round((count / topArtists.body.items.length) * 100)
      }));

    // Recent activity with timestamps
    const recentActivity = recentlyPlayed.body.items.slice(0, 20).map(item => ({
      trackId: item.track.id,
      trackName: item.track.name,
      artistName: item.track.artists[0].name,
      artistId: item.track.artists[0].id,
      playedAt: item.played_at,
      albumImage: item.track.album.images[0]?.url,
      albumName: item.track.album.name,
      duration: item.track.duration_ms,
      externalUrl: item.track.external_urls.spotify,
    }));

    // Listening patterns (hourly distribution)
    const hourlyActivity = Array(24).fill(0);
    recentlyPlayed.body.items.forEach(item => {
      const hour = new Date(item.played_at).getHours();
      hourlyActivity[hour]++;
    });

    const peakHour = hourlyActivity.indexOf(Math.max(...hourlyActivity));

    // Currently playing track
    const nowPlaying = currentlyPlaying?.body?.item ? {
      isPlaying: currentlyPlaying.body.is_playing,
      trackId: currentlyPlaying.body.item.id,
      trackName: currentlyPlaying.body.item.name,
      artists: currentlyPlaying.body.item.artists.map(a => ({ id: a.id, name: a.name })),
      albumName: currentlyPlaying.body.item.album.name,
      albumImage: currentlyPlaying.body.item.album.images[0]?.url,
      duration: currentlyPlaying.body.item.duration_ms,
      progress: currentlyPlaying.body.progress_ms,
      externalUrl: currentlyPlaying.body.item.external_urls.spotify,
      device: {
        name: currentlyPlaying.body.device?.name,
        type: currentlyPlaying.body.device?.type,
      }
    } : null;

    // Response data
    const dashboardData = {
      user: {
        id: user._id,
        spotifyId: user.spotifyId,
        displayName: user.displayName,
        email: user.email,
        avatarUrl: user.avatarUrl,
        accountType: stats.accountType,
        followers: stats.followersCount,
        preferences: user.preferences,
        linkedServices: user.linkedServices || [],
      },
      stats,
      playlists: userPlaylists.body.items.slice(0, 50).map(playlist => ({
        id: playlist.id,
        name: playlist.name,
        description: playlist.description,
        images: playlist.images,
        tracksCount: playlist.tracks.total,
        isPublic: playlist.public,
        owner: playlist.owner.display_name,
        externalUrl: playlist.external_urls.spotify,
      })),
      topArtists: topArtists.body.items.map(artist => ({
        id: artist.id,
        name: artist.name,
        genres: artist.genres,
        images: artist.images,
        popularity: artist.popularity,
        followers: artist.followers?.total || 0,
        externalUrl: artist.external_urls.spotify,
      })),
      topTracks: topTracks.body.items.map(track => ({
        id: track.id,
        name: track.name,
        artists: track.artists.map(a => ({ id: a.id, name: a.name })),
        album: {
          name: track.album.name,
          images: track.album.images,
        },
        duration: track.duration_ms,
        popularity: track.popularity,
        previewUrl: track.preview_url,
        externalUrl: track.external_urls.spotify,
      })),
      recentActivity,
      topGenres,
      listeningPatterns: {
        hourlyActivity: hourlyActivity.map((count, hour) => ({
          hour: `${hour}:00`,
          count
        })),
        peakListeningHour: `${peakHour}:00 - ${peakHour + 1}:00`,
        totalListeningTime: recentlyPlayed.body.items.reduce((sum, item) => 
          sum + item.track.duration_ms, 0
        ),
      },
      nowPlaying,
      recentShares: userShares.map(share => ({
        shareId: share.shareId,
        playlistName: share.playlistName,
        playlistImage: share.playlistImage,
        views: share.views,
        createdAt: share.createdAt,
        shareUrl: `/share/${share.shareId}`,
      })),
    };

    console.log('✅ Dashboard: Overview data compiled successfully');
    res.json(dashboardData);

  } catch (error) {
    console.error('❌ Dashboard overview error:', error.message);
    
    // Handle token expiration
    if (error.statusCode === 401) {
      return res.status(401).json({ 
        message: 'Spotify token expired',
        code: 'SPOTIFY_TOKEN_EXPIRED'
      });
    }

    res.status(500).json({ 
      message: 'Failed to fetch dashboard data',
      error: error.message 
    });
  }
};

/**
 * @desc    Get detailed listening statistics with time ranges
 * @route   GET /api/dashboard/listening-stats
 * @access  Protected
 */
export const getListeningStats = async (req, res) => {
  try {
    const user = req.user;
    const { timeRange = 'medium_term' } = req.query; // short_term, medium_term, long_term

    console.log(`📊 Listening Stats: Fetching for ${timeRange}`);

    const spotifyApi = new SpotifyWebApi();
    spotifyApi.setAccessToken(user.accessToken);

    const [topTracks, topArtists, recentlyPlayed] = await Promise.all([
      spotifyApi.getMyTopTracks({ limit: 50, time_range: timeRange }),
      spotifyApi.getMyTopArtists({ limit: 50, time_range: timeRange }),
      spotifyApi.getMyRecentlyPlayedTracks({ limit: 50 }),
    ]);

    // Get audio features for top tracks
    const trackIds = topTracks.body.items.map(t => t.id);
    const audioFeatures = await spotifyApi.getAudioFeaturesForTracks(trackIds);

    // Calculate listening patterns
    const listeningPatterns = {
      totalTracksPlayed: recentlyPlayed.body.items.length,
      uniqueArtists: new Set(recentlyPlayed.body.items.map(item => item.track.artists[0].id)).size,
      uniqueTracks: new Set(recentlyPlayed.body.items.map(item => item.track.id)).size,
      averageTrackDuration: Math.round(
        topTracks.body.items.reduce((sum, track) => sum + track.duration_ms, 0) / 
        topTracks.body.items.length / 1000
      ),
      averagePopularity: Math.round(
        topTracks.body.items.reduce((sum, track) => sum + track.popularity, 0) / 
        topTracks.body.items.length
      ),
    };

    // Audio features analysis
    const avgFeatures = {
      energy: 0,
      valence: 0,
      danceability: 0,
      acousticness: 0,
      instrumentalness: 0,
      speechiness: 0,
      tempo: 0,
    };

    audioFeatures.body.audio_features.forEach(feature => {
      if (feature) {
        Object.keys(avgFeatures).forEach(key => {
          avgFeatures[key] += feature[key] || 0;
        });
      }
    });

    Object.keys(avgFeatures).forEach(key => {
      avgFeatures[key] = avgFeatures[key] / audioFeatures.body.audio_features.length;
    });

    // Genre distribution
    const genreCount = {};
    topArtists.body.items.forEach(artist => {
      artist.genres.forEach(genre => {
        genreCount[genre] = (genreCount[genre] || 0) + 1;
      });
    });

    const genreDistribution = Object.entries(genreCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([genre, count]) => ({ 
        genre, 
        count, 
        percentage: Math.round((count / topArtists.body.items.length) * 100) 
      }));

    // Listening time distribution (by hour and day)
    const hourDistribution = Array(24).fill(0);
    const dayDistribution = Array(7).fill(0);
    
    recentlyPlayed.body.items.forEach(item => {
      const date = new Date(item.played_at);
      const hour = date.getHours();
      const day = date.getDay();
      hourDistribution[hour]++;
      dayDistribution[day]++;
    });

    res.json({
      timeRange,
      timeRangeLabel: {
        'short_term': 'Last 4 Weeks',
        'medium_term': 'Last 6 Months',
        'long_term': 'All Time'
      }[timeRange],
      patterns: listeningPatterns,
      audioProfile: avgFeatures,
      genreDistribution,
      hourDistribution: hourDistribution.map((count, hour) => ({ 
        hour: `${hour}:00`, 
        count 
      })),
      dayDistribution: dayDistribution.map((count, day) => ({
        day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day],
        count
      })),
      topTracks: topTracks.body.items.map((track, index) => ({
        rank: index + 1,
        id: track.id,
        name: track.name,
        artists: track.artists.map(a => a.name),
        album: track.album.name,
        popularity: track.popularity,
        duration: track.duration_ms,
        audioFeatures: audioFeatures.body.audio_features[index],
      })),
      topArtists: topArtists.body.items.map((artist, index) => ({
        rank: index + 1,
        id: artist.id,
        name: artist.name,
        genres: artist.genres,
        popularity: artist.popularity,
        followers: artist.followers?.total || 0,
      })),
    });

    console.log('✅ Listening stats fetched successfully');

  } catch (error) {
    console.error('❌ Listening stats error:', error.message);
    
    if (error.statusCode === 401) {
      return res.status(401).json({ 
        message: 'Spotify token expired',
        code: 'SPOTIFY_TOKEN_EXPIRED'
      });
    }

    res.status(500).json({ 
      message: 'Failed to fetch listening statistics',
      error: error.message 
    });
  }
};

/**
 * @desc    Get user's currently playing track with audio features
 * @route   GET /api/dashboard/now-playing
 * @access  Protected
 */
export const getNowPlaying = async (req, res) => {
  try {
    const user = req.user;

    const spotifyApi = new SpotifyWebApi();
    spotifyApi.setAccessToken(user.accessToken);

    const currentlyPlaying = await spotifyApi.getMyCurrentPlayingTrack();

    if (!currentlyPlaying.body || !currentlyPlaying.body.item) {
      return res.json({
        isPlaying: false,
        message: 'No track currently playing',
      });
    }

    const track = currentlyPlaying.body.item;
    
    // Get audio features for current track
    const audioFeatures = await spotifyApi.getAudioFeaturesForTrack(track.id);
    
    // Calculate mood from audio features
    const features = audioFeatures.body;
    let mood = 'Neutral';
    if (features.valence > 0.7 && features.energy > 0.6) mood = 'Happy';
    else if (features.valence < 0.3 && features.energy < 0.4) mood = 'Sad';
    else if (features.energy > 0.8) mood = 'Energetic';
    else if (features.energy < 0.3 && features.valence > 0.5) mood = 'Calm';
    
    res.json({
      isPlaying: currentlyPlaying.body.is_playing,
      track: {
        id: track.id,
        name: track.name,
        artists: track.artists.map(a => ({ id: a.id, name: a.name })),
        album: {
          name: track.album.name,
          images: track.album.images,
        },
        duration: track.duration_ms,
        progress: currentlyPlaying.body.progress_ms,
        progressPercentage: Math.round((currentlyPlaying.body.progress_ms / track.duration_ms) * 100),
        externalUrl: track.external_urls.spotify,
        previewUrl: track.preview_url,
      },
      audioFeatures: features,
      mood: mood,
      device: {
        name: currentlyPlaying.body.device?.name,
        type: currentlyPlaying.body.device?.type,
        volume: currentlyPlaying.body.device?.volume_percent,
      },
      context: currentlyPlaying.body.context ? {
        type: currentlyPlaying.body.context.type,
        uri: currentlyPlaying.body.context.uri,
      } : null,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('❌ Now playing error:', error.message);
    
    if (error.statusCode === 401) {
      return res.status(401).json({ 
        message: 'Spotify token expired',
        code: 'SPOTIFY_TOKEN_EXPIRED'
      });
    }

    // Return empty state instead of error for better UX
    res.json({
      isPlaying: false,
      message: 'Unable to fetch currently playing track',
    });
  }
};

/**
 * @desc    Get personalized music recommendations
 * @route   GET /api/dashboard/recommendations
 * @access  Protected
 */
export const getDashboardRecommendations = async (req, res) => {
  try {
    const user = req.user;
    const { limit = 20, seedType = 'tracks' } = req.query;

    const spotifyApi = new SpotifyWebApi();
    spotifyApi.setAccessToken(user.accessToken);

    // Get user's top items to use as seeds
    const topTracks = await spotifyApi.getMyTopTracks({ limit: 5, time_range: 'short_term' });
    const topArtists = await spotifyApi.getMyTopArtists({ limit: 3, time_range: 'short_term' });
    
    const seedTracks = topTracks.body.items.slice(0, 3).map(track => track.id);
    const seedArtists = topArtists.body.items.slice(0, 2).map(artist => artist.id);

    // Get recommendations
    const recommendations = await spotifyApi.getRecommendations({
      seed_tracks: seedType === 'tracks' ? seedTracks : [],
      seed_artists: seedType === 'artists' ? seedArtists : seedArtists.slice(0, 2),
      limit: parseInt(limit),
      market: 'US',
    });

    res.json({
      recommendations: recommendations.body.tracks.map(track => ({
        id: track.id,
        name: track.name,
        artists: track.artists.map(a => ({ id: a.id, name: a.name })),
        album: {
          name: track.album.name,
          images: track.album.images,
        },
        duration: track.duration_ms,
        popularity: track.popularity,
        previewUrl: track.preview_url,
        externalUrl: track.external_urls.spotify,
      })),
      seeds: {
        tracks: topTracks.body.items.slice(0, 3).map(track => ({
          id: track.id,
          name: track.name,
          artists: track.artists.map(a => a.name),
        })),
        artists: topArtists.body.items.slice(0, 2).map(artist => ({
          id: artist.id,
          name: artist.name,
        })),
      },
      total: recommendations.body.tracks.length,
    });

  } catch (error) {
    console.error('❌ Recommendations error:', error.message);
    
    if (error.statusCode === 401) {
      return res.status(401).json({ 
        message: 'Spotify token expired',
        code: 'SPOTIFY_TOKEN_EXPIRED'
      });
    }

    res.status(500).json({ 
      message: 'Failed to fetch recommendations',
      error: error.message 
    });
  }
};

/**
 * @desc    Get mood analysis trends (PLACEHOLDER - needs ML API)
 * @route   GET /api/dashboard/mood-trends
 * @access  Protected
 */
export const getMoodTrends = async (req, res) => {
  try {
    const user = req.user;
    const { limit = 50 } = req.query;

    const spotifyApi = new SpotifyWebApi();
    spotifyApi.setAccessToken(user.accessToken);

    // Get recently played tracks
    const recentlyPlayed = await spotifyApi.getMyRecentlyPlayedTracks({ 
      limit: parseInt(limit) 
    });

    // Get audio features
    const trackIds = recentlyPlayed.body.items.map(item => item.track.id);
    const audioFeatures = await spotifyApi.getAudioFeaturesForTracks(trackIds);

    // Basic mood calculation (will be replaced by ML API)
    const moodData = recentlyPlayed.body.items.map((item, index) => {
      const features = audioFeatures.body.audio_features[index];
      
      let mood = 'Neutral';
      if (features) {
        if (features.valence > 0.7 && features.energy > 0.6) mood = 'Happy';
        else if (features.valence < 0.3 && features.energy < 0.4) mood = 'Sad';
        else if (features.energy > 0.8) mood = 'Energetic';
        else if (features.energy < 0.3 && features.valence > 0.5) mood = 'Calm';
      }

      return {
        timestamp: item.played_at,
        trackName: item.track.name,
        artistName: item.track.artists[0].name,
        mood,
        features: features || {},
      };
    });

    // Mood distribution
    const moodCounts = moodData.reduce((acc, item) => {
      acc[item.mood] = (acc[item.mood] || 0) + 1;
      return acc;
    }, {});

    res.json({
      timeline: moodData,
      distribution: Object.entries(moodCounts).map(([mood, count]) => ({
        mood,
        count,
        percentage: Math.round((count / moodData.length) * 100),
      })),
      message: 'Using basic mood analysis. ML API integration pending.',
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