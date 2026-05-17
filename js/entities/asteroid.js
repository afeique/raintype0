// 3D icosahedron asteroid with pulsing hue wireframe + hit flash.
// Visual upgrades adapted from rainsrc HEAD:
//   • Per-rock unique hue palette (baseHue / hueSpread / cycleSpeed)
//   • Per-edge time-cycled HSL stroke colour
//   • Black underlay pass so wireframes read against busy starfield
//   • Localised radial flash + expanding ring + propagating wavefront
//     across edges at the bullet impact point
//   • Directional debris streaks in the hit direction

import { random, AST_SPEED, Viewport } from '../core/utils.js';
import { frameClock } from '../core/frame-clock.js';
import { hsl } from '../core/color-cache.js';

// Icosahedron edges — 12 vertices, 30 edges.
const ICOSAHEDRON_EDGES = [
    [0,1],[0,5],[0,7],[0,10],[0,11],[1,5],[1,7],[1,8],[1,9],[2,3],
    [2,4],[2,6],[2,10],[2,11],[3,4],[3,6],[3,8],[3,9],[4,5],[4,9],
    [4,11],[5,9],[5,11],[6,7],[6,8],[6,10],[7,8],[7,10],[8,9],[10,11],
];

// Base icosahedron vertices (golden ratio).
const T = (1 + Math.sqrt(5)) / 2;
const BASE_VERTS = [
    [-1, T, 0], [1, T, 0], [-1, -T, 0], [1, -T, 0],
    [0, -1, T], [0, 1, T], [0, -1, -T], [0, 1, -T],
    [T, 0, -1], [T, 0, 1], [-T, 0, -1], [-T, 0, 1],
];

const HIT_FLASH_MAX = 10;

export class Asteroid {
    constructor() {
        this.active = false;
        this.edges = ICOSAHEDRON_EDGES;
        this.fov = 300;
        this._hitFlashTimer = 0;
        this._hitPoint = { x: 0, y: 0 };
        this._hitAngle = 0;
    }

    reset(x, y, baseR) {
        this.x = x;
        this.y = y;
        this.vel = {
            x: random(-AST_SPEED, AST_SPEED) || 0.2,
            y: random(-AST_SPEED, AST_SPEED) || 0.2,
        };
        this.rot3D = { x: 0, y: 0, z: 0 };
        this.rotVel3D = {
            x: random(-0.02, 0.02),
            y: random(-0.02, 0.02),
            z: random(-0.02, 0.02),
        };
        this.active = true;
        this._hitFlashTimer = 0;

        // Unique per-asteroid hue palette (rainsrc HEAD design).
        // 80% teal→cyan→blue→violet, 20% warm gold for variety.
        this.baseHue = Math.random() < 0.2
            ? 40 + Math.random() * 20
            : 150 + Math.random() * 130;
        this.hueSpread     = 30 + Math.random() * 70;
        this.hueCycleSpeed = 10 + Math.random() * 20;
        this.saturation    = 80 + Math.random() * 15;
        this.lightness     = 65 + Math.random() * 15;

        this.rescale(baseR || random(40, 60));
    }

    rescale(newBaseRadius) {
        this.baseRadius = newBaseRadius;
        this.vertices3D = BASE_VERTS.map(v => {
            const d = 1 + random(-0.25, 0.25);
            return {
                x: v[0] * this.baseRadius * d,
                y: v[1] * this.baseRadius * d,
                z: v[2] * this.baseRadius * d,
            };
        });
        let minR = Infinity, maxR = 0;
        for (const v of this.vertices3D) {
            const d = Math.hypot(v.x, v.y, v.z);
            if (d < minR) minR = d;
            if (d > maxR) maxR = d;
        }
        this.radius = (minR + maxR) / 2;
        this.mass = (4 / 3) * Math.PI * Math.pow(this.radius, 3);
        this.project();
    }

    project() {
        const cosX = Math.cos(this.rot3D.x), sinX = Math.sin(this.rot3D.x);
        const cosY = Math.cos(this.rot3D.y), sinY = Math.sin(this.rot3D.y);
        const cosZ = Math.cos(this.rot3D.z), sinZ = Math.sin(this.rot3D.z);
        this.projectedVertices = this.vertices3D.map(v => {
            let x = v.x, y = v.y, z = v.z;
            let tx = x, ty = y;
            x = tx * cosZ - ty * sinZ;
            y = tx * sinZ + ty * cosZ;
            tx = y; let tz = z;
            y = tx * cosX - tz * sinX;
            z = tx * sinX + tz * cosX;
            tx = x; tz = z;
            x = tx * cosY + tz * sinY;
            z = -tx * sinY + tz * cosY;
            return {
                x: (x * this.fov) / (this.fov + z),
                y: (y * this.fov) / (this.fov + z),
                depth: z,
            };
        });
    }

    update() {
        if (!this.active) return;
        this.x += this.vel.x;
        this.y += this.vel.y;
        const wrapBuffer = this.baseRadius * 4;
        if (this.x < -wrapBuffer)              this.x = Viewport.width + wrapBuffer;
        if (this.x > Viewport.width + wrapBuffer)  this.x = -wrapBuffer;
        if (this.y < -wrapBuffer)              this.y = Viewport.height + wrapBuffer;
        if (this.y > Viewport.height + wrapBuffer) this.y = -wrapBuffer;
        this.rot3D.x += this.rotVel3D.x;
        this.rot3D.y += this.rotVel3D.y;
        this.rot3D.z += this.rotVel3D.z;
        this.project();
    }

    // Called by the collision handler at the moment of bullet impact.
    // Stores the world-space hit point and angle so the next 10 draws
    // can paint the localised flash + propagating wavefront.
    registerHit(x, y, angle) {
        this._hitFlashTimer = HIT_FLASH_MAX;
        this._hitPoint.x = x;
        this._hitPoint.y = y;
        this._hitAngle = angle ?? 0;
    }

    draw(ctx) {
        if (!this.active) return;

        ctx.save();
        ctx.translate(this.x, this.y);

        this._drawWireframe(ctx);

        // Propagating wavefront across edges — only while flashing.
        if (this._hitFlashTimer > 0) this._drawHitWavefront(ctx);

        ctx.restore();

        // Localised radial flash lives in world-space (post-restore).
        if (this._hitFlashTimer > 0) {
            this._drawHitFlash(ctx);
            this._hitFlashTimer--;
        }
    }

    // ── Wireframe pass (black underlay + per-edge pulsing colour) ──────

    _drawWireframe(ctx) {
        const now = frameClock.now;

        // Black underlay — one beginPath + stroke for the whole shape,
        // thicker than the colour pass so each edge gets an outline.
        // Makes wireframes legible against bright starfield / particles.
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 0.85;
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 4.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (let i = 0; i < this.edges.length; i++) {
            const e = this.edges[i];
            const v1 = this.projectedVertices[e[0]];
            const v2 = this.projectedVertices[e[1]];
            if (!v1 || !v2) continue;
            ctx.moveTo(v1.x, v1.y);
            ctx.lineTo(v2.x, v2.y);
        }
        ctx.stroke();

        // Colour pass — each edge gets its own time-cycled HSL stroke.
        // hue = baseHue + cycleOffset + edgeIndex/total × hueSpread.
        // Alpha falls off with depth (pseudo-3D look).
        ctx.lineWidth = 2;
        ctx.lineCap = 'butt';
        const fovInvRange = 1 / (this.fov + this.radius);
        for (let i = 0; i < this.edges.length; i++) {
            const e = this.edges[i];
            const v1 = this.projectedVertices[e[0]];
            const v2 = this.projectedVertices[e[1]];
            if (!v1 || !v2) continue;
            const avg = (v1.depth + v2.depth) * 0.5;
            const alpha = Math.max(0.2,
                Math.pow(Math.max(0, (this.fov - avg) * fovInvRange), 2.0));
            const hue = (this.baseHue
                + now / this.hueCycleSpeed
                + (i / this.edges.length) * this.hueSpread) % 360;
            ctx.globalAlpha = alpha;
            ctx.strokeStyle = hsl(hue, this.saturation, this.lightness);
            ctx.beginPath();
            ctx.moveTo(v1.x, v1.y);
            ctx.lineTo(v2.x, v2.y);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
    }

    // ── Hit wavefront (in entity-local coords, inside save/restore) ───

    _drawHitWavefront(ctx) {
        if (!this.projectedVertices) return;
        const progress = 1 - (this._hitFlashTimer / HIT_FLASH_MAX);
        // Convert world-space hit point into entity-local coords.
        const hx = this._hitPoint.x - this.x;
        const hy = this._hitPoint.y - this.y;
        const maxDist = Math.max(1, this.radius * 2);
        const wave = progress * 1.1;
        const waveWidth = 0.32;

        ctx.globalCompositeOperation = 'lighter';
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';

        for (let i = 0; i < this.edges.length; i++) {
            const e = this.edges[i];
            const v1 = this.projectedVertices[e[0]];
            const v2 = this.projectedVertices[e[1]];
            if (!v1 || !v2) continue;
            const mx = (v1.x + v2.x) * 0.5;
            const my = (v1.y + v2.y) * 0.5;
            const dNorm = Math.hypot(mx - hx, my - hy) / maxDist;
            const u = (wave - dNorm) / waveWidth;
            const intensity = Math.exp(-u * u);
            if (intensity < 0.02) continue;
            ctx.globalAlpha = Math.min(1, intensity);
            ctx.strokeStyle = '#ffffff';
            ctx.beginPath();
            ctx.moveTo(v1.x, v1.y);
            ctx.lineTo(v2.x, v2.y);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.lineCap = 'butt';
    }

    // ── Localised flash (world-space, AFTER the entity translate) ─────

    _drawHitFlash(ctx) {
        const t = this._hitFlashTimer;
        const alpha = t / HIT_FLASH_MAX;
        const progress = 1 - alpha;
        const fr = this.radius * 0.65;

        // Clamp the visible flash centre to within 0.85R of the asteroid
        // centre so a glancing edge-hit doesn't paint half its glow into
        // empty space.
        const dx0 = this._hitPoint.x - this.x;
        const dy0 = this._hitPoint.y - this.y;
        const d0 = Math.hypot(dx0, dy0);
        const maxDist = this.radius * 0.85;
        const cx = d0 > maxDist ? this.x + (dx0 / d0) * maxDist : this._hitPoint.x;
        const cy = d0 > maxDist ? this.y + (dy0 / d0) * maxDist : this._hitPoint.y;

        ctx.save();
        ctx.globalCompositeOperation = 'lighter';

        // Radial gradient — white core fading to cool blue.
        const flashAlpha = alpha * 0.7;
        const flashRadius = fr * (1 + progress * 0.4);
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, flashRadius);
        grad.addColorStop(0,   `rgba(255, 255, 255, ${flashAlpha})`);
        grad.addColorStop(0.5, `rgba(200, 220, 255, ${flashAlpha * 0.35})`);
        grad.addColorStop(1,   'rgba(150, 200, 255, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, flashRadius, 0, Math.PI * 2);
        ctx.fill();

        // Expanding ring kicks in after 10% of the flash.
        if (progress > 0.1) {
            const ringProgress = (progress - 0.1) / 0.9;
            const ringRadius = fr * (0.3 + ringProgress * 1.8);
            const ringAlpha = (1 - ringProgress) * 0.3;
            ctx.strokeStyle = `rgba(180, 220, 255, ${ringAlpha})`;
            ctx.lineWidth = Math.max(1, fr * 0.08 * (1 - ringProgress));
            ctx.beginPath();
            ctx.arc(cx, cy, ringRadius, 0, Math.PI * 2);
            ctx.stroke();
        }

        // 4 directional debris streaks in the bullet's travel direction.
        const colors = ['255,255,255', '120,235,255', '255,255,150', '190,150,255'];
        for (let i = 0; i < 4; i++) {
            const angle = this._hitAngle + (i / 4 - 0.375) * 1.5;
            const speed = 0.5 + (i * 31 % 10) * 0.06;
            const dist = progress * fr * 2.5 * speed;
            const ddx = Math.cos(angle) * dist;
            const ddy = Math.sin(angle) * dist;
            const sz = fr * (0.18 - progress * 0.09);
            if (sz <= 0) continue;
            ctx.fillStyle = `rgba(${colors[i]}, ${alpha * 0.5})`;
            ctx.beginPath();
            ctx.arc(cx + ddx, cy + ddy, sz, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }
}
