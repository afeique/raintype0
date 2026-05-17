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

const ATTRACTOR_ASTEROIDS = 6;

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
        for (let i = 0; i < ATTRACTOR_ASTEROIDS; i++) {
            const r = random(35, 70);
            // Distribute across the canvas at random.
            const x = random(0, Viewport.width);
            const y = random(0, Viewport.height);
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
        t += 0.004; // slow oscillation
        // Lissajous-style "camera" drift — magnitude 0.6 px/frame so the
        // parallax is felt but never overwhelms the static asteroids.
        cam.vel.x = Math.cos(t * 1.1) * 0.6;
        cam.vel.y = Math.sin(t * 0.9) * 0.6;

        pools.asteroids.updateActive();
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
