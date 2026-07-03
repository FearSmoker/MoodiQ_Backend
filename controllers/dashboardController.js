import SpotifyWebApi from 'spotify-web-api-node';
import User from '../models/userModel.js';
import SharedPlaylist from '../models/sharedPlaylistModel.js';
import * as mlService from '../services/mlService.js';
import { inferMoodFromFeatures } from './recommendationsController.js';

/**
 * Dashboard Controller - Complete ML Integration v2.0
 * Uses HYBRID approach: Spotify API + ML Service
 */

/**
 * @desc    Get comprehensive dashboard overview data
 * @route   GET /api/dashboard/overview
 * @access  Protected
 */
export const getDashboardOverview = async (req, res) => {
  try {
    const user = req.user;
    
    const spotifyApi = new SpotifyWebApi();
    spotifyApi.setAccessToken(user.accessToken);

    // Fetch data in parallel
    const [
      userPlaylists,
      topArtists,
      topTracks,
      recentlyPlayed,
      savedTracks,
      userProfile,
      userShares,
      currentlyPlaying,
      liveSession  // NEW: Check for live session
    ] = await Promise.all([
      spotifyApi.getUserPlaylists(user.spotifyId, { limit: 50 }).catch(err => {
        console.warn('⚠️ getUserPlaylists failed:', err.message);
        return { body: { items: [], total: 0 } };
      }),
      spotifyApi.getMyTopArtists({ limit: 20, time_range: 'medium_term' }).catch(err => {
        console.warn('⚠️ getMyTopArtists failed:', err.message);
        return { body: { items: [], total: 0 } };
      }),
      spotifyApi.getMyTopTracks({ limit: 20, time_range: 'medium_term' }).catch(err => {
        console.warn('⚠️ getMyTopTracks failed:', err.message);
        return { body: { items: [], total: 0 } };
      }),
      spotifyApi.getMyRecentlyPlayedTracks({ limit: 50 }).catch(err => {
        console.warn('⚠️ getMyRecentlyPlayedTracks failed:', err.message);
        return { body: { items: [], total: 0 } };
      }),
      spotifyApi.getMySavedTracks({ limit: 1 }).catch(err => {
        console.warn('⚠️ getMySavedTracks failed:', err.message);
        return { body: { items: [], total: 0 } };
      }),
      spotifyApi.getMe().catch(err => {
        console.warn('⚠️ getMe failed:', err.message);
        return { body: { followers: { total: 0 }, product: 'free' } };
      }),
      SharedPlaylist.find({ owner: user._id }).sort({ createdAt: -1 }).limit(10).catch(err => {
        console.warn('⚠️ SharedPlaylist search failed:', err.message);
        return [];
      }),
      spotifyApi.getMyCurrentPlayingTrack().catch(() => null),
      mlService.getCurrentLiveSession(user._id.toString()).catch(() => null)  // NEW
    ]);

    // Calculate comprehensive statistics
    const stats = {
      totalPlaylists: userPlaylists?.body?.total || 0,
      totalTracks: savedTracks?.body?.total || 0,
      totalShares: userShares?.length || 0,
      totalShareViews: userShares?.reduce((sum, share) => sum + (share.views || 0), 0) || 0,
      followersCount: userProfile?.body?.followers?.total || 0,
      accountType: userProfile?.body?.product || 'free',
      totalArtists: new Set((recentlyPlayed?.body?.items || []).map(item => item?.track?.artists?.[0]?.id).filter(Boolean)).size,
      recentlyPlayedCount: recentlyPlayed?.body?.items?.length || 0,
    };

    // Genre analysis from top artists
    const genreCount = {};
    (topArtists?.body?.items || []).forEach(artist => {
      if (artist?.genres) {
        artist.genres.forEach(genre => {
          genreCount[genre] = (genreCount[genre] || 0) + 1;
        });
      }
    });

    const topGenres = Object.entries(genreCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([genre, count]) => ({ 
        genre, 
        count,
        percentage: (topArtists?.body?.items?.length || 0) > 0 ? Math.round((count / topArtists.body.items.length) * 100) : 0
      }));

    // Recent activity with timestamps
    const recentActivity = (recentlyPlayed?.body?.items || []).slice(0, 20).map(item => ({
      trackId: item?.track?.id,
      trackName: item?.track?.name || 'Unknown Track',
      artistName: item?.track?.artists?.[0]?.name || 'Unknown Artist',
      artistId: item?.track?.artists?.[0]?.id || null,
      playedAt: item?.played_at,
      albumImage: item?.track?.album?.images?.[0]?.url || null,
      albumName: item?.track?.album?.name || 'Unknown Album',
      duration: item?.track?.duration_ms || 0,
      externalUrl: item?.track?.external_urls?.spotify || '',
    }));

    // Listening patterns (hourly distribution)
    const hourlyActivity = Array(24).fill(0);
    (recentlyPlayed?.body?.items || []).forEach(item => {
      if (item?.played_at) {
        const hour = new Date(item.played_at).getHours();
        hourlyActivity[hour]++;
      }
    });

    const peakHour = hourlyActivity.indexOf(Math.max(...hourlyActivity));

    // Currently playing track with ML mood analysis
    let nowPlaying = null;
    if (currentlyPlaying?.body?.item) {
      // `progress_ms` from Spotify is already the live current position;
      // it does not need any elapsed-time correction added on top (that
      // was double-counting and made the reported position drift ahead
      // of real playback the longer it had been since the last seek).
      const progress = currentlyPlaying.body.progress_ms || 0;

      try {
        // Get ML mood analysis for currently playing track
        const moodAnalysis = await mlService.analyzeCurrentlyPlaying(
          user.accessToken,
          user._id.toString()
        );

        nowPlaying = {
          isPlaying: currentlyPlaying.body.is_playing,
          trackId: currentlyPlaying.body.item.id,
          trackName: currentlyPlaying.body.item.name || 'Unknown Track',
          artists: currentlyPlaying.body.item.artists?.map(a => ({ id: a.id, name: a.name })) || [],
          albumName: currentlyPlaying.body.item.album?.name || 'Unknown Album',
          albumImage: currentlyPlaying.body.item.album?.images?.[0]?.url || null,
          duration: currentlyPlaying.body.item.duration_ms || 0,
          progress: progress,
          externalUrl: currentlyPlaying.body.item.external_urls?.spotify || '',
          device: {
            name: currentlyPlaying.body.device?.name,
            type: currentlyPlaying.body.device?.type,
          },
          // ML mood analysis
          mood: {
            fused_mood: moodAnalysis?.mood_analysis?.fused_mood || 'Unknown',
            confidence: moodAnalysis?.mood_analysis?.confidence || 0,
            audio_mood: moodAnalysis?.mood_analysis?.audio_mood || 'Unknown',
            lyrics_mood: moodAnalysis?.mood_analysis?.lyrics_mood || 'Neutral',
            scores: moodAnalysis?.mood_analysis?.scores || {}
          }
        };

      } catch (mlError) {
        console.warn('⚠️ ML mood analysis unavailable for now playing:', mlError.message);
        
        // Fallback: direct Spotify audio features + local rule engine
        let inferredMood = 'Unknown';
        try {
          const featResponse = await spotifyApi.getAudioFeaturesForTracks([currentlyPlaying.body.item.id]);
          const features = featResponse.body.audio_features?.[0] || null;
          if (features) {
            inferredMood = inferMoodFromFeatures(features);
          }
        } catch (featErr) {
          console.warn('⚠️ Fallback audio features failed in overview:', featErr.message);
        }

        // Fallback: basic info with local rule-based mood
        nowPlaying = {
          isPlaying: currentlyPlaying.body.is_playing,
          trackId: currentlyPlaying.body.item.id,
          trackName: currentlyPlaying.body.item.name || 'Unknown Track',
          artists: currentlyPlaying.body.item.artists?.map(a => ({ id: a.id, name: a.name })) || [],
          albumName: currentlyPlaying.body.item.album?.name || 'Unknown Album',
          albumImage: currentlyPlaying.body.item.album?.images?.[0]?.url || null,
          duration: currentlyPlaying.body.item.duration_ms || 0,
          progress: progress,
          externalUrl: currentlyPlaying.body.item.external_urls?.spotify || '',
          device: currentlyPlaying.body.device || null,
          mood: inferredMood !== 'Unknown' ? {
            fused_mood: inferredMood,
            confidence: null,
            audio_mood: inferredMood,
            lyrics_mood: null,
            scores: { [inferredMood]: null },
            source: 'rule_based_fallback'
          } : null
        };
      }
    }

    // Get user's ML learning stats
    let mlStats = null;
    try {
      mlStats = await mlService.getUserLearningStats(user._id.toString());
    } catch (mlError) {
      console.warn('⚠️ ML stats unavailable:', mlError.message);
    }

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
      stats: {
        ...stats,
        // Add ML personalization stats
        feedbackCount: mlStats?.feedback_count || 0,
        personalizationLevel: mlStats?.personalization_level || 'none',
        hasTrainedModel: mlStats?.has_trained_model || false,
      },
      liveSession: liveSession?.active ? {
        sessionId: liveSession.session_id,
        startedAt: liveSession.started_at,
        trackCount: liveSession.track_count,
        currentMood: liveSession.current_mood,
        duration: liveSession.session_duration_minutes
      } : null,
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
          name: track.album?.name || '',
          images: track.album?.images || [],
        },
        duration: track.duration_ms,
        popularity: track.popularity,
        previewUrl: track.preview_url,
        externalUrl: track.external_urls?.spotify || track.external_urls || '',
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
      mlInsights: mlStats ? {
        feedbackCount: mlStats.feedback_count,
        personalizationLevel: mlStats.personalization_level,
        hasTrainedModel: mlStats.has_trained_model,
        moodPreferences: mlStats.mood_corrections || {},
        lastTrained: mlStats.last_trained,
      } : null
    };

    res.json(dashboardData);

  } catch (error) {
    console.error('❌ Dashboard overview error:', error.message);
    
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
    const { timeRange = 'medium_term' } = req.query;


    const spotifyApi = new SpotifyWebApi();
    spotifyApi.setAccessToken(user.accessToken);

    const [topTracks, topArtists, recentlyPlayed] = await Promise.all([
      spotifyApi.getMyTopTracks({ limit: 50, time_range: timeRange }),
      spotifyApi.getMyTopArtists({ limit: 50, time_range: timeRange }),
      spotifyApi.getMyRecentlyPlayedTracks({ limit: 50 }),
    ]);

    const tracksCount = topTracks.body.items.length;
    
    // Calculate listening patterns
    const listeningPatterns = {
      totalTracksPlayed: recentlyPlayed?.body?.items?.length || 0,
      uniqueArtists: new Set((recentlyPlayed?.body?.items || []).map(item => item?.track?.artists?.[0]?.id).filter(Boolean)).size,
      uniqueTracks: new Set((recentlyPlayed?.body?.items || []).map(item => item?.track?.id).filter(Boolean)).size,
      averageTrackDuration: tracksCount > 0 ? Math.round(
        (topTracks?.body?.items || []).reduce((sum, track) => sum + (track?.duration_ms || 0), 0) / 
        tracksCount / 1000
      ) : 0,
      averagePopularity: tracksCount > 0 ? Math.round(
        (topTracks?.body?.items || []).reduce((sum, track) => sum + (track?.popularity || 0), 0) / 
        tracksCount
      ) : 0,
    };

    // Genre distribution
    const genreCount = {};
    (topArtists?.body?.items || []).forEach(artist => {
      if (artist?.genres) {
        artist.genres.forEach(genre => {
          genreCount[genre] = (genreCount[genre] || 0) + 1;
        });
      }
    });

    const genreDistribution = Object.entries(genreCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([genre, count]) => ({ 
        genre, 
        count, 
        percentage: (topArtists?.body?.items?.length || 0) > 0 ? Math.round((count / topArtists.body.items.length) * 100) : 0 
      }));

    // Listening time distribution (by hour and day)
    const hourDistribution = Array(24).fill(0);
    const dayDistribution = Array(7).fill(0);
    
    (recentlyPlayed?.body?.items || []).forEach(item => {
      if (item?.played_at) {
        const date = new Date(item.played_at);
        const hour = date.getHours();
        const day = date.getDay();
        hourDistribution[hour]++;
        dayDistribution[day]++;
      }
    });


    res.json({
      timeRange,
      timeRangeLabel: {
        'short_term': 'Last 4 Weeks',
        'medium_term': 'Last 6 Months',
        'long_term': 'All Time'
      }[timeRange],
      patterns: listeningPatterns,
      genreDistribution,
      hourDistribution: hourDistribution.map((count, hour) => ({ 
        hour: `${hour}:00`, 
        count 
      })),
      dayDistribution: dayDistribution.map((count, day) => ({
        day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day],
        count
      })),
      topTracks: (topTracks?.body?.items || []).slice(0, 20).map((track, index) => ({
        rank: index + 1,
        id: track?.id,
        name: track?.name || 'Unknown Track',
        artists: track?.artists?.map(a => a.name) || [],
        album: track?.album?.name || 'Unknown Album',
        popularity: track?.popularity || 0,
        duration: track?.duration_ms || 0,
      })),
      topArtists: (topArtists?.body?.items || []).slice(0, 20).map((artist, index) => ({
        rank: index + 1,
        id: artist?.id,
        name: artist?.name || 'Unknown Artist',
        genres: artist?.genres || [],
        popularity: artist?.popularity || 0,
        followers: artist?.followers?.total || 0,
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
 * @desc    Get currently playing track with ML mood analysis
 * @route   GET /api/dashboard/now-playing
 * @access  Protected
 */
export const getNowPlaying = async (req, res) => {
  try {
    const user = req.user;


    const spotifyApi = new SpotifyWebApi();
    spotifyApi.setAccessToken(user.accessToken);

    let nowPlayingAnalysis;
    let fallbackUsed = false;

    try {
      // Use ML service's currently playing analysis (HYBRID)
      nowPlayingAnalysis = await mlService.analyzeCurrentlyPlaying(
        user.accessToken,
        user._id.toString()
      );
    } catch (mlError) {
      console.warn('⚠️ ML service analyzeCurrentlyPlaying failed, trying Spotify direct fallback:', mlError.message);
      
      const currentlyPlaying = await spotifyApi.getMyCurrentPlayingTrack().catch(() => null);
      if (!currentlyPlaying || !currentlyPlaying.body || !currentlyPlaying.body.item) {
        return res.json({
          isPlaying: false,
          message: 'No track currently playing',
        });
      }
      
      const item = currentlyPlaying.body.item;
      const trackId = item.id;
      
      // Get audio features
      let features = null;
      try {
        const featResponse = await spotifyApi.getAudioFeaturesForTracks([trackId]);
        features = featResponse.body.audio_features?.[0] || null;
      } catch (featErr) {
        console.warn('⚠️ Failed to get audio features for fallback:', featErr.message);
      }
      
      // Infer mood
      const inferredMood = features ? inferMoodFromFeatures(features) : 'Unknown';
      
      nowPlayingAnalysis = {
        is_playing: currentlyPlaying.body.is_playing,
        track: {
          id: item.id,
          name: item.name,
          artists: item.artists.map(a => ({ id: a.id, name: a.name })),
          album: {
            name: item.album.name || item.album,
            images: item.album?.images || []
          },
          duration_ms: item.duration_ms,
          external_url: item.external_urls?.spotify || '',
          popularity: item.popularity || 50,
          images: item.album?.images || []
        },
        // progress_ms from Spotify is already the live current position —
        // no elapsed-time correction needed (see note in getDashboardOverview).
        progress_ms: currentlyPlaying.body.progress_ms || 0,
        device: currentlyPlaying.body.device || null,
        mood_analysis: inferredMood !== 'Unknown' ? {
          fused_mood: inferredMood,
          confidence: null,
          audio_mood: inferredMood,
          lyrics_mood: null,
          scores: { [inferredMood]: null },
          source: 'rule_based_fallback'
        } : null
      };
      fallbackUsed = true;
    }

    if (!nowPlayingAnalysis.is_playing) {
      return res.json({
        isPlaying: false,
        message: 'No track currently playing',
      });
    }

    
    res.json({
      isPlaying: nowPlayingAnalysis.is_playing,
      track: {
        id: nowPlayingAnalysis.track.id,
        name: nowPlayingAnalysis.track.name,
        artists: nowPlayingAnalysis.track.artists,
        album: {
          name: nowPlayingAnalysis.track.album.name || nowPlayingAnalysis.track.album,
          images: nowPlayingAnalysis.track.images || nowPlayingAnalysis.track.album?.images || [],
        },
        duration: nowPlayingAnalysis.track.duration_ms,
        progress: nowPlayingAnalysis.progress_ms,
        progressPercentage: nowPlayingAnalysis.track.duration_ms > 0 ? Math.round((nowPlayingAnalysis.progress_ms / nowPlayingAnalysis.track.duration_ms) * 100) : 0,
        externalUrl: nowPlayingAnalysis.track.external_url,
        popularity: nowPlayingAnalysis.track.popularity,
      },
      mood: {
        fused_mood: nowPlayingAnalysis.mood_analysis?.fused_mood || 'Unknown',
        confidence: nowPlayingAnalysis.mood_analysis?.confidence || 0,
        audio_mood: nowPlayingAnalysis.mood_analysis?.audio_mood || 'Unknown',
        lyrics_mood: nowPlayingAnalysis.mood_analysis?.lyrics_mood || 'Neutral',
        scores: nowPlayingAnalysis.mood_analysis?.scores || {}
      },
      device: nowPlayingAnalysis.device,
      context: nowPlayingAnalysis.context || null,
      timestamp: nowPlayingAnalysis.timestamp || new Date().toISOString(),
    });

  } catch (error) {
    console.error('❌ Now playing error:', error.message);
    
    if (error.statusCode === 401) {
      return res.status(401).json({ 
        message: 'Spotify token expired',
        code: 'SPOTIFY_TOKEN_EXPIRED'
      });
    }

    res.json({
      isPlaying: false,
      message: 'Unable to fetch currently playing track',
    });
  }
};

/**
 * @desc    Get personalized music recommendations with ML
 * @route   GET /api/dashboard/recommendations
 * @access  Protected
 */
export const getDashboardRecommendations = async (req, res) => {
  try {
    const user = req.user;
    const { limit = 20 } = req.query;


    // Use ML service for personalized recommendations
    const recommendations = await mlService.generatePersonalizedPlaylist(
      user._id.toString(),
      user.accessToken,
      parseInt(limit)
    );


    res.json({
      recommendations: recommendations.tracks || [],
      personalized: recommendations.personalized || false,
      userPreferences: recommendations.user_preferences || {},
      source: 'ml_personalized',
      total: recommendations.total || 0,
      message: recommendations.message,
    });

  } catch (error) {
    console.error('❌ Recommendations error:', error.message);
    
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
      message: 'Failed to fetch recommendations',
      error: error.message 
    });
  }
};