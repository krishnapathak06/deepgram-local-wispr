# Wispr Studio 🎙️⚡

A native macOS application and dashboard designed for **Open-Wispr** voice dictation and **superfast local audio/video file transcription** powered by **Apple Silicon Metal GPU hardware acceleration**.

> 🔒 **100% Local & Offline**: All speech recognition is processed on your device using Whisper.cpp with Apple Metal GPU (`MTL0`). Zero audio data or telemetry is sent to any cloud server.

---

## ✨ Features

### 1. ⚡ Superfast Drag & Drop File Transcription
- **Universal Format Support**: Drag and drop, click to browse, or paste (<kbd>⌘V</kbd>) audio and video files (`MP3`, `WAV`, `M4A`, `AAC`, `FLAC`, `OGG`, `MP4`, `MOV`, `MKV`, `WEBM`).
- **Dedicated Model Selector**: Select which local Whisper model to transcribe with (`base.en`, `large-v3-turbo`, `medium.en`, `small.en`, `base`, etc.).
- **Hardware Acceleration**: Automatic Apple Metal GPU offloading (`MTL0` on Apple M2) via `whisper-cli` with flash attention enabled.
- **Real-Time Progress**: Live percentage streaming and inference metrics (e.g., audio duration, inference elapsed time).
- **Rich Multi-Format Export**:
  - 📋 **One-Click Copy Text**
  - 📄 **Plain Text (`.txt`)**
  - 🎬 **SubRip Subtitles (`.srt`)**
  - 🌐 **WebVTT Subtitles (`.vtt`)**
  - 📝 **Markdown (`.md`)** with properties table and timestamps
  - ⚙️ **Raw Structured JSON (`.json`)**
- **Interactive Segment Inspector**: Clickable timestamp chips `[00:01 → 00:05]` with in-transcript keyword search.

### 2. 🎛️ Open-Wispr Dictation Controller
- **Real-Time Daemon Status**: Live indicator showing whether the Open-Wispr push-to-talk daemon is active, its PID, and hotkey.
- **Instant Start / Stop**: One-click toggling to start or stop the voice dictation background daemon.
- **Menubar Tray Companion**: Native macOS menubar tray icon with quick start/stop and instant dictation model switching.

### 3. ⚙️ Complete Settings Configuration
- **Push-to-Talk Hotkey**: Easily select `Globe / fn key`, `Right Option`, `F5`, `Ctrl + Space`, or custom keys.
- **Toggle Mode**: Toggle between tap-to-talk (start/stop) or push-and-hold.
- **Microphone Selection**: Choose between built-in MacBook microphones or external USB/Bluetooth mics.
- **Dictation Model**: Switch system-wide dictation model loaded into RAM.
- **Spoken Punctuation**: Enable or disable spoken punctuation interpretation.

### 4. 📦 Local Models Hub
- Scans `~/.config/open-wispr/models/` for existing `ggml-*.bin` models.
- Displays file sizes, accuracy tiers, and speed ratings.
- One-click downloader for any additional official Whisper model (`large-v3`, `medium`, `small`, `tiny`).

---

## 🚀 Getting Started

### Prerequisites
- macOS Apple Silicon (M1/M2/M3/M4)
- `open-wispr` installed (e.g., via Homebrew at `/opt/homebrew/bin/open-wispr`)
- `whisper-cli` (installed via Homebrew at `/opt/homebrew/bin/whisper-cli`)
- `ffmpeg` (installed via Homebrew at `/opt/homebrew/bin/ffmpeg`)
- Node.js (v18+)

### Launching the Application

Run the launcher script:
```bash
./launch.sh
```

Or run via npm:
```bash
# Launch native macOS desktop app
npm start

# Or launch local web dashboard (http://localhost:3000)
npm run web
```

---

## 🛠️ Project Structure

```
audio-transcriber-wispr/
├── launch.sh                     # Quick launch script
├── package.json                  # Dependencies and scripts
├── src/
│   ├── main.js                   # Electron main process & menubar tray
│   ├── preload.js                # Secure IPC bridge
│   ├── server.js                 # Standalone local HTTP + SSE server
│   ├── services/
│   │   ├── wisprService.js       # Open-Wispr daemon, config & model manager
│   │   └── transcribeService.js  # Whisper.cpp Metal GPU transcription engine
│   └── ui/
│       ├── index.html            # Dark-glass modern macOS user interface
│       ├── styles.css            # Responsive styles and animations
│       └── app.js                # Dual-mode (IPC / REST) application logic
└── scripts/
    └── test_services.js          # Automated end-to-end service verification
```

---

## 🔒 Privacy & Local Processing
No internet connection is required to transcribe files or use dictation. All models and speech inference execute directly on the Neural Engine / Metal GPU of your Mac.
