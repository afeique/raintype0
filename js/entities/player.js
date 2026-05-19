// Cyan twin-triangle ship. Supports two input modes:
//   • Desktop — keyboard: arrow-keys rotate + thrust, space fires.
//   • Mobile  — single stick: drag-to-move (Sky Force / Galaxy Attack
//     model). Ship auto-aims at the nearest asteroid and auto-fires
//     when something's in cone+range. Player only focuses on dodging.

import {
    SHIP_SIZE, SHIP_THRUST, SHIP_FRICTION, MAX_V, TURN_SPEED,
    random, wrap, Viewport,
} from '../core/utils.js';
import { findNearestAsteroid } from '../world/aim-assist.js';
import { BLEND_ADDITIVE, BLEND_NORMAL } from '../render/renderer.js';

const MOBILE_FIRE_INTERVAL_MS = 140; // a touch quicker than desktop's 200
const MOBILE_AUTOFIRE_MAX_DIST = 1200;
const MOBILE_AUTOFIRE_CONE = 25 * Math.PI / 180; // ±25°

export class Player {
    constructor() {
        this.isThrusting = false;
        this.active = false;
        this._lastFireAt = 0;
        this.reset();
    }

    reset() {
        this.x = Viewport.width / 2;
        this.y = Viewport.height / 2;
        this.radius = SHIP_SIZE / 2;
        this.angle = -Math.PI / 2;
        this.vel = { x: 0, y: 0 };
        this.canShoot = true;
        this.active = true;
        this.isThrusting = false;
        this._lastFireAt = 0;
    }

    update(ctx, deps) {
        if (!this.active) return;
        const { input, pools, audio, haptic, mobile, mobileInput } = deps;

        if (mobile && mobileInput) {
            this._updateMobile(mobileInput, pools, audio, haptic);
        } else {
            this._updateDesktop(input, pools, audio, haptic);
        }

        // Speed cap + integration + wrap — shared by both modes.
        const mag = Math.hypot(this.vel.x, this.vel.y);
        if (mag > MAX_V) {
            this.vel.x = (this.vel.x / mag) * MAX_V;
            this.vel.y = (this.vel.y / mag) * MAX_V;
        }
        this.x += this.vel.x;
        this.y += this.vel.y;
        wrap(this, Viewport);
    }

    // ── Desktop input (preserved from monosrc) ─────────────────────────

    _updateDesktop(input, pools, audio, haptic) {
        this.isThrusting = input.up;
        this.angle += TURN_SPEED * input.rotation;

        if (input.up) {
            this.vel.x += Math.cos(this.angle) * SHIP_THRUST;
            this.vel.y += Math.sin(this.angle) * SHIP_THRUST;
            // Particles trail BEHIND the ship.
            this._spawnThrustParticles(pools, this.angle + Math.PI);
            audio.play('thruster');
        } else if (input.down) {
            // True reverse thrust along the ship's tail direction.
            // Particles spray FORWARD off the nose so the visual
            // matches the force vector.
            this.vel.x -= Math.cos(this.angle) * SHIP_THRUST;
            this.vel.y -= Math.sin(this.angle) * SHIP_THRUST;
            this._spawnThrustParticles(pools, this.angle);
            audio.play('thruster');
            this.isThrusting = true; // counts as thrusting for SFX gate
        } else {
            this.vel.x *= SHIP_FRICTION;
            this.vel.y *= SHIP_FRICTION;
        }

        if (input.space && this.canShoot) {
            this._fire(pools, audio, haptic, this.angle);
            this.canShoot = false;
            setTimeout(() => { this.canShoot = true; }, 200);
        }
    }

    // ── Mobile single-stick input + auto-aim + auto-fire ─────────────

    _updateMobile(mobileInput, pools, audio, haptic) {
        const { move } = mobileInput;

        if (move.active && move.magnitude > 0.15) {
            this.isThrusting = true;
            const thrustDir = Math.atan2(move.y, move.x);
            const t = SHIP_THRUST * move.magnitude;
            this.vel.x += Math.cos(thrustDir) * t;
            this.vel.y += Math.sin(thrustDir) * t;
            this._spawnThrustParticles(pools, thrustDir + Math.PI);
            audio.play('thruster');
        } else {
            this.isThrusting = false;
            this.vel.x *= SHIP_FRICTION;
            this.vel.y *= SHIP_FRICTION;
        }

        const target = findNearestAsteroid(this.x, this.y, pools, MOBILE_AUTOFIRE_MAX_DIST);
        if (target) {
            this.angle = Math.atan2(target.y - this.y, target.x - this.x);
        }

        if (target) {
            const now = performance.now();
            if (now - this._lastFireAt >= MOBILE_FIRE_INTERVAL_MS) {
                const tDx = target.x - this.x;
                const tDy = target.y - this.y;
                const tLen = Math.hypot(tDx, tDy) || 1;
                const dot = (Math.cos(this.angle) * tDx + Math.sin(this.angle) * tDy) / tLen;
                if (dot >= Math.cos(MOBILE_AUTOFIRE_CONE)) {
                    this._fire(pools, audio, haptic, this.angle);
                    this._lastFireAt = now;
                }
            }
        }
    }

    // ── Shared helpers ────────────────────────────────────────────────

    _spawnThrustParticles(pools, rearAngleOverride) {
        const rear = rearAngleOverride !== undefined
            ? rearAngleOverride
            : this.angle + Math.PI;
        const dist = this.radius * 1.2;
        const spread = this.radius * 0.8;
        for (let i = 0; i < 4; i++) {
            const pAngle = rear + random(-0.3, 0.3);
            const pDist = random(0, spread);
            const px = this.x + Math.cos(pAngle) * dist + Math.cos(pAngle + Math.PI / 2) * pDist;
            const py = this.y + Math.sin(pAngle) * dist + Math.sin(pAngle + Math.PI / 2) * pDist;
            pools.particles.get(px, py, 'thrust', rear);
        }
    }

    _fire(pools, audio, haptic, angle) {
        audio.play('shoot');
        haptic(15);
        pools.bullets.get(this.x, this.y, angle);
    }

    draw(r) {
        if (!this.active) return;
        r.setLayer('overlay');
        // Ship draws as two triangles (rotated by angle + π/2). Compute
        // world-space vertices and emit each edge through drawGlowLine
        // so the renderer can synthesise the cyan halo.
        const x = this.x, y = this.y, R = this.radius, w = 1.15;
        // Local-space vertices (before rotation).
        const lx = [0, R * 0.96 * w, R * 0.6 * w, 0, -R * 0.96 * w, -R * 0.6 * w];
        const ly = [-R, R * 0.9, R * 0.9, -R * 0.1, R * 0.9, R * 0.9];

        // The original draws "rotate(angle + π/2)" then sketches with
        // nose at (0, -R). Apply that same rotation here.
        const rot = this.angle + Math.PI / 2;
        const c = Math.cos(rot), s = Math.sin(rot);
        const wx = new Array(6);
        const wy = new Array(6);
        for (let i = 0; i < 6; i++) {
            wx[i] = x + lx[i] * c - ly[i] * s;
            wy[i] = y + lx[i] * s + ly[i] * c;
        }

        // Original used 'lighter' compositing — additive blend for both
        // the line and its shadow halo. drawGlowLine emits the halo as
        // an additive soft line beneath the crisp stroke.
        r.setBlend(BLEND_ADDITIVE);
        const lw = 2;
        const glowW = 15;
        // Right triangle: 0 → 1 → 2 → 3 → 0
        r.drawGlowLine(wx[0], wy[0], wx[1], wy[1], lw, 0, 1, 1, 1, glowW, 0, 1, 1, 1);
        r.drawGlowLine(wx[1], wy[1], wx[2], wy[2], lw, 0, 1, 1, 1, glowW, 0, 1, 1, 1);
        r.drawGlowLine(wx[2], wy[2], wx[3], wy[3], lw, 0, 1, 1, 1, glowW, 0, 1, 1, 1);
        r.drawGlowLine(wx[3], wy[3], wx[0], wy[0], lw, 0, 1, 1, 1, glowW, 0, 1, 1, 1);
        // Left triangle: 0 → 4 → 5 → 3 → 0
        r.drawGlowLine(wx[0], wy[0], wx[4], wy[4], lw, 0, 1, 1, 1, glowW, 0, 1, 1, 1);
        r.drawGlowLine(wx[4], wy[4], wx[5], wy[5], lw, 0, 1, 1, 1, glowW, 0, 1, 1, 1);
        r.drawGlowLine(wx[5], wy[5], wx[3], wy[3], lw, 0, 1, 1, 1, glowW, 0, 1, 1, 1);
        r.drawGlowLine(wx[3], wy[3], wx[0], wy[0], lw, 0, 1, 1, 1, glowW, 0, 1, 1, 1);
        r.setBlend(BLEND_NORMAL);
        r.setLayer('bulk');
    }
}
