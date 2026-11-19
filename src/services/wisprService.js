const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec, spawn } = require('child_process');

const HOME_DIR = os.homedir();
const CONFIG_DIR = path.join(HOME_DIR, '.config', 'open-wispr');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const MODELS_DIR = path.join(CONFIG_DIR, 'models');
const OPEN_WISPR_BIN = '/opt/homebrew/bin/open-wispr';
const OPEN_WISPR_APP_BIN = '/opt/homebrew/opt/open-wispr/OpenWispr.app/Contents/MacOS/open-wispr';
const OPEN_WISPR_APP = '/opt/homebrew/opt/open-wispr/OpenWispr.app';

// Catalog of known whisper models supported by open-wispr
const MODEL_CATALOG = [
  { id: 'deepgram', name: '⚡ Cloud Deepgram (Nova-2)', size: 'Cloud API', speed: 'Instant (< 0.5s)', accuracy: 'State of the Art', description: 'Ultra-fast cloud transcription via Deepgram Nova-2, 0% CPU/GPU RAM' },
  { id: 'tiny.en', name: 'Tiny English', size: '75 MB', speed: 'Ultra Fast', accuracy: 'Basic', description: 'Smallest English model, lowest RAM' },
  { id: 'tiny', name: 'Tiny Multilingual', size: '75 MB', speed: 'Ultra Fast', accuracy: 'Basic', description: 'Multilingual ultra-fast model' },
  { id: 'base.en', name: 'Base English', size: '142 MB', speed: 'Very Fast', accuracy: 'Good', description: 'Default English model, recommended for general use' },
  { id: 'base.en-q5_1', name: 'Base English (Q5_1)', size: '57 MB', speed: 'Very Fast', accuracy: 'Good', description: 'Quantized base English model' },
  { id: 'base', name: 'Base Multilingual', size: '142 MB', speed: 'Very Fast', accuracy: 'Good', description: 'Default multilingual model' },
  { id: 'small.en', name: 'Small English', size: '466 MB', speed: 'Fast', accuracy: 'Very Good', description: 'Higher accuracy English transcription' },
  { id: 'small', name: 'Small Multilingual', size: '466 MB', speed: 'Fast', accuracy: 'Very Good', description: 'High accuracy multilingual' },
  { id: 'medium.en', name: 'Medium English', size: '1.5 GB', speed: 'Moderate', accuracy: 'High', description: 'Very accurate English model' },
  { id: 'medium', name: 'Medium Multilingual', size: '1.5 GB', speed: 'Moderate', accuracy: 'High', description: 'High precision multilingual' },
  { id: 'large-v3-turbo', name: 'Large v3 Turbo', size: '1.6 GB', speed: 'Fast (GPU)', accuracy: 'State of the Art', description: 'Latest OpenAI Turbo model with Apple Metal acceleration' },
  { id: 'large-v3', name: 'Large v3', size: '3.1 GB', speed: 'Slower', accuracy: 'Maximum', description: 'Highest accuracy Whisper model' }
];

const DEFAULT_CONFIG = {
  transcriptionEngine: 'deepgram',
  hotkey: {
    modifiers: [],
    keyCode: 63
  },
  hotkeys: [
    {
      modifiers: [],
      keyCode: 63
    }
  ],
  audioInputDeviceID: 0,
  maxRecordings: 0,
  spokenPunctuation: false,
  toggleMode: true,
  modelSize: 'base.en',
  language: 'en',
  audioInputDeviceUID: 'BuiltInMicrophoneDevice'
};

function ensureDirs() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  if (!fs.existsSync(MODELS_DIR)) {
    fs.mkdirSync(MODELS_DIR, { recursive: true });
  }
}

function getConfig() {
  ensureDirs();
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Error reading config file:', err);
  }
  return { ...DEFAULT_CONFIG };
}

function saveConfig(newConfig) {
  ensureDirs();
  try {
    const current = getConfig();
    const merged = { ...current, ...newConfig };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), 'utf8');
    return { success: true, config: merged };
  } catch (err) {
    console.error('Error saving config file:', err);
    return { success: false, error: err.message };
  }
}

function checkDaemonRunning() {
  return new Promise((resolve) => {
    // Strictly match the open-wispr daemon, avoiding whisper-cli and our own app
    exec('pgrep -fl "open-wispr" | grep -v "whisper-cli" | grep -v "audio-transcriber-wispr" | grep -v "Wispr Studio"', (err, stdout) => {
      if (err || !stdout.trim()) {
        resolve({ running: false, pid: null, processDetails: '' });
      } else {
        const lines = stdout.trim().split('\n').filter(l => l.includes('open-wispr') && !l.includes('whisper-cli'));
        if (lines.length === 0) {
          return resolve({ running: false, pid: null, processDetails: '' });
        }
        const first = lines[0].trim().split(/\s+/);
        const pid = parseInt(first[0], 10);
        resolve({ running: true, pid, processDetails: stdout.trim() });
      }
    });
  });
}

function startDaemon() {
  return new Promise(async (resolve) => {
    const current = await checkDaemonRunning();
    if (current.running) {
      return resolve({ success: true, message: 'Daemon is already running', pid: current.pid });
    }

    const uid = process.getuid ? process.getuid() : 501;
    // The Homebrew plist lives in /opt/homebrew, may or may not be symlinked to ~/Library/LaunchAgents
    const homebrewPlist = '/opt/homebrew/opt/open-wispr/homebrew.mxcl.open-wispr.plist';
    const launchAgentPlist = path.join(HOME_DIR, 'Library', 'LaunchAgents', 'homebrew.mxcl.open-wispr.plist');
    const plist = fs.existsSync(launchAgentPlist) ? launchAgentPlist : (fs.existsSync(homebrewPlist) ? homebrewPlist : null);

    // Attempt launchctl bootstrap if plist is known, then fall through to direct spawn
    const launchctlCmd = plist
      ? `launchctl bootstrap gui/${uid} "${plist}" 2>/dev/null; launchctl load "${plist}" 2>/dev/null`
      : 'true';

    exec(launchctlCmd, () => {
      setTimeout(async () => {
        let newStatus = await checkDaemonRunning();
        if (newStatus.running) {
          return resolve({ success: true, message: 'Open-Wispr daemon started', pid: newStatus.pid });
        }

        // Direct spawn — most reliable path
        try {
          const child = spawn(OPEN_WISPR_APP_BIN, ['start'], { detached: true, stdio: 'ignore' });
          child.unref();
        } catch (e) {
          try {
            const child = spawn(OPEN_WISPR_BIN, ['start'], { detached: true, stdio: 'ignore' });
            child.unref();
          } catch (e2) {}
        }

        let attempts = 0;
        const interval = setInterval(async () => {
          attempts++;
          newStatus = await checkDaemonRunning();
          if (newStatus.running) {
            clearInterval(interval);
            return resolve({ success: true, message: 'Open-Wispr daemon started', pid: newStatus.pid });
          }
          if (attempts >= 10) {
            clearInterval(interval);
            return resolve({
              success: false,
              message: 'Daemon start initiated. Grant Accessibility & Microphone in System Settings → Privacy if prompted.'
            });
          }
        }, 300);
      }, 400);
    });
  });
}

function stopDaemon() {
  return new Promise(async (resolve) => {
    const status = await checkDaemonRunning();
    if (!status.running) {
      return resolve({ success: true, message: 'Open-Wispr daemon is already stopped' });
    }

    const uid = process.getuid ? process.getuid() : 501;
    // Try both plist locations
    const homebrewPlist = '/opt/homebrew/opt/open-wispr/homebrew.mxcl.open-wispr.plist';
    const launchAgentPlist = path.join(HOME_DIR, 'Library', 'LaunchAgents', 'homebrew.mxcl.open-wispr.plist');

    // Bootout from launchd so it doesn't auto-resurrect, then kill process
    const stopCmd = [
      `launchctl bootout gui/${uid} homebrew.mxcl.open-wispr 2>/dev/null`,
      `launchctl bootout gui/${uid} "${homebrewPlist}" 2>/dev/null`,
      `launchctl bootout gui/${uid} "${launchAgentPlist}" 2>/dev/null`,
      `launchctl unload "${homebrewPlist}" 2>/dev/null`,
      `launchctl unload "${launchAgentPlist}" 2>/dev/null`,
      `osascript -e 'tell application "OpenWispr" to quit' 2>/dev/null`,
      `killall -9 open-wispr 2>/dev/null`,
      `pkill -9 -f "OpenWispr" 2>/dev/null`,
      status.pid ? `kill -9 ${status.pid} 2>/dev/null` : ''
    ].filter(Boolean).join(' ; ');

    if (status.pid) {
      try { process.kill(status.pid, 'SIGKILL'); } catch (e) {}
    }

    exec(stopCmd, () => {
      let attempts = 0;
      const interval = setInterval(async () => {
        attempts++;
        const check = await checkDaemonRunning();
        if (!check.running) {
          clearInterval(interval);
          return resolve({ success: true, message: 'Open-Wispr daemon stopped' });
        }
        if (attempts >= 8) {
          clearInterval(interval);
          // One final hard kill attempt
          exec(`killall -9 open-wispr 2>/dev/null ; pkill -9 -f OpenWispr 2>/dev/null`, () => {});
          return resolve({
            success: !check.running,
            message: check.running ? 'Process stopped (launchd may restart it)' : 'Open-Wispr daemon stopped'
          });
        }
      }, 200);
    });
  });
}

function restartDaemon() {
  return new Promise(async (resolve) => {
    await stopDaemon();
    // Allow OS to release socket and file handles
    setTimeout(async () => {
      const res = await startDaemon();
      resolve(res);
    }, 400);
  });
}

function getInstalledModels() {
  ensureDirs();
  const installed = [];
  try {
    const files = fs.readdirSync(MODELS_DIR);
    for (const file of files) {
      if (file.startsWith('ggml-') && file.endsWith('.bin')) {
        const stat = fs.statSync(path.join(MODELS_DIR, file));
        const modelId = file.replace(/^ggml-/, '').replace(/\.bin$/, '');
        const catalogEntry = MODEL_CATALOG.find(m => m.id === modelId) || {
          id: modelId,
          name: modelId,
          speed: 'Custom',
          accuracy: 'Custom',
          description: 'Custom GGML model'
        };

        installed.push({
          ...catalogEntry,
          filename: file,
          fullPath: path.join(MODELS_DIR, file),
          fileSizeBytes: stat.size,
          fileSizeFormatted: formatBytes(stat.size),
          lastModified: stat.mtime
        });
      }
    }
  } catch (err) {
    console.error('Error listing models:', err);
  }

  // Deepgram Cloud model is always available without downloading
  const deepgramCatalog = MODEL_CATALOG.find(m => m.id === 'deepgram');
  if (deepgramCatalog) {
    installed.unshift({
      ...deepgramCatalog,
      filename: 'deepgram',
      fullPath: 'cloud:deepgram',
      fileSizeBytes: 0,
      fileSizeFormatted: 'Cloud API',
      lastModified: new Date()
    });
  }

  // Combine with catalog so user sees what is downloaded vs what is available to download
  const fullList = MODEL_CATALOG.map(item => {
    if (item.id === 'deepgram') {
      return {
        ...item,
        isDownloaded: true,
        filename: 'deepgram',
        fullPath: 'cloud:deepgram',
        fileSizeBytes: 0,
        fileSizeFormatted: 'Cloud API'
      };
    }
    const match = installed.find(i => i.id === item.id);
    return {
      ...item,
      isDownloaded: !!match,
      filename: match ? match.filename : `ggml-${item.id}.bin`,
      fullPath: match ? match.fullPath : path.join(MODELS_DIR, `ggml-${item.id}.bin`),
      fileSizeBytes: match ? match.fileSizeBytes : null,
      fileSizeFormatted: match ? match.fileSizeFormatted : item.size
    };
  });

  return { installed, allModels: fullList };
}

function downloadModel(modelId, onLog) {
  return new Promise((resolve, reject) => {
    const child = spawn(OPEN_WISPR_BIN, ['download-model', modelId]);

    child.stdout.on('data', (data) => {
      const msg = data.toString();
      if (onLog) onLog(msg);
    });

    child.stderr.on('data', (data) => {
      const msg = data.toString();
      if (onLog) onLog(msg);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, message: `Model ${modelId} downloaded successfully.` });
      } else {
        reject(new Error(`Download exited with code ${code}`));
      }
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

function getAudioInputDevices() {
  return new Promise((resolve) => {
    // Query macOS system_profiler for audio input devices
    exec('system_profiler SPAudioDataType -json', (err, stdout) => {
      const devices = [];
      if (!err && stdout) {
        try {
          const parsed = JSON.parse(stdout);
          const audioData = parsed.SPAudioDataType || [];
          for (const item of audioData) {
            const rawDevices = item._items || [];
            for (const dev of rawDevices) {
              if (dev.coreaudio_input_source || dev.coreaudio_device_input) {
                devices.push({
                  id: dev.coreaudio_device_id || dev._name,
                  name: dev._name,
                  uid: dev.coreaudio_device_uid || dev._name,
                  isDefault: dev.coreaudio_default_audio_input_device === 'spaudio_yes'
                });
              }
            }
          }
        } catch (e) {
          // JSON parse fallback
        }
      }

      // If system_profiler JSON was empty or had different keys, fallback to text parse
      if (devices.length === 0) {
        exec('system_profiler SPAudioDataType', (err2, stdout2) => {
          if (!err2 && stdout2) {
            const lines = stdout2.split('\n');
            let currentDev = null;
            for (const line of lines) {
              const trimmed = line.trim();
              if (line.startsWith('        ') && line.endsWith(':') && !trimmed.startsWith('Default') && !trimmed.startsWith('Input') && !trimmed.startsWith('Output')) {
                currentDev = trimmed.replace(/:$/, '');
              }
              if (trimmed.includes('Default Input Device: Yes') || trimmed.includes('Input Channels:')) {
                if (currentDev && !devices.find(d => d.name === currentDev)) {
                  devices.push({
                    id: currentDev,
                    name: currentDev,
                    uid: currentDev,
                    isDefault: trimmed.includes('Default Input Device: Yes')
                  });
                }
              }
            }
          }
          if (devices.length === 0) {
            devices.push({ id: 'BuiltInMicrophoneDevice', name: 'MacBook Built-in Microphone', uid: 'BuiltInMicrophoneDevice', isDefault: true });
          }
          resolve(devices);
        });
        return;
      }

      resolve(devices);
    });
  });
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

module.exports = {
  CONFIG_DIR,
  CONFIG_FILE,
  MODELS_DIR,
  MODEL_CATALOG,
  getConfig,
  saveConfig,
  checkDaemonRunning,
  startDaemon,
  stopDaemon,
  restartDaemon,
  getInstalledModels,
  downloadModel,
  getAudioInputDevices
};
