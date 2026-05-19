// Abstract Renderer interface — every concrete backend (canvas2d,
// WebGL2, WebGL2-hybrid, WebGPU) implements this surface. Entity
// draw() methods talk only to this interface and never poke a
// CanvasRenderingContext2D / WebGL2RenderingContext directly.
//
// All coordinates are in world space. Entities that need a local
// rotation/translation (player ship, line debris, asteroid edges)
// compute the rotated world vertices themselves before calling the
// renderer, so the renderer has no transform stack.
//
// Colors are passed as four separate floats in [0, 1] (r, g, b, a).
// This avoids per-call allocations in hot paths (particles, bullets,
// asteroid edges) and lets the WebGL/WebGPU paths write them straight
// into instance buffers.

export const BLEND_NORMAL = 'normal';
export const BLEND_ADDITIVE = 'additive';

export class Renderer {
    /**
     * @param {HTMLCanvasElement} canvas — game canvas
     */
    constructor(canvas) {
        this.canvas = canvas;
        this.width = canvas.width;
        this.height = canvas.height;
    }

    /**
     * Async init. Returns true on success, false if the backend is not
     * available in this browser (caller should fall back).
     */
    async init() { return true; }

    /**
     * Canvas was resized. Concrete renderers re-create framebuffers
     * here. Default: just sync the width/height fields.
     */
    resize(w, h) {
        this.width = w;
        this.height = h;
        this.canvas.width = w;
        this.canvas.height = h;
    }

    /**
     * Begin a frame. `shakeX/Y` is the screen-shake translation to apply
     * to every world-space draw this frame.
     */
    beginFrame(shakeX = 0, shakeY = 0) {}

    /**
     * Paint the motion-blur veil over the previous frame. Standard
     * gameplay value is (0, 0, 0, 0.3). Must be called BEFORE any
     * entities draw for the new frame.
     */
    applyVeil(r, g, b, a) {}

    /**
     * Switch the blend mode used by subsequent draws.
     *   'normal'   — SRC_ALPHA, ONE_MINUS_SRC_ALPHA (canvas2d "source-over")
     *   'additive' — SRC_ALPHA, ONE              (canvas2d "lighter")
     */
    setBlend(mode) {}

    /** Flush any pending batches and present the frame to the screen. */
    endFrame() {}

    /**
     * Hint to layered renderers (Hybrid) about which target the next
     * draws should land on. Values: 'bulk' (high-volume / WebGL) or
     * 'overlay' (canvas2d for visually-sensitive entities). No-op on
     * single-backend renderers.
     */
    setLayer(name) {}

    // ── Primitives ────────────────────────────────────────────────────

    /** Filled disk centered at (x, y) with given radius. */
    fillCircle(x, y, radius, r, g, b, a) {}

    /** Stroked ring (just the outline). */
    strokeRing(x, y, radius, lineWidth, r, g, b, a) {}

    /**
     * Bordered filled rect — a "point" star. The border draws as an
     * outer rect of (size + 2*borderSize) and the fill draws inside.
     */
    fillBorderedRect(
        cx, cy, size, borderSize,
        fillR, fillG, fillB, fillA,
        borderR, borderG, borderB, borderA,
    ) {}

    /** Crisp line segment from (x1, y1) to (x2, y2). */
    drawLine(x1, y1, x2, y2, lineWidth, r, g, b, a) {}

    /**
     * Line with a soft additive halo around it — used for the player
     * ship to mimic canvas2d's shadowBlur+'lighter' glow without the
     * expensive gaussian filter. Glow color is added beneath the crisp
     * line; the line draws normally on top.
     */
    drawGlowLine(
        x1, y1, x2, y2, lineWidth,
        r, g, b, a,
        glowWidth, glowR, glowG, glowB, glowA,
    ) {}

    /**
     * Radial gradient disk — three color stops at t=0, t=0.5, t=1.
     * Used by the asteroid hit-flash. All RGBA components in [0, 1].
     */
    drawRadialFlash(
        cx, cy, radius,
        innerR, innerG, innerB, innerA,
        midR,   midG,   midB,   midA,
        outerR, outerG, outerB, outerA,
    ) {}
}
