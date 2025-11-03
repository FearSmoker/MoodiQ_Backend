import SpotifyWebApi from 'spotify-web-api-node';

/**
 * @desc    Get real-time listening analytics
 * @route   GET /api/realtime/current
 * @access  Protected
 */
export const getCurrentAnalytics = async (req, res) => {
  try {
    const spotifyApi = new SpotifyWebApi();
    spotifyApi.setAccessToken(req.user.accessToken);

    // Get currently playing
    const currentlyPlaying = await spotifyApi.getMyCurrentPlayingTrack();

    if (!currentlyPlaying.body || !currentlyPlaying.body.item) {
      return res.json({
        isPlaying: false,
        message: 'No track currently playing',
      });
    }

    const track = currentlyPlaying.body.item;
    
    // Get audio features
    const features = await spotifyApi.getAudioFeaturesForTrack(track.id);

    // Calculate real-time mood
    const mood = calculateRealtimeMood(features.body);

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
      features: features.body,
      mood: mood,
      device: {
        name: currentlyPlaying.body.device?.name,
        type: currentlyPlaying.body.device?.type,
        volume: currentlyPlaying.body.device?.volume_percent,
      },
      timestamp: new Date().toISOString(),
    });

  } catch (err) {
    console.error('Error fetching current analytics:', err.message);
    
    if (err.statusCode === 401) {
      return res.status(401).json({ 
        message: 'Spotify token expired',
        code: 'SPOTIFY_TOKEN_EXPIRED'
      });
    }

    res.status(500).json({ message: 'Failed to fetch current analytics' });
  }
};

function calculateRealtimeMood(features) {
  const valence = features.valence;
  const energy = features.energy;
  
  if (valence > 0.7 && energy > 0.6) return 'Happy';
  if (valence < 0.3 && energy < 0.4) return 'Sad';
  if (energy > 0.8) return 'Energetic';
  if (energy < 0.3 && valence > 0.5) return 'Calm';
  if (valence < 0.3 && energy > 0.6) return 'Intense';
  return 'Neutral';
}

/**
 * @desc    Get listening history with mood timeline
 * @route   GET /api/realtime/history
 * @access  Protected
 */
export const getListeningHistory = async (req, res) => {
  const { limit = 50, timeRange = '24h' } = req.query;

  try {
    const spotifyApi = new SpotifyWebApi();
    spotifyApi.setAccessToken(req.user.accessToken);

    // Get recently played tracks
    const recentlyPlayed = await spotifyApi.getMyRecentlyPlayedTracks({ 
      limit: parseInt(limit) 
    });

    // Get audio features for all tracks
    const trackIds = recentlyPlayed.body.items.map(item => item.track.id);
    const audioFeatures = await spotifyApi.getAudioFeaturesForTracks(trackIds);

    // Combine data with mood analysis
    const history = recentlyPlayed.body.items.map((item, index) => ({
      playedAt: item.played_at,
      track: {
        id: item.track.id,
        name: item.track.name,
        artists: item.track.artists.map(a => a.name),
        album: item.track.album.name,
        duration: item.track.duration_ms,
      },
      features: audioFeatures.body.audio_features[index],
      mood: calculateRealtimeMood(audioFeatures.body.audio_features[index]),
    }));

    // Calculate timeline statistics
    const moodTimeline = calculateMoodTimeline(history);

    res.json({
      history: history,
      timeline: moodTimeline,
      statistics: {
        totalTracks: history.length,
        timeRange: timeRange,
        avgValence: history.reduce((sum, h) => sum + h.features.valence, 0) / history.length,
        avgEnergy: history.reduce((sum, h) => sum + h.features.energy, 0) / history.length,
      },
    });

  } catch (err) {
    console.error('Error fetching listening history:', err.message);
    
    if (err.statusCode === 401) {
      return res.status(401).json({ 
        message: 'Spotify token expired',
        code: 'SPOTIFY_TOKEN_EXPIRED'
      });
    }

    res.status(500).json({ message: 'Failed to fetch listening history' });
  }
};

function calculateMoodTimeline(history) {
  const timeline = [];
  let currentMood = null;
  let moodStart = null;
  let moodDuration = 0;

  history.forEach((item, index) => {
    if (item.mood !== currentMood) {
      if (currentMood) {
        timeline.push({
          mood: currentMood,
          start: moodStart,
          duration: moodDuration,
          trackCount: Math.floor(moodDuration / (3 * 60 * 1000)), // Estimate
        });
      }
      currentMood = item.mood;
      moodStart = item.playedAt;
      moodDuration = item.track.duration;
    } else {
      moodDuration += item.track.duration;
    }
  });

  if (currentMood) {
    timeline.push({
      mood: currentMood,
      start: moodStart,
      duration: moodDuration,
      trackCount: Math.floor(moodDuration / (3 * 60 * 1000)),
    });
  }

  return timeline;
}