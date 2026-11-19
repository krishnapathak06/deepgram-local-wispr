const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const wisprService = require('./services/wisprService');
const transcribeService = require('./services/transcribeService');

const PORT = process.env.PORT || 3000;
const UI_DIR = path.join(__dirname, 'ui');

// Connected SSE clients
const sseClients = new Set();

function broadcastSSE(eventType, data) {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

function parseMultipartBody(req, uploadDir) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) {
      return reject(new Error('Expected multipart/form-data'));
    }

    const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    if (!boundaryMatch) {
      return reject(new Error('No boundary in multipart request'));
    }
    const boundary = boundaryMatch[1] || boundaryMatch[2];
    const boundaryBuffer = Buffer.from(`--${boundary}`);

    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const fullBuffer = Buffer.concat(chunks);
      const files = [];
      const fields = {};

      let start = 0;
      while (start < fullBuffer.length) {
        const nextBoundary = fullBuffer.indexOf(boundaryBuffer, start);
        if (nextBoundary === -1) break;

        const partHeaderStart = nextBoundary + boundaryBuffer.length + 2; // skip CRLF
        const partHeaderEnd = fullBuffer.indexOf(Buffer.from('\r\n\r\n'), partHeaderStart);
        if (partHeaderEnd === -1) break;

        const headerStr = fullBuffer.subarray(partHeaderStart, partHeaderEnd).toString();
        const nextBoundaryPos = fullBuffer.indexOf(boundaryBuffer, partHeaderEnd + 4);
        const partEnd = nextBoundaryPos === -1 ? fullBuffer.length : nextBoundaryPos - 2; // skip trailing CRLF

        const partContent = fullBuffer.subarray(partHeaderEnd + 4, partEnd);

        // Parse Content-Disposition
        const dispMatch = headerStr.match(/Content-Disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]+)")?/i);
        if (dispMatch) {
          const fieldName = dispMatch[1];
          const filename = dispMatch[2];

          if (filename) {
            const safeName = Date.now() + '_' + path.basename(filename);
            const savedPath = path.join(uploadDir, safeName);
            fs.writeFileSync(savedPath, partContent);
            files.push({ originalName: filename, savedPath, size: partContent.length });
          } else {
            fields[fieldName] = partContent.toString().trim();
          }
        }

        start = nextBoundaryPos;
      }

      resolve({ files, fields });
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // SSE Stream
  if (pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    res.write(': connected\n\n');
    sseClients.add(res);

    req.on('close', () => {
      sseClients.delete(res);
    });
    return;
  }

  // REST API Endpoints
  if (pathname === '/api/status' && req.method === 'GET') {
    const daemon = await wisprService.checkDaemonRunning();
    const config = wisprService.getConfig();
    const models = wisprService.getInstalledModels();
    const devices = await wisprService.getAudioInputDevices();
    const history = transcribeService.getHistory();
    const active = transcribeService.getActiveJobs();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ daemon, config, models, devices, history, active }));
    return;
  }

  if (pathname === '/api/wispr/start' && req.method === 'POST') {
    const result = await wisprService.startDaemon();
    const status = await wisprService.checkDaemonRunning();
    broadcastSSE('wispr:statusChange', status);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  if (pathname === '/api/wispr/stop' && req.method === 'POST') {
    const result = await wisprService.stopDaemon();
    const status = await wisprService.checkDaemonRunning();
    broadcastSSE('wispr:statusChange', status);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  if (pathname === '/api/wispr/config' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        const result = wisprService.saveConfig(parsed);
        broadcastSSE('wispr:configUpdated', result.config);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (pathname === '/api/wispr/download-model' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { modelId } = JSON.parse(body);
        broadcastSSE('wispr:downloadLog', `Starting download for model: ${modelId}...`);
        const result = await wisprService.downloadModel(modelId, (log) => {
          broadcastSSE('wispr:downloadLog', log);
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (pathname === '/api/transcribe/upload' && req.method === 'POST') {
    const uploadDir = path.join(os.tmpdir(), 'wispr-uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

    try {
      const { files, fields } = await parseMultipartBody(req, uploadDir);
      const model = fields.model || 'base.en';
      const language = fields.language || 'auto';

      if (files.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No files uploaded' }));
        return;
      }

      // Process uploaded files
      const results = [];
      for (const f of files) {
        broadcastSSE('transcribe:status', { filename: f.originalName, message: 'Processing uploaded file...' });
        const resObj = await transcribeService.transcribeFile(
          f.savedPath,
          { model, language },
          {
            onProgress: (p) => broadcastSSE('transcribe:progress', { ...p, filename: f.originalName }),
            onStatus: (msg) => broadcastSSE('transcribe:status', { filename: f.originalName, message: msg })
          }
        );
        resObj.filename = f.originalName;
        results.push(resObj);
        broadcastSSE('transcribe:complete', resObj);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, results }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (pathname === '/api/transcribe/paths' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { filePaths, model, language } = JSON.parse(body);
        const results = [];
        for (const fp of filePaths) {
          const resObj = await transcribeService.transcribeFile(
            fp,
            { model: model || 'base.en', language: language || 'auto' },
            {
              onProgress: (p) => broadcastSSE('transcribe:progress', p),
              onStatus: (msg) => broadcastSSE('transcribe:status', { filePath: fp, message: msg })
            }
          );
          results.push(resObj);
          broadcastSSE('transcribe:complete', resObj);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, results }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (pathname === '/api/history' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(transcribeService.getHistory()));
    return;
  }

  // Static File Serving
  let filePath = path.join(UI_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(UI_DIR, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg'
  };

  const contentType = mimeTypes[ext] || 'application/octet-stream';
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

function startServer(port = PORT) {
  return new Promise((resolve) => {
    server.listen(port, () => {
      console.log(`Wispr Studio server running at http://localhost:${port}`);
      resolve(server);
    });
  });
}

if (require.main === module) {
  startServer();
}

module.exports = { server, startServer, broadcastSSE };
