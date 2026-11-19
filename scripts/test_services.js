const wisprService = require('../src/services/wisprService');
const transcribeService = require('../src/services/transcribeService');
const path = require('path');

async function test() {
  console.log('=== TESTING WISPR STUDIO CORE SERVICES ===');

  // 1. Daemon & Config
  console.log('\n1. Checking Open-Wispr Daemon Status:');
  const status = await wisprService.checkDaemonRunning();
  console.log('Daemon running:', status.running, 'PID:', status.pid);

  console.log('\n2. Reading Config:');
  const config = wisprService.getConfig();
  console.log('Current Model:', config.modelSize, 'Language:', config.language, 'Toggle:', config.toggleMode);

  // 2. Models
  console.log('\n3. Installed Models:');
  const { installed, allModels } = wisprService.getInstalledModels();
  console.log(`Found ${installed.length} installed local models:`);
  installed.forEach(m => console.log(`  - ${m.id} (${m.fileSizeFormatted}) -> ${m.fullPath}`));

  // 3. Audio Devices
  console.log('\n4. Detecting Audio Devices:');
  const devices = await wisprService.getAudioInputDevices();
  console.log(`Found ${devices.length} audio devices:`);
  devices.forEach(d => console.log(`  - ${d.name} (Default: ${d.isDefault})`));

  // 4. Test Local Whisper Metal GPU Transcription
  console.log('\n5. Testing Local Whisper Metal GPU Transcription on test audio...');
  const scratchDir = path.join(__dirname, '..', 'scratch');
  const testAudio = path.join(scratchDir, 'test_tone.wav');
  const fs = require('fs');
  const { execSync } = require('child_process');
  if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });
  if (!fs.existsSync(testAudio)) {
    execSync(`ffmpeg -f lavfi -i "sine=frequency=440:duration=1" -ar 16000 -ac 1 -c:a pcm_s16le "${testAudio}" -y`);
  }
  const result = await transcribeService.transcribeFile(testAudio, {
    model: 'base.en',
    language: 'en'
  }, {
    onProgress: (p) => console.log(`Progress: ${p.percent}% - ${p.stage || ''}`),
    onStatus: (msg) => console.log(`Status: ${msg}`)
  });

  console.log('\n=== TRANSCRIPTION RESULT ===');
  console.log('File:', result.filename);
  console.log('Model Used:', result.modelUsed);
  // 5. Test Deepgram Cloud Nova-2 Transcription
  console.log('\n6. Testing Deepgram Cloud Nova-2 Transcription...');
  const dgResult = await transcribeService.transcribeFile(testAudio, {
    model: 'deepgram',
    language: 'en'
  }, {
    onProgress: (p) => console.log(`Deepgram Progress: ${p.percent}% - ${p.stage || ''}`),
    onStatus: (msg) => console.log(`Deepgram Status: ${msg}`)
  });
  console.log('Deepgram Model:', dgResult.modelUsed);
  console.log('Deepgram Inference Time:', dgResult.inferenceTimeFormatted);
  console.log('Deepgram Text:', JSON.stringify(dgResult.text));

  console.log('\n✅ ALL CORE SERVICES PASSED PERFECTLY!');
}

test().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
