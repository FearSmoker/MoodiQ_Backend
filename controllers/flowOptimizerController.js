import SpotifyWebApi from 'spotify-web-api-node';
import axios from 'axios';

const ML_API_URL = process.env.ML_API_URL || 'http://localhost:8000';

/**
 * @desc    Optimize playlist flow with ML
 * @route   POST /api/flow/optimize
 * @access  Protected
 */
export const optimizePlaylistFlow = async (req, res) => {
  const { tracks, startMood, endMood, algorithm = 'dynamic_programming' } = req.body;

  if (!tracks || !Array.isArray(tracks) || tracks.length === 0) {
    return res.status(400).json({ message: 'Tracks array is required' });
  }

  try {
    // Call ML API's Flow Optimizer
    const flowResponse = await axios.post(`${ML_API_URL}/optimize/flow`, {
      tracks,
      start_mood: startMood || null,
      end_mood: endMood || null,
      algorithm,
      user_id: req.user._id.toString(),
    }, {
      timeout: 30000
    });

    res.json({
      optimizedOrder: flowResponse.data.optimizedOrder,
      flowScore: flowResponse.data.flowScore,
      transitions: flowResponse.data.transitions,
    });

  } catch (err) {
    console.error('Error optimizing playlist flow:', err.message);
    
    // Fallback: Simple energy-based optimization
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
      const optimized = simpleEnergyOptimization(tracks, startMood, endMood);
      return res.json({
        optimizedOrder: optimized.order,
        flowScore: optimized.score,
        transitions: optimized.transitions,
        source: 'fallback',
        message: 'Using fallback optimization (ML service unavailable)'
      });
    }
    
    if (err.response) {
      return res.status(err.response.status).json({ 
        message: 'ML API error: ' + (err.response.data?.message || err.message) 
      });
    }
    
    res.status(500).json({ message: 'Failed to optimize playlist flow' });
  }
};

// Simple fallback optimization based on energy levels
function simpleEnergyOptimization(tracks, startMood, endMood) {
  const tracksCopy = tracks.map((t, idx) => ({ ...t, originalIndex: idx }));
  
  // Sort by energy for smooth transition
  tracksCopy.sort((a, b) => {
    const energyA = a.features?.energy || 0.5;
    const energyB = b.features?.energy || 0.5;
    return energyA - energyB;
  });

  const order = tracksCopy.map(t => t.originalIndex);
  const score = calculateFlowScore(tracksCopy);
  const transitions = calculateTransitions(tracksCopy);

  return { order, score, transitions };
}

function calculateFlowScore(tracks) {
  let totalDiff = 0;
  for (let i = 0; i < tracks.length - 1; i++) {
    const energyDiff = Math.abs(
      (tracks[i].features?.energy || 0.5) - 
      (tracks[i + 1].features?.energy || 0.5)
    );
    totalDiff += energyDiff;
  }
  return Math.max(0, 100 - (totalDiff / tracks.length) * 100);
}

function calculateTransitions(tracks) {
  const transitions = [];
  for (let i = 0; i < tracks.length - 1; i++) {
    transitions.push({
      from: i,
      to: i + 1,
      smoothness: 1 - Math.abs(
        (tracks[i].features?.energy || 0.5) - 
        (tracks[i + 1].features?.energy || 0.5)
      )
    });
  }
  return transitions;
}

/**
 * @desc    Apply optimized order to Spotify playlist
 * @route   PUT /api/flow/apply/:playlistId
 * @access  Protected
 */
export const applyOptimizedFlow = async (req, res) => {
  const { playlistId } = req.params;
  const { trackUris } = req.body;

  if (!trackUris || !Array.isArray(trackUris)) {
    return res.status(400).json({ message: 'Track URIs array is required' });
  }

  try {
    const spotifyApi = new SpotifyWebApi();
    spotifyApi.setAccessToken(req.user.accessToken);
    
    // Replace all tracks with new order
    await spotifyApi.replaceTracksInPlaylist(playlistId, trackUris);

    res.json({ 
      success: true, 
      message: 'Playlist flow applied successfully',
      trackCount: trackUris.length 
    });

  } catch (err) {
    console.error('Error applying optimized flow:', err.message);
    res.status(500).json({ message: 'Failed to apply optimized flow' });
  }
};