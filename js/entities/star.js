// Background stars. Two flavours:
//   • Normal — shaped (point/diamond/star4/star8/plus), twinkles by
//     sinusoidal opacity, drifts toward the ship within 150px.
//   • Burst — gold-bordered green stars flung from a destroyed
//     asteroid. Wider attraction radius (350px) and a hard life
//     timer (300 frames).

import {
    STAR_ATTR, STAR_ATTRACT_DIST, STAR_FRIC,
    BURST_STAR_ATTRACT_DIST, BURST_STAR_ATTR,
    random, wrap, Viewport,
} from '../core/utils.js';
import {
    NORMAL_STAR_RGB,
    PALETTE,
} from '../render/color-util.js';

const SHAPES = ['point', 'point', 'point', 'point', 'point', 'point', 'point', 'diamond', 'star4', 'star8', 'plus'];

export class Star {
    constructor() {
        this.active = false;
        // Pre-allocated RGB triplets so reset() never allocates.
        this.color = new Float32Array(3);
        this.borderColor = new Float32Array(3);
    }

    reset(x, y, burst = false) {
        this.x = x ?? random(0, Viewport.width);
        this.y = y ?? random(0, Viewport.height);

        // Heavily weight toward small stars; the rare big ones are tasty.
        const sizeRoll = Math.pow(Math.random(), 6);
        this.z = (1 - sizeRoll) * 4 + 0.5;
        this.radius = this.z;

        this.opacity = 0;
        this.opacityOffset = Math.random() * Math.PI * 2;
        this.twinkleSpeed = random(0.01, 0.05);

        this.shape = SHAPES[(Math.random() * SHAPES.length) | 0];
        this.points = ((random(4, 7)) | 0) * 2;
        this.innerRadiusRatio = random(0.4, 0.8);

        this.isBurst = burst;
        this.vel = { x: 0, y: 0 };
        this.active = true;

        if (burst) {
            const ang = random(0, 2 * Math.PI);
            const spd = random(2, 5);
            this.vel = { x: Math.cos(ang) * spd, y: Math.sin(ang) * spd };
            this.color.set(PALETTE.burstGreen);
            this.borderColor.set(PALETTE.gold);
            // Persist indefinitely — the player picks them up by flying
            // over them. WebGL2 batches all stars in one instanced draw
            // so the additional draw cost is negligible, and the world
            // gets a richer "scatter & scoop" feel.
            this.life = -1;
        } else {
            this.color.set(NORMAL_STAR_RGB[(Math.random() * NORMAL_STAR_RGB.length) | 0]);
            this.borderColor.set(NORMAL_STAR_RGB[(Math.random() * NORMAL_STAR_RGB.length) | 0]);
            this.life = -1;
        }
    }

    update(shipVel, player, pool) {
        if (!this.active) return;

        if (this.isBurst) {
            // Burst stars persist indefinitely (life = -1). They drift,
            // friction-decelerate to a slow float, twinkle softly, and
            // get magnet-pulled toward the player at a wide radius —
            // same model as normal stars but punchier.
            this.vel.x *= STAR_FRIC;
            this.vel.y *= STAR_FRIC;
            this.x += this.vel.x;
            this.y += this.vel.y;
            this.opacityOffset += this.twinkleSpeed * 0.5;
            this.opacity = (Math.sin(this.opacityOffset) + 1) / 2 * 0.4 + 0.6;

            const dx = player.x - this.x;
            const dy = player.y - this.y;
            const dist = Math.hypot(dx, dy);
            if (player.active && dist < BURST_STAR_ATTRACT_DIST) {
                this.x += (dx / dist) * BURST_STAR_ATTR * this.z;
                this.y += (dy / dist) * BURST_STAR_ATTR * this.z;
            }
        } else {
            const dx = player.x - this.x;
            const dy = player.y - this.y;
            const dist = Math.hypot(dx, dy);
            if (player.active && dist < STAR_ATTRACT_DIST) {
                this.x += (dx / dist) * STAR_ATTR * this.z;
                this.y += (dy / dist) * STAR_ATTR * this.z;
            }
            this.opacityOffset += this.twinkleSpeed;
            this.opacity = (Math.sin(this.opacityOffset) + 1) / 2 * 0.9 + 0.1;
        }

        // Parallax: deeper stars (lower z) drift more relative to ship.
        this.x -= shipVel.x / (6 - this.z);
        this.y -= shipVel.y / (6 - this.z);
        wrap(this, Viewport);
    }

    draw(r) {
        if (!this.active) return;
        const a = this.opacity * (this.z / 5);
        if (a <= 0) return;

        const cr = this.color[0], cg = this.color[1], cb = this.color[2];
        const br = this.borderColor[0], bg = this.borderColor[1], bb = this.borderColor[2];

        if (this.shape === 'point') {
            r.fillBorderedRect(
                this.x, this.y, this.radius, 1,
                cr, cg, cb, a,
                br, bg, bb, a,
            );
            return;
        }

        const colorLineWidth = 0.5 + this.z / 5;
        const x = this.x, y = this.y;

        switch (this.shape) {
            case 'diamond': {
                const r0 = this.radius;
                const rx = r0 * 0.7;
                const p = [
                    0, -r0,
                    rx, 0,
                    0, r0,
                    -rx, 0,
                ];
                this._strokeClosed(r, x, y, p, br, bg, bb, a, 1);
                this._strokeClosed(r, x, y, p, cr, cg, cb, a, colorLineWidth);
                break;
            }
            case 'plus': {
                const r0 = this.radius;
                // Border pass — width 1.
                r.drawLine(x, y - r0, x, y + r0, 1, br, bg, bb, a);
                r.drawLine(x - r0, y, x + r0, y, 1, br, bg, bb, a);
                // Color pass.
                r.drawLine(x, y - r0, x, y + r0, colorLineWidth, cr, cg, cb, a);
                r.drawLine(x - r0, y, x + r0, y, colorLineWidth, cr, cg, cb, a);
                break;
            }
            case 'star4': {
                const r0 = this.radius;
                const r1 = r0 * 0.4;
                const p = [];
                for (let i = 0; i < 8; i++) {
                    const ang = i * Math.PI / 4;
                    const rad = i % 2 === 0 ? r0 : r1;
                    p.push(Math.cos(ang) * rad, Math.sin(ang) * rad);
                }
                this._strokeClosed(r, x, y, p, br, bg, bb, a, 1);
                this._strokeClosed(r, x, y, p, cr, cg, cb, a, colorLineWidth);
                break;
            }
            case 'star8': {
                const r0 = this.radius;
                const r1 = this.innerRadiusRatio;
                const p = [];
                const n = this.points * 2;
                for (let i = 0; i < n; i++) {
                    const ang = i * Math.PI / this.points;
                    const rad = i % 2 === 0 ? r0 : r1;
                    p.push(Math.cos(ang) * rad, Math.sin(ang) * rad);
                }
                this._strokeClosed(r, x, y, p, br, bg, bb, a, 1);
                this._strokeClosed(r, x, y, p, cr, cg, cb, a, colorLineWidth);
                break;
            }
            default: {
                // Crossed lines (X) — same as the canvas2d fallback.
                const r0 = this.radius;
                r.drawLine(x - r0, y - r0, x + r0, y + r0, 1, br, bg, bb, a);
                r.drawLine(x + r0, y - r0, x - r0, y + r0, 1, br, bg, bb, a);
                r.drawLine(x - r0, y - r0, x + r0, y + r0, colorLineWidth, cr, cg, cb, a);
                r.drawLine(x + r0, y - r0, x - r0, y + r0, colorLineWidth, cr, cg, cb, a);
                break;
            }
        }
    }

    _strokeClosed(r, ox, oy, p, cr, cg, cb, ca, lw) {
        const n = p.length;
        for (let i = 0; i < n; i += 2) {
            const j = (i + 2) % n;
            r.drawLine(ox + p[i], oy + p[i + 1], ox + p[j], oy + p[j + 1], lw, cr, cg, cb, ca);
        }
    }
}
