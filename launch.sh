#!/usr/bin/env bash
# Wispr Studio — Launch Script

# Ensure Homebrew and Node binaries are in PATH (crucial for macOS Automator / GUI apps)
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:$PATH"

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

echo "⚡ Starting Wispr Studio..."

# Check if electron is available
if [ -f "./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" ]; then
    echo "🚀 Launching native macOS Electron desktop application..."
    if [ ! -t 1 ]; then
        # Running from Automator or macOS GUI - detach so Automator finishes immediately
        nohup ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron . "$@" >/dev/null 2>&1 &
        exit 0
    else
        exec ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron . "$@"
    fi
else
    echo "🌐 Starting Wispr Studio local web dashboard..."
    node src/server.js &
    SERVER_PID=$!
    sleep 1
    open "http://localhost:3000"
    wait $SERVER_PID
fi
