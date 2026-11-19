const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, exec } = require('child_process');
const { MODELS_DIR, getInstalledModels } = require('./wisprService');
const deepgramService = require('./deepgramService');

const WHISPER_CLI = '/opt/homebrew/bin/whisper-cli';
const FFMPEG_BIN = '/opt/homebrew/bin/ffmpeg';
const TEMP_DIR = path.join(os.tmpdir(), 'wispr-transcriptions');

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// In-memory job registry
const activeJobs = new Map();
const completedHistory = [];

/**
 * Format milliseconds / seconds to HH:MM:SS or MM:SS
 */
function formatTimestamp(seconds) {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  const ms = Math.floor((seconds - totalSeconds) * 1000);

  const pad = (n, len = 2) => String(n).padStart(len, '0');
  if (hrs > 0) {
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)}.${pad(ms, 3)}`;
  }
  return `${pad(mins)}:${pad(secs)}.${pad(ms, 3)}`;
}

/**
 * Convert Deepgram word timestamps into natural subtitle segments
 */
function convertWordsToSegments(words) {
  if (!words || words.length === 0) return [];
  const segments = [];
  let currentWords = [];
  let startSec = words[0].start || 0;

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    currentWords.push(w.punctuated_word || w.word);

    const hasBreakPunctuation = /[.!?]$/.test(w.punctuated_word || w.word);
    const reachedLength = currentWords.length >= 8;

    if (hasBreakPunctuation || reachedLength || i === words.length - 1) {
      const endSec = w.end || (startSec + 1);
      segments.push({
        id: segments.length + 1,
        start: startSec,
        end: endSec,
        startFormatted: formatTimestamp(startSec),
        endFormatted: formatTimestamp(endSec),
        text: currentWords.join(' ').trim()
      });
      currentWords = [];
      if (i + 1 < words.length) {
        startSec = words[i + 1].start;
      }
    }
  }
  return segments;
}

function convertSegmentsToSrt(segments) {
  return segments.map((seg, idx) => {
    const startStr = formatTimestamp(seg.start).replace('.', ',');
    const endStr = formatTimestamp(seg.end).replace('.', ',');
    return `${idx + 1}\n${startStr} --> ${endStr}\n${seg.text}\n`;
  }).join('\n');
}

function convertSegmentsToVtt(segments) {
  let vtt = 'WEBVTT\n\n';
  segments.forEach((seg, idx) => {
    const startStr = formatTimestamp(seg.start);
    const endStr = formatTimestamp(seg.end);
    vtt += `${idx + 1}\n${startStr} --> ${endStr}\n${seg.text}\n\n`;
  });
  return vtt.trim();
}

/**
 * Convert any audio or video to 16kHz mono WAV for Whisper
 */
function convertTo16kHzWav(inputPath, outputPath, onProgress) {
  return new Promise((resolve, reject) => {
    if (onProgress) onProgress({ percent: 5, stage: 'Extracting and converting audio...' });

    const args = [
      '-i', inputPath,
      '-vn',
      '-ar', '16000',
      '-ac', '1',
      '-c:a', 'pcm_s16le',
      outputPath,
      '-y'
    ];

    const proc = spawn(FFMPEG_BIN, args);

    let errOutput = '';
    proc.stderr.on('data', (data) => {
      errOutput += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        if (onProgress) onProgress({ percent: 15, stage: 'Audio extracted, preparing local Whisper model...' });
        resolve(outputPath);
      } else {
        reject(new Error(`FFmpeg audio conversion failed: ${errOutput.slice(-300)}`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Get media duration using ffmpeg / ffprobe
 */
function getMediaDuration(inputPath) {
  return new Promise((resolve) => {
    exec(`ffmpeg -i "${inputPath}" 2>&1 | grep "Duration"`, (err, stdout) => {
      if (!err && stdout) {
        const match = stdout.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
        if (match) {
          const hours = parseFloat(match[1]);
          const minutes = parseFloat(match[2]);
          const seconds = parseFloat(match[3]);
          return resolve(hours * 3600 + minutes * 60 + seconds);
        }
      }
      resolve(null);
    });
  });
}

/**
 * Transcribe a single file using whisper-cli or Deepgram Cloud
 */
async function transcribeFile(filePath, options = {}, callbacks = {}) {
  const {
    model = 'deepgram',
    language = 'auto',
    threads = 4,
    flashAttn = true
  } = options;

  const { onProgress, onStatus } = callbacks;
  const jobId = 'job_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
  const startTime = Date.now();

  const fileStats = fs.statSync(filePath);
  const baseFilename = path.basename(filePath);

  const jobInfo = {
    id: jobId,
    filename: baseFilename,
    filePath,
    fileSize: fileStats.size,
    fileSizeFormatted: formatBytes(fileStats.size),
    modelUsed: (model === 'deepgram' || model === 'nova-2') ? 'Deepgram Nova-2 (Cloud)' : model,
    language,
    status: 'converting',
    progress: 0,
    startTime
  };
  activeJobs.set(jobId, jobInfo);

  // 1. Check if Deepgram Cloud model is selected
  if (model === 'deepgram' || model === 'nova-2') {
    try {
      jobInfo.status = 'transcribing';
      if (onStatus) onStatus('Transcribing with Deepgram Nova-2 Cloud API...');
      if (onProgress) onProgress({ jobId, percent: 25, stage: 'Uploading audio to Deepgram Cloud...' });

      const dgResult = await deepgramService.transcribeAudioFile(filePath, { language });
      if (onProgress) onProgress({ jobId, percent: 80, stage: 'Formatting subtitles & transcript...' });

      const duration = dgResult.duration || await getMediaDuration(filePath) || 0;
      const textContent = dgResult.text || '';
      const segments = convertWordsToSegments(dgResult.words);
      const srtContent = convertSegmentsToSrt(segments);
      const vttContent = convertSegmentsToVtt(segments);

      const markdownContent = generateMarkdown({
        filename: baseFilename,
        model: 'Deepgram Nova-2 (Cloud)',
        duration: duration ? formatTimestamp(duration) : 'Unknown',
        text: textContent,
        segments
      });

      const endTime = Date.now();
      const inferenceTimeMs = endTime - startTime;

      const result = {
        id: jobId,
        filename: baseFilename,
        filePath,
        fileSize: fileStats.size,
        fileSizeFormatted: formatBytes(fileStats.size),
        duration: duration ? formatTimestamp(duration) : null,
        durationSec: duration,
        modelUsed: 'Deepgram Nova-2 (Cloud)',
        language,
        inferenceTimeMs,
        inferenceTimeFormatted: `${(inferenceTimeMs / 1000).toFixed(1)}s`,
        text: textContent,
        srt: srtContent,
        vtt: vttContent,
        json: dgResult.json,
        segments,
        markdown: markdownContent,
        completedAt: new Date().toISOString()
      };

      jobInfo.status = 'completed';
      jobInfo.progress = 100;
      jobInfo.result = result;

      if (onProgress) onProgress({ jobId, percent: 100, stage: 'Complete!' });
      if (onStatus) onStatus('Cloud transcription finished successfully.');

      completedHistory.unshift(result);
      if (completedHistory.length > 50) completedHistory.pop();
      activeJobs.delete(jobId);
      return result;
    } catch (err) {
      jobInfo.status = 'error';
      jobInfo.error = err.message;
      activeJobs.delete(jobId);
      throw err;
    }
  }

  // 2. Locate local model
  const { installed } = getInstalledModels();
  let modelPath = null;
  const matchingModel = installed.find(m => m.id === model || m.filename === model || m.name === model);
  if (matchingModel && matchingModel.fullPath !== 'cloud:deepgram') {
    modelPath = matchingModel.fullPath;
  } else {
    // Check if directly in MODELS_DIR
    const candidate = path.join(MODELS_DIR, `ggml-${model}.bin`);
    if (fs.existsSync(candidate)) {
      modelPath = candidate;
    } else {
      // Pick first installed local model as fallback
      const localModels = installed.filter(m => m.fullPath !== 'cloud:deepgram');
      if (localModels.length > 0) {
        modelPath = localModels[0].fullPath;
        console.warn(`Requested model ${model} not found, falling back to ${localModels[0].id}`);
      } else {
        throw new Error(`Model ${model} is not downloaded. Please download it first.`);
      }
    }
  }

  // 3. Prepare output filenames
  const tempWav = path.join(TEMP_DIR, `${jobId}_16k.wav`);
  const outputBase = path.join(TEMP_DIR, `${jobId}_output`);
  jobInfo.modelUsed = path.basename(modelPath).replace(/^ggml-/, '').replace(/\.bin$/, '');

  try {
    let wavForWhisper = tempWav;
    let duration = null;

    if (options.skipConversion) {
      wavForWhisper = filePath;
      duration = Math.max(0.1, (fileStats.size - 44) / 32000);
      jobInfo.duration = duration;
      jobInfo.progress = 15;
    } else {
      // Convert to 16kHz mono WAV
      if (onStatus) onStatus('Extracting audio & optimizing for Whisper...');
      await convertTo16kHzWav(filePath, tempWav, (p) => {
        jobInfo.progress = p.percent;
        if (onProgress) onProgress({ jobId, ...p });
      });

      duration = await getMediaDuration(tempWav);
      jobInfo.duration = duration;
    }

    // 3. Build whisper-cli arguments
    const whisperArgs = [
      '-m', modelPath,
      '-f', wavForWhisper,
      '--print-progress',
      '--output-json',
      '--output-txt',
      '--output-srt',
      '--output-vtt',
      '-of', outputBase,
      '-t', String(threads)
    ];

    if (flashAttn) {
      whisperArgs.push('-fa');
    }

    if (language && language !== 'auto') {
      whisperArgs.push('-l', language);
    } else {
      whisperArgs.push('-l', 'auto');
    }

    jobInfo.status = 'transcribing';
    if (onStatus) onStatus('Running Whisper on Apple Metal GPU...');

    await new Promise((resolve, reject) => {
      const child = spawn(WHISPER_CLI, whisperArgs);
      jobInfo.process = child;

      let stdOutCombined = '';
      let stdErrCombined = '';

      const handleOutput = (chunk) => {
        const text = chunk.toString();
        // Look for: whisper_print_progress_callback: progress = 42%
        const match = text.match(/progress\s*=\s*(\d+)%/);
        if (match) {
          const pct = parseInt(match[1], 10);
          // Scale 15% -> 98%
          const scaled = Math.min(99, Math.round(15 + (pct * 0.84)));
          jobInfo.progress = scaled;
          if (onProgress) onProgress({ jobId, percent: scaled, stage: `Transcribing on Metal GPU: ${pct}%` });
        }
      };

      child.stdout.on('data', (data) => {
        stdOutCombined += data.toString();
        handleOutput(data);
      });

      child.stderr.on('data', (data) => {
        stdErrCombined += data.toString();
        handleOutput(data);
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`whisper-cli failed (code ${code}): ${stdErrCombined.slice(-400)}`));
        }
      });

      child.on('error', (err) => {
        reject(err);
      });
    });

    // 4. Parse output files
    const txtFile = `${outputBase}.txt`;
    const srtFile = `${outputBase}.srt`;
    const vttFile = `${outputBase}.vtt`;
    const jsonFile = `${outputBase}.json`;

    let textContent = '';
    let srtContent = '';
    let vttContent = '';
    let jsonContent = null;
    let segments = [];

    if (fs.existsSync(txtFile)) {
      textContent = fs.readFileSync(txtFile, 'utf8').trim();
    }
    if (fs.existsSync(srtFile)) {
      srtContent = fs.readFileSync(srtFile, 'utf8').trim();
    }
    if (fs.existsSync(vttFile)) {
      vttContent = fs.readFileSync(vttFile, 'utf8').trim();
    }
    if (fs.existsSync(jsonFile)) {
      try {
        jsonContent = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
        if (jsonContent && jsonContent.transcription) {
          segments = jsonContent.transcription.map((seg, idx) => {
            const startSec = (seg.timestamps && seg.timestamps.from) ? parseWhisperTimestamp(seg.timestamps.from) : (seg.from / 1000);
            const endSec = (seg.timestamps && seg.timestamps.to) ? parseWhisperTimestamp(seg.timestamps.to) : (seg.to / 1000);
            return {
              id: idx + 1,
              start: startSec,
              end: endSec,
              startFormatted: seg.timestamps ? seg.timestamps.from : formatTimestamp(startSec),
              endFormatted: seg.timestamps ? seg.timestamps.to : formatTimestamp(endSec),
              text: (seg.text || '').trim()
            };
          });
        }
      } catch (err) {
        console.warn('Failed parsing json output:', err);
      }
    }

    // Fallback parsing from SRT if JSON segments missing
    if (segments.length === 0 && srtContent) {
      segments = parseSrtToSegments(srtContent);
    }

    // Generate Markdown transcript
    const markdownContent = generateMarkdown({
      filename: baseFilename,
      model: jobInfo.modelUsed,
      duration: duration ? formatTimestamp(duration) : 'Unknown',
      text: textContent,
      segments
    });

    const endTime = Date.now();
    const inferenceTimeMs = endTime - startTime;

    const result = {
      id: jobId,
      filename: baseFilename,
      filePath,
      fileSize: fileStats.size,
      fileSizeFormatted: formatBytes(fileStats.size),
      duration: duration ? formatTimestamp(duration) : null,
      durationSec: duration,
      modelUsed: jobInfo.modelUsed,
      language,
      inferenceTimeMs,
      inferenceTimeFormatted: `${(inferenceTimeMs / 1000).toFixed(1)}s`,
      text: textContent,
      srt: srtContent,
      vtt: vttContent,
      json: jsonContent,
      segments,
      markdown: markdownContent,
      completedAt: new Date().toISOString()
    };

    jobInfo.status = 'completed';
    jobInfo.progress = 100;
    jobInfo.result = result;

    if (onProgress) onProgress({ jobId, percent: 100, stage: 'Complete!' });
    if (onStatus) onStatus('Transcription finished successfully.');

    // Add to history (keep top 50)
    completedHistory.unshift(result);
    if (completedHistory.length > 50) completedHistory.pop();

    // Clean up temporary files
    try {
      if (fs.existsSync(tempWav)) fs.unlinkSync(tempWav);
      if (fs.existsSync(txtFile)) fs.unlinkSync(txtFile);
      if (fs.existsSync(srtFile)) fs.unlinkSync(srtFile);
      if (fs.existsSync(vttFile)) fs.unlinkSync(vttFile);
      if (fs.existsSync(jsonFile)) fs.unlinkSync(jsonFile);
    } catch (e) {
      // Ignore cleanup error
    }

    activeJobs.delete(jobId);
    return result;

  } catch (err) {
    jobInfo.status = 'error';
    jobInfo.error = err.message;
    if (onStatus) onStatus(`Error: ${err.message}`);
    // Clean up temp wav
    try {
      if (fs.existsSync(tempWav)) fs.unlinkSync(tempWav);
    } catch (e) {}
    activeJobs.delete(jobId);
    throw err;
  }
}

function parseWhisperTimestamp(tsStr) {
  if (typeof tsStr === 'number') return tsStr;
  const parts = tsStr.replace(',', '.').split(':');
  if (parts.length === 3) {
    return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
  }
  if (parts.length === 2) {
    return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
  }
  return parseFloat(tsStr) || 0;
}

function parseSrtToSegments(srt) {
  const blocks = srt.split(/\n\s*\n/);
  const segments = [];
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length >= 2) {
      const timeMatch = lines[1].match(/(\d\d:\d\d:\d\d[,.]\d\d\d)\s*-->\s*(\d\d:\d\d:\d\d[,.]\d\d\d)/);
      if (timeMatch) {
        const text = lines.slice(2).join(' ').trim();
        segments.push({
          id: segments.length + 1,
          startFormatted: timeMatch[1],
          endFormatted: timeMatch[2],
          start: parseWhisperTimestamp(timeMatch[1]),
          end: parseWhisperTimestamp(timeMatch[2]),
          text
        });
      }
    }
  }
  return segments;
}

function generateMarkdown({ filename, model, duration, text, segments }) {
  let md = `# Transcription: ${filename}\n\n`;
  md += `| Property | Value |\n|---|---|\n`;
  md += `| **Model** | \`${model}\` (Local Metal GPU) |\n`;
  md += `| **Duration** | ${duration} |\n`;
  md += `| **Date** | ${new Date().toLocaleString()} |\n\n`;
  md += `## Full Text\n\n${text}\n\n`;

  if (segments && segments.length > 0) {
    md += `## Timestamps\n\n`;
    for (const seg of segments) {
      md += `- **[${seg.startFormatted} → ${seg.endFormatted}]** ${seg.text}\n`;
    }
  }
  return md;
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getHistory() {
  return completedHistory;
}

function getActiveJobs() {
  return Array.from(activeJobs.values()).map(j => ({
    id: j.id,
    filename: j.filename,
    fileSizeFormatted: j.fileSizeFormatted,
    modelUsed: j.modelUsed,
    status: j.status,
    progress: j.progress
  }));
}

function cancelJob(jobId) {
  const job = activeJobs.get(jobId);
  if (job && job.process) {
    try {
      job.process.kill('SIGTERM');
      activeJobs.delete(jobId);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
  return { success: false, error: 'Job not found' };
}

module.exports = {
  transcribeFile,
  getHistory,
  getActiveJobs,
  cancelJob
};
