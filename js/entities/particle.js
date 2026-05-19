// All particle variants share one class. The type tag selects the
// reset / update / draw behaviour. Preserves the monosrc vocabulary
// 1:1 — every particle type the player can see is here.

import { random, inView } from '../core/utils.js';
import {
    ASTEROID_WARM_RGB, DEBRIS_BROWN_RGB, THRUST_RGB, PALETTE,
    hslToRgb,
} from '../render/color-util.js';

// Scratch — reused across calls. Particles don't run multi-threaded.
const _hsl = new Float32Array(3);

export class Particle {
    constructor() {
        this.active = false;
        this.color = new Float32Array(3);
    }

    reset(x, y, type, ...args) {
        this.x = x;
        this.y = y;
        this.type = type;
        this.active = true;

        switch (type) {
            case 'explosion': {
                this.radius = random(1, 3);
                this.vel = { x: random(-3, 3), y: random(-3, 3) };
                this.life = 1;
                hslToRgb((Math.random() * 360) | 0, 100, 70, this.color);
                break;
            }
            case 'asteroidHit': {
                this.radius = random(2, 5);
                this.vel = { x: random(-4, 4), y: random(-4, 4) };
                this.life = 1;
                this.color.set(ASTEROID_WARM_RGB[(Math.random() * ASTEROID_WARM_RGB.length) | 0]);
                break;
            }
            case 'asteroidDestroy': {
                this.radius = random(3, 8);
                this.vel = { x: random(-6, 6), y: random(-6, 6) };
                this.life = 1.2;
                this.color.set(ASTEROID_WARM_RGB[(Math.random() * ASTEROID_WARM_RGB.length) | 0]);
                break;
            }
            case 'debris': {
                this.radius = random(1, 4);
                this.vel = { x: random(-5, 5), y: random(-5, 5) };
                this.life = 1.5;
                this.color.set(DEBRIS_BROWN_RGB[(Math.random() * DEBRIS_BROWN_RGB.length) | 0]);
                break;
            }
            case 'rockDebris': {
                this.radius = random(1, 3);
                const gray = (random(80, 200)) | 0 / 255;
                const g = ((random(80, 200)) | 0) / 255;
                this.color[0] = g;
                this.color[1] = g;
                this.color[2] = g;
                const [vx, vy] = args;
                this.vel = { x: vx ?? random(-4, 4), y: vy ?? random(-4, 4) };
                this.life = 1.2 + random(0, 0.5);
                this.friction = 0.88 + random(0, 0.07);
                break;
            }
            case 'playerExplosion': {
                this.life = 1;
                this.radius = 0;
                this.maxRadius = 150;
                this.color.set(PALETTE.cyan);
                break;
            }
            case 'thrust': {
                const [angle] = args;
                this.color.set(THRUST_RGB[(Math.random() * THRUST_RGB.length) | 0]);
                const a = angle + random(-0.26, 0.26);
                const s = random(1.5, 3);
                this.radius = random(1, 2.5);
                this.vel = { x: Math.cos(a) * s, y: Math.sin(a) * s };
                this.life = 1;
                break;
            }
            case 'phantom': {
                const [hue, radius] = args;
                // Phantom carries the bullet's current hue as a float so
                // we don't pay CSS-string parsing per spawn.
                hslToRgb(hue, 100, 50, this.color);
                this.radius = radius * 0.8;
                this.life = 0.5;
                this.vel = { x: 0, y: 0 };
                break;
            }
            case 'pickupPulse': {
                this.life = 1;
                this.radius = 0;
                this.maxRadius = 30;
                this.color.set(PALETTE.white);
                break;
            }
        }
    }

    update(pool) {
        if (!this.active) return;
        switch (this.type) {
            case 'explosion':
            case 'thrust':
            case 'asteroidHit':
            case 'asteroidDestroy':
            case 'debris':
                this.x += this.vel.x;
                this.y += this.vel.y;
                this.life -= 0.02;
                break;
            case 'rockDebris':
                this.x += this.vel.x;
                this.y += this.vel.y;
                this.vel.x *= this.friction;
                this.vel.y *= this.friction;
                this.life -= 0.018;
                break;
            case 'phantom':
                this.life -= 0.05;
                break;
            case 'playerExplosion':
                this.life -= 0.02;
                this.radius = (1 - this.life ** 2) * this.maxRadius;
                break;
            case 'pickupPulse':
                this.life -= 0.04;
                this.radius = (1 - this.life) * this.maxRadius;
                break;
        }
        if (this.life <= 0) pool.release(this);
    }

    draw(r) {
        if (!this.active) return;
        const a = this.life > 1 ? 1 : (this.life < 0 ? 0 : this.life);
        if (a <= 0) return;
        // Particles have no wrap — they drift off-screen and live there
        // until life expires. Cull while still alive to skip the draw.
        if (!inView(this.x, this.y, this.radius || 1)) return;
        const cr = this.color[0], cg = this.color[1], cb = this.color[2];

        switch (this.type) {
            case 'explosion':
            case 'thrust':
            case 'phantom':
            case 'asteroidHit':
            case 'asteroidDestroy':
            case 'debris':
            case 'rockDebris':
                r.fillCircle(this.x, this.y, this.radius, cr, cg, cb, a);
                break;
            case 'playerExplosion':
            case 'pickupPulse':
                r.strokeRing(this.x, this.y, this.radius, 3, cr, cg, cb, a);
                break;
        }
    }
}
