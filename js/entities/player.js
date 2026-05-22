// Cyan swept-wing interceptor. Supports two input modes:
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

        // Swept-wing interceptor (silhouette adapted from rainboids).
        // The hull is one closed 10-point perimeter in local space (nose
        // at (0, -R), +y down), rotated by angle + π/2 — same convention
        // as the old twin-triangle. We split the perimeter into bright
        // "leading" edges (nose + wing fronts) that carry the glow halo,
        // and "trailing" edges drawn as crisp lines. The glow stroke is
        // the costly primitive (canvas2d shadowBlur / WebGL bloom-boost),
        // so reserving it for the 4 front edges — instead of stroking
        // every edge with glow as before — keeps a richer hull cheaper
        // than the old 8-glow-line ship.
        //
        //            N(0)
        //           /    \
        //   LW(8)--LS(9)  RS(1)--RW(2)
        //      \    \      /    /
        //     LB(7)  \    /   RB(3)
        //        \   TC(5)   /
        //       LE(6)      RE(4)
        const x = this.x, y = this.y, R = this.radius;
        const lx = [
            0.00,  0.24,  1.16,  0.30,  0.42,
            0.00, -0.42, -0.30, -1.16, -0.24,
        ];
        const ly = [
           -1.00, -0.16,  0.50,  0.48,  0.92,
            0.58,  0.92,  0.48,  0.50, -0.16,
        ];
        const rot = this.angle + Math.PI / 2;
        const c = Math.cos(rot), s = Math.sin(rot);
        const wx = new Array(10), wy = new Array(10);
        for (let i = 0; i < 10; i++) {
            const px = lx[i] * R, py = ly[i] * R;
            wx[i] = x + px * c - py * s;
            wy[i] = y + px * s + py * c;
        }

        r.setBlend(BLEND_ADDITIVE);

        // Trailing / rear edges — crisp cyan, no halo (cheap; visually
        // recedes so the glowing front edges read as the leading face).
        const tw = 1.5, ta = 0.85;
        r.drawLine(wx[2], wy[2], wx[3], wy[3], tw, 0, 0.85, 1, ta); // RW→RB
        r.drawLine(wx[3], wy[3], wx[4], wy[4], tw, 0, 0.85, 1, ta); // RB→RE
        r.drawLine(wx[4], wy[4], wx[5], wy[5], tw, 0, 0.85, 1, ta); // RE→TC
        r.drawLine(wx[5], wy[5], wx[6], wy[6], tw, 0, 0.85, 1, ta); // TC→LE
        r.drawLine(wx[6], wy[6], wx[7], wy[7], tw, 0, 0.85, 1, ta); // LE→LB
        r.drawLine(wx[7], wy[7], wx[8], wy[8], tw, 0, 0.85, 1, ta); // LB→LW

        // Leading edges — bright cyan with glow halo (signature look).
        const lw = 2, gw = 12;
        r.drawGlowLine(wx[0], wy[0], wx[1], wy[1], lw, 0, 1, 1, 1, gw, 0, 1, 1, 1); // N→RS
        r.drawGlowLine(wx[1], wy[1], wx[2], wy[2], lw, 0, 1, 1, 1, gw, 0, 1, 1, 1); // RS→RW
        r.drawGlowLine(wx[0], wy[0], wx[9], wy[9], lw, 0, 1, 1, 1, gw, 0, 1, 1, 1); // N→LS
        r.drawGlowLine(wx[9], wy[9], wx[8], wy[8], lw, 0, 1, 1, 1, gw, 0, 1, 1, 1); // LS→LW

        // Twin engine ports — warm exhaust (matches the orange thrust
        // trail). Bright + larger while thrusting, faint ember at idle.
        const er = R * (this.isThrusting ? 0.24 : 0.13);
        const ea = this.isThrusting ? 1 : 0.4;
        r.fillCircle(wx[4], wy[4], er, 1, 0.45, 0.05, ea); // right engine
        r.fillCircle(wx[6], wy[6], er, 1, 0.45, 0.05, ea); // left engine

        // Cockpit — bright white-cyan core just behind the nose.
        const ckx = x - (-0.34 * R) * s;
        const cky = y + (-0.34 * R) * c;
        r.fillCircle(ckx, cky, R * 0.16, 0.7, 1, 1, 0.95);

        r.setBlend(BLEND_NORMAL);
        r.setLayer('bulk');
    }
}
