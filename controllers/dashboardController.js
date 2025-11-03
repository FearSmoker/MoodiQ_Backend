import SpotifyWebApi from 'spotify-web-api-node';
import User from '../models/userModel.js';
import SharedPlaylist from '../models/sharedPlaylistModel.js';

/**
 * @desc    Get dashboard overview data
 * @route   GET /api/dashboard/overview
 * @access  Protected
 */
export const getDashboardOverview = async (req, res) => {
  try {
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
      userShares
    ] = await Promise.all([
      // Get user's playlists
      spotifyApi.getUserPlaylists(user.spotifyId, { limit: 50 }),
      
      // Get top artists (last 6 months)
      spotifyApi.getMyTopArtists({ limit: 10, time_range: 'medium_term' }),
      
      // Get top tracks (last 6 months)
      spotifyApi.getMyTopTracks({ limit: 10, time_range: 'medium_term' }),
      
      // Get recently played tracks
      spotifyApi.getMyRecentlyPlayedTracks({ limit: 20 }),
      
      // Get saved tracks count
      spotifyApi.getMySavedTracks({ limit: 1 }),
      
      // Get user profile
      spotifyApi.getMe(),
      
      // Get user's shared playlists from our database
      SharedPlaylist.find({ owner: user._id }).sort({ createdAt: -1 }).limit(10)
    ]);

    // Calculate statistics
    const stats = {
      totalPlaylists: userPlaylists.body.total || 0,
      totalTracks: savedTracks.body.total || 0,
      totalShares: userShares.length,
      totalShareViews: userShares.reduce((sum, share) => sum + (share.views || 0), 0),
      followersCount: userProfile.body.followers?.total || 0,
      accountType: userProfile.body.product || 'free',
    };

    // Top genres from top artists
    const topGenres = topArtists.body.items
      .flatMap(artist => artist.genres)
      .reduce((acc, genre) => {
        acc[genre] = (acc[genre] || 0) + 1;
        return acc;
      }, {});

    const topGenresArray = Object.entries(topGenres)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([genre, count]) => ({ genre, count }));

    // Recent activity
    const recentActivity = recentlyPlayed.body.items.map(item => ({
      trackName: item.track.name,
      artistName: item.track.artists[0].name,
      playedAt: item.played_at,
      albumImage: item.track.album.images[0]?.url,
      trackId: item.track.id,
    }));

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
      },
      stats,
      playlists: userPlaylists.body.items.slice(0, 10).map(playlist => ({
        id: playlist.id,
        name: playlist.name,
        description: playlist.description,
        images: playlist.images,
        tracksCount: playlist.tracks.total,
        isPublic: playlist.public,
        owner: playlist.owner.display_name,
        externalUrl: playlist.external_urls.spotify,
      })),
      topArtists: topArtists.body.items.slice(0, 5).map(artist => ({
        id: artist.id,
        name: artist.name,
        genres: artist.genres,
        images: artist.images,
        popularity: artist.popularity,
        externalUrl: artist.external_urls.spotify,
      })),
      topTracks: topTracks.body.items.slice(0, 10).map(track => ({
        id: track.id,
        name: track.name,
        artists: track.artists.map(a => ({ id: a.id, name: a.name })),
        album: {
          name: track.album.name,
          images: track.album.images,
        },
        duration: track.duration_ms,
        popularity: track.popularity,
        externalUrl: track.external_urls.spotify,
      })),
      recentActivity: recentActivity.slice(0, 10),
      topGenres: topGenresArray,
      recentShares: userShares.map(share => ({
        shareId: share.shareId,
        playlistName: share.playlistName,
        playlistImage: share.playlistImage,
        views: share.views,
        createdAt: share.createdAt,
      })),
    };

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
 * @desc    Get user's listening statistics
 * @route   GET /api/dashboard/listening-stats
 * @access  Protected
 */
export const getListeningStats = async (req, res) => {
  try {
    const user = req.user;
    const { timeRange = 'medium_term' } = req.query; // short_term, medium_term, long_term

    const spotifyApi = new SpotifyWebApi();
    spotifyApi.setAccessToken(user.accessToken);

    const [topTracks, topArtists, recentlyPlayed] = await Promise.all([
      spotifyApi.getMyTopTracks({ limit: 50, time_range: timeRange }),
      spotifyApi.getMyTopArtists({ limit: 50, time_range: timeRange }),
      spotifyApi.getMyRecentlyPlayedTracks({ limit: 50 }),
    ]);

    // Calculate listening patterns
    const listeningPatterns = {
      totalTracksPlayed: recentlyPlayed.body.items.length,
      uniqueArtists: new Set(recentlyPlayed.body.items.map(item => item.track.artists[0].id)).size,
      averageTrackDuration: Math.round(
        topTracks.body.items.reduce((sum, track) => sum + track.duration_ms, 0) / 
        topTracks.body.items.length / 1000
      ),
    };

    // Genre distribution
    const genreCount = {};
    topArtists.body.items.forEach(artist => {
      artist.genres.forEach(genre => {
        genreCount[genre] = (genreCount[genre] || 0) + 1;
      });
    });

    const genreDistribution = Object.entries(genreCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([genre, count]) => ({ genre, count, percentage: Math.round((count / topArtists.body.items.length) * 100) }));

    // Listening time distribution (by hour of day)
    const hourDistribution = Array(24).fill(0);
    recentlyPlayed.body.items.forEach(item => {
      const hour = new Date(item.played_at).getHours();
      hourDistribution[hour]++;
    });

    res.json({
      timeRange,
      patterns: listeningPatterns,
      genreDistribution,
      hourDistribution: hourDistribution.map((count, hour) => ({ hour, count })),
      topTracks: topTracks.body.items.slice(0, 20).map(track => ({
        id: track.id,
        name: track.name,
        artists: track.artists.map(a => a.name),
        popularity: track.popularity,
      })),
      topArtists: topArtists.body.items.slice(0, 20).map(artist => ({
        id: artist.id,
        name: artist.name,
        genres: artist.genres,
        popularity: artist.popularity,
      })),
    });

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
 * @desc    Get user's currently playing track
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
        externalUrl: track.external_urls.spotify,
      },
      device: {
        name: currentlyPlaying.body.device?.name,
        type: currentlyPlaying.body.device?.type,
        volume: currentlyPlaying.body.device?.volume_percent,
      },
    });

  } catch (error) {
    console.error('❌ Now playing error:', error.message);
    
    if (error.statusCode === 401) {
      return res.status(401).json({ 
        message: 'Spotify token expired',
        code: 'SPOTIFY_TOKEN_EXPIRED'
      });
    }

    res.status(500).json({ 
      message: 'Failed to fetch currently playing track',
      error: error.message 
    });
  }
};

/**
 * @desc    Get user's music recommendations based on recent listening
 * @route   GET /api/dashboard/recommendations
 * @access  Protected
 */
export const getDashboardRecommendations = async (req, res) => {
  try {
    const user = req.user;

    const spotifyApi = new SpotifyWebApi();
    spotifyApi.setAccessToken(user.accessToken);

    // Get user's top tracks to use as seeds
    const topTracks = await spotifyApi.getMyTopTracks({ limit: 5, time_range: 'short_term' });
    const seedTracks = topTracks.body.items.slice(0, 5).map(track => track.id);

    // Get recommendations
    const recommendations = await spotifyApi.getRecommendations({
      seed_tracks: seedTracks,
      limit: 20,
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
      seedTracks: topTracks.body.items.map(track => ({
        id: track.id,
        name: track.name,
        artists: track.artists.map(a => a.name),
      })),
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