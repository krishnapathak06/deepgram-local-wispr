#!/bin/sh
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

if [ -x "/opt/homebrew/bin/node" ]; then
  NODE_EXEC="/opt/homebrew/bin/node"
elif [ -x "/usr/local/bin/node" ]; then
  NODE_EXEC="/usr/local/bin/node"
else
  NODE_EXEC="node"
fi

WRAPPER_SCRIPT="/Users/gauravpathak/Documents/GitHub/audio-transcriber-wispr/scripts/whisper_cli_wrapper.js"

if [ -f "$WRAPPER_SCRIPT" ]; then
  exec "$NODE_EXEC" "$WRAPPER_SCRIPT" "$@"
else
  exec /opt/homebrew/Cellar/whisper.cpp/1.9.1/bin/whisper-cli "$@"
fi
