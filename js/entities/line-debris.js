// White line segments flung from asteroid edges on destruction.

import { random, inView } from '../core/utils.js';

export class LineDebris {
    constructor() { this.active = false; }

    reset(x, y, p1, p2) {
        this.x = x;
        this.y = y;
        this.life = 1;
        this.p1 = p1;
        this.p2 = p2;
        this.active = true;
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;
        const ang = Math.atan2(midY, midX);
        const spd = random(1, 3);
        this.vel = { x: Math.cos(ang) * spd, y: Math.sin(ang) * spd };
        this.rot = 0;
        this.rotVel = random(-0.1, 0.1);
    }

    update(pool) {
        if (!this.active) return;
        this.x += this.vel.x;
        this.y += this.vel.y;
        this.rot += this.rotVel;
        this.life -= 0.02;
        if (this.life <= 0) pool.release(this);
    }

    draw(r) {
        if (!this.active) return;
        const a = this.life > 1 ? 1 : (this.life < 0 ? 0 : this.life);
        if (a <= 0) return;
        // Coarse cull — the line segment can extend up to ~30 px from
        // origin once rotated; 40 covers it comfortably.
        if (!inView(this.x, this.y, 40)) return;
        // Rotate p1, p2 by `rot` and translate by (x, y) — entities
        // compute world coords themselves so the renderer interface has
        // no transform stack.
        const c = Math.cos(this.rot);
        const s = Math.sin(this.rot);
        const x1 = this.x + this.p1.x * c - this.p1.y * s;
        const y1 = this.y + this.p1.x * s + this.p1.y * c;
        const x2 = this.x + this.p2.x * c - this.p2.y * s;
        const y2 = this.y + this.p2.x * s + this.p2.y * c;
        r.drawLine(x1, y1, x2, y2, 1.5, 1, 1, 1, a);
    }
}
