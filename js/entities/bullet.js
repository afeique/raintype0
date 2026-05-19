// Straight rainbow bullet. Hue cycles per-frame; phantom trail spawns
// every other frame. Releases self when off-screen.

import { BULLET_SPEED, SHIP_SIZE, Viewport } from '../core/utils.js';
import { hslToRgb } from '../render/color-util.js';

const _rgb = new Float32Array(3);

export class Bullet {
    constructor() { this.active = false; }

    reset(x, y, a) {
        this.x = x + Math.cos(a) * (SHIP_SIZE / 1.5);
        this.y = y + Math.sin(a) * (SHIP_SIZE / 1.5);
        this.radius = 3;
        this.angle = a;
        this.vel = { x: Math.cos(a) * BULLET_SPEED, y: Math.sin(a) * BULLET_SPEED };
        this.life = 0;
        this.mass = 1;
        this.active = true;
    }

    update(pools) {
        if (!this.active) return;
        this.life++;
        this.x += this.vel.x;
        this.y += this.vel.y;

        if (this.life % 2 === 0) {
            const hue = (this.life * 5) % 360;
            pools.particles.get(this.x, this.y, 'phantom', hue, this.radius);
        }

        if (this.x < 0 || this.x > Viewport.width || this.y < 0 || this.y > Viewport.height) {
            pools.bullets.release(this);
        }
    }

    draw(r) {
        if (!this.active) return;
        hslToRgb((this.life * 5) % 360, 100, 50, _rgb);
        r.fillCircle(this.x, this.y, this.radius, _rgb[0], _rgb[1], _rgb[2], 1);
    }
}
