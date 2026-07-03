import axios from 'axios';
import * as cheerio from 'cheerio';
import { getFromCache, setInCache } from '../services/cacheService.js';

// Genius API key — from backend env (primary)
const GENIUS_KEY = (process.env.GENIUS_API_KEY || '').trim();

// =====================================================
// DIRECT GENIUS LYRICS FETCHING FROM NODE BACKEND
// No ML service dependency — pure Genius REST + scrape
// =====================================================

/**
 * Search Genius for a song and return top result metadata
 */
async function searchGenius(trackName, artistName) {
  const query = `${trackName} ${artistName}`;
  const response = await axios.get('https://api.genius.com/search', {
    headers: { Authorization: `Bearer ${GENIUS_KEY}` },
    params: { q: query },
    timeout: 10000
  });
  const hits = response.data?.response?.hits || [];
  if (hits.length === 0) return null;
  return hits[0].result; // { url, title, primary_artist, id, ... }
}

/**
 * Scrape lyrics text from a Genius song page URL
 */
async function scrapeLyricsFromGenius(songUrl) {
  const page = await axios.get(songUrl, {
    timeout: 12000,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MoodiQ/1.0)' }
  });
  const $ = cheerio.load(page.data);

  // Genius uses data-lyrics-container attribute on modern pages
  const containers = $('[data-lyrics-container="true"]');
  if (containers.length > 0) {
    const parts = [];
    containers.each((_, el) => {
      // Replace <br> with newlines before extracting text
      $(el).find('br').replaceWith('\n');
      parts.push($(el).text());
    });
    return parts.join('\n').trim();
  }

  // Fallback: older Genius page structure
  const lyricsDiv = $('.lyrics');
  if (lyricsDiv.length > 0) {
    return lyricsDiv.text().trim();
  }

  return null;
}

/**
 * Simple sentiment analysis using word lists (no ML service needed)
 */
function analyzeSentiment(lyrics) {
  if (!lyrics) return { label: 'Neutral', score: 0.5 };

  const positiveWords = ['love', 'happy', 'joy', 'smile', 'bright', 'beautiful', 'wonderful', 'amazing', 'great', 'good', 'hope', 'light', 'sunshine', 'dance', 'free', 'best', 'dream', 'feel', 'alive', 'win'];
  const negativeWords = ['sad', 'pain', 'hurt', 'cry', 'lonely', 'dark', 'broken', 'lost', 'fear', 'hate', 'wrong', 'bad', 'die', 'kill', 'tears', 'gone', 'never', 'miss', 'fall', 'fail'];

  const words = lyrics.toLowerCase().match(/\b\w+\b/g) || [];
  const total = words.length || 1;
  const posCount = words.filter(w => positiveWords.includes(w)).length;
  const negCount = words.filter(w => negativeWords.includes(w)).length;

  const score = (posCount - negCount) / total;
  const normalized = Math.min(1, Math.max(0, (score + 0.1) * 5));

  let label = 'Neutral';
  if (normalized > 0.6) label = 'Positive';
  else if (normalized < 0.4) label = 'Negative';

  return { label, score: parseFloat(normalized.toFixed(2)), posCount, negCount };
}

// =====================================================
// ROUTE HANDLERS
// =====================================================

/**
 * @desc    Get lyrics for a single track
 * @route   GET /api/lyrics/track/:trackId
 * @access  Protected
 */
export const getTrackLyrics = async (req, res) => {
  const { trackId } = req.params;
  const { trackName, artistName } = req.query;

  if (!trackName || !artistName) {
    return res.status(400).json({
      message: 'trackName and artistName query parameters are required'
    });
  }

  if (!GENIUS_KEY) {
    return res.status(503).json({
      message: 'Lyrics service not configured (missing GENIUS_API_KEY)',
      code: 'LYRICS_NOT_CONFIGURED'
    });
  }

  const cacheKey = `lyrics:${trackId || trackName}:${artistName}`;

  try {
    // Check cache first (7 day TTL for lyrics)
    const cached = await getFromCache(cacheKey).catch(() => null);
    if (cached) {
      console.log(`✅ Lyrics cache hit: ${trackName}`);
      return res.json(cached);
    }

    console.log(`🎤 Fetching lyrics: "${trackName}" by ${artistName}`);

    // 1. Search Genius
    const songResult = await searchGenius(trackName, artistName);
    if (!songResult) {
      return res.status(404).json({ message: 'Lyrics not found for this track', trackName, artistName });
    }

    // 2. Scrape lyrics
    const rawLyrics = await scrapeLyricsFromGenius(songResult.url);
    if (!rawLyrics) {
      return res.status(404).json({
        message: 'Lyrics page found but content unavailable',
        geniusUrl: songResult.url
      });
    }

    // 3. Sentiment analysis
    const sentiment = analyzeSentiment(rawLyrics);

    const result = {
      trackId: trackId || null,
      trackName,
      artistName,
      lyrics: rawLyrics,
      source: 'genius',
      geniusUrl: songResult.url,
      geniusTitle: songResult.title,
      sentiment,
      syncedLyrics: null,
    };

    // Cache for 7 days
    await setInCache(cacheKey, result, 604800).catch(() => {});
    console.log(`✅ Lyrics fetched: "${trackName}" (${rawLyrics.length} chars)`);
    res.json(result);

  } catch (err) {
    console.error('❌ Lyrics fetch error:', err.message);

    if (err.response?.status === 401) {
      return res.status(503).json({
        message: 'Genius API authentication failed. Check GENIUS_API_KEY.',
        code: 'GENIUS_AUTH_ERROR'
      });
    }

    if (err.response?.status === 404) {
      return res.status(404).json({ message: 'Lyrics not found' });
    }

    // Genius scraping blocked or timeout — return graceful response
    return res.status(404).json({
      message: 'Could not retrieve lyrics for this track',
      reason: err.message
    });
  }
};

/**
 * @desc    Analyze lyrics for multiple tracks (batch)
 * @route   POST /api/lyrics/analyze
 * @access  Protected
 */
export const analyzeLyrics = async (req, res) => {
  const { tracks } = req.body;

  if (!tracks || !Array.isArray(tracks)) {
    return res.status(400).json({ message: 'tracks array is required' });
  }

  try {
    console.log(`📝 Analyzing lyrics for ${tracks.length} tracks (direct Genius)`);

    if (!GENIUS_KEY) {
      return res.json({
        message: 'Lyrics analysis unavailable (missing GENIUS_API_KEY)',
        status: 'unavailable',
        lyricsData: [],
        sentimentScores: { average: 0, positive: 0, negative: 0, neutral: tracks.length },
        themes: [],
        keywords: []
      });
    }

    const limit = Math.min(tracks.length, 10); // Limit to 10 for speed
    const lyricsData = [];
    let posCount = 0, negCount = 0, neutralCount = 0;
    const allWords = [];

    for (const track of tracks.slice(0, limit)) {
      try {
        const songResult = await searchGenius(track.name || track.track, track.artist || 'Unknown');
        if (!songResult) {
          lyricsData.push({ track: track.name || track.track, artist: track.artist, status: 'not_found' });
          neutralCount++;
          continue;
        }

        const rawLyrics = await scrapeLyricsFromGenius(songResult.url);
        const sentiment = analyzeSentiment(rawLyrics);

        if (sentiment.label === 'Positive') posCount++;
        else if (sentiment.label === 'Negative') negCount++;
        else neutralCount++;

        // Collect words for keywords
        if (rawLyrics) {
          const words = rawLyrics.toLowerCase().match(/\b[a-z]{4,}\b/g) || [];
          allWords.push(...words);
        }

        lyricsData.push({
          track: track.name || track.track,
          artist: track.artist,
          sentiment,
          status: 'analyzed',
          geniusUrl: songResult.url
        });
      } catch (trackErr) {
        lyricsData.push({ track: track.name || track.track, artist: track.artist, status: 'error', error: trackErr.message });
        neutralCount++;
      }
    }

    // Build keyword frequency
    const stopWords = new Set(['that', 'this', 'with', 'from', 'your', 'have', 'more', 'when', 'they', 'will', 'been', 'what', 'were', 'their', 'know', 'like', 'just', 'come', 'back']);
    const wordFreq = {};
    allWords.filter(w => !stopWords.has(w)).forEach(w => {
      wordFreq[w] = (wordFreq[w] || 0) + 1;
    });
    const topKeywords = Object.entries(wordFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([word]) => word);

    // Infer themes from keywords
    const themeMap = {
      'Love': ['love', 'heart', 'baby', 'mine', 'kiss', 'beautiful'],
      'Party': ['night', 'dance', 'party', 'drink', 'club', 'music'],
      'Heartbreak': ['pain', 'hurt', 'broken', 'tears', 'gone', 'miss'],
      'Motivation': ['rise', 'dream', 'strong', 'fight', 'believe', 'power'],
      'Life': ['life', 'live', 'world', 'time', 'days', 'years'],
    };
    const themes = Object.entries(themeMap)
      .filter(([, keywords]) => keywords.some(kw => topKeywords.includes(kw)))
      .map(([theme]) => theme);

    const totalAnalyzed = lyricsData.filter(d => d.status === 'analyzed').length;
    const avgSentiment = totalAnalyzed > 0 ? parseFloat((posCount / totalAnalyzed).toFixed(2)) : 0;

    console.log(`✅ Analyzed ${lyricsData.length} tracks: ${posCount} positive, ${negCount} negative`);

    res.json({
      lyricsData,
      sentimentScores: {
        average: avgSentiment,
        positive: posCount,
        negative: negCount,
        neutral: neutralCount,
        total: lyricsData.length
      },
      themes,
      keywords: topKeywords
    });

  } catch (err) {
    console.error('❌ Lyrics analysis error:', err.message);
    res.json({
      message: 'Lyrics analysis encountered an error',
      status: 'partial',
      lyricsData: [],
      sentimentScores: { average: 0, positive: 0, negative: 0, neutral: 0 },
      themes: [],
      keywords: []
    });
  }
};

/**
 * @desc    Get lyrics with sentiment analysis
 * @route   POST /api/lyrics/sentiment
 * @access  Protected
 */
export const getLyricsSentiment = async (req, res) => {
  const { trackName, artistName } = req.body;

  if (!trackName || !artistName) {
    return res.status(400).json({ message: 'trackName and artistName are required' });
  }

  try {
    console.log(`💭 Lyrics sentiment: "${trackName}" by ${artistName}`);

    if (!GENIUS_KEY) {
      return res.status(503).json({ message: 'Lyrics service not configured', code: 'LYRICS_NOT_CONFIGURED' });
    }

    const cacheKey = `lyrics:sentiment:${trackName}:${artistName}`;
    const cached = await getFromCache(cacheKey).catch(() => null);
    if (cached) return res.json(cached);

    const songResult = await searchGenius(trackName, artistName);
    if (!songResult) {
      return res.status(404).json({ message: 'Lyrics not found for this track' });
    }

    const rawLyrics = await scrapeLyricsFromGenius(songResult.url);
    const sentiment = analyzeSentiment(rawLyrics);

    // Simple mood inference from sentiment
    let mood = 'Neutral';
    if (sentiment.label === 'Positive') mood = sentiment.score > 0.75 ? 'Joyful' : 'Happy';
    else if (sentiment.label === 'Negative') mood = sentiment.score < 0.25 ? 'Melancholic' : 'Sad';

    const result = { trackName, artistName, lyrics: rawLyrics, sentiment, mood, language: 'en', translated: false };
    await setInCache(cacheKey, result, 604800).catch(() => {});
    res.json(result);

  } catch (err) {
    console.error('❌ Lyrics sentiment error:', err.message);
    res.status(500).json({ message: 'Failed to fetch lyrics sentiment', error: err.message });
  }
};

/**
 * @desc    Search lyrics by query
 * @route   GET /api/lyrics/search
 * @access  Protected
 */
export const searchLyrics = async (req, res) => {
  const { query, limit = 10 } = req.query;

  if (!query) return res.status(400).json({ message: 'Search query is required' });

  if (!GENIUS_KEY) {
    return res.status(503).json({ message: 'Lyrics service not configured', code: 'LYRICS_NOT_CONFIGURED' });
  }

  try {
    console.log(`🔍 Searching Genius: "${query}"`);

    const response = await axios.get('https://api.genius.com/search', {
      headers: { Authorization: `Bearer ${GENIUS_KEY}` },
      params: { q: query, per_page: Math.min(parseInt(limit), 20) },
      timeout: 10000
    });

    const hits = response.data?.response?.hits || [];
    const results = hits.map(hit => ({
      id: hit.result.id,
      title: hit.result.title,
      artist: hit.result.primary_artist?.name || 'Unknown',
      url: hit.result.url,
      thumbnail: hit.result.song_art_image_thumbnail_url,
      snippet: hit.result.full_title
    }));

    console.log(`✅ Genius search: ${results.length} results`);
    res.json({ query, results, total: results.length });

  } catch (err) {
    console.error('❌ Lyrics search error:', err.message);
    res.status(500).json({ message: 'Failed to search lyrics', error: err.message });
  }
};
