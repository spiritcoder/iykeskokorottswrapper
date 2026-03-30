require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;
const KOKORO_API_URL = process.env.KOKORO_API_URL || 'http://kokoro-fastapi-gpu:8880';

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Fetch voices from Kokoro on startup ───────────────────────────
let cachedVoices = [];

async function fetchVoices() {
  try {
    const res = await axios.get(`${KOKORO_API_URL}/v1/audio/voices`);
    // The response is typically { voices: [...] } or just an array
    const data = res.data;
    if (Array.isArray(data)) {
      cachedVoices = data;
    } else if (data.voices && Array.isArray(data.voices)) {
      cachedVoices = data.voices;
    } else if (typeof data === 'object') {
      // Some versions return { voice_id: {...}, ... }
      cachedVoices = Object.keys(data);
    }
    console.log(`✅ Loaded ${cachedVoices.length} voices from Kokoro`);
  } catch (err) {
    console.error('⚠️  Could not fetch voices from Kokoro:', err.message);
    console.log('   Will retry on next page load...');
  }
}

// ─── Routes ────────────────────────────────────────────────────────

// Main page
app.get('/', async (req, res) => {
  // Retry voice fetch if cache is empty
  if (cachedVoices.length === 0) {
    await fetchVoices();
  }

  // Categorise voices by prefix
  const categories = {};
  cachedVoices.forEach(v => {
    const voiceId = typeof v === 'string' ? v : v.id || v.voice_id || v.name || String(v);
    let category = 'Other';

    if (voiceId.startsWith('af_')) category = 'American Female';
    else if (voiceId.startsWith('am_')) category = 'American Male';
    else if (voiceId.startsWith('bf_')) category = 'British Female';
    else if (voiceId.startsWith('bm_')) category = 'British Male';
    else if (voiceId.startsWith('jf_')) category = 'Japanese Female';
    else if (voiceId.startsWith('jm_')) category = 'Japanese Male';
    else if (voiceId.startsWith('zf_')) category = 'Chinese Female';
    else if (voiceId.startsWith('zm_')) category = 'Chinese Male';
    else if (voiceId.startsWith('ef_')) category = 'Spanish Female';
    else if (voiceId.startsWith('em_')) category = 'Spanish Male';
    else if (voiceId.startsWith('ff_')) category = 'French Female';
    else if (voiceId.startsWith('fm_')) category = 'French Male';
    else if (voiceId.startsWith('hf_')) category = 'Hindi Female';
    else if (voiceId.startsWith('hm_')) category = 'Hindi Male';
    else if (voiceId.startsWith('if_')) category = 'Italian Female';
    else if (voiceId.startsWith('im_')) category = 'Italian Male';
    else if (voiceId.startsWith('pf_')) category = 'Portuguese Female';
    else if (voiceId.startsWith('pm_')) category = 'Portuguese Male';

    if (!categories[category]) categories[category] = [];
    categories[category].push(voiceId);
  });

  // Sort voices within each category
  Object.values(categories).forEach(arr => arr.sort());

  res.render('index', { categories, voiceCount: cachedVoices.length });
});

// Preview a voice — returns a short MP3 clip
app.post('/api/preview', async (req, res) => {
  const { voice } = req.body;
  if (!voice) return res.status(400).json({ error: 'voice is required' });

  try {
    const response = await axios.post(
      `${KOKORO_API_URL}/v1/audio/speech`,
      {
        model: 'kokoro',
        voice,
        input: 'Hello! This is a preview of my voice. I hope you like how I sound.',
        response_format: 'mp3',
      },
      { responseType: 'arraybuffer', timeout: 0 }
    );

    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': response.data.byteLength,
    });
    res.send(Buffer.from(response.data));
  } catch (err) {
    console.error('Preview error:', err.message);
    if (err.response) {
      console.error('  Kokoro status:', err.response.status);
      console.error('  Kokoro body:', Buffer.from(err.response.data).toString().substring(0, 500));
    }
    res.status(502).json({ error: 'Failed to generate preview from Kokoro API' });
  }
});

// Generate full TTS — returns an MP3 download
app.post('/api/generate', async (req, res) => {
  const { text, voice, temperature } = req.body;
  if (!text || !voice) return res.status(400).json({ error: 'text and voice are required' });
  const temp = parseFloat(temperature) || 1.0;

  // Clean text for Kokoro (it prefers flat, single-line input)
  const cleanedText = text
    .replace(/\\/g, '')
    .replace(/"/g, '\\"')
    .replace(/\n+/g, ' ')
    .replace(/\r/g, '')
    .trim();

  try {
    const response = await axios.post(
      `${KOKORO_API_URL}/v1/audio/speech`,
      {
        model: 'kokoro',
        voice,
        input: cleanedText,
        response_format: 'mp3',
        speed: temp,
      },
      { responseType: 'arraybuffer', timeout: 0 }
    );

    const filename = `voiceover_${voice}_${Date.now()}.mp3`;
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': response.data.byteLength,
    });
    res.send(Buffer.from(response.data));
  } catch (err) {
    console.error('Generate error:', err.message);
    if (err.response) {
      console.error('  Kokoro status:', err.response.status);
      console.error('  Kokoro body:', Buffer.from(err.response.data).toString().substring(0, 500));
    }
    res.status(502).json({ error: 'Failed to generate audio from Kokoro API' });
  }
});

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ─── Start ─────────────────────────────────────────────────────────
fetchVoices().then(() => {
  app.listen(PORT, () => {
    console.log(`🎙  KokoroTTS Web UI running at http://localhost:${PORT}`);
  });
});
