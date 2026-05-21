// Canvas2D backend — the reference renderer. Translates Renderer
// primitives back into CanvasRenderingContext2D calls so the visual
// baseline matches the original game exactly. This is the default
// path and the fallback when WebGL2/WebGPU init fails.

import { Renderer, BLEND_NORMAL, BLEND_ADDITIVE } from './renderer.js';

// CSS-color cache for rgba(r,g,b,a). Quantises alpha to 1/1000 — visually
// indistinguishable from full precision. Key is composed of all four
// 8-bit/10-bit channels as a single positive integer.
const _strCache = new Map();
function rgbaStr(r, g, b, a) {
    let ri = (r * 255) | 0; if (ri < 0) ri = 0; else if (ri > 255) ri = 255;
    let gi = (g * 255) | 0; if (gi < 0) gi = 0; else if (gi > 255) gi = 255;
    let bi = (b * 255) | 0; if (bi < 0) bi = 0; else if (bi > 255) bi = 255;
    let ai = (a * 1000) | 0; if (ai < 0) ai = 0; else if (ai > 1000) ai = 1000;
    // 256^3 * 1024 = 17 179 869 184 — fits safely under 2^53.
    const key = ((ri * 256 + gi) * 256 + bi) * 1024 + ai;
    let s = _strCache.get(key);
    if (s !== undefined) return s;
    s = `rgba(${ri},${gi},${bi},${(ai / 1000).toFixed(3)})`;
    _strCache.set(key, s);
    return s;
}

export class Canvas2DRenderer extends Renderer {
    constructor(canvas) {
        super(canvas);
        this.ctx = canvas.getContext('2d');
        this.blend = BLEND_NORMAL;
        this._shakeX = 0;
        this._shakeY = 0;
        this._textures = new Map();
    }

    async init() {
        return !!this.ctx;
    }

    resize(w, h) {
        super.resize(w, h);
    }

    beginFrame(shakeX = 0, shakeY = 0) {
        this._shakeX = shakeX;
        this._shakeY = shakeY;
        this.ctx.save();
        if (shakeX || shakeY) this.ctx.translate(shakeX, shakeY);
        // Default state — entities don't reset this, so do it once.
        this.ctx.globalCompositeOperation = 'source-over';
        this.blend = BLEND_NORMAL;
    }

    applyVeil(r, g, b, a) {
        // Veil is drawn in screen coords — temporarily undo the shake.
        const c = this.ctx;
        c.save();
        if (this._shakeX || this._shakeY) c.translate(-this._shakeX, -this._shakeY);
        c.globalCompositeOperation = 'source-over';
        c.globalAlpha = 1;
        c.fillStyle = rgbaStr(r, g, b, a);
        c.fillRect(0, 0, this.width, this.height);
        c.restore();
        c.globalCompositeOperation = this.blend === BLEND_ADDITIVE ? 'lighter' : 'source-over';
    }

    setBlend(mode) {
        if (mode === this.blend) return;
        this.blend = mode;
        this.ctx.globalCompositeOperation = mode === BLEND_ADDITIVE ? 'lighter' : 'source-over';
    }

    endFrame() {
        this.ctx.restore();
    }

    fillCircle(x, y, radius, r, g, b, a) {
        const c = this.ctx;
        c.fillStyle = rgbaStr(r, g, b, a);
        c.beginPath();
        c.arc(x, y, radius, 0, 2 * Math.PI);
        c.fill();
    }

    strokeRing(x, y, radius, lineWidth, r, g, b, a) {
        const c = this.ctx;
        c.strokeStyle = rgbaStr(r, g, b, a);
        c.lineWidth = lineWidth;
        c.beginPath();
        c.arc(x, y, radius, 0, 2 * Math.PI);
        c.stroke();
    }

    fillBorderedRect(
        cx, cy, size, borderSize,
        fillR, fillG, fillB, fillA,
        borderR, borderG, borderB, borderA,
    ) {
        const c = this.ctx;
        c.fillStyle = rgbaStr(borderR, borderG, borderB, borderA);
        c.fillRect(
            cx - size / 2 - borderSize,
            cy - size / 2 - borderSize,
            size + borderSize * 2,
            size + borderSize * 2,
        );
        c.fillStyle = rgbaStr(fillR, fillG, fillB, fillA);
        c.fillRect(cx - size / 2, cy - size / 2, size, size);
    }

    drawLine(x1, y1, x2, y2, lineWidth, r, g, b, a) {
        const c = this.ctx;
        c.strokeStyle = rgbaStr(r, g, b, a);
        c.lineWidth = lineWidth;
        c.beginPath();
        c.moveTo(x1, y1);
        c.lineTo(x2, y2);
        c.stroke();
    }

    drawGlowLine(
        x1, y1, x2, y2, lineWidth,
        r, g, b, a,
        glowWidth, glowR, glowG, glowB, glowA,
    ) {
        const c = this.ctx;
        // Replicate the original shadowBlur+'lighter' effect with native
        // shadow — the renderer is already inside an additive blend so
        // the shadow gets the full glow look without extra passes.
        const prevShadowColor = c.shadowColor;
        const prevShadowBlur = c.shadowBlur;
        c.shadowColor = rgbaStr(glowR, glowG, glowB, glowA);
        c.shadowBlur = glowWidth;
        c.strokeStyle = rgbaStr(r, g, b, a);
        c.lineWidth = lineWidth;
        c.beginPath();
        c.moveTo(x1, y1);
        c.lineTo(x2, y2);
        c.stroke();
        c.shadowColor = prevShadowColor;
        c.shadowBlur = prevShadowBlur;
    }

    drawRadialFlash(
        cx, cy, radius,
        innerR, innerG, innerB, innerA,
        midR,   midG,   midB,   midA,
        outerR, outerG, outerB, outerA,
    ) {
        const c = this.ctx;
        const grad = c.createRadialGradient(cx, cy, 0, cx, cy, radius);
        grad.addColorStop(0,   rgbaStr(innerR, innerG, innerB, innerA));
        grad.addColorStop(0.5, rgbaStr(midR,   midG,   midB,   midA));
        grad.addColorStop(1,   rgbaStr(outerR, outerG, outerB, outerA));
        c.fillStyle = grad;
        c.beginPath();
        c.arc(cx, cy, radius, 0, 2 * Math.PI);
        c.fill();
    }

    registerTexture(id, source) {
        this._textures.set(id, source);
    }

    drawSprite(id, cx, cy, width, height, rotation, alpha) {
        const tex = this._textures.get(id);
        if (!tex || alpha <= 0) return;
        const c = this.ctx;
        c.save();
        c.globalAlpha = alpha;
        c.translate(cx, cy);
        if (rotation) c.rotate(rotation);
        c.drawImage(tex, -width / 2, -height / 2, width, height);
        c.restore();
        // globalAlpha is reset by restore(); blend mode is restored by
        // the outer frame's composite state.
    }
}
