// Money pieces — the collectible currency that destroyed asteroids
// scatter. Unlike background stars (entities/star.js), these ARE
// magnet-pulled toward the ship and ARE collected on contact for score.
// Keeping them a separate entity from decorative stars is the whole
// point: one clear concept per class.
//
// Three denominations, drawn as little coins/gems. Gold is rarest and
// worth the most, giving the "scatter & scoop" a light risk/reward read.

import {
    MONEY_ATTR, MONEY_ATTRACT_DIST, STAR_FRIC,
    random, wrap, Viewport,
} from '../core/utils.js';
import { hexToRgb } from '../render/color-util.js';

// fill, border (rim), score, spawn weight (relative). Tweak freely.
const VARIANT = (fill, border, score, weight) => ({
    color: hexToRgb(fill),
    border: hexToRgb(border),
    score,
    weight,
});
const MONEY_VARIANTS = [
    VARIANT('#00ff7f', '#0a5235', 5,  60),  // green — common
    VARIANT('#ff5bc2', '#5e1440', 9,  30),  // pink  — uncommon
    VARIANT('#ffd700', '#7a5600', 18, 10),  // gold  — rare, high value
];
const MONEY_TOTAL_WEIGHT = MONEY_VARIANTS.reduce((s, v) => s + v.weight, 0);

function pickVariant() {
    let roll = Math.random() * MONEY_TOTAL_WEIGHT;
    for (const v of MONEY_VARIANTS) {
        roll -= v.weight;
        if (roll < 0) return v;
    }
    return MONEY_VARIANTS[0];
}

export class MoneyPiece {
    constructor() {
        this.active = false;
        this.color = new Float32Array(3);
        this.borderColor = new Float32Array(3);
    }

    reset(x, y) {
        this.x = x;
        this.y = y;

        // Fling outward from the spawn point, then friction-decay to a
        // slow float so the magnet can take over.
        const ang = random(0, 2 * Math.PI);
        const spd = random(2, 5);
        this.vel = { x: Math.cos(ang) * spd, y: Math.sin(ang) * spd };

        const v = pickVariant();
        this.color.set(v.color);
        this.borderColor.set(v.border);
        this.score = v.score;
        // Readable, consistent pickup size (gold reads a touch larger so
        // the rare piece pops) — distinct from the tiny background dust.
        this.radius = v.score >= 18 ? 5.5 : 4.5;

        // Fixed mid-foreground parallax depth (collectibles sit "in" the
        // playfield, not deep in the backdrop).
        this.z = 3;

        this.opacity = 1;
        this.opacityOffset = Math.random() * Math.PI * 2;
        this.twinkleSpeed = random(0.02, 0.05);

        this.active = true;
    }

    update(shipVel, player) {
        if (!this.active) return;

        this.vel.x *= STAR_FRIC;
        this.vel.y *= STAR_FRIC;
        this.x += this.vel.x;
        this.y += this.vel.y;

        // Gentle shimmer.
        this.opacityOffset += this.twinkleSpeed;
        this.opacity = (Math.sin(this.opacityOffset) + 1) / 2 * 0.3 + 0.7;

        // Magnet toward the ship — the "scoop". Flat per-frame pull so the
        // feel doesn't depend on parallax depth.
        if (player.active) {
            const dx = player.x - this.x;
            const dy = player.y - this.y;
            const dist = Math.hypot(dx, dy);
            if (dist < MONEY_ATTRACT_DIST && dist > 0.0001) {
                this.x += (dx / dist) * MONEY_ATTR;
                this.y += (dy / dist) * MONEY_ATTR;
            }
        }

        // Parallax-drift with the world so pieces feel anchored in space.
        this.x -= shipVel.x / (6 - this.z);
        this.y -= shipVel.y / (6 - this.z);
        wrap(this, Viewport);
    }

    draw(r) {
        if (!this.active) return;
        const a = this.opacity;
        const x = this.x, y = this.y, rad = this.radius;
        const cr = this.color[0], cg = this.color[1], cb = this.color[2];
        const br = this.borderColor[0], bg = this.borderColor[1], bb = this.borderColor[2];

        // Coin body, darker rim, bright centre highlight.
        r.fillCircle(x, y, rad, cr, cg, cb, a);
        r.strokeRing(x, y, rad, Math.max(1, rad * 0.28), br, bg, bb, a);
        r.fillCircle(x, y, rad * 0.4, 1, 1, 1, a * 0.85);
    }
}
