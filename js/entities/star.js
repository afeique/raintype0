// Background stars — purely decorative. They twinkle (sinusoidal
// opacity) and parallax-drift relative to the ship, then toroidally
// wrap. They are NOT attracted to the player and CANNOT be collected;
// the collectible currency is a separate entity (see money-piece.js).
//
// Visual variety comes from a broad colour palette (NORMAL_STAR_RGB)
// and a weighted spread of shapes — points dominate, with the occasional
// diamond / star / ring / hexagram sprinkled in.

import { random, wrap, Viewport } from '../core/utils.js';
import { NORMAL_STAR_RGB } from '../render/color-util.js';

// Shape weighting — points dominate (the field is mostly tiny pixels)
// but a richer spread of decorative shapes is sprinkled through for
// variety. Each non-'point' entry is comparatively rare.
const SHAPES = [
    'point', 'point', 'point', 'point', 'point', 'point', 'point', 'point',
    'diamond', 'star4', 'star5', 'star8', 'plus', 'cross',
    'triangle', 'hexagram', 'ring',
];

export class Star {
    constructor() {
        this.active = false;
        // Pre-allocated RGB triplets so reset() never allocates.
        this.color = new Float32Array(3);
        this.borderColor = new Float32Array(3);
    }

    reset(x, y) {
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

        // Independent fill + border colours from the wide palette so the
        // field reads as a varied stellar population rather than one hue.
        this.color.set(NORMAL_STAR_RGB[(Math.random() * NORMAL_STAR_RGB.length) | 0]);
        this.borderColor.set(NORMAL_STAR_RGB[(Math.random() * NORMAL_STAR_RGB.length) | 0]);

        this.active = true;
    }

    update(shipVel) {
        if (!this.active) return;

        // Decorative only: twinkle in place, then parallax-drift with the
        // ship. No attraction toward the player — that belongs to money
        // pieces alone.
        this.opacityOffset += this.twinkleSpeed;
        this.opacity = (Math.sin(this.opacityOffset) + 1) / 2 * 0.9 + 0.1;

        // Parallax: shallower stars (higher z) drift more relative to ship.
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
            case 'star5': {
                // 5-point star (alternating outer/inner radius).
                const r0 = this.radius;
                const r1 = r0 * 0.45;
                const p = [];
                for (let i = 0; i < 10; i++) {
                    const ang = -Math.PI / 2 + i * Math.PI / 5;
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
            case 'triangle': {
                const r0 = this.radius;
                const p = [];
                for (let i = 0; i < 3; i++) {
                    const ang = -Math.PI / 2 + i * (2 * Math.PI / 3);
                    p.push(Math.cos(ang) * r0, Math.sin(ang) * r0);
                }
                this._strokeClosed(r, x, y, p, br, bg, bb, a, 1);
                this._strokeClosed(r, x, y, p, cr, cg, cb, a, colorLineWidth);
                break;
            }
            case 'hexagram': {
                // Two overlapping triangles (Star of David). Draw each as
                // its own closed loop so the SDF lines render crisply.
                const r0 = this.radius;
                const triA = [], triB = [];
                for (let i = 0; i < 3; i++) {
                    const aAng = -Math.PI / 2 + i * (2 * Math.PI / 3);
                    const bAng =  Math.PI / 2 + i * (2 * Math.PI / 3);
                    triA.push(Math.cos(aAng) * r0, Math.sin(aAng) * r0);
                    triB.push(Math.cos(bAng) * r0, Math.sin(bAng) * r0);
                }
                this._strokeClosed(r, x, y, triA, br, bg, bb, a, 1);
                this._strokeClosed(r, x, y, triB, br, bg, bb, a, 1);
                this._strokeClosed(r, x, y, triA, cr, cg, cb, a, colorLineWidth);
                this._strokeClosed(r, x, y, triB, cr, cg, cb, a, colorLineWidth);
                break;
            }
            case 'ring': {
                const r0 = this.radius;
                r.strokeRing(x, y, r0, 1, br, bg, bb, a);
                r.strokeRing(x, y, r0, colorLineWidth, cr, cg, cb, a);
                break;
            }
            default: {
                // Crossed lines (X) — 'cross' shape + fallback.
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
