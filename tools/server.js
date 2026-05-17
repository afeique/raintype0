#!/usr/bin/env node
// Tiny zero-dependency static dev server.
//
//   node tools/server.js [--port 8080] [--root .]
//
// Serves the given root with no-cache headers so changes show up on
// reload without hard-refresh dances. Streams files (handles Range
// requests for mp3 / mp4 / large assets). Logs each request.
//
// Used by `npm run dev`. We use Node's built-in `http` + `fs` rather
// than depending on a static-server package, so the dev experience is
// identical across fresh clones (no npx fetch, no install of an HTTP
// server, no surprise CDN download on first run).

import http from 'node:http';
import { createReadStream, statSync, existsSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
function arg(name, fallback) {
    const i = argv.indexOf(`--${name}`);
    return i !== -1 ? argv[i + 1] : fallback;
}

const PORT = Number(arg('port', process.env.PORT || 8080));
const ROOT = resolve(arg('root', process.cwd()));

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'application/javascript; charset=utf-8',
    '.mjs':  'application/javascript; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif':  'image/gif',
    '.svg':  'image/svg+xml',
    '.ico':  'image/x-icon',
    '.mp3':  'audio/mpeg',
    '.wav':  'audio/wav',
    '.ogg':  'audio/ogg',
    '.txt':  'text/plain; charset=utf-8',
    '.md':   'text/markdown; charset=utf-8',
};

function safePath(reqUrl) {
    // Strip query string, decode, normalize, refuse traversal escapes.
    const decoded = decodeURIComponent(reqUrl.split('?')[0]);
    const norm = normalize(decoded).replace(/^[/\\]+/, '');
    const full = join(ROOT, norm);
    return full.startsWith(ROOT) ? full : null;
}

function send(res, status, headers, body) {
    res.writeHead(status, {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0',
        ...headers,
    });
    if (body !== undefined) res.end(body);
    else res.end();
}

function logLine(req, status, bytes = '') {
    const ts = new Date().toISOString().slice(11, 19);
    const url = req.url.length > 60 ? req.url.slice(0, 57) + '...' : req.url;
    console.log(`[${ts}] ${status} ${req.method.padEnd(4)} ${url} ${bytes}`);
}

const server = http.createServer((req, res) => {
    let p = safePath(req.url);
    if (!p) return send(res, 403, {}, 'Forbidden') || logLine(req, 403);

    // Directory → index.html
    try {
        const st = statSync(p);
        if (st.isDirectory()) p = join(p, 'index.html');
    } catch { /* not found — fall through to existsSync */ }

    if (!existsSync(p)) {
        send(res, 404, { 'Content-Type': 'text/plain' }, '404 Not Found');
        return logLine(req, 404);
    }

    const ext = extname(p).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const st = statSync(p);
    const size = st.size;

    // Range request support — important for large audio (mp3 seek).
    const range = req.headers.range;
    if (range) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (m) {
            const start = m[1] ? parseInt(m[1], 10) : 0;
            const end   = m[2] ? parseInt(m[2], 10) : size - 1;
            if (start >= size || end >= size) {
                send(res, 416, { 'Content-Range': `bytes */${size}` });
                return logLine(req, 416);
            }
            res.writeHead(206, {
                'Content-Type': type,
                'Content-Range': `bytes ${start}-${end}/${size}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': (end - start + 1),
                'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
            });
            createReadStream(p, { start, end }).pipe(res);
            logLine(req, 206, `${end - start + 1}b`);
            return;
        }
    }

    res.writeHead(200, {
        'Content-Type': type,
        'Content-Length': size,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    });
    createReadStream(p).pipe(res);
    logLine(req, 200, `${size}b`);
});

server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
        console.error(`✗ port ${PORT} already in use. Run \`npm run dev\` again — predev will kill it first.`);
        process.exit(1);
    }
    throw e;
});

server.listen(PORT, () => {
    console.log(`\n  RAINTYPE0 dev server`);
    console.log(`  root:  ${ROOT}`);
    console.log(`  url:   http://localhost:${PORT}/`);
    console.log(`  press Ctrl-C to stop\n`);
});

// Friendly shutdown.
function shutdown() {
    console.log('\n  stopping…');
    server.close(() => process.exit(0));
    // Last-resort hard exit if close hangs (e.g. open mp3 stream).
    setTimeout(() => process.exit(0), 500).unref();
}
process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);
