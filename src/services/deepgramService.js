const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');

const HOME_DIR = os.homedir();
const CONFIG_FILE = path.join(HOME_DIR, '.config', 'open-wispr', 'config.json');

/**
 * Locate and return Deepgram API Key from:
 * 1. process.env.DEEPGRAM_API_KEY
 * 2. .env.local in workspace / cwd
 * 3. .env.local next to main executable / app bundle
 * 4. ~/.config/open-wispr/config.json
 */
function getApiKey() {
  if (process.env.DEEPGRAM_API_KEY && process.env.DEEPGRAM_API_KEY.trim()) {
    return process.env.DEEPGRAM_API_KEY.trim();
  }

  // Candidate .env.local paths
  const candidateEnvPaths = [
    path.join(__dirname, '..', '..', '.env.local'),
    path.join(__dirname, '..', '.env.local'),
    path.join(process.cwd(), '.env.local'),
    path.join(HOME_DIR, 'Documents', 'GitHub', 'audio-transcriber-wispr', '.env.local'),
    path.join(HOME_DIR, '.config', 'open-wispr', '.env.local')
  ];

  for (const envPath of candidateEnvPaths) {
    try {
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf8');
        const match = content.match(/^\s*DEEPGRAM_API_KEY\s*=\s*['"]?([a-zA-Z0-9_\-]+)['"]?/m);
        if (match && match[1]) {
          const key = match[1].trim();
          // Sync key to config.json so daemon and packaged app have access
          syncKeyToConfig(key);
          return key;
        }
      }
    } catch (e) {}
  }

  // Check config.json
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      if (cfg.deepgramApiKey && cfg.deepgramApiKey.trim()) {
        return cfg.deepgramApiKey.trim();
      }
    }
  } catch (e) {}

  return null;
}

function syncKeyToConfig(key) {
  try {
    if (!key) return;
    let cfg = {};
    if (fs.existsSync(CONFIG_FILE)) {
      cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
    if (cfg.deepgramApiKey !== key) {
      cfg.deepgramApiKey = key;
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
    }
  } catch (e) {}
}

/**
 * Transcribe an audio buffer using Deepgram Nova-2 Cloud API
 *
 * @param {Buffer} audioBuffer - Raw audio data (WAV, MP3, M4A, etc.)
 * @param {string} mimeType - e.g. 'audio/wav', 'audio/mp3'
 * @param {Object} options - { language: 'en', model: 'nova-2' }
 * @returns {Promise<{ text: string, words: Array, duration: number, json: Object }>}
 */
function transcribeAudioBuffer(audioBuffer, mimeType = 'audio/wav', options = {}) {
  return new Promise((resolve, reject) => {
    const apiKey = options.apiKey || getApiKey();
    if (!apiKey) {
      return reject(new Error('Deepgram API Key not found. Please add DEEPGRAM_API_KEY to .env.local'));
    }

    const language = options.language && options.language !== 'auto' ? options.language : 'en';
    const model = options.model || 'nova-2';

    const queryParams = new URLSearchParams({
      model,
      smart_format: 'true',
      punctuate: 'true',
      language
    });

    const reqOptions = {
      hostname: 'api.deepgram.com',
      port: 443,
      path: `/v1/listen?${queryParams.toString()}`,
      method: 'POST',
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': mimeType,
        'Content-Length': audioBuffer.length
      }
    };

    const req = https.request(reqOptions, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => {
        responseBody += chunk;
      });

      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const data = JSON.parse(responseBody);
            const alternative = data.results?.channels?.[0]?.alternatives?.[0] || {};
            const text = (alternative.transcript || '').trim();
            const words = alternative.words || [];
            const duration = data.metadata?.duration || 0;

            resolve({
              text,
              words,
              duration,
              json: data
            });
          } catch (parseErr) {
            reject(new Error(`Failed to parse Deepgram response: ${parseErr.message}`));
          }
        } else {
          let errorMsg = `Deepgram API HTTP ${res.statusCode}`;
          try {
            const errObj = JSON.parse(responseBody);
            if (errObj.err_msg || errObj.message) {
              errorMsg += `: ${errObj.err_msg || errObj.message}`;
            }
          } catch (e) {
            errorMsg += `: ${responseBody.slice(0, 200)}`;
          }
          reject(new Error(errorMsg));
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error(`Deepgram connection error: ${err.message}`));
    });

    req.write(audioBuffer);
    req.end();
  });
}

/**
 * Transcribe an audio or video file using Deepgram Cloud API
 *
 * @param {string} filePath - Absolute path to audio/video file
 * @param {Object} options - { language: 'en', model: 'nova-2' }
 */
async function transcribeAudioFile(filePath, options = {}) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Audio file not found: ${filePath}`);
  }

  const audioBuffer = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();

  let mimeType = 'audio/wav';
  if (ext === '.mp3') mimeType = 'audio/mp3';
  else if (ext === '.m4a' || ext === '.aac') mimeType = 'audio/m4a';
  else if (ext === '.ogg' || ext === '.opus') mimeType = 'audio/ogg';
  else if (ext === '.flac') mimeType = 'audio/flac';
  else if (ext === '.mp4') mimeType = 'video/mp4';
  else if (ext === '.mov') mimeType = 'video/quicktime';
  else if (ext === '.webm') mimeType = 'audio/webm';

  return transcribeAudioBuffer(audioBuffer, mimeType, options);
}

module.exports = {
  getApiKey,
  transcribeAudioBuffer,
  transcribeAudioFile
};
