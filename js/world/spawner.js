// Continuous asteroid spawner. Constant target population — no
// difficulty scaling, pure endurance.
//
//   • Each tick, if active asteroids < TARGET_POPULATION AND the
//     spawn-cooldown has elapsed, spawn one off-screen.
//   • Hard cap on total active asteroids (parents + split fragments)
//     keeps total on-screen object count bounded for perf.
//
// "Active" includes split fragments from bullet hits; they're emergent
// and short-lived. The cap is what protects per-frame draw cost.

import { AST_SPEED, random, Viewport } from '../core/utils.js';
import { frameClock } from '../core/frame-clock.js';

const TARGET_POPULATION  = 6;    // parent asteroids the spawner keeps alive
export const MAX_ACTIVE_ASTEROIDS = 14;  // hard cap on total (parents + fragments)
const SPAWN_COOLDOWN_MS  = 1500; // minimum gap between spawns

export function createSpawner({ pools }) {
    let lastSpawnAt = 0;

    function spawnOffscreen() {
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
        const spd = AST_SPEED;
        ast.vel = { x: Math.cos(ang) * spd, y: Math.sin(ang) * spd };
    }

    function seed() {
        for (let i = 0; i < TARGET_POPULATION; i++) spawnOffscreen();
        lastSpawnAt = frameClock.now;
    }

    function tick() {
        const active = pools.asteroids.activeObjects.length;
        if (active >= MAX_ACTIVE_ASTEROIDS) return;
        if (active >= TARGET_POPULATION) return;
        if (frameClock.now - lastSpawnAt < SPAWN_COOLDOWN_MS) return;
        spawnOffscreen();
        lastSpawnAt = frameClock.now;
    }

    return { seed, tick, spawnOffscreen };
}
