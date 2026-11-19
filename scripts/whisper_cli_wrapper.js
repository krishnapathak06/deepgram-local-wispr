#!/usr/bin/env node

/**
 * Smart whisper-cli wrapper
 *
 * If transcriptionEngine is 'deepgram' and a Deepgram API key is available,
 * transcribes using Deepgram Nova-2 Cloud REST API (~250ms, 0% CPU/GPU).
 * Otherwise, delegates seamlessly to the original whisper-cli binary.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { spawn } = require('child_process');

const REAL_WHISPER_CLI = '/opt/homebrew/Cellar/whisper.cpp/1.9.1/bin/whisper-cli';
const HOME_DIR = os.homedir();
const CONFIG_FILE = path.join(HOME_DIR, '.config', 'open-wispr', 'config.json');

// Check config and env for Deepgram configuration
function getDeepgramSettings() {
  let engine = 'deepgram'; // default to deepgram if key is present
  let apiKey = process.env.DEEPGRAM_API_KEY || null;

  // 1. Try reading ~/.config/open-wispr/config.json
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      if (cfg.transcriptionEngine) {
        engine = cfg.transcriptionEngine;
      }
      if (cfg.deepgramApiKey && !apiKey) {
        apiKey = cfg.deepgramApiKey;
      }
    }
  } catch (e) {}

  // 2. Try candidate .env.local locations if apiKey not found yet
  if (!apiKey) {
    const candidateEnvPaths = [
      path.join(HOME_DIR, 'Documents', 'GitHub', 'audio-transcriber-wispr', '.env.local'),
      path.join(__dirname, '..', '.env.local'),
      path.join(process.cwd(), '.env.local')
    ];
    for (const envPath of candidateEnvPaths) {
      try {
        if (fs.existsSync(envPath)) {
          const content = fs.readFileSync(envPath, 'utf8');
          const match = content.match(/^\s*DEEPGRAM_API_KEY\s*=\s*['"]?([a-zA-Z0-9_\-]+)['"]?/m);
          if (match && match[1]) {
            apiKey = match[1].trim();
            break;
          }
        }
      } catch (e) {}
    }
  }

  return { engine, apiKey };
}

// Find audio file in command line arguments
function findAudioFile(args) {
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '-f' || args[i] === '--file') && args[i + 1]) {
      return args[i + 1];
    }
  }
  // Fallback: look for any .wav argument
  for (const arg of args) {
    if (arg.endsWith('.wav') && fs.existsSync(arg)) {
      return arg;
    }
  }
  return null;
}

// Find language if specified
function findLanguage(args) {
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '-l' || args[i] === '--language') && args[i + 1]) {
      return args[i + 1];
    }
  }
  return 'en';
}

// Transcribe via Deepgram Nova-2 REST API
function transcribeWithDeepgram(audioPath, apiKey, language) {
  return new Promise((resolve, reject) => {
    const audioBuffer = fs.readFileSync(audioPath);
    try {
      fs.copyFileSync(audioPath, '/tmp/last-recording.wav');
      fs.appendFileSync('/tmp/whisper-cli-debug.log', `[${new Date().toISOString()}] Audio bytes: ${audioBuffer.length}, saved copy to /tmp/last-recording.wav\n`);
    } catch (e) {}

    const queryParams = new URLSearchParams({
      model: 'nova-2',
      smart_format: 'true',
      punctuate: 'true',
      language: language && language !== 'auto' ? language : 'en'
    });

    const reqOptions = {
      hostname: 'api.deepgram.com',
      port: 443,
      path: `/v1/listen?${queryParams.toString()}`,
      method: 'POST',
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': 'audio/wav',
        'Content-Length': audioBuffer.length
      }
    };

    const req = https.request(reqOptions, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          fs.appendFileSync('/tmp/whisper-cli-debug.log', `[${new Date().toISOString()}] Deepgram HTTP ${res.statusCode}: ${body.slice(0, 500)}\n`);
        } catch (e) {}

        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const parsed = JSON.parse(body);
            const transcript = parsed.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
            resolve(transcript.trim());
          } catch (e) {
            reject(e);
          }
        } else {
          reject(new Error(`Deepgram HTTP ${res.statusCode}: ${body.slice(0, 100)}`));
        }
      });
    });

    req.on('error', reject);
    req.write(audioBuffer);
    req.end();
  });
}

// Delegate to real whisper-cli binary
function delegateToRealWhisper() {
  const child = spawn(REAL_WHISPER_CLI, process.argv.slice(2), {
    stdio: 'inherit'
  });
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code || 0);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const logMsg = `[${new Date().toISOString()}] Called with: ${JSON.stringify(args)}\n`;
  try { fs.appendFileSync('/tmp/whisper-cli-debug.log', logMsg); } catch (e) {}

  // If help, version, or no args requested, always delegate to real whisper-cli
  if (args.length === 0 || args.includes('-h') || args.includes('--help') || args.includes('--version')) {
    return delegateToRealWhisper();
  }

  const { engine, apiKey } = getDeepgramSettings();
  try { fs.appendFileSync('/tmp/whisper-cli-debug.log', `[${new Date().toISOString()}] Settings: engine=${engine}, hasKey=${!!apiKey}\n`); } catch (e) {}

  // If user selected local whisper, or no API key is available, use real whisper-cli
  if (engine !== 'deepgram' || !apiKey) {
    try { fs.appendFileSync('/tmp/whisper-cli-debug.log', `[${new Date().toISOString()}] Delegating to real whisper-cli because engine is ${engine}\n`); } catch (e) {}
    return delegateToRealWhisper();
  }

  const audioFile = findAudioFile(args);
  try { fs.appendFileSync('/tmp/whisper-cli-debug.log', `[${new Date().toISOString()}] Audio file: ${audioFile}\n`); } catch (e) {}
  if (!audioFile || !fs.existsSync(audioFile)) {
    try { fs.appendFileSync('/tmp/whisper-cli-debug.log', `[${new Date().toISOString()}] Audio file missing, delegating to real whisper\n`); } catch (e) {}
    return delegateToRealWhisper();
  }

  const language = findLanguage(args);

  // Signal to Wispr Studio HUD that transcription has officially started
  try { fs.writeFileSync('/tmp/wispr-active-state', 'transcribing'); } catch (e) {}

  try {
    const text = await transcribeWithDeepgram(audioFile, apiKey, language);
    try { fs.appendFileSync('/tmp/whisper-cli-debug.log', `[${new Date().toISOString()}] Deepgram returned text length=${text.length}: "${text}"\n`); } catch (e) {}
    
    // Signal to Wispr Studio HUD that transcription is done
    try { fs.writeFileSync('/tmp/wispr-active-state', 'done'); } catch (e) {}

    if (text) {
      try {
        const { execSync } = require('child_process');
        execSync('pbcopy', { input: text });
      } catch (e) {}

      process.stdout.write(text + '\n', () => {
        // Allow a brief moment for OpenWispr daemon to catch stdout and paste
        setTimeout(() => {
          process.exit(0);
        }, 50);
      });

      // Safety timeout in case stdout callback is delayed
      setTimeout(() => {
        process.exit(0);
      }, 100);
    } else {
      process.exit(0);
    }

  } catch (err) {
    try { fs.writeFileSync('/tmp/wispr-active-state', 'done'); } catch (e) {}
    try { fs.appendFileSync('/tmp/whisper-cli-debug.log', `[${new Date().toISOString()}] Deepgram error: ${err.message}\n`); } catch (e) {}
    console.error('Deepgram transcription failed, falling back to local Whisper:', err.message);
    delegateToRealWhisper();
  }
}

main();
