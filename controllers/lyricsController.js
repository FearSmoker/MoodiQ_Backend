import axios from 'axios';
import * as cheerio from 'cheerio';
import { getFromCache, setInCache } from '../services/cacheService.js';

const GENIUS_KEY = (process.env.GENIUS_API_KEY || '').trim();
const GEMINI_KEY = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();

// Gemini model — same as Python gemini_service.py uses
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// ── Genius helpers ─────────────────────────────────────────────────────────

async function searchGenius(trackName, artistName) {
  if (!GENIUS_KEY) return null;
  try {
    const query = `${trackName} ${artistName}`;
    const response = await axios.get('https://api.genius.com/search', {
      headers: { Authorization: `Bearer ${GENIUS_KEY}` },
      params: { q: query },
      timeout: 10000
    });
    const hits = response.data?.response?.hits || [];
    if (hits.length === 0) return null;
    return hits[0].result;
  } catch (err) {
    console.warn('⚠️ Genius search failed:', err.message);
    return null;
  }
}

async function scrapeLyricsFromGenius(songUrl) {
  try {
    const page = await axios.get(songUrl, {
      timeout: 12000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MoodiQ/1.0)' }
    });
    const $ = cheerio.load(page.data);

    // modern Genius uses data-lyrics-container
    const containers = $('[data-lyrics-container="true"]');
    if (containers.length > 0) {
      const parts = [];
      containers.each((_, el) => {
        $(el).find('br').replaceWith('\n');
        parts.push($(el).text());
      });
      const text = parts.join('\n').trim();
      if (text.length > 50) return text;
    }

    // fallback: older Genius page structure
    const lyricsDiv = $('.lyrics');
    if (lyricsDiv.length > 0) {
      const text = lyricsDiv.text().trim();
      if (text.length > 50) return text;
    }

    return null;
  } catch (err) {
    console.warn('⚠️ Genius scrape failed:', err.message);
    return null;
  }
}

// ── Gemini fallback ────────────────────────────────────────────────────────

async function fetchLyricsFromGemini(trackName, artistName) {
  if (!GEMINI_KEY) return null;

  try {
    console.log(`🤖 Gemini lyrics fallback: "${trackName}" by ${artistName}`);

    const prompt = `You are a lyrics database assistant. Provide the complete, accurate lyrics for the song "${trackName}" by ${artistName}.

If you know the lyrics, return them in full, formatted with line breaks between verses and a blank line between sections (like [Verse], [Chorus], etc.). 
If you do not know or are not confident, return exactly: NOT_FOUND

Return ONLY the lyrics text (or NOT_FOUND), no other commentary.`;

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 2048 }
      },
      { timeout: 20000 }
    );

    const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

    if (!text || text === 'NOT_FOUND' || text.startsWith('NOT_FOUND')) {
      console.log(`ℹ️ Gemini: lyrics not found for "${trackName}"`);
      return null;
    }

    if (text.length < 30) return null;

    console.log(`✅ Gemini lyrics fetched (${text.length} chars)`);
    return text;

  } catch (err) {
    // handle quota / auth errors gracefully
    if (err.response?.status === 429) {
      console.warn('⚠️ Gemini rate limit hit — skipping lyrics fallback');
    } else if (err.response?.status === 400 || err.response?.status === 403) {
      console.warn('⚠️ Gemini auth/config error:', err.response?.data?.error?.message || err.message);
    } else {
      console.warn('⚠️ Gemini lyrics fallback error:', err.message);
    }
    return null;
  }
}

// ── Sentiment analysis ─────────────────────────────────────────────────────

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

// ── Route handlers ─────────────────────────────────────────────────────────

export const getTrackLyrics = async (req, res) => {
  const { trackId } = req.params;
  const { trackName, artistName } = req.query;

  if (!trackName || !artistName) {
    return res.status(400).json({
      message: 'trackName and artistName query parameters are required'
    });
  }

  const cacheKey = `lyrics:${trackId || trackName}:${artistName}`;

  try {
    // check cache first (7 day TTL)
    const cached = await getFromCache(cacheKey).catch(() => null);
    if (cached) {
      console.log(`✅ Lyrics cache hit: ${trackName}`);
      return res.json(cached);
    }

    console.log(`🎤 Fetching lyrics: "${trackName}" by ${artistName}`);

    let rawLyrics = null;
    let source = null;
    let geniusUrl = null;

    // try Genius first
    if (GENIUS_KEY) {
      const songResult = await searchGenius(trackName, artistName);
      if (songResult) {
        geniusUrl = songResult.url;
        rawLyrics = await scrapeLyricsFromGenius(songResult.url);
        if (rawLyrics) source = 'genius';
      }
    }

    // fallback to Gemini if Genius failed or no key
    if (!rawLyrics && GEMINI_KEY) {
      rawLyrics = await fetchLyricsFromGemini(trackName, artistName);
      if (rawLyrics) source = 'gemini';
    }

    if (!rawLyrics) {
      return res.status(404).json({
        message: 'Lyrics not found for this track',
        trackName,
        artistName,
        geniusConfigured: !!GENIUS_KEY,
        geminiConfigured: !!GEMINI_KEY
      });
    }

    const sentiment = analyzeSentiment(rawLyrics);

    const result = {
      trackId: trackId || null,
      trackName,
      artistName,
      lyrics: rawLyrics,
      source,
      geniusUrl: geniusUrl || null,
      sentiment,
      syncedLyrics: null,
    };

    // cache for 7 days
    await setInCache(cacheKey, result, 604800).catch(() => {});
    console.log(`✅ Lyrics fetched via ${source}: "${trackName}" (${rawLyrics.length} chars)`);
    res.json(result);

  } catch (err) {
    console.error('❌ Lyrics fetch error:', err.message);
    return res.status(500).json({
      message: 'Failed to fetch lyrics',
      error: err.message
    });
  }
};

export const analyzeLyrics = async (req, res) => {
  const { tracks } = req.body;

  if (!tracks || !Array.isArray(tracks)) {
    return res.status(400).json({ message: 'tracks array is required' });
  }

  if (!GENIUS_KEY && !GEMINI_KEY) {
    return res.json({
      message: 'Lyrics analysis unavailable — configure GENIUS_API_KEY or GEMINI_API_KEY',
      status: 'unavailable',
      lyricsData: [],
      sentimentScores: { average: 0, positive: 0, negative: 0, neutral: tracks.length },
      themes: [],
      keywords: []
    });
  }

  try {
    console.log(`📝 Analyzing lyrics for ${tracks.length} tracks`);

    const limit = Math.min(tracks.length, 10);
    const lyricsData = [];
    let posCount = 0, negCount = 0, neutralCount = 0;
    const allWords = [];

    for (const track of tracks.slice(0, limit)) {
      try {
        const name = track.name || track.track;
        const artist = track.artist || 'Unknown';
        let rawLyrics = null;
        let source = null;

        // try Genius
        if (GENIUS_KEY) {
          const songResult = await searchGenius(name, artist);
          if (songResult) {
            rawLyrics = await scrapeLyricsFromGenius(songResult.url);
            if (rawLyrics) source = 'genius';
          }
        }

        // fallback to Gemini
        if (!rawLyrics && GEMINI_KEY) {
          rawLyrics = await fetchLyricsFromGemini(name, artist);
          if (rawLyrics) source = 'gemini';
        }

        if (!rawLyrics) {
          lyricsData.push({ track: name, artist, status: 'not_found' });
          neutralCount++;
          continue;
        }

        const sentiment = analyzeSentiment(rawLyrics);

        if (sentiment.label === 'Positive') posCount++;
        else if (sentiment.label === 'Negative') negCount++;
        else neutralCount++;

        if (rawLyrics) {
          const words = rawLyrics.toLowerCase().match(/\b[a-z]{4,}\b/g) || [];
          allWords.push(...words);
        }

        lyricsData.push({ track: name, artist, sentiment, status: 'analyzed', source });
      } catch (trackErr) {
        lyricsData.push({ track: track.name || track.track, artist: track.artist, status: 'error', error: trackErr.message });
        neutralCount++;
      }
    }

    // keyword frequency
    const stopWords = new Set(['that', 'this', 'with', 'from', 'your', 'have', 'more', 'when', 'they', 'will', 'been', 'what', 'were', 'their', 'know', 'like', 'just', 'come', 'back']);
    const wordFreq = {};
    allWords.filter(w => !stopWords.has(w)).forEach(w => {
      wordFreq[w] = (wordFreq[w] || 0) + 1;
    });
    const topKeywords = Object.entries(wordFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([word]) => word);

    // theme inference
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

export const getLyricsSentiment = async (req, res) => {
  const { trackName, artistName } = req.body;

  if (!trackName || !artistName) {
    return res.status(400).json({ message: 'trackName and artistName are required' });
  }

  if (!GENIUS_KEY && !GEMINI_KEY) {
    return res.status(503).json({ message: 'Lyrics service not configured', code: 'LYRICS_NOT_CONFIGURED' });
  }

  try {
    console.log(`💭 Lyrics sentiment: "${trackName}" by ${artistName}`);

    const cacheKey = `lyrics:sentiment:${trackName}:${artistName}`;
    const cached = await getFromCache(cacheKey).catch(() => null);
    if (cached) return res.json(cached);

    let rawLyrics = null;
    let source = null;

    if (GENIUS_KEY) {
      const songResult = await searchGenius(trackName, artistName);
      if (songResult) {
        rawLyrics = await scrapeLyricsFromGenius(songResult.url);
        if (rawLyrics) source = 'genius';
      }
    }

    if (!rawLyrics && GEMINI_KEY) {
      rawLyrics = await fetchLyricsFromGemini(trackName, artistName);
      if (rawLyrics) source = 'gemini';
    }

    if (!rawLyrics) {
      return res.status(404).json({ message: 'Lyrics not found for this track' });
    }

    const sentiment = analyzeSentiment(rawLyrics);

    // simple mood inference
    let mood = 'Neutral';
    if (sentiment.label === 'Positive') mood = sentiment.score > 0.75 ? 'Joyful' : 'Happy';
    else if (sentiment.label === 'Negative') mood = sentiment.score < 0.25 ? 'Melancholic' : 'Sad';

    const result = { trackName, artistName, lyrics: rawLyrics, sentiment, mood, source, language: 'en', translated: false };
    await setInCache(cacheKey, result, 604800).catch(() => {});
    res.json(result);

  } catch (err) {
    console.error('❌ Lyrics sentiment error:', err.message);
    res.status(500).json({ message: 'Failed to fetch lyrics sentiment', error: err.message });
  }
};

export const searchLyrics = async (req, res) => {
  const { query, limit = 10 } = req.query;

  if (!query) return res.status(400).json({ message: 'Search query is required' });

  if (!GENIUS_KEY && !GEMINI_KEY) {
    return res.status(503).json({ message: 'Lyrics service not configured', code: 'LYRICS_NOT_CONFIGURED' });
  }

  try {
    console.log(`🔍 Searching Genius: "${query}"`);

    if (GENIUS_KEY) {
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
      return res.json({ query, results, total: results.length });
    }

    // no Genius key — return empty with a helpful message
    return res.json({ query, results: [], total: 0, message: 'Search requires GENIUS_API_KEY' });

  } catch (err) {
    console.error('❌ Lyrics search error:', err.message);
    res.status(500).json({ message: 'Failed to search lyrics', error: err.message });
  }
};
