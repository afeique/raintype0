// Continuous asteroid spawner with a smooth time-based difficulty ramp.
//
//   • Each tick, if active asteroids < current target population AND the
//     spawn-cooldown has elapsed, spawn one off-screen.
//   • A hard cap on total active asteroids (parents + split fragments)
//     keeps total on-screen object count bounded for perf.
//   • Difficulty scales from "calm" to "max" over RAMP_SECONDS of real
//     time since the run started, then holds. The game stays wave-less
//     endurance — there's just a rising tide rather than a flat sea.
//
// "Active" includes split fragments from bullet hits; they're emergent
// and short-lived. The cap is what protects per-frame draw cost.

import { AST_SPEED, random, Viewport } from '../core/utils.js';
import { frameClock } from '../core/frame-clock.js';

// Endpoints of the difficulty ramp. `_0` = run start, `_1` = fully ramped.
const RAMP_SECONDS = 120;          // ~2 min to reach max intensity

const TARGET_POP_0 = 6,   TARGET_POP_1 = 12;
const MAX_ACTIVE_0 = 14,  MAX_ACTIVE_1 = 22;
const COOLDOWN_0   = 1500, COOLDOWN_1  = 650;   // ms between spawns
const SPEED_MUL_0  = 1.0,  SPEED_MUL_1 = 1.8;

// Retained for any external reference; the live cap is computed per-tick.
export const MAX_ACTIVE_ASTEROIDS = MAX_ACTIVE_1;

const lerp = (a, b, t) => a + (b - a) * t;

export function createSpawner({ pools }) {
    let lastSpawnAt = 0;
    let startedAt = 0;

    // 0 → 1 over the first RAMP_SECONDS of the run.
    function difficulty() {
        const elapsed = (frameClock.now - startedAt) / 1000;
        const d = elapsed / RAMP_SECONDS;
        return d < 0 ? 0 : d > 1 ? 1 : d;
    }

    function spawnOffscreen(speedMul = 1) {
        const r = random(30, 60);
        const spawnBuffer = r * 4;
        let x, y;
        const edge = (random(0, 4)) | 0;
        switch (edge) {
            case 0: x = random(0, Viewport.width);  y = -spawnBuffer; break;
            case 1: x = Viewport.width + spawnBuffer; y = random(0, Viewport.height); break;
            case 2: x = random(0, Viewport.width);  y = Viewport.height + spawnBuffer; break;
            default: x = -spawnBuffer; y = random(0, Viewport.height); break;
        }
        const ast = pools.asteroids.get(x, y, r);
        const tx = random(Viewport.width * 0.3, Viewport.width * 0.7);
        const ty = random(Viewport.height * 0.3, Viewport.height * 0.7);
        const ang = Math.atan2(ty - y, tx - x);
        const spd = AST_SPEED * speedMul;
        ast.vel = { x: Math.cos(ang) * spd, y: Math.sin(ang) * spd };
    }

    function seed() {
        startedAt = frameClock.now;
        for (let i = 0; i < TARGET_POP_0; i++) spawnOffscreen(SPEED_MUL_0);
        lastSpawnAt = frameClock.now;
    }

    function tick() {
        const d = difficulty();
        const targetPop = Math.round(lerp(TARGET_POP_0, TARGET_POP_1, d));
        const maxActive = Math.round(lerp(MAX_ACTIVE_0, MAX_ACTIVE_1, d));
        const cooldown  = lerp(COOLDOWN_0, COOLDOWN_1, d);
        const speedMul  = lerp(SPEED_MUL_0, SPEED_MUL_1, d);

        const active = pools.asteroids.activeObjects.length;
        if (active >= maxActive) return;
        if (active >= targetPop) return;
        if (frameClock.now - lastSpawnAt < cooldown) return;
        spawnOffscreen(speedMul);
        lastSpawnAt = frameClock.now;
    }

    return { seed, tick, spawnOffscreen };
}
