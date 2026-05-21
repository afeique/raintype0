// All collision handling for the playing state.
//   • player ↔ asteroid → game over
//   • bullet ↔ asteroid → hit (split or destroy)
//   • asteroid ↔ asteroid → elastic + rocky-debris spray
//   • player ↔ money piece → pickup (background stars are inert)
//
// O(n²) over very small N — fine at the monosrc scale (~25 asteroids,
// ~3 bullets, ~150 stars). A spatial grid would not change the frame
// budget here.

import {
    collision, random,
    HIT_SCORE, DESTROY_SCORE,
    MIN_AST_RAD,
} from '../core/utils.js';

// Pairwise elastic collision resolution between every asteroid in the
// list. Velocity exchange ONLY when the pair is actively closing —
// already-separating pairs (split fragments, drifting overlaps) are
// skipped or they'd re-bond every frame and jitter ("skipping" glitch).
// No positional correction; the velocity carries pairs apart naturally
// so overlapped rocks don't teleport at first contact.
//
// `particles` is optional — when supplied a rocky-debris burst spawns
// at the contact midpoint. The title-screen attractor calls this with
// null so it gets the physics without the particle cost.
export function resolveAsteroidCollisions(asteroids, particles = null) {
    for (let i = 0; i < asteroids.length; i++) {
        const a1 = asteroids[i];
        for (let j = i + 1; j < asteroids.length; j++) {
            const a2 = asteroids[j];
            const dx = a2.x - a1.x, dy = a2.y - a1.y;
            const distSq = dx * dx + dy * dy;
            const sumR = a1.radius + a2.radius;
            if (distSq >= sumR * sumR || distSq < 0.01) continue;

            const dist = Math.sqrt(distSq);
            const nx = dx / dist, ny = dy / dist;

            const rvx = a2.vel.x - a1.vel.x;
            const rvy = a2.vel.y - a1.vel.y;
            const closing = rvx * nx + rvy * ny;
            if (closing >= 0) continue;

            const tx = -ny, ty = nx;
            const dpTan1 = a1.vel.x * tx + a1.vel.y * ty;
            const dpTan2 = a2.vel.x * tx + a2.vel.y * ty;
            const dpNorm1 = a1.vel.x * nx + a1.vel.y * ny;
            const dpNorm2 = a2.vel.x * nx + a2.vel.y * ny;
            const m1 = a1.mass, m2 = a2.mass;
            const totalM = m1 + m2;
            const newN1 = (dpNorm1 * (m1 - m2) + 2 * m2 * dpNorm2) / totalM;
            const newN2 = (dpNorm2 * (m2 - m1) + 2 * m1 * dpNorm1) / totalM;
            a1.vel.x = tx * dpTan1 + nx * newN1;
            a1.vel.y = ty * dpTan1 + ny * newN1;
            a2.vel.x = tx * dpTan2 + nx * newN2;
            a2.vel.y = ty * dpTan2 + ny * newN2;

            if (particles) {
                const debrisCount = (random(8, 16)) | 0;
                const cx = (a1.x + a2.x) * 0.5;
                const cy = (a1.y + a2.y) * 0.5;
                for (let d = 0; d < debrisCount; d++) {
                    const angle = Math.atan2(ny, nx) + random(-0.7, 0.7);
                    const speed = random(5, 13);
                    particles.get(cx, cy, 'rockDebris', Math.cos(angle) * speed, Math.sin(angle) * speed);
                }
            }
        }
    }
}

export function createAsteroidHitEffect(x, y, pools) {
    for (let i = 0; i < 15; i++) pools.particles.get(x + random(-5, 5), y + random(-5, 5), 'asteroidHit');
    for (let i = 0; i < 8;  i++) pools.particles.get(x + random(-3, 3), y + random(-3, 3), 'debris');
}

export function createAsteroidDestroyEffect(ast, pools) {
    for (let i = 0; i < 40; i++) pools.particles.get(ast.x + random(-10, 10), ast.y + random(-10, 10), 'asteroidDestroy');
    for (let i = 0; i < 25; i++) pools.particles.get(ast.x + random(-8, 8),  ast.y + random(-8, 8),  'debris');
    for (const e of ast.edges) {
        const p1 = ast.vertices3D[e[0]];
        const p2 = ast.vertices3D[e[1]];
        pools.lineDebris.get(ast.x, ast.y, p1, p2);
    }
}

// Scatter collectible money pieces from a destroyed asteroid. Each piece
// rolls its own denomination (green / pink / gold) in MoneyPiece.reset.
// A small handful per asteroid — 20 was a confetti storm.
export function createMoneyBurst(x, y, pools) {
    const count = 2 + ((Math.random() * 3) | 0); // 2–4 pieces
    for (let i = 0; i < count; i++) pools.money.get(x, y);
}

// Returns mutated `state` (in particular game.score). Returns
// { playerDied: boolean } so the caller can sequence game-over flow.
export function handleCollisions(state, pools, audio, haptic, shake) {
    let playerDied = false;

    // ── player ↔ asteroid ─────────────────────────────────────────────
    if (state.player.active) {
        for (const ast of pools.asteroids.activeObjects) {
            if (collision(state.player, ast)) {
                playerDied = true;
                return { playerDied };
            }
        }
    }

    // ── bullets ↔ asteroids ───────────────────────────────────────────
    for (let i = pools.bullets.activeObjects.length - 1; i >= 0; i--) {
        const bullet = pools.bullets.activeObjects[i];
        for (let j = pools.asteroids.activeObjects.length - 1; j >= 0; j--) {
            const ast = pools.asteroids.activeObjects[j];
            if (!collision(bullet, ast)) continue;

            state.score += HIT_SCORE;
            haptic(20);
            audio.play('hit');
            // Light the asteroid's hit-flash at the impact point in the
            // bullet's travel direction.
            ast.registerHit(bullet.x, bullet.y, bullet.angle);
            createAsteroidHitEffect(bullet.x, bullet.y, pools);

            const smallEnough = ast.baseRadius <= (MIN_AST_RAD + 5);
            if (smallEnough) {
                state.score += DESTROY_SCORE;
                audio.play('explosion');
                createAsteroidDestroyEffect(ast, pools);
                createMoneyBurst(ast.x, ast.y, pools);
                pools.asteroids.release(ast);
                shake(15, 8);
            } else {
                const count = Math.random() < 0.5 ? 2 : 3;
                const newR = ast.baseRadius / Math.sqrt(count);
                // Momentum-conserving COM velocity (asteroid + bullet).
                const totalMass = ast.mass + bullet.mass;
                const vCOMx = (ast.vel.x * ast.mass + bullet.vel.x * bullet.mass) / totalMass;
                const vCOMy = (ast.vel.y * ast.mass + bullet.vel.y * bullet.mass) / totalMass;

                if (newR < MIN_AST_RAD) {
                    state.score += DESTROY_SCORE;
                    audio.play('explosion');
                    createAsteroidDestroyEffect(ast, pools);
                    createMoneyBurst(ast.x, ast.y, pools);
                    shake(15, 8);
                } else {
                    for (let k = 0; k < count; k++) {
                        const child = pools.asteroids.get(
                            ast.x + random(-2, 2),
                            ast.y + random(-2, 2),
                            newR,
                        );
                        const angle = (k / count) * (2 * Math.PI) + random(-0.2, 0.2);
                        const kickX = Math.cos(angle) * 1;
                        const kickY = Math.sin(angle) * 1;
                        child.vel.x = vCOMx + kickX;
                        child.vel.y = vCOMy + kickY;
                    }
                }
                pools.asteroids.release(ast);
            }
            pools.bullets.release(bullet);
            break;
        }
    }

    // ── asteroid ↔ asteroid ────────────────────────────────────────────
    resolveAsteroidCollisions(pools.asteroids.activeObjects, pools.particles);

    // ── player ↔ money pieces (pickup) ────────────────────────────────
    // Only money pieces are collectible; their score depends on the
    // denomination (green / pink / gold). Background stars live in a
    // separate pool, are never iterated here, and so can never be picked
    // up — they're purely decorative.
    if (state.player.active) {
        for (let i = pools.money.activeObjects.length - 1; i >= 0; i--) {
            const piece = pools.money.activeObjects[i];
            if (!collision(state.player, piece)) continue;
            state.score += piece.score;
            audio.play('coin');
            pools.particles.get(piece.x, piece.y, 'pickupPulse');
            pools.money.release(piece);
        }
    }

    return { playerDied };
}
