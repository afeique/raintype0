// Title-screen attractor — runs the visual aesthetic of the game
// (twinkling stars + slowly drifting pulsing asteroids) on the canvas
// behind the title-screen overlay so the title doesn't sit on dead
// black. Uses the SAME entity classes the gameplay does, so the
// asteroid hue palette + motion-blur veil come along for free.
//
// Star parallax uses a synthesized "fake ship velocity" that rotates
// slowly around a wide circle, giving the starfield a cinematic
// camera-pan feeling.

import { Star } from '../entities/star.js';
import { Asteroid } from '../entities/asteroid.js';
import { PoolManager } from '../core/pool-manager.js';
import { STAR_COUNT, MIN_STAR_DIST, random, Viewport } from '../core/utils.js';
import { resolveAsteroidCollisions } from './collisions.js';

const ATTRACTOR_ASTEROIDS = 6;
// Minimum gap between any two attractor asteroids at spawn time, so
// they start visually separated (the elastic collision still kicks in
// later if they drift together). Add a small padding beyond the sum of
// radii so the wireframes never visually touch on the first frame.
const ATTRACTOR_AST_PAD = 24;

export function createAttractor() {
    const pools = {
        stars:     new PoolManager(Star, STAR_COUNT + 10),
        asteroids: new PoolManager(Asteroid, ATTRACTOR_ASTEROIDS),
    };

    // Synthetic "camera" — a virtual position drifting in a slow
    // looping orbit. Its velocity feeds the star parallax so the
    // background quietly pans.
    const cam = {
        x: Viewport.width / 2,
        y: Viewport.height / 2,
        vel: { x: 0, y: 0 },
        active: true, // satisfies star.update's player.active check
        radius: 10,   // unused for stars but read by collision util
    };

    // The attractor wraps both `update` and `draw` into one frame call
    // since title-screen update + draw share the same trivial loop.
    function spawnStars() {
        for (let i = 0; i < STAR_COUNT; i++) {
            let x, y, tooClose, attempts = 0;
            do {
                tooClose = false;
                x = random(0, Viewport.width);
                y = random(0, Viewport.height);
                for (const o of pools.stars.activeObjects) {
                    if (Math.hypot(x - o.x, y - o.y) < MIN_STAR_DIST) {
                        tooClose = true;
                        break;
                    }
                }
                attempts++;
                if (attempts > 100) break;
            } while (tooClose);
            if (!tooClose) pools.stars.get(x, y, false);
        }
    }

    function spawnAsteroids() {
        const active = pools.asteroids.activeObjects;
        for (let i = 0; i < ATTRACTOR_ASTEROIDS; i++) {
            const r = random(35, 70);
            // Reject placements that would overlap an already-placed
            // attractor asteroid. Cap attempts so we never infinite-loop
            // on tight viewports; if every attempt fails just take the
            // last candidate and let the elastic collision sort it out.
            let x = 0, y = 0;
            let attempts = 0;
            while (attempts < 80) {
                x = random(r, Viewport.width  - r);
                y = random(r, Viewport.height - r);
                let overlap = false;
                for (const o of active) {
                    const minDist = r + o.radius + ATTRACTOR_AST_PAD;
                    if (Math.hypot(x - o.x, y - o.y) < minDist) { overlap = true; break; }
                }
                if (!overlap) break;
                attempts++;
            }
            const ast = pools.asteroids.get(x, y, r);
            // Gentle, cinematic drift — not the punchy gameplay
            // velocity. Slows down the eye, lets the title breathe.
            const ang = random(0, Math.PI * 2);
            const spd = random(0.25, 0.7);
            ast.vel = { x: Math.cos(ang) * spd, y: Math.sin(ang) * spd };
            // Lazier tumble too.
            ast.rotVel3D.x *= 0.55;
            ast.rotVel3D.y *= 0.55;
            ast.rotVel3D.z *= 0.55;
        }
    }

    spawnStars();
    spawnAsteroids();

    let t = 0;
    function tick() {
        t += 0.005;
        // Two-sinusoid sum so the synthesised camera follows a
        // meandering path rather than a tight Lissajous loop — gives
        // the starfield a clearly visible drift while still keeping
        // the asteroids the focal point. Magnitude peaks around
        // 2 px/frame, ~3x the previous version.
        cam.vel.x = Math.cos(t * 1.10) * 1.4 + Math.sin(t * 0.32) * 0.7;
        cam.vel.y = Math.sin(t * 0.90) * 1.4 + Math.cos(t * 0.41) * 0.7;

        pools.asteroids.updateActive();
        // Elastic asteroid–asteroid collisions on the title screen so
        // the drifting rocks bounce off each other instead of phasing.
        // No particle pool here — physics only, no rocky-debris spawn.
        resolveAsteroidCollisions(pools.asteroids.activeObjects, null);
        for (const s of pools.stars.activeObjects) {
            s.update(cam.vel, cam, pools.stars);
        }
    }

    function draw(ctx) {
        pools.stars.drawActive(ctx);
        pools.asteroids.drawActive(ctx);
    }

    function resize() {
        // Keep the existing entities alive across resize — the wrap
        // logic in their update() naturally accommodates new bounds.
    }

    return { tick, draw, resize };
}
