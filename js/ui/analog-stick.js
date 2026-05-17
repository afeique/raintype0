// Virtual analog stick — canvas-rendered, touch-driven.
//
// Tracks one active touch session. The handle follows the touch within
// the base radius. Output: normalized { x, y, magnitude } in [-1, 1].
// Adapted from rainsrc HEAD's analog-stick.js — visual design + maths
// preserved, dependencies stripped.

const BASE_RADIUS = 72;
const HANDLE_RADIUS = 34;
const BASE_MARGIN = 28;          // distance from canvas left/right edge
const BASE_BOTTOM_OFFSET = 110;  // distance from canvas bottom
const HIT_SLOP = 36;             // generous touch-target slop

export class AnalogStick {
    constructor({ side = 'left', label = '' } = {}) {
        this.side = side === 'right' ? 'right' : 'left';
        this.label = label;
        this.baseX = 0;
        this.baseY = 0;
        this.dx = 0;
        this.dy = 0;
        this.active = false;
        this.touchId = null;
        this._alpha = 0.55;
        this._targetAlpha = 0.55;
    }

    resize(canvasW, canvasH) {
        const x = this.side === 'left'
            ? BASE_MARGIN + BASE_RADIUS
            : canvasW - BASE_MARGIN - BASE_RADIUS;
        const y = canvasH - BASE_BOTTOM_OFFSET - BASE_RADIUS / 2;
        this.baseX = Math.round(x);
        this.baseY = Math.round(y);
    }

    contains(x, y) {
        const dx = x - this.baseX;
        const dy = y - this.baseY;
        const r = BASE_RADIUS + HIT_SLOP;
        return dx * dx + dy * dy <= r * r;
    }

    // Try to claim a touch. Returns true if the touch is in this stick's
    // zone and no other touch is already owning it.
    onTouchStart(touchId, x, y) {
        if (this.active) return false;
        if (!this.contains(x, y)) return false;
        this.active = true;
        this.touchId = touchId;
        this._targetAlpha = 1.0;
        this._updateHandle(x, y);
        return true;
    }

    onTouchMove(touchId, x, y) {
        if (!this.active || this.touchId !== touchId) return;
        this._updateHandle(x, y);
    }

    onTouchEnd(touchId) {
        if (this.touchId !== touchId) return;
        this.active = false;
        this.touchId = null;
        this._targetAlpha = 0.55;
        this.dx = 0;
        this.dy = 0;
    }

    _updateHandle(x, y) {
        let dx = x - this.baseX;
        let dy = y - this.baseY;
        const mag = Math.hypot(dx, dy);
        if (mag > BASE_RADIUS) {
            const k = BASE_RADIUS / mag;
            dx *= k;
            dy *= k;
        }
        this.dx = dx;
        this.dy = dy;
    }

    getInput() {
        const x = this.dx / BASE_RADIUS;
        const y = this.dy / BASE_RADIUS;
        const magnitude = Math.min(1, Math.hypot(x, y));
        return { x, y, magnitude, active: this.active };
    }

    draw(ctx) {
        this._alpha += (this._targetAlpha - this._alpha) * 0.18;
        if (this._alpha < 0.02) return;

        const bx = this.baseX;
        const by = this.baseY;

        ctx.save();
        ctx.globalAlpha = this._alpha;
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;

        // Base ring — translucent dark fill + light-blue stroke.
        ctx.fillStyle = 'rgba(6, 14, 32, 0.45)';
        ctx.strokeStyle = 'rgba(140, 200, 255, 0.85)';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(bx, by, BASE_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Inner guide ring — faint rail for the handle.
        ctx.strokeStyle = 'rgba(140, 200, 255, 0.30)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(bx, by, BASE_RADIUS - 10, 0, Math.PI * 2);
        ctx.stroke();

        // Optional centre label (e.g. "MOVE", "FIRE").
        if (this.label) {
            ctx.fillStyle = 'rgba(140, 200, 255, 0.45)';
            ctx.font = '10px "Press Start 2P", monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(this.label, bx, by);
        }

        // Handle — radial-gradient sphere.
        const hx = bx + this.dx;
        const hy = by + this.dy;
        const grad = ctx.createRadialGradient(
            hx - HANDLE_RADIUS * 0.35, hy - HANDLE_RADIUS * 0.35, 2,
            hx, hy, HANDLE_RADIUS,
        );
        grad.addColorStop(0,    'rgba(255, 255, 255, 0.95)');
        grad.addColorStop(0.55, 'rgba(150, 215, 255, 0.92)');
        grad.addColorStop(1,    'rgba(30, 90, 170, 0.92)');
        ctx.fillStyle = grad;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.78)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(hx, hy, HANDLE_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Centre pip — quick deflection-direction read.
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.beginPath();
        ctx.arc(hx, hy, 3, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }
}

export const ANALOG_STICK_GEOM = Object.freeze({
    BASE_RADIUS,
    HANDLE_RADIUS,
    BASE_MARGIN,
    BASE_BOTTOM_OFFSET,
    HIT_SLOP,
});
