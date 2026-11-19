const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, shell, clipboard, nativeImage, globalShortcut, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, exec } = require('child_process');
const wisprService = require('./services/wisprService');
const transcribeService = require('./services/transcribeService');
const deepgramService = require('./services/deepgramService');

let mainWindow = null;
let hudWindow = null;
let tray = null;
let isQuitting = false;
let hudCorner = 'bottom-right'; // 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'bottom-center'
let activeDictationProc = null;
let dictationWavPath = null;
let isDictating = false;
let isTranscribingInternal = false;
let openWisprWatcher = null;

function createWindow(showOnReady = false) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (showOnReady) {
      mainWindow.show();
      mainWindow.focus();
    }
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: 1220,
    height: 840,
    minWidth: 960,
    minHeight: 660,
    title: 'Wispr Studio — Voice Dictation & Local Whisper Transcription',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 20, y: 20 },
    backgroundColor: '#0c0f17',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'ui', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    if (showOnReady) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  mainWindow.on('close', () => {
    app.quit();
  });

  updateTray();
  return mainWindow;
}

function openMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow(true);
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

function createTrayIcon() {
  // Create a clean 16x16 / 32x32 template icon for macOS menubar
  const iconCanvasSvg = `
    <svg width="22" height="22" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg">
      <path d="M11 2 C8.8 2 7 3.8 7 6 L7 11 C7 13.2 8.8 15 11 15 C13.2 15 15 13.2 15 11 L15 6 C15 3.8 13.2 2 11 2 Z" fill="#000000"/>
      <path d="M4 10 C4 13.5 7.1 16.4 10 16.9 L10 19 L8 19 C7.4 19 7 19.4 7 20 C7 20.6 7.4 21 8 21 L14 21 C14.6 21 15 20.6 15 20 C15 19.4 14.6 19 14 19 L12 19 L12 16.9 C14.9 16.4 18 13.5 18 10 C18 9.4 17.6 9 17 9 C16.4 9 16 9.4 16 10 C16 12.8 13.8 15 11 15 C8.2 15 6 12.8 6 10 C6 9.4 5.6 9 5 9 C4.4 9 4 9.4 4 10 Z" fill="#000000"/>
    </svg>
  `;
  const iconBuffer = Buffer.from(iconCanvasSvg);
  let trayImage = nativeImage.createFromBuffer(iconBuffer);
  trayImage.setTemplateImage(true);

  tray = new Tray(trayImage);
  tray.setToolTip('Wispr Studio — Voice Dictation');
  tray.on('click', () => {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      openMainWindow();
    }
  });

  updateTray();
}

async function updateTray() {
  if (!tray) return;

  const daemonStatus = await wisprService.checkDaemonRunning();
  const config = wisprService.getConfig();
  const { installed } = wisprService.getInstalledModels();
  const currentEngine = config.transcriptionEngine || 'deepgram';

  const statusLabel = daemonStatus.running ? '🟢 Dictation: Active' : '⚪ Dictation: Inactive';

  const localModels = installed.filter(m => m.id !== 'deepgram');
  const modelMenuItems = localModels.map(m => ({
    label: m.id + (m.id === config.modelSize && currentEngine === 'local' ? ' ✓' : ''),
    type: 'normal',
    click: async () => {
      wisprService.saveConfig({ modelSize: m.id, transcriptionEngine: 'local' });
      // Restart daemon with selected model so it takes effect immediately
      if (daemonStatus.running) {
        await wisprService.stopDaemon();
        await wisprService.startDaemon();
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('wispr:configUpdated', { modelSize: m.id, transcriptionEngine: 'local' });
      }
      updateTray();
    }
  }));

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Wispr Studio', enabled: false },
    { type: 'separator' },
    {
      label: 'Open Studio Interface',
      click: () => {
        openMainWindow();
      }
    },
    { label: statusLabel, enabled: false },
    { type: 'separator' },
    { label: 'Transcription Engine:', enabled: false },
    {
      label: '⚡ Cloud Deepgram (Nova-2)' + (currentEngine === 'deepgram' ? ' ✓' : ''),
      type: 'normal',
      click: async () => {
        wisprService.saveConfig({ transcriptionEngine: 'deepgram' });
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('wispr:configUpdated', { transcriptionEngine: 'deepgram' });
        }
        updateTray();
      }
    },
    {
      label: '💻 Local Whisper (Offline Metal GPU)' + (currentEngine === 'local' ? ' ✓' : ''),
      type: 'normal',
      click: async () => {
        wisprService.saveConfig({ transcriptionEngine: 'local' });
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('wispr:configUpdated', { transcriptionEngine: 'local' });
        }
        updateTray();
      }
    },
    { type: 'separator' },
    {
      label: `Local Whisper Model (${config.modelSize || 'base.en'})`,
      submenu: modelMenuItems.length > 0 ? modelMenuItems : [{ label: 'No local models downloaded', enabled: false }]
    },
    { type: 'separator' },
    {
      label: daemonStatus.running ? 'Restart Voice Daemon' : 'Start Voice Daemon',
      click: async () => {
        if (daemonStatus.running) {
          await wisprService.stopDaemon();
        }
        await wisprService.startDaemon();
        updateTray();
        if (mainWindow && !mainWindow.isDestroyed()) {
          const newStatus = await wisprService.checkDaemonRunning();
          mainWindow.webContents.send('wispr:statusChange', newStatus);
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit Wispr Studio',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
}

// IPC Handlers

ipcMain.handle('wispr:getStatus', async () => {
  const daemon = await wisprService.checkDaemonRunning();
  const config = wisprService.getConfig();
  const models = wisprService.getInstalledModels();
  const devices = await wisprService.getAudioInputDevices();
  return { daemon, config, models, devices };
});

ipcMain.handle('wispr:start', async () => {
  const res = await wisprService.startDaemon();
  updateTray();
  return res;
});

ipcMain.handle('wispr:stop', async () => {
  const res = await wisprService.stopDaemon();
  updateTray();
  return res;
});

ipcMain.handle('wispr:getConfig', () => {
  return wisprService.getConfig();
});

ipcMain.handle('wispr:saveConfig', async (event, newConfig) => {
  const oldConfig = wisprService.getConfig();
  const res = wisprService.saveConfig(newConfig);

  // If model changed and daemon is active, restart daemon so old model is freed from RAM/Metal GPU
  if (newConfig.modelSize && newConfig.modelSize !== oldConfig.modelSize) {
    const daemonStatus = await wisprService.checkDaemonRunning();
    if (daemonStatus.running) {
      await wisprService.restartDaemon();
      if (mainWindow && !mainWindow.isDestroyed()) {
        const newStatus = await wisprService.checkDaemonRunning();
        mainWindow.webContents.send('wispr:statusChange', newStatus);
      }
    }
  }

  updateTray();
  return res;
});

ipcMain.handle('wispr:getModels', () => {
  return wisprService.getInstalledModels();
});

ipcMain.handle('wispr:downloadModel', async (event, modelId) => {
  try {
    const res = await wisprService.downloadModel(modelId, (log) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('wispr:downloadLog', log);
      }
    });
    updateTray();
    return res;
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('wispr:getAudioDevices', async () => {
  return await wisprService.getAudioInputDevices();
});

// Transcribe IPC
ipcMain.handle('transcribe:start', async (event, { filePaths, options }) => {
  const results = [];
  for (const filePath of filePaths) {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('transcribe:status', { filePath, status: 'Starting transcription...' });
      }

      const res = await transcribeService.transcribeFile(
        filePath,
        options,
        {
          onProgress: (p) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('transcribe:progress', p);
            }
          },
          onStatus: (msg) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('transcribe:status', { filePath, message: msg });
            }
          }
        }
      );

      results.push(res);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('transcribe:complete', res);
      }
    } catch (err) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('transcribe:error', { filePath, error: err.message });
      }
    }
  }
  return results;
});

ipcMain.handle('transcribe:getHistory', () => {
  return transcribeService.getHistory();
});

ipcMain.handle('transcribe:cancel', (event, jobId) => {
  return transcribeService.cancelJob(jobId);
});

// Dialogs & Helpers
ipcMain.handle('dialog:selectFiles', async () => {
  if (!mainWindow) return [];
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Audio or Video Files for Transcription',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Audio & Video Files', extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'mp4', 'mov', 'mkv', 'webm', 'avi'] },
      { name: 'Audio Only', extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus'] },
      { name: 'Video Only', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  if (result.canceled) return [];
  return result.filePaths;
});

ipcMain.handle('dialog:saveFile', async (event, { defaultName, content }) => {
  if (!mainWindow) return { canceled: true };
  const ext = path.extname(defaultName).replace('.', '');
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Transcription',
    defaultPath: defaultName,
    filters: [
      { name: ext.toUpperCase() + ' File', extensions: [ext] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }

  try {
    fs.writeFileSync(result.filePath, content, 'utf8');
    return { success: true, filePath: result.filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('clipboard:writeText', (event, text) => {
  clipboard.writeText(text);
  return true;
});

ipcMain.handle('system:openFolder', (event, dirPath) => {
  shell.openPath(dirPath || wisprService.CONFIG_DIR);
  return true;
});

// HUD Positioning & Management
function getHudPosition(corner, workArea, w, h) {
  const pad = 24;
  switch (corner) {
    case 'top-left':
      return { x: workArea.x + pad, y: workArea.y + pad };
    case 'top-right':
      return { x: workArea.x + workArea.width - w - pad, y: workArea.y + pad };
    case 'bottom-left':
      return { x: workArea.x + pad, y: workArea.y + workArea.height - h - pad };
    case 'bottom-center':
      return { x: Math.round(workArea.x + (workArea.width - w) / 2), y: workArea.y + workArea.height - h - pad };
    case 'bottom-right':
    default:
      return { x: workArea.x + workArea.width - w - pad, y: workArea.y + workArea.height - h - pad };
  }
}

let hudReady = false;
let pendingHudState = null;

function createHudWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const hudWidth = 240;
  const hudHeight = 72;
  const pos = getHudPosition(hudCorner, primaryDisplay.workArea, hudWidth, hudHeight);

  hudWindow = new BrowserWindow({
    width: hudWidth,
    height: hudHeight,
    x: pos.x,
    y: pos.y,
    type: 'panel',
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    acceptFirstMouse: false,
    resizable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (process.platform === 'darwin') {
    try {
      hudWindow.setHiddenInMissionControl(true);
      hudWindow.setWindowButtonVisibility(false);
    } catch (e) {}
  }

  hudWindow.setAlwaysOnTop(true, 'screen-saver');
  hudWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  hudWindow.setIgnoreMouseEvents(true, { forward: true });

  // Track when HUD renderer is fully ready to receive IPC messages
  hudWindow.webContents.on('did-finish-load', () => {
    hudReady = true;
    // Flush any pending state that was queued before the window loaded
    if (pendingHudState && pendingHudState !== 'hidden') {
      setHudState(pendingHudState);
    }
    pendingHudState = null;
  });

  hudWindow.loadFile(path.join(__dirname, 'ui', 'hud.html'));
}

let currentHudState = 'hidden';
let hudSafetyTimer = null;

function setHudState(state) {
  currentHudState = state;
  clearTimeout(hudSafetyTimer);

  // If HUD isn't ready yet, queue the state
  if (!hudReady) {
    pendingHudState = state;
    return;
  }

  if (!hudWindow || hudWindow.isDestroyed()) return;

  if (state === 'hidden') {
    try { hudWindow.webContents.send('hud:state', { state: 'hidden' }); } catch (e) {}
    hudSafetyTimer = setTimeout(() => {
      if (hudWindow && !hudWindow.isDestroyed() && currentHudState === 'hidden') {
        hudWindow.hide();
      }
    }, 280);
  } else {
    const primaryDisplay = screen.getPrimaryDisplay();
    const pos = getHudPosition(hudCorner, primaryDisplay.workArea, 240, 72);
    hudWindow.setPosition(pos.x, pos.y, false);
    // CRITICAL: Use showInactive() so the user's active typing cursor NEVER loses focus
    hudWindow.showInactive();
    hudWindow.setAlwaysOnTop(true, 'screen-saver');
    hudWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    hudWindow.setIgnoreMouseEvents(true, { forward: true });

    try { hudWindow.webContents.send('hud:state', { state }); } catch (e) {}

    if (state === 'done') {
      hudSafetyTimer = setTimeout(() => setHudState('hidden'), 700);
    } else if (state === 'transcribing') {
      // 30-second watchdog in case of heavy local models/long audio
      hudSafetyTimer = setTimeout(() => setHudState('done'), 30000);
    } else if (state === 'recording') {
      // Generous 10-minute watchdog strictly to recover if app is killed — NEVER cut off active speech
      hudSafetyTimer = setTimeout(() => setHudState('hidden'), 600000);
    }
  }
}

// Paste text at active cursor using AppleScript Cmd+V
function pasteAtCursor(text) {
  if (!text || !text.trim()) return;
  clipboard.writeText(text.trim());
  setTimeout(() => {
    exec(`osascript -e 'tell application "System Events" to keystroke "v" using command down'`, (err) => {
      if (err) {
        console.error('Accessibility paste error:', err);
      }
    });
  }, 60);
}

// Direct Wispr Studio Dictation Engine
async function toggleDictation() {
  if (isDictating) {
    // Stop recording and transcribe
    stopDictation();
  } else {
    // Start recording
    startDictation();
  }
}

function startDictation() {
  if (isDictating) return;
  isDictating = true;
  setHudState('recording');

  const tmpDir = path.join(wisprService.CONFIG_DIR, 'recordings');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }
  dictationWavPath = path.join(tmpDir, `dictation-${Date.now()}.wav`);

  // Record 16kHz mono WAV from default macOS microphone using ffmpeg
  const ffmpegBin = '/opt/homebrew/bin/ffmpeg';
  activeDictationProc = spawn(ffmpegBin, [
    '-y',
    '-f', 'avfoundation',
    '-i', ':0',
    '-ar', '16000',
    '-ac', '1',
    '-c:a', 'pcm_s16le',
    dictationWavPath
  ], { stdio: ['pipe', 'ignore', 'ignore'] });

  activeDictationProc.on('error', (err) => {
    console.error('Dictation recording spawn error:', err);
    isDictating = false;
    setHudState('hidden');
  });
}

function stopDictation() {
  if (!isDictating) return;
  isDictating = false;
  isTranscribingInternal = true;
  setHudState('transcribing');

  const proc = activeDictationProc;
  const wavPath = dictationWavPath;
  activeDictationProc = null;

  if (proc) {
    // Gracefully stop ffmpeg so WAV header is finalized
    proc.stdin.write('q');
    setTimeout(() => {
      try { proc.kill('SIGINT'); } catch (e) {}
    }, 150);

    proc.on('close', async () => {
      await processTranscribeAndPaste(wavPath);
    });
  } else {
    isTranscribingInternal = false;
    setHudState('hidden');
  }
}

async function processTranscribeAndPaste(wavPath) {
  try {
    if (!fs.existsSync(wavPath) || fs.statSync(wavPath).size < 1000) {
      setHudState('hidden');
      return;
    }

    const config = wisprService.getConfig();
    let text = '';

    if (config.transcriptionEngine === 'deepgram') {
      const dgResult = await deepgramService.transcribeAudioFile(wavPath, { language: config.language || 'en' });
      text = dgResult ? dgResult.text : '';
    } else {
      const model = config.modelSize || 'base.en';
      const result = await transcribeService.transcribeFile(wavPath, {
        model,
        language: config.language || 'en',
        skipConversion: true
      });
      text = result ? result.text : '';
    }

    if (text && text.trim()) {
      pasteAtCursor(text);
      setHudState('done');
    } else {
      setHudState('hidden');
    }
  } catch (err) {
    console.error('Dictation transcription error:', err);
    setHudState('hidden');
  } finally {
    isTranscribingInternal = false;
    // Cleanup temporary wav
    setTimeout(() => {
      try { if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath); } catch (e) {}
    }, 4000);
  }
}

// OpenWispr Watcher (tracks external Open-Wispr push-to-talk daemon dictation)
function setupOpenWisprWatcher() {
  const tmpDir = os.tmpdir();
  const recordingsDir = path.join(os.homedir(), '.config', 'open-wispr', 'recordings');
  if (!fs.existsSync(recordingsDir)) {
    try { fs.mkdirSync(recordingsDir, { recursive: true }); } catch (e) {}
  }

  let isEvaluating = false;
  let activeRecordingFile = null;
  let lastFileSize = -1;
  let stableTicksCount = 0;
  const processedFiles = new Set();

  // Seed existing recordings so old files are never flagged as new
  try {
    if (fs.existsSync(recordingsDir)) {
      for (const f of fs.readdirSync(recordingsDir)) {
        processedFiles.add(path.join(recordingsDir, f));
      }
    }
  } catch (e) {}

  function evaluateState() {
    // If Wispr Studio's internal dictation or file transcription is active, don't interfere
    if (isDictating || isTranscribingInternal || isEvaluating) return;
    isEvaluating = true;

    try {
      const now = Date.now();
      let candidateFile = null;
      let candidateStat = null;

      // 1. Check dedicated Open-Wispr recordings directory
      try {
        if (fs.existsSync(recordingsDir)) {
          const files = fs.readdirSync(recordingsDir).filter(f => f.endsWith('.wav'));
          for (const f of files) {
            const full = path.join(recordingsDir, f);
            if (processedFiles.has(full)) continue;
            try {
              const s = fs.statSync(full);
              // Only consider files modified within the last 4 seconds
              if (now - s.mtimeMs < 4000) {
                if (!candidateStat || s.mtimeMs > candidateStat.mtimeMs) {
                  candidateFile = full;
                  candidateStat = s;
                }
              } else {
                processedFiles.add(full);
              }
            } catch (e) {}
          }
        }
      } catch (e) {}

      // 2. Check tmpDir specifically for open-wispr-recording*.wav (do not watch entire tmp)
      if (!candidateFile) {
        try {
          const tmpFiles = fs.readdirSync(tmpDir).filter(f => f.startsWith('open-wispr-recording') && f.endsWith('.wav'));
          for (const f of tmpFiles) {
            const full = path.join(tmpDir, f);
            if (processedFiles.has(full)) continue;
            try {
              const s = fs.statSync(full);
              if (now - s.mtimeMs < 4000) {
                if (!candidateStat || s.mtimeMs > candidateStat.mtimeMs) {
                  candidateFile = full;
                  candidateStat = s;
                }
              } else {
                processedFiles.add(full);
              }
            } catch (e) {}
          }
        } catch (e) {}
      }

      // 3. State Evaluation: Deterministic signaling from whisper_cli_wrapper
      const stateFile = '/tmp/wispr-active-state';
      if (fs.existsSync(stateFile)) {
        try {
          const signaledState = fs.readFileSync(stateFile, 'utf8').trim();
          if (signaledState === 'transcribing') {
            if (currentHudState !== 'transcribing') {
              setHudState('transcribing');
            }
            return;
          } else if (signaledState === 'done') {
            try { fs.unlinkSync(stateFile); } catch (e) {}
            if (currentHudState !== 'done') {
              setHudState('done');
            }
            return;
          }
        } catch (e) {}
      }

      // If an active recording file exists (and whisper-cli is not running yet):
      if (candidateFile) {
        if (currentHudState !== 'recording' && currentHudState !== 'transcribing') {
          setHudState('recording');
        }
      } else {
        // No active recording file and no active whisper-cli state:
        if (currentHudState === 'recording') {
          setTimeout(() => {
            if (!fs.existsSync(stateFile) && currentHudState === 'recording') {
              setHudState('hidden');
            }
          }, 600);
        }
      }
    } catch (err) {
      // Ignore evaluation errors
    } finally {
      isEvaluating = false;
    }
  }

  // Watch open-wispr recordings directory directly
  try {
    fs.watch(recordingsDir, { persistent: false }, () => {
      evaluateState();
    });
  } catch (e) {}

  // Gentle 600ms poll interval (uses < 0.05% CPU, zero process spawns)
  openWisprWatcher = setInterval(evaluateState, 600);
}

// Global Hotkey Setup
function registerGlobalHotkeys() {
  try {
    globalShortcut.unregisterAll();

    // Register F5 for push-to-talk / toggle live dictation
    const registered = globalShortcut.register('F5', () => {
      toggleDictation();
    });

    if (!registered) {
      // Fallback shortcut if F5 is reserved by macOS function keys
      globalShortcut.register('Option+Space', () => {
        toggleDictation();
      });
    }
  } catch (err) {
    console.warn('Could not register global hotkey:', err);
  }
}

// IPC Handlers for HUD
ipcMain.handle('hud:setCorner', (event, corner) => {
  hudCorner = corner;
  if (hudWindow && !hudWindow.isDestroyed()) {
    const primaryDisplay = screen.getPrimaryDisplay();
    const pos = getHudPosition(hudCorner, primaryDisplay.workArea, 240, 72);
    hudWindow.setPosition(pos.x, pos.y, false);
  }
  return true;
});

ipcMain.handle('hud:testState', (event, state) => {
  setHudState(state);
  return true;
});

ipcMain.handle('dictation:toggle', () => {
  toggleDictation();
  return { isDictating };
});

// App Lifecycle
app.whenReady().then(async () => {
  // Explicitly ensure the app never starts at login
  try {
    app.setLoginItemSettings({
      openAtLogin: false
    });
  } catch (e) {}

  // Open the main transcription window immediately when launched
  openMainWindow();

  // Sync Deepgram API Key from .env.local if available
  try {
    const dgKey = deepgramService.getApiKey();
    if (dgKey) {
      wisprService.saveConfig({ deepgramApiKey: dgKey });
    }
  } catch (e) {}

  app.on('activate', () => {
    openMainWindow();
  });
});

app.on('before-quit', () => {
  isQuitting = true;
  if (activeDictationProc) {
    try { activeDictationProc.kill('SIGKILL'); } catch (e) {}
  }
});

app.on('window-all-closed', () => {
  // Quit completely when window is closed (zero background memory/CPU)
  app.quit();
});
