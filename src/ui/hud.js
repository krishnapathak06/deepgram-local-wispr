// Floating HUD Controller
const pill = document.getElementById('hudPill');
const recordingView = document.getElementById('recordingView');
const transcribingView = document.getElementById('transcribingView');
const doneView = document.getElementById('doneView');

let currentState = 'hidden';
let autoHideTimer = null;

function setHudState(state) {
  currentState = state;
  clearTimeout(autoHideTimer);

  if (state === 'hidden') {
    pill.classList.add('state-hidden');
    return;
  }

  // Ensure pill is visible
  pill.classList.remove('state-hidden');

  // Deactivate all views
  recordingView.classList.remove('active');
  transcribingView.classList.remove('active');
  doneView.classList.remove('active');

  if (state === 'recording') {
    recordingView.classList.add('active');
    // Generous watchdog (10 minutes) only as a crash safeguard — never cut off active speech
    autoHideTimer = setTimeout(() => {
      setHudState('hidden');
    }, 600000);
  } else if (state === 'transcribing') {
    transcribingView.classList.add('active');
    // Generous watchdog (60s) for heavy models/long audio — wait for real completion
    autoHideTimer = setTimeout(() => {
      setHudState('done');
    }, 60000);
  } else if (state === 'done') {
    doneView.classList.add('active');
    // Display checkmark briefly then fade out
    autoHideTimer = setTimeout(() => {
      setHudState('hidden');
    }, 650);
  }
}

// Click to manually dismiss if ever clicked
pill.addEventListener('click', () => {
  setHudState('hidden');
});

// Listen for messages from main process via IPC or window postMessage
if (window.electronAPI && window.electronAPI.onHudState) {
  window.electronAPI.onHudState((data) => {
    setHudState(data.state);
  });
}

// Fallback listener for window message
window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'hud:state') {
    setHudState(event.data.state);
  }
});
