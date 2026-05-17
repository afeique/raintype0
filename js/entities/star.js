// Background stars. Two flavours:
//   • Normal — shaped (point/diamond/star4/star8/plus), twinkles by
//     sinusoidal opacity, drifts toward the ship within 150px.
//   • Burst — gold-bordered green stars flung from a destroyed
//     asteroid. Wider attraction radius (350px) and a hard life
//     timer (300 frames).

import {
    NORMAL_STAR_COLORS,
    STAR_ATTR, STAR_FRIC,
    BURST_STAR_ATTRACT_DIST, BURST_STAR_ATTR,
    random, wrap, Viewport,
} from '../core/utils.js';

const SHAPES = ['point', 'point', 'point', 'point', 'point', 'point', 'point', 'diamond', 'star4', 'star8', 'plus'];

export class Star {
    constructor() { this.active = false; }

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
            this.color = '#00ff7f';
            this.borderColor = '#ffd700';
            this.life = 300;
        } else {
            this.color = NORMAL_STAR_COLORS[(Math.random() * NORMAL_STAR_COLORS.length) | 0];
            this.borderColor = NORMAL_STAR_COLORS[(Math.random() * NORMAL_STAR_COLORS.length) | 0];
            this.life = -1;
        }
    }

    update(shipVel, player, pool) {
        if (!this.active) return;

        if (this.isBurst) {
            this.life--;
            if (this.life <= 0) {
                pool.release(this);
                return;
            }
            this.vel.x *= STAR_FRIC;
            this.vel.y *= STAR_FRIC;
            this.x += this.vel.x;
            this.y += this.vel.y;
            this.opacity = Math.min(1, this.life / 120);

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
            if (player.active && dist < 150) {
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

    draw(ctx) {
        if (!this.active) return;
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.globalAlpha = this.opacity * (this.z / 5);

        if (this.shape === 'point') {
            const borderSize = 1;
            ctx.fillStyle = this.borderColor;
            ctx.fillRect(
                -this.radius / 2 - borderSize,
                -this.radius / 2 - borderSize,
                this.radius + borderSize * 2,
                this.radius + borderSize * 2,
            );
            ctx.fillStyle = this.color;
            ctx.fillRect(-this.radius / 2, -this.radius / 2, this.radius, this.radius);
        } else {
            ctx.beginPath();
            switch (this.shape) {
                case 'diamond':
                    ctx.moveTo(0, -this.radius);
                    ctx.lineTo(this.radius * 0.7, 0);
                    ctx.lineTo(0, this.radius);
                    ctx.lineTo(-this.radius * 0.7, 0);
                    ctx.closePath();
                    break;
                case 'plus':
                    ctx.moveTo(0, -this.radius);
                    ctx.lineTo(0, this.radius);
                    ctx.moveTo(-this.radius, 0);
                    ctx.lineTo(this.radius, 0);
                    break;
                case 'star4':
                    for (let i = 0; i < 8; i++) {
                        const a = i * Math.PI / 4;
                        const r = i % 2 === 0 ? this.radius : this.radius * 0.4;
                        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
                    }
                    ctx.closePath();
                    break;
                case 'star8':
                    for (let i = 0; i < this.points * 2; i++) {
                        const a = i * Math.PI / this.points;
                        const r = i % 2 === 0 ? this.radius : this.innerRadiusRatio;
                        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
                    }
                    ctx.closePath();
                    break;
                default:
                    ctx.moveTo(-this.radius, -this.radius);
                    ctx.lineTo(this.radius, this.radius);
                    ctx.moveTo(this.radius, -this.radius);
                    ctx.lineTo(-this.radius, this.radius);
                    break;
            }
            ctx.strokeStyle = this.borderColor;
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.strokeStyle = this.color;
            ctx.lineWidth = 0.5 + this.z / 5;
            ctx.stroke();
        }
        ctx.restore();
    }
}
