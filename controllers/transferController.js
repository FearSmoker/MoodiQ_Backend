import { google } from 'googleapis';
import axios from 'axios';
import { broadcastUpdate } from '../services/socketService.js';

const APPLE_MUSIC_API_URL = 'https://api.music.apple.com/v1';

/**
 * Search for a track on YouTube Music
 */
const searchTrackOnYouTube = async (trackName, artistName, accessToken) => {
  try {
    const youtube = google.youtube('v3');
    const query = `${trackName} ${artistName} official audio`;
    
    const searchResponse = await youtube.search.list({
      part: 'snippet',
      q: query,
      type: 'video',
      videoCategoryId: '10', // Music category
      maxResults: 1,
      access_token: accessToken,
    });

    if (searchResponse.data.items && searchResponse.data.items.length > 0) {
      return searchResponse.data.items[0].id.videoId;
    }

    return null;
  } catch (err) {
    console.error(`YouTube search error for ${trackName}:`, err.message);
    throw err;
  }
};

/**
 * Search for a track on Apple Music
 */
const searchTrackOnAppleMusic = async (trackName, artistName, userToken, developerToken) => {
  try {
    const query = `${trackName} ${artistName}`;
    
    const response = await axios.get(`${APPLE_MUSIC_API_URL}/catalog/us/search`, {
      params: {
        term: query,
        types: 'songs',
        limit: 1,
      },
      headers: {
        'Authorization': `Bearer ${developerToken}`,
        'Music-User-Token': userToken,
      },
    });

    if (response.data.results?.songs?.data && response.data.results.songs.data.length > 0) {
      return response.data.results.songs.data[0].id;
    }

    return null;
  } catch (err) {
    console.error(`Apple Music search error for ${trackName}:`, err.message);
    throw err;
  }
};

/**
 * Create a playlist on YouTube Music
 */
const createYouTubePlaylist = async (playlistName, videoIds, accessToken) => {
  try {
    const youtube = google.youtube('v3');
    
    // Create playlist
    const playlistResponse = await youtube.playlists.insert({
      part: 'snippet,status',
      requestBody: {
        snippet: {
          title: playlistName,
          description: 'Created by Moodify-AI',
        },
        status: {
          privacyStatus: 'private', // Can be 'public', 'private', or 'unlisted'
        },
      },
      access_token: accessToken,
    });

    const playlistId = playlistResponse.data.id;

    // Add videos to playlist
    for (const videoId of videoIds) {
      try {
        await youtube.playlistItems.insert({
          part: 'snippet',
          requestBody: {
            snippet: {
              playlistId: playlistId,
              resourceId: {
                kind: 'youtube#video',
                videoId: videoId,
              },
            },
          },
          access_token: accessToken,
        });
      } catch (itemErr) {
        console.error(`Failed to add video ${videoId}:`, itemErr.message);
      }
    }

    return {
      success: true,
      playlistId: playlistId,
      playlistUrl: `https://www.youtube.com/playlist?list=${playlistId}`,
    };
  } catch (err) {
    console.error('YouTube playlist creation error:', err.message);
    throw err;
  }
};

/**
 * Create a playlist on Apple Music
 */
const createAppleMusicPlaylist = async (playlistName, trackIds, userToken, developerToken) => {
  try {
    // Create playlist
    const createResponse = await axios.post(
      `${APPLE_MUSIC_API_URL}/me/library/playlists`,
      {
        attributes: {
          name: playlistName,
          description: 'Created by Moodify-AI',
        },
      },
      {
        headers: {
          'Authorization': `Bearer ${developerToken}`,
          'Music-User-Token': userToken,
          'Content-Type': 'application/json',
        },
      }
    );

    const playlistId = createResponse.data.data[0].id;

    // Add tracks to playlist
    if (trackIds.length > 0) {
      const tracksData = trackIds.map((trackId) => ({
        id: trackId,
        type: 'songs',
      }));

      await axios.post(
        `${APPLE_MUSIC_API_URL}/me/library/playlists/${playlistId}/tracks`,
        {
          data: tracksData,
        },
        {
          headers: {
            'Authorization': `Bearer ${developerToken}`,
            'Music-User-Token': userToken,
            'Content-Type': 'application/json',
          },
        }
      );
    }

    return {
      success: true,
      playlistId: playlistId,
      playlistUrl: `https://music.apple.com/library/playlist/${playlistId}`,
    };
  } catch (err) {
    console.error('Apple Music playlist creation error:', err.message);
    throw err;
  }
};

/**
 * Generic handler for transferring a playlist to a service
 */
const handleTransfer = async (req, res, service) => {
  const { playlistName, tracks } = req.body;

  if (!playlistName) {
    return res.status(400).json({ message: 'Playlist name is required' });
  }

  if (!tracks || !Array.isArray(tracks) || tracks.length === 0) {
    return res.status(400).json({ message: 'Tracks array is required' });
  }

  // Check authentication
  const userAuthTokens = req.user.authTokens?.get(service);
  
  if (!userAuthTokens || !userAuthTokens.accessToken) {
    return res.status(401).json({ 
      message: `Not authenticated with ${service}. Please connect your ${service} account first.`,
      needsAuth: true,
    });
  }

  const user = req.user;
  const maxRetries = 3;
  const serviceTrackIds = [];
  const failedTracks = [];

  try {
    broadcastUpdate({
      type: 'transfer_started',
      userId: user._id.toString(),
      service: service,
      totalTracks: tracks.length,
    });

    // Search for each track
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      
      broadcastUpdate({
        type: 'transfer_progress',
        userId: user._id.toString(),
        service: service,
        song: track.name,
        artist: track.artist || track.artists?.join(', '),
        progress: Math.round((i / tracks.length) * 100),
        status: 'searching',
      });

      let trackId = null;
      let success = false;

      // Retry logic
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          if (service === 'youtube') {
            trackId = await searchTrackOnYouTube(
              track.name,
              track.artist || track.artists?.join(', '),
              userAuthTokens.accessToken
            );
          } else if (service === 'apple') {
            const developerToken = process.env.APPLE_DEVELOPER_TOKEN;
            if (!developerToken) {
              throw new Error('Apple Developer Token not configured');
            }
            trackId = await searchTrackOnAppleMusic(
              track.name,
              track.artist || track.artists?.join(', '),
              userAuthTokens.accessToken,
              developerToken
            );
          }

          if (trackId) {
            success = true;
            break;
          }
        } catch (err) {
          console.error(`Attempt ${attempt} failed for ${track.name}:`, err.message);
          if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 500 * attempt));
          }
        }
      }

      if (success && trackId) {
        serviceTrackIds.push(trackId);
        broadcastUpdate({
          type: 'transfer_progress',
          userId: user._id.toString(),
          service: service,
          song: track.name,
          progress: Math.round(((i + 1) / tracks.length) * 100),
          status: 'found',
        });
      } else {
        failedTracks.push(track.name);
        console.warn(`Failed to find ${track.name} on ${service} after ${maxRetries} attempts`);
        broadcastUpdate({
          type: 'transfer_progress',
          userId: user._id.toString(),
          service: service,
          song: track.name,
          progress: Math.round(((i + 1) / tracks.length) * 100),
          status: 'failed',
        });
      }
    }

    // Create playlist
    broadcastUpdate({
      type: 'transfer_progress',
      userId: user._id.toString(),
      service: service,
      status: 'creating_playlist',
      progress: 95,
    });

    let result;
    if (service === 'youtube') {
      result = await createYouTubePlaylist(
        playlistName,
        serviceTrackIds,
        userAuthTokens.accessToken
      );
    } else if (service === 'apple') {
      const developerToken = process.env.APPLE_DEVELOPER_TOKEN;
      result = await createAppleMusicPlaylist(
        playlistName,
        serviceTrackIds,
        userAuthTokens.accessToken,
        developerToken
      );
    }

    broadcastUpdate({
      type: 'transfer_complete',
      userId: user._id.toString(),
      service: service,
      url: result.playlistUrl,
      successCount: serviceTrackIds.length,
      failedCount: failedTracks.length,
    });

    res.json({
      success: true,
      playlistUrl: result.playlistUrl,
      playlistId: result.playlistId,
      tracksAdded: serviceTrackIds.length,
      tracksFailed: failedTracks.length,
      failedTracks: failedTracks,
    });

  } catch (err) {
    console.error(`Transfer to ${service} failed:`, err.message);
    
    broadcastUpdate({
      type: 'transfer_error',
      userId: user._id.toString(),
      service: service,
      message: err.message,
    });

    res.status(500).json({ 
      message: `Transfer to ${service} failed: ${err.message}`,
      tracksAdded: serviceTrackIds.length,
      tracksFailed: failedTracks.length,
    });
  }
};

// --- Exported Route Handlers ---

/**
 * @desc    Transfer playlist to YouTube Music
 * @route   POST /api/transfer/youtube
 * @access  Protected
 */
export const transferToYouTube = (req, res) => handleTransfer(req, res, 'youtube');

/**
 * @desc    Transfer playlist to Apple Music
 * @route   POST /api/transfer/apple
 * @access  Protected
 */
export const transferToApple = (req, res) => handleTransfer(req, res, 'apple');

/**
 * @desc    Get transfer status
 * @route   GET /api/transfer/status
 * @access  Protected
 */
export const getTransferStatus = async (req, res) => {
  try {
    const linkedServices = [];
    
    if (req.user.authTokens) {
      if (req.user.authTokens.get('youtube')) {
        linkedServices.push('youtube');
      }
      if (req.user.authTokens.get('apple')) {
        linkedServices.push('apple');
      }
    }

    res.json({
      linkedServices,
      availableServices: ['youtube', 'apple'],
    });
  } catch (err) {
    console.error('Error getting transfer status:', err.message);
    res.status(500).json({ message: 'Failed to get transfer status' });
  }
};