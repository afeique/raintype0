// Hybrid renderer — WebGL2 underneath for the high-volume primitives
// (stars, particles, bullets, line debris) and a thin Canvas2D overlay
// on top for the visually-sensitive entities (player ship glow,
// asteroid wireframe, radial hit flash). The two canvases are stacked
// in the DOM and both apply their own per-frame veil so trails fade
// consistently.
//
// Routing: entities call `r.setLayer('overlay')` before their draws
// (asteroid + player) and `r.setLayer('bulk')` after. The default layer
// is 'bulk'.

import { Renderer, BLEND_NORMAL, BLEND_ADDITIVE } from './renderer.js';
import { WebGL2Renderer } from './webgl2-renderer.js';
import { Canvas2DRenderer } from './canvas2d-renderer.js';

export class WebGL2HybridRenderer extends Renderer {
    constructor(canvas) {
        super(canvas);
        this.bulk = new WebGL2Renderer(canvas);

        // Overlay canvas — inserted directly after the game canvas so
        // it stacks on top. It must NOT have the global `canvas
        // { background: #000 }` style or it would hide the WebGL layer.
        this.overlayCanvas = document.createElement('canvas');
        this.overlayCanvas.id = 'gameOverlayCanvas';
        const s = this.overlayCanvas.style;
        s.position = 'absolute';
        s.top = '0';
        s.left = '0';
        s.pointerEvents = 'none';
        s.zIndex = '2';
        s.background = 'transparent';
        canvas.parentNode.insertBefore(this.overlayCanvas, canvas.nextSibling);
        this.overlay = new Canvas2DRenderer(this.overlayCanvas);

        this._layer = 'bulk';
        this._current = this.bulk;
    }

    async init() {
        const ok = await this.bulk.init();
        if (!ok) return false;
        await this.overlay.init();
        return true;
    }

    resize(w, h) {
        super.resize(w, h);
        this.bulk.resize(w, h);
        this.overlay.resize(w, h);
    }

    beginFrame(shakeX = 0, shakeY = 0) {
        this.bulk.beginFrame(shakeX, shakeY);
        this.overlay.beginFrame(shakeX, shakeY);
        this._layer = 'bulk';
        this._current = this.bulk;
    }

    applyVeil(r, g, b, a) {
        // WebGL bulk: standard veil via FBO.
        this.bulk.applyVeil(r, g, b, a);
        // Overlay canvas2d: use destination-out so transparent regions
        // stay transparent (the WebGL layer below shows through), while
        // previously-drawn ship/asteroid pixels fade toward fully
        // transparent at the same 30%-per-frame rate.
        const c = this.overlay.ctx;
        c.save();
        c.globalCompositeOperation = 'destination-out';
        c.globalAlpha = a;
        c.fillStyle = '#ffffff';
        c.fillRect(0, 0, this.width, this.height);
        c.restore();
    }

    setBlend(mode) {
        this._current.setBlend(mode);
    }

    endFrame() {
        this.bulk.endFrame();
        this.overlay.endFrame();
    }

    setLayer(name) {
        if (name === this._layer) return;
        this._layer = name;
        this._current = name === 'overlay' ? this.overlay : this.bulk;
    }

    // ── Primitive forwards ────────────────────────────────────────────

    fillCircle(x, y, radius, r, g, b, a) {
        this._current.fillCircle(x, y, radius, r, g, b, a);
    }
    strokeRing(x, y, radius, lineWidth, r, g, b, a) {
        this._current.strokeRing(x, y, radius, lineWidth, r, g, b, a);
    }
    fillBorderedRect(cx, cy, size, borderSize, fr, fg, fb, fa, br, bg, bb, ba) {
        this._current.fillBorderedRect(cx, cy, size, borderSize, fr, fg, fb, fa, br, bg, bb, ba);
    }
    drawLine(x1, y1, x2, y2, lineWidth, r, g, b, a) {
        this._current.drawLine(x1, y1, x2, y2, lineWidth, r, g, b, a);
    }
    drawGlowLine(x1, y1, x2, y2, lineWidth, r, g, b, a, glowWidth, gr, gg, gb, ga) {
        this._current.drawGlowLine(x1, y1, x2, y2, lineWidth, r, g, b, a, glowWidth, gr, gg, gb, ga);
    }
    drawRadialFlash(cx, cy, radius, iR, iG, iB, iA, mR, mG, mB, mA, oR, oG, oB, oA) {
        this._current.drawRadialFlash(cx, cy, radius, iR, iG, iB, iA, mR, mG, mB, mA, oR, oG, oB, oA);
    }

    // Nebula clouds are background — always render on the WebGL2 bulk
    // layer (beneath the canvas2d overlay), regardless of setLayer state.
    registerTexture(id, source) {
        this.bulk.registerTexture(id, source);
    }
    drawSprite(id, cx, cy, width, height, rotation, alpha) {
        this.bulk.drawSprite(id, cx, cy, width, height, rotation, alpha);
    }
}
