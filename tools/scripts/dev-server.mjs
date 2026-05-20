#!/usr/bin/env node
//
// dev-server.mjs — port-fallback wrapper around http-server for the
// static dev server (run via `npm run dev`).
//
// Probes the desired port (default 8080, overridable via `PORT` env
// var). If it's in use, scans the next few ports until it finds one
// free, then exec's http-server on that port. Logs the chosen port
// loudly so it's visible in the terminal.
//
// Why this exists: leftover http-server processes from previous
// sessions routinely hold :8080 hostage. Rather than make the user
// track them down with `lsof | xargs kill`, we just pick the next
// free port and tell them what we picked.
//
// CLI args are passed through to http-server unchanged, except `-p
// <port>` which we inject. `-o` (auto-open browser) is honored — the
// browser opens at the actually-chosen port via http-server's own
// open behavior.
//
// Mirrors rainboids' tools/scripts/sp-server.mjs verbatim, with the
// project name and default port swapped.

import net from 'node:net';
import { spawn } from 'node:child_process';

const DEFAULT_PORT = 8080;
const MAX_TRIES = 20;

const desired = Number.parseInt(process.env.PORT ?? `${DEFAULT_PORT}`, 10);
if (!Number.isFinite(desired) || desired < 1 || desired > 65535) {
    console.error(`[dev-server] invalid PORT env var: ${process.env.PORT}`);
    process.exit(2);
}

function probe(port) {
    return new Promise((resolve) => {
        const sock = net.createServer();
        sock.once('error', () => resolve(false));
        sock.once('listening', () => sock.close(() => resolve(true)));
        // Bind the same address http-server uses (all interfaces, dual
        // stack) rather than just loopback — otherwise a process holding
        // 0.0.0.0:PORT slips past a 127.0.0.1 probe and http-server then
        // crashes with EADDRINUSE on spawn, defeating the fallback. The
        // rainboids original probes 127.0.0.1 and has this latent bug;
        // it just rarely surfaces on its less-contested default port.
        sock.listen(port);
    });
}

async function findFreePort(start) {
    for (let p = start; p < start + MAX_TRIES; p++) {
        // eslint-disable-next-line no-await-in-loop
        if (await probe(p)) return p;
    }
    throw new Error(
        `no free port in range ${start}..${start + MAX_TRIES - 1}`,
    );
}

let port;
try {
    port = await findFreePort(desired);
} catch (err) {
    console.error(`[dev-server] ${err.message}`);
    process.exit(3);
}

// Vite-style colored banner. Only emits ANSI when stdout is a TTY
// (skipped under pipes / CI logs / Playwright capture).
const TTY = process.stdout.isTTY;
const c = TTY
    ? {
        reset: '\x1b[0m',
        bold: '\x1b[1m',
        dim: '\x1b[2m',
        green: '\x1b[32m',
        yellow: '\x1b[33m',
        cyan: '\x1b[36m',
    }
    : { reset: '', bold: '', dim: '', green: '', yellow: '', cyan: '' };

const tag = `${c.bold}${c.green}RAINTYPE0${c.reset} ${c.bold}dev${c.reset}`;
const url = `${c.cyan}http://127.0.0.1:${c.bold}${port}${c.reset}${c.cyan}/${c.reset}`;
const status =
    port === desired
        ? `${c.green}ready${c.reset}`
        : `${c.yellow}port ${desired} busy → using ${port}${c.reset}`;

console.log('');
console.log(`  ${tag}  ${status}`);
console.log('');
console.log(`  ${c.green}➜${c.reset}  ${c.bold}Local:${c.reset}   ${url}`);
console.log('');

const extra = process.argv.slice(2);
const args = ['http-server', '-p', String(port), ...extra];

const child = spawn('npx', args, {
    stdio: 'inherit',
    env: process.env,
});
child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
        child.kill(sig);
    });
}
