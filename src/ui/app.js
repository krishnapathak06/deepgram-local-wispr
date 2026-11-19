// Wispr Studio Client Logic
// Seamlessly operates in both Electron (IPC) and Browser (REST + SSE) modes

const isElectron = !!(window.api && window.api.system && window.api.system.isElectron);
const API_BASE = window.location.origin;

let appState = {
  daemon: { running: false, pid: null },
  config: {},
  models: { installed: [], allModels: [] },
  devices: [],
  currentTranscript: null,
  activeQueue: []
};

// DOM Elements
const navItems = document.querySelectorAll('.nav-btn, .nav-item');
const tabPanes = document.querySelectorAll('.tab-content, .tab-pane');
const pageTitle = document.getElementById('page-title');

// Topbar & Sidebar Daemon Controls
const topbarPulse = document.getElementById('topbar-pulse');
const topbarDaemonLabel = document.getElementById('topbar-daemon-label');
const topbarToggleBtn = document.getElementById('topbar-toggle-daemon-btn');
const sidebarIndicator = document.getElementById('sidebar-daemon-indicator');
const sidebarDaemonText = document.getElementById('sidebar-daemon-text');
const sidebarHotkeyText = document.getElementById('sidebar-hotkey-text');
const sidebarToggleBtn = document.getElementById('sidebar-toggle-daemon-btn');
const daemonNavDot = document.getElementById('daemon-nav-dot');

// Hero Tab Elements
const heroStatusAvatar = document.getElementById('hero-status-avatar');
const heroStatusBadge = document.getElementById('hero-status-badge');
const heroPidBadge = document.getElementById('hero-pid-badge');
const heroHotkeyBadge = document.getElementById('hero-hotkey-badge');
const heroStartBtn = document.getElementById('hero-start-btn');
const heroStopBtn = document.getElementById('hero-stop-btn');
const heroToggleBtn = document.getElementById('hero-toggle-btn');
const infoHotkey = document.getElementById('info-hotkey');
const infoModel = document.getElementById('info-model');
const infoToggle = document.getElementById('info-toggle');
const infoPunctuation = document.getElementById('info-punctuation');
const infoDevice = document.getElementById('info-device');

// Transcribe Elements
const dropzone = document.getElementById('dropzone');
const browseFilesBtn = document.getElementById('browse-files-btn');
const fileInputHidden = document.getElementById('file-input-hidden');
const transcribeModelSelect = document.getElementById('transcribe-model-select');
const transcribeLangSelect = document.getElementById('transcribe-language-select');
const transcribeQueueContainer = document.getElementById('transcribe-queue-container');
const queueItemsList = document.getElementById('queue-items-list');
const queueStatusText = document.getElementById('queue-status-text');

// Results Viewer Elements
const resultContainer = document.getElementById('result-container');
const resultFilename = document.getElementById('result-filename');
const resultTagModel = document.getElementById('result-tag-model');
const resultTagDuration = document.getElementById('result-tag-duration');
const resultTagTime = document.getElementById('result-tag-time');
const resultTagLang = document.getElementById('result-tag-lang');
const transcriptPlainText = document.getElementById('transcript-plain-text');
const transcriptSegmentsList = document.getElementById('transcript-segments-list');
const transcriptSrtPre = document.getElementById('transcript-srt-pre');
const transcriptMarkdownPre = document.getElementById('transcript-markdown-pre');
const transcriptSearchInput = document.getElementById('transcript-search-input');
const copyTextBtn = document.getElementById('copy-text-btn');
const exportDropdownBtn = document.getElementById('export-dropdown-btn');
const exportMenu = document.getElementById('export-menu');

// Settings Elements
const saveSettingsBtn = document.getElementById('save-settings-btn');
const settingEngine = document.getElementById('setting-engine');
const settingDeepgramStatus = document.getElementById('setting-deepgram-status');
const settingDeepgramBadge = document.getElementById('setting-deepgram-badge');
const settingHotkey = document.getElementById('setting-hotkey');
const settingToggleMode = document.getElementById('setting-toggle-mode');
const settingModel = document.getElementById('setting-model');
const settingLanguage = document.getElementById('setting-language');
const settingAudioDevice = document.getElementById('setting-audio-device');
const settingSpokenPunctuation = document.getElementById('setting-spoken-punctuation');

// Models Elements
const refreshModelsBtn = document.getElementById('refresh-models-btn');
const modelsCardsGrid = document.getElementById('models-cards-grid');
const modelLogBox = document.getElementById('model-log-box');
const modelLogOutput = document.getElementById('model-log-output');
const closeLogBtn = document.getElementById('close-log-btn');
const toast = document.getElementById('toast');

// --- Initialization ---

document.addEventListener('DOMContentLoaded', async () => {
  setupNavigation();
  setupDaemonControls();
  setupSettingsForm();
  setupDropzone();
  setupResultsViewer();
  setupModelHub();
  setupPasteHandler();

  await refreshAllStatus();

  // Listen for real-time events
  if (isElectron) {
    window.api.transcribe.onProgress(handleProgressEvent);
    window.api.transcribe.onStatus(handleStatusEvent);
    window.api.transcribe.onJobComplete(handleJobCompleteEvent);
    window.api.wispr.onDownloadLog(handleDownloadLogEvent);
  } else {
    setupSSE();
  }
});

// Navigation Handling
function setupNavigation() {
  navItems.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab');
      navItems.forEach(b => b.classList.remove('active'));
      tabPanes.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const targetPane = document.getElementById(tabId);
      if (targetPane) targetPane.classList.add('active');

      const titles = {
        'tab-transcribe': 'Transcribe',
        'tab-wispr': 'Dictation',
        'tab-settings': 'Settings',
        'tab-models': 'Models'
      };
      if (pageTitle) pageTitle.textContent = titles[tabId] || 'Wispr';
    });
  });
}

// Status & Daemon Control
async function refreshAllStatus() {
  try {
    let data;
    if (isElectron) {
      data = await window.api.wispr.getStatus();
    } else {
      const res = await fetch(`${API_BASE}/api/status`);
      data = await res.json();
    }

    appState.daemon = data.daemon || { running: false };
    appState.config = data.config || {};
    appState.models = data.models || { installed: [], allModels: [] };
    appState.devices = data.devices || [];

    updateDaemonUI(appState.daemon);
    updateConfigUI(appState.config);
    updateModelsUI(appState.models);
    updateAudioDevicesUI(appState.devices);
  } catch (err) {
    console.error('Error fetching status:', err);
  }
}

function updateDaemonUI(daemon) {
  const isRunning = daemon.running;

  // Pulse dots & labels
  if (topbarPulse) topbarPulse.className = `dot ${isRunning ? 'online' : 'dot-offline'}`;
  if (topbarDaemonLabel) topbarDaemonLabel.textContent = isRunning ? `Dictation on (${daemon.pid})` : 'Dictation off';
  if (topbarToggleBtn) {
    topbarToggleBtn.textContent = isRunning ? 'Stop' : 'Start';
  }

  if (sidebarIndicator) sidebarIndicator.className = `dot ${isRunning ? 'online' : 'dot-offline'}`;
  if (sidebarDaemonText) sidebarDaemonText.textContent = isRunning ? 'Dictation active' : 'Dictation stopped';
  if (sidebarToggleBtn) {
    sidebarToggleBtn.textContent = isRunning ? 'Stop Daemon' : 'Start Daemon';
  }
  if (daemonNavDot) daemonNavDot.className = `dot ${isRunning ? 'online' : 'dot-offline'}`;

  // Hero section
  if (heroStatusBadge) {
    heroStatusBadge.textContent = isRunning ? 'Active' : 'Stopped';
    heroStatusBadge.className = `chip ${isRunning ? 'chip-highlight' : ''}`;
  }
  if (heroPidBadge) {
    heroPidBadge.textContent = daemon.pid ? `PID: ${daemon.pid}` : 'PID: None';
  }
  if (heroStartBtn) {
    heroStartBtn.disabled = isRunning;
    heroStartBtn.style.opacity = isRunning ? '0.4' : '1';
    heroStartBtn.style.pointerEvents = isRunning ? 'none' : 'auto';
  }
  if (heroStopBtn) {
    heroStopBtn.disabled = !isRunning;
    heroStopBtn.style.opacity = !isRunning ? '0.4' : '1';
    heroStopBtn.style.pointerEvents = !isRunning ? 'none' : 'auto';
  }
  if (heroToggleBtn) {
    heroToggleBtn.textContent = isRunning ? 'Stop Daemon' : 'Start Daemon';
  }
}

function updateConfigUI(config) {
  const hotkeyStr = getHotkeyDescription(config);
  if (sidebarHotkeyText) sidebarHotkeyText.textContent = `Hotkey: ${hotkeyStr}`;
  if (heroHotkeyBadge) heroHotkeyBadge.textContent = `Hotkey: ${hotkeyStr}`;
  if (infoHotkey) infoHotkey.textContent = hotkeyStr;
  if (infoModel) infoModel.textContent = config.modelSize || 'base.en';
  if (infoToggle) infoToggle.textContent = config.toggleMode ? 'Press once to start / press to stop' : 'Push and hold key';
  if (infoPunctuation) infoPunctuation.textContent = config.spokenPunctuation ? 'Enabled' : 'Disabled';
  if (infoDevice) infoDevice.textContent = config.audioInputDeviceUID || 'Built-in Microphone';

  // Form fields
  if (settingEngine) settingEngine.value = config.transcriptionEngine || 'deepgram';
  if (settingToggleMode) settingToggleMode.checked = !!config.toggleMode;
  if (settingSpokenPunctuation) settingSpokenPunctuation.checked = !!config.spokenPunctuation;
  if (settingLanguage && config.language) settingLanguage.value = config.language;
  if (settingModel && config.modelSize) settingModel.value = config.modelSize;

  if (settingDeepgramStatus) {
    if (config.deepgramApiKey) {
      settingDeepgramStatus.textContent = 'Active • Key loaded from .env.local';
      if (settingDeepgramBadge) {
        settingDeepgramBadge.textContent = 'Configured in .env.local ✓';
        settingDeepgramBadge.style.color = '#10b981';
      }
    } else {
      settingDeepgramStatus.textContent = 'Missing DEEPGRAM_API_KEY in .env.local';
      if (settingDeepgramBadge) {
        settingDeepgramBadge.textContent = 'Key Missing';
        settingDeepgramBadge.style.color = '#f59e0b';
      }
    }
  }

  // Sync hotkey dropdown
  if (settingHotkey) {
    if (config.hotkey && config.hotkey.keyCode === 63) {
      settingHotkey.value = 'globe';
    } else {
      settingHotkey.value = 'custom';
    }
  }
}

function getHotkeyDescription(config) {
  if (!config.hotkey) return 'Globe / fn key';
  if (config.hotkey.keyCode === 63) return 'Globe / fn key';
  if (config.hotkey.keyCode === 61) return 'Right Option key';
  if (config.hotkey.keyCode === 96) return 'F5 key';
  return `Key code ${config.hotkey.keyCode}`;
}

function updateModelsUI(modelsData) {
  const { installed = [], allModels = [] } = modelsData;

  // Update transcribe model select dropdown
  if (transcribeModelSelect) {
    const currentVal = transcribeModelSelect.value;
    transcribeModelSelect.innerHTML = '';

    allModels.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      const isDownloaded = m.isDownloaded ? '⚡' : '⬇️';
      opt.textContent = `${isDownloaded} ${m.id} (${m.name} • ${m.speed})`;
      if (m.id === currentVal || (m.id === 'base.en' && !currentVal)) {
        opt.selected = true;
      }
      transcribeModelSelect.appendChild(opt);
    });
  }

  // Update settings model select
  if (settingModel) {
    settingModel.innerHTML = '';
    allModels.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = `${m.id} (${m.fileSizeFormatted || m.size})`;
      if (m.id === appState.config.modelSize) opt.selected = true;
      settingModel.appendChild(opt);
    });
  }

  // Render cards in Model Hub
  if (modelsCardsGrid) {
    modelsCardsGrid.innerHTML = '';
    allModels.forEach(m => {
      const card = document.createElement('div');
      card.className = `model-card ${m.isDownloaded ? 'downloaded' : ''}`;

      card.innerHTML = `
        <div class="model-card-header">
          <h4>${m.name}</h4>
          <span class="chip ${m.isDownloaded ? 'chip-highlight' : ''}">${m.isDownloaded ? 'Installed' : 'Downloadable'}</span>
        </div>
        <p>${m.description || ''}</p>
        <div class="model-card-meta">
          <span>${m.speed}</span>
          <span>${m.fileSizeFormatted || m.size}</span>
        </div>
        <div class="model-card-actions">
          ${m.isDownloaded
            ? `<button class="btn-subtle" disabled>Ready</button>`
            : `<button class="btn-ghost download-model-btn" data-model="${m.id}">Download</button>`
          }
        </div>
      `;

      modelsCardsGrid.appendChild(card);
    });

    document.querySelectorAll('.download-model-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const modelId = btn.getAttribute('data-model');
        downloadModel(modelId);
      });
    });
  }
}

function updateAudioDevicesUI(devices) {
  if (settingAudioDevice && devices.length > 0) {
    settingAudioDevice.innerHTML = '';
    devices.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.uid || d.id;
      opt.textContent = `${d.name} ${d.isDefault ? '(Default)' : ''}`;
      if (d.uid === appState.config.audioInputDeviceUID || d.isDefault) {
        opt.selected = true;
      }
      settingAudioDevice.appendChild(opt);
    });
  }
}

function setupDaemonControls() {
  const setBusy = (busy, label) => {
    [topbarToggleBtn, sidebarToggleBtn, heroToggleBtn, heroStartBtn, heroStopBtn].forEach(btn => {
      if (btn) {
        btn.disabled = busy;
      }
    });
    if (busy && label) {
      if (topbarToggleBtn) topbarToggleBtn.textContent = label;
      if (sidebarToggleBtn) sidebarToggleBtn.textContent = label;
    }
  };

  const startDaemonAction = async () => {
    setBusy(true, 'Starting...');
    showToast('Starting Open-Wispr...');
    try {
      let res;
      if (isElectron) {
        res = await window.api.wispr.start();
      } else {
        res = await fetch(`${API_BASE}/api/wispr/start`, { method: 'POST' }).then(r => r.json());
      }
      await refreshAllStatus();
      showToast(res.message || 'Daemon started');
    } catch (err) {
      showToast(`Error: ${err.message}`);
      await refreshAllStatus();
    } finally {
      setBusy(false);
      updateDaemonUI(appState.daemon);
    }
  };

  const stopDaemonAction = async () => {
    setBusy(true, 'Stopping...');
    showToast('Stopping Open-Wispr...');
    try {
      let res;
      if (isElectron) {
        res = await window.api.wispr.stop();
      } else {
        res = await fetch(`${API_BASE}/api/wispr/stop`, { method: 'POST' }).then(r => r.json());
      }
      appState.daemon.running = false;
      appState.daemon.pid = null;
      updateDaemonUI(appState.daemon);

      await refreshAllStatus();
      showToast(res.message || 'Daemon stopped');
    } catch (err) {
      showToast(`Error: ${err.message}`);
      await refreshAllStatus();
    } finally {
      setBusy(false);
      updateDaemonUI(appState.daemon);
    }
  };

  const toggleDaemon = async () => {
    if (appState.daemon.running) {
      await stopDaemonAction();
    } else {
      await startDaemonAction();
    }
  };

  if (topbarToggleBtn) topbarToggleBtn.addEventListener('click', toggleDaemon);
  if (sidebarToggleBtn) sidebarToggleBtn.addEventListener('click', toggleDaemon);
  if (heroToggleBtn) heroToggleBtn.addEventListener('click', toggleDaemon);
  if (heroStartBtn) heroStartBtn.addEventListener('click', startDaemonAction);
  if (heroStopBtn) heroStopBtn.addEventListener('click', stopDaemonAction);
}

// Settings Form Handling
function setupSettingsForm() {
  if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      const updated = {
        transcriptionEngine: settingEngine ? settingEngine.value : 'deepgram',
        modelSize: settingModel ? settingModel.value : 'base.en',
        toggleMode: settingToggleMode ? settingToggleMode.checked : true,
        language: settingLanguage ? settingLanguage.value : 'en',
        spokenPunctuation: settingSpokenPunctuation ? settingSpokenPunctuation.checked : false,
        audioInputDeviceUID: settingAudioDevice ? settingAudioDevice.value : 'BuiltInMicrophoneDevice'
      };

      if (settingHotkey && settingHotkey.value === 'globe') {
        updated.hotkey = { modifiers: [], keyCode: 63 };
        updated.hotkeys = [{ modifiers: [], keyCode: 63 }];
      } else if (settingHotkey && settingHotkey.value === 'rightoption') {
        updated.hotkey = { modifiers: [], keyCode: 61 };
        updated.hotkeys = [{ modifiers: [], keyCode: 61 }];
      } else if (settingHotkey && settingHotkey.value === 'f5') {
        updated.hotkey = { modifiers: [], keyCode: 96 };
        updated.hotkeys = [{ modifiers: [], keyCode: 96 }];
      }

      showToast('Saving settings to Open-Wispr config...');
      try {
        if (isElectron) {
          await window.api.wispr.saveConfig(updated);
        } else {
          await fetch(`${API_BASE}/api/wispr/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updated)
          });
        }
        await refreshAllStatus();
        showToast('Settings saved & applied successfully!');
      } catch (err) {
        showToast(`Save failed: ${err.message}`);
      }
    });
  }
}

// Drag & Drop and File Selection
function setupDropzone() {
  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('dragover');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('dragover');
    }, false);
  });

  dropzone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      handleFilesSelected(files);
    }
  });

  dropzone.addEventListener('click', () => {
    if (isElectron) {
      selectFilesViaNativeDialog();
    } else if (fileInputHidden) {
      fileInputHidden.click();
    }
  });

  if (browseFilesBtn) {
    browseFilesBtn.addEventListener('click', () => {
      if (isElectron) {
        selectFilesViaNativeDialog();
      } else if (fileInputHidden) {
        fileInputHidden.click();
      }
    });
  }

  if (fileInputHidden) {
    fileInputHidden.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        handleFilesSelected(e.target.files);
      }
    });
  }
}

// Handle Paste from Clipboard
function setupPasteHandler() {
  window.addEventListener('paste', async (e) => {
    // If inside text editor, don't hijack
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
      return;
    }

    if (e.clipboardData && e.clipboardData.files && e.clipboardData.files.length > 0) {
      e.preventDefault();
      showToast('Pasted file detected, starting transcription...');
      handleFilesSelected(e.clipboardData.files);
      return;
    }

    const text = e.clipboardData ? e.clipboardData.getData('text') : '';
    if (text && (text.startsWith('/') || text.startsWith('file://')) && (text.includes('.mp3') || text.includes('.wav') || text.includes('.m4a') || text.includes('.mp4') || text.includes('.mov'))) {
      const cleanPath = text.replace(/^file:\/\//, '').trim();
      showToast(`Pasted path: ${cleanPath}`);
      startTranscriptionForPaths([cleanPath]);
    }
  });
}

async function selectFilesViaNativeDialog() {
  try {
    const filePaths = await window.api.dialog.selectFiles();
    if (filePaths && filePaths.length > 0) {
      startTranscriptionForPaths(filePaths);
    }
  } catch (err) {
    console.error('File dialog error:', err);
  }
}

async function handleFilesSelected(fileList) {
  const model = transcribeModelSelect.value;
  const language = transcribeLangSelect.value;

  if (isElectron) {
    const filePaths = [];
    for (let i = 0; i < fileList.length; i++) {
      const f = fileList[i];
      if (f.path) {
        filePaths.push(f.path);
      }
    }
    if (filePaths.length > 0) {
      return startTranscriptionForPaths(filePaths);
    }
  }

  // Web Browser mode: upload files via multipart POST
  const formData = new FormData();
  formData.append('model', model);
  formData.append('language', language);
  for (let i = 0; i < fileList.length; i++) {
    formData.append('files', fileList[i]);
  }

  showQueueUI(Array.from(fileList).map(f => ({ name: f.name, size: f.size })));

  try {
    const res = await fetch(`${API_BASE}/api/transcribe/upload`, {
      method: 'POST',
      body: formData
    });
    const result = await res.json();
    if (result.results && result.results.length > 0) {
      renderCompletedTranscript(result.results[0]);
    }
  } catch (err) {
    showToast(`Upload failed: ${err.message}`);
  }
}

async function startTranscriptionForPaths(filePaths) {
  const model = transcribeModelSelect.value;
  const language = transcribeLangSelect.value;

  showQueueUI(filePaths.map(p => ({ name: p.split('/').pop(), path: p })));

  try {
    if (isElectron) {
      const results = await window.api.transcribe.start(filePaths, { model, language });
      if (results && results.length > 0) {
        renderCompletedTranscript(results[0]);
      }
    } else {
      const res = await fetch(`${API_BASE}/api/transcribe/paths`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePaths, model, language })
      });
      const data = await res.json();
      if (data.results && data.results.length > 0) {
        renderCompletedTranscript(data.results[0]);
      }
    }
  } catch (err) {
    showToast(`Transcription error: ${err.message}`);
  }
}

function showQueueUI(files) {
  if (transcribeQueueContainer) transcribeQueueContainer.classList.remove('hidden');
  if (queueItemsList) {
    queueItemsList.innerHTML = '';
    files.forEach((f, idx) => {
      const item = document.createElement('div');
      item.className = 'queue-item';
      item.id = `queue-item-${idx}`;
      item.innerHTML = `
        <div class="queue-item-meta">
          <span class="queue-item-name">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 18V5l12-2v13"/>
              <circle cx="6" cy="18" r="3"/>
              <circle cx="18" cy="16" r="3"/>
            </svg>
            ${f.name}
          </span>
          <span class="queue-stage-text" id="stage-text-${idx}">Converting audio...</span>
        </div>
        <div class="queue-progress-bar">
          <div class="queue-progress-fill" id="progress-fill-${idx}" style="width: 15%;"></div>
        </div>
      `;
      queueItemsList.appendChild(item);
    });
  }
}

function handleProgressEvent(p) {
  const fill = document.getElementById('progress-fill-0');
  const stage = document.getElementById('stage-text-0');
  if (fill) fill.style.width = `${p.percent}%`;
  if (stage) stage.textContent = p.stage || `Transcribing on Metal GPU: ${p.percent}%`;
  if (queueStatusText) queueStatusText.textContent = `${p.percent}% • Apple Metal GPU`;
}

function handleStatusEvent(s) {
  const stage = document.getElementById('stage-text-0');
  if (stage && s.message) stage.textContent = s.message;
}

function handleJobCompleteEvent(result) {
  renderCompletedTranscript(result);
}

function renderCompletedTranscript(result) {
  appState.currentTranscript = result;

  if (transcribeQueueContainer) transcribeQueueContainer.classList.add('hidden');
  if (resultContainer) resultContainer.classList.remove('hidden');

  if (resultFilename) resultFilename.textContent = result.filename;
  if (resultTagModel) resultTagModel.textContent = result.modelUsed;
  if (resultTagDuration) resultTagDuration.textContent = result.duration || '00:00';
  if (resultTagTime) resultTagTime.textContent = result.inferenceTimeFormatted || '1.0s';
  if (resultTagLang) resultTagLang.textContent = result.language;

  if (transcriptPlainText) transcriptPlainText.innerText = result.text || '';
  if (transcriptSrtPre) transcriptSrtPre.textContent = result.srt || '';
  if (transcriptMarkdownPre) transcriptMarkdownPre.textContent = result.markdown || '';

  // Render interactive segments
  if (transcriptSegmentsList) {
    transcriptSegmentsList.innerHTML = '';
    const segments = result.segments || [];
    if (segments.length === 0) {
      transcriptSegmentsList.innerHTML = '<p class="text-dim">No timestamp segments available.</p>';
    } else {
      segments.forEach(seg => {
        const segItem = document.createElement('div');
        segItem.className = 'segment-item';
        segItem.innerHTML = `
          <span class="segment-timestamp">[${seg.startFormatted} → ${seg.endFormatted}]</span>
          <span class="segment-text">${escapeHtml(seg.text)}</span>
        `;
        transcriptSegmentsList.appendChild(segItem);
      });
    }
  }

  showToast('Transcription completed superfast on Apple Metal GPU!');
}

function setupResultsViewer() {
  // View Switcher Tabs (Text, Segments, Subtitles, Markdown)
  const tabBtns = document.querySelectorAll('.fmt-tab, .tab-btn');
  const viewPanels = document.querySelectorAll('.view-panel');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.getAttribute('data-view');
      tabBtns.forEach(b => b.classList.remove('active'));
      viewPanels.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const panel = document.getElementById(`view-${view}`);
      if (panel) panel.classList.add('active');
    });
  });

  // Copy Text
  if (copyTextBtn) {
    copyTextBtn.addEventListener('click', () => {
      if (!appState.currentTranscript) return;
      const textToCopy = transcriptPlainText.innerText || appState.currentTranscript.text;
      if (isElectron) {
        window.api.clipboard.writeText(textToCopy);
      } else {
        navigator.clipboard.writeText(textToCopy);
      }
      showToast('Transcript copied to clipboard!');
    });
  }

  // Export Dropdown
  if (exportDropdownBtn && exportMenu) {
    exportDropdownBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      exportMenu.classList.toggle('show');
    });

    document.addEventListener('click', () => {
      exportMenu.classList.remove('show');
    });

    document.querySelectorAll('#export-menu button').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const type = btn.getAttribute('data-export');
        exportTranscript(type);
      });
    });
  }

  // Search within transcript
  if (transcriptSearchInput) {
    transcriptSearchInput.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase().trim();
      const segmentItems = document.querySelectorAll('.segment-item');
      segmentItems.forEach(item => {
        const text = item.textContent.toLowerCase();
        item.style.display = (!query || text.includes(query)) ? 'flex' : 'none';
      });
    });
  }
}

function exportTranscript(type) {
  if (!appState.currentTranscript) return;
  const t = appState.currentTranscript;
  const baseName = t.filename.replace(/\.[^/.]+$/, '');

  let content = '';
  let filename = '';

  switch (type) {
    case 'txt':
      content = transcriptPlainText.innerText || t.text;
      filename = `${baseName}_transcript.txt`;
      break;
    case 'srt':
      content = t.srt;
      filename = `${baseName}.srt`;
      break;
    case 'vtt':
      content = t.vtt;
      filename = `${baseName}.vtt`;
      break;
    case 'md':
      content = t.markdown;
      filename = `${baseName}_transcript.md`;
      break;
    case 'json':
      content = JSON.stringify(t, null, 2);
      filename = `${baseName}_transcript.json`;
      break;
  }

  if (isElectron) {
    window.api.dialog.saveFile(filename, content).then(res => {
      if (res && res.success) {
        showToast(`Saved to ${res.filePath.split('/').pop()}`);
      }
    });
  } else {
    // Browser download blob
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported ${filename}`);
  }
}

// Model Hub & Downloader
function setupModelHub() {
  if (refreshModelsBtn) {
    refreshModelsBtn.addEventListener('click', refreshAllStatus);
  }
  if (closeLogBtn) {
    closeLogBtn.addEventListener('click', () => {
      if (modelLogBox) modelLogBox.classList.add('hidden');
    });
  }
}

async function downloadModel(modelId) {
  if (modelLogBox) modelLogBox.classList.remove('hidden');
  if (modelLogOutput) modelLogOutput.textContent = `Initiating download for ${modelId} via open-wispr download-model...\n`;

  try {
    if (isElectron) {
      await window.api.wispr.downloadModel(modelId);
    } else {
      await fetch(`${API_BASE}/api/wispr/download-model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId })
      });
    }
    showToast(`Model ${modelId} downloaded!`);
    await refreshAllStatus();
  } catch (err) {
    if (modelLogOutput) modelLogOutput.textContent += `\nError: ${err.message}`;
  }
}

function handleDownloadLogEvent(logText) {
  if (modelLogBox) modelLogBox.classList.remove('hidden');
  if (modelLogOutput) {
    modelLogOutput.textContent += logText;
    modelLogOutput.scrollTop = modelLogOutput.scrollHeight;
  }
}

// SSE Setup for Browser Mode
function setupSSE() {
  const eventSource = new EventSource(`${API_BASE}/api/events`);
  eventSource.addEventListener('wispr:statusChange', (e) => {
    const data = JSON.parse(e.data);
    appState.daemon = data;
    updateDaemonUI(data);
  });
  eventSource.addEventListener('wispr:configUpdated', (e) => {
    const data = JSON.parse(e.data);
    appState.config = data;
    updateConfigUI(data);
  });
  eventSource.addEventListener('transcribe:progress', (e) => {
    const data = JSON.parse(e.data);
    handleProgressEvent(data);
  });
  eventSource.addEventListener('transcribe:complete', (e) => {
    const data = JSON.parse(e.data);
    renderCompletedTranscript(data);
  });
  eventSource.addEventListener('wispr:downloadLog', (e) => {
    const data = JSON.parse(e.data);
    handleDownloadLogEvent(data);
  });
}

function showToast(msg) {
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.remove('hidden');
  setTimeout(() => {
    toast.classList.add('hidden');
  }, 2800);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
