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

// ── Colored request log ──────────────────────────────────────────────
// ANSI escapes are honoured by every modern terminal; when stdout is a
// pipe (CI, tee) Node sets isTTY=false and we silently drop colours so
// log files stay clean. Colour mapping mirrors the convention used by
// Vite, http-server, and morgan: green=2xx, cyan=3xx, yellow=4xx, red=5xx.

// Force-enable when FORCE_COLOR is set (CI logs, dev tools that pipe
// stdout). Force-disable when NO_COLOR is set (https://no-color.org).
const wantColor = process.env.NO_COLOR ? false
                : process.env.FORCE_COLOR ? true
                : !!process.stdout.isTTY;

const COLOR = wantColor ? {
    reset:  '\x1b[0m',
    dim:    '\x1b[2m',
    grey:   '\x1b[90m',
    cyan:   '\x1b[36m',
    green:  '\x1b[32m',
    yellow: '\x1b[33m',
    red:    '\x1b[31m',
    bold:   '\x1b[1m',
} : {
    reset: '', dim: '', grey: '', cyan: '', green: '', yellow: '', red: '', bold: '',
};

function statusColor(s) {
    if (s >= 500) return COLOR.red;
    if (s >= 400) return COLOR.yellow;
    if (s >= 300) return COLOR.cyan;
    return COLOR.green;
}

function methodColor(m) {
    return m === 'GET' ? COLOR.green
         : m === 'POST' ? COLOR.cyan
         : m === 'DELETE' ? COLOR.red
         : COLOR.yellow;
}

function logLine(req, status, bytes = '') {
    const ts = new Date().toISOString().slice(11, 19);
    const url = req.url.length > 60 ? req.url.slice(0, 57) + '...' : req.url;
    const sc = statusColor(status);
    const mc = methodColor(req.method);
    console.log(
        `${COLOR.grey}[${ts}]${COLOR.reset} ` +
        `${sc}${COLOR.bold}${status}${COLOR.reset} ` +
        `${mc}${req.method.padEnd(4)}${COLOR.reset} ` +
        `${url} ` +
        `${COLOR.dim}${bytes}${COLOR.reset}`,
    );
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
    const C = COLOR;
    console.log(`\n  ${C.bold}${C.cyan}RAINTYPE0${C.reset} ${C.dim}dev server${C.reset}`);
    console.log(`  ${C.grey}root:${C.reset}  ${ROOT}`);
    console.log(`  ${C.grey}url:${C.reset}   ${C.green}http://localhost:${PORT}/${C.reset}`);
    console.log(`  ${C.dim}press Ctrl-C to stop${C.reset}\n`);
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
