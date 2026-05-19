// Color helpers used by every renderer. All conversions yield floats
// in [0, 1] so the WebGL/WebGPU paths can write them straight into
// instance buffers, and the canvas2d path can stringify on demand.

// ── HSL → RGB (floats in 0..1; h in degrees, s/l in percent 0..100) ──
//
// Hot path — bullets and asteroid edges call this every frame. The
// arithmetic is inlined and free of allocations; returns via the
// caller-provided destination array to avoid GC churn.

export function hslToRgb(h, s, l, out) {
    h = ((h % 360) + 360) % 360;
    s *= 0.01;
    l *= 0.01;

    const c = (1 - Math.abs(2 * l - 1)) * s;
    const hp = h / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    const m = l - c * 0.5;

    let r, g, b;
    if      (hp < 1) { r = c; g = x; b = 0; }
    else if (hp < 2) { r = x; g = c; b = 0; }
    else if (hp < 3) { r = 0; g = c; b = x; }
    else if (hp < 4) { r = 0; g = x; b = c; }
    else if (hp < 5) { r = x; g = 0; b = c; }
    else             { r = c; g = 0; b = x; }

    out[0] = r + m;
    out[1] = g + m;
    out[2] = b + m;
    return out;
}

// Parse an HTML-style hex color like "#0ff", "#00ffff", "#a6b3ff".
// Returns a fresh Float32Array(3). Call once per unique color at
// module init — never per frame.
export function hexToRgb(hex) {
    const s = hex.startsWith('#') ? hex.slice(1) : hex;
    let r, g, b;
    if (s.length === 3) {
        r = parseInt(s[0] + s[0], 16) / 255;
        g = parseInt(s[1] + s[1], 16) / 255;
        b = parseInt(s[2] + s[2], 16) / 255;
    } else {
        r = parseInt(s.slice(0, 2), 16) / 255;
        g = parseInt(s.slice(2, 4), 16) / 255;
        b = parseInt(s.slice(4, 6), 16) / 255;
    }
    return new Float32Array([r, g, b]);
}

// One-shot parser for any CSS color string ("hsl(...)", "rgb(...)",
// named, hex). Goes through a 1×1 canvas — slow, so used only when
// caching is on the call site.
let parseCanvas = null;
let parseCtx = null;
const parseCache = new Map();

export function parseCssColor(str) {
    let v = parseCache.get(str);
    if (v) return v;
    if (!parseCanvas) {
        parseCanvas = document.createElement('canvas');
        parseCanvas.width = 1;
        parseCanvas.height = 1;
        parseCtx = parseCanvas.getContext('2d', { willReadFrequently: true });
    }
    parseCtx.clearRect(0, 0, 1, 1);
    parseCtx.fillStyle = str;
    parseCtx.fillRect(0, 0, 1, 1);
    const px = parseCtx.getImageData(0, 0, 1, 1).data;
    v = new Float32Array([px[0] / 255, px[1] / 255, px[2] / 255, px[3] / 255]);
    parseCache.set(str, v);
    return v;
}

// Pre-baked palettes — every named color the game uses, exposed as
// Float32Array(3) so renderers can read them without re-parsing.
export const PALETTE = {
    cyan:        hexToRgb('#0ff'),
    white:       hexToRgb('#fff'),
    gold:        hexToRgb('#ffd700'),
    burstGreen:  hexToRgb('#00ff7f'),
};

export const NORMAL_STAR_RGB = [
    '#a6b3ff', '#c3a6ff', '#f3a6ff', '#ffa6f8',
    '#ffa6c7', '#ff528e', '#d98cff', '#ff8c00',
].map(hexToRgb);

export const ASTEROID_WARM_RGB = [
    '#ff4500', '#ff6347', '#ff7f50', '#ff8c00', '#ffa500', '#ff6b35',
].map(hexToRgb);

export const DEBRIS_BROWN_RGB = [
    '#8b4513', '#a0522d', '#cd853f', '#d2691e', '#b8860b', '#daa520',
].map(hexToRgb);

export const THRUST_RGB = [
    '#ff4500', '#ff8c00', '#ffa500',
].map(hexToRgb);
