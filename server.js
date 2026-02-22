const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT = process.cwd();

let clients = [];
let fileTimes = new Map();

function scan(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    try {
      const st = fs.statSync(full);
      const prev = fileTimes.get(full);
      if (!prev || prev !== st.mtimeMs) {
        fileTimes.set(full, st.mtimeMs);
      }
      if (e.isDirectory()) scan(full);
    } catch (err) {
      // ignore
    }
  }
}

// initialize map
scan(ROOT);

function detectChanges() {
  const newTimes = new Map();
  let changed = false;
  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      try {
        const st = fs.statSync(full);
        newTimes.set(full, st.mtimeMs);
        const prev = fileTimes.get(full);
        if (!prev || prev !== st.mtimeMs) changed = true;
        if (e.isDirectory()) walk(full);
      } catch (err) {}
    }
  }
  try { walk(ROOT); } catch (err) { /* ignore */ }
  fileTimes = newTimes;
  if (changed) {
    for (const res of clients) {
      try { res.write('data: reload\n\n'); } catch (e) {}
    }
  }
}

setInterval(detectChanges, 1000);

function send404(res) {
  res.statusCode = 404;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end('404 Not Found');
}

function serveFile(req, res, pathname) {
  let filePath = path.join(ROOT, pathname);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    const index = path.join(filePath, 'index.html');
    if (fs.existsSync(index)) filePath = index;
  }
  if (!fs.existsSync(filePath)) return send404(res);
  const ext = path.extname(filePath).toLowerCase();
  const ct = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.json': 'application/json',
  }[ext] || 'application/octet-stream';
  res.setHeader('Content-Type', ct);
  let stream = fs.createReadStream(filePath);
  if (ct.startsWith('text/html')) {
    // inject live reload client
    let html = fs.readFileSync(filePath, 'utf8');
    const snippet = "\n<script>var es=new EventSource('/events');es.onmessage=function(){location.reload()};es.onerror=function(){/* ignore */};</script>\n";
    if (html.includes('</body>')) html = html.replace('</body>', snippet + '</body>');
    res.end(html);
    return;
  }
  stream.pipe(res);
}

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/events') {
    // SSE endpoint
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('\n');
    clients.push(res);
    req.on('close', () => {
      clients = clients.filter(r => r !== res);
    });
    return;
  }
  let pathname = url.slice(1) || 'index.html';
  serveFile(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`Live server running at http://localhost:${PORT}/`);
  console.log('Press Ctrl+C to stop.');
});
