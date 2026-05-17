#!/usr/bin/env node
// Kill anything listening on the given port (default 8080).
//
//   node tools/kill-port.js [port]
//
// Used as the `predev` hook so `npm run dev` always starts cleanly
// even if a previous server was left running in another terminal.

import { execSync } from 'node:child_process';

const port = Number(process.argv[2] || process.env.PORT || 8080);

let pids = [];
try {
    // -nP : numeric, no port-name resolution
    // -i tcp:<port> : the port we want
    // -t : terse output (pids only)
    // -sTCP:LISTEN : only the listener (not connected clients)
    const out = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`, { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString().trim();
    if (out) pids = out.split(/\s+/).map(Number).filter(Boolean);
} catch {
    // lsof exits non-zero when nothing matches — that's fine.
}

if (pids.length === 0) {
    console.log(`  port ${port} is free`);
    process.exit(0);
}

for (const pid of pids) {
    try {
        process.kill(pid, 'SIGTERM');
        console.log(`  killed pid ${pid} (was listening on :${port})`);
    } catch (e) {
        console.warn(`  could not kill pid ${pid}: ${e.message}`);
    }
}

// Give the OS a moment to release the socket.
const deadline = Date.now() + 1500;
(async function waitForFree() {
    while (Date.now() < deadline) {
        try {
            execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`, { stdio: 'ignore' });
            // Still listening — wait & retry.
            await new Promise(r => setTimeout(r, 100));
        } catch {
            return; // free
        }
    }
})();
