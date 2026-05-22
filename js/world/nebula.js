// Background nebula clouds — ported from rainboids' webgl-starfield
// atlas nebula textures (FBM value-noise "wispy" filaments + dense
// "core"). Each cloud sprite is baked once into an offscreen canvas
// (pre-tinted RGBA), registered with the renderer, then drawn every
// frame as a large, low-alpha, additively-blended quad behind the
// starfield. The renderer's bloom pass softens them further.
//
// Parallax: each cloud has a depth in [0,1]; we accumulate the ship's
// (or attractor camera's) velocity into a drift offset scaled by depth,
// so deeper clouds barely move and nearer ones slide more — the same
// model the stars use, just much gentler.

import { random, Viewport } from '../core/utils.js';

const TEX_SIZE = 192;          // baked cloud texture resolution
const CLOUD_COUNT = 7;         // total clouds across all depths

// JWST-ish multi-hue palettes (RGB 0..255). Each cloud picks one and a
// tint from it — layering related-but-distinct hues reads as a rich
// nebula rather than a flat wash.
const PALETTES = [
    [[60, 120, 255], [120, 80, 255], [200, 90, 255]],   // cobalt → violet
    [[255, 70, 160], [220, 60, 220], [120, 90, 255]],   // magenta → indigo
    [[60, 220, 200], [70, 140, 255], [150, 90, 255]],   // teal → blue
    [[255, 130, 60], [255, 80, 120], [200, 70, 200]],   // ember → rose
    [[80, 230, 140], [70, 180, 255], [160, 110, 255]],  // aurora
];

// ── Multi-octave value-noise (ported from rainboids atlas) ────────────

function buildNoise(N, seed) {
    const grid = new Float32Array(N * N);
    let s = seed >>> 0;
    for (let i = 0; i < N * N; i++) {
        s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
        grid[i] = (s >>> 0) / 0xffffffff;
    }
    return grid;
}
function sampleNoise(grid, N, u, v) {
    let fx = u * N, fy = v * N;
    fx -= Math.floor(fx / N) * N;
    fy -= Math.floor(fy / N) * N;
    const ix = Math.floor(fx) % N, iy = Math.floor(fy) % N;
    const tx = fx - Math.floor(fx), ty = fy - Math.floor(fy);
    const ix1 = (ix + 1) % N, iy1 = (iy + 1) % N;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const a = grid[iy * N + ix],  b = grid[iy * N + ix1];
    const c = grid[iy1 * N + ix], d = grid[iy1 * N + ix1];
    return a * (1 - sx) * (1 - sy) + b * sx * (1 - sy)
         + c * (1 - sx) * sy + d * sx * sy;
}
function fbm(grids, sizes, u, v, anisoX = 1, anisoY = 1) {
    let sum = 0, amp = 1, total = 0;
    for (let i = 0; i < grids.length; i++) {
        sum += amp * sampleNoise(grids[i], sizes[i], u * anisoX, v * anisoY);
        total += amp;
        amp *= 0.5;
        anisoX *= 2; anisoY *= 2;
    }
    return sum / total;
}

// Bake one cloud texture into an offscreen canvas, pre-tinted.
//   kind 'wispy' — anisotropic filaments (JWST gas streamers)
//   kind 'core'  — bright center with noise-modulated halo
function bakeCloud(kind, tint) {
    const cv = document.createElement('canvas');
    cv.width = TEX_SIZE;
    cv.height = TEX_SIZE;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(TEX_SIZE, TEX_SIZE);
    const data = img.data;
    const inv = 1 / (TEX_SIZE - 1);
    const seedBase = (Math.random() * 0xffff) | 0;
    const grids = [
        buildNoise(8,  seedBase ^ 0xa1b2),
        buildNoise(16, seedBase ^ 0xc3d4),
        buildNoise(32, seedBase ^ 0xe5f6),
    ];
    const sizes = [8, 16, 32];
    const [tr, tg, tb] = tint;

    for (let y = 0; y < TEX_SIZE; y++) {
        const v = y * inv;
        const dy = (v - 0.5) * 2;
        for (let x = 0; x < TEX_SIZE; x++) {
            const u = x * inv;
            const dx = (u - 0.5) * 2;
            let a;
            if (kind === 'wispy') {
                const r2 = dx * dx * 0.7 + dy * dy * 1.5;
                const mask = Math.max(0, 1 - r2);
                const noiseV = fbm(grids, sizes, u, v, 2.5, 0.8);
                a = Math.min(1, Math.pow(noiseV, 1.7) * mask * 1.4);
            } else {
                const r2 = dx * dx + dy * dy;
                const peak = Math.exp(-r2 * 3.2);
                const halo = Math.max(0, 1 - Math.sqrt(r2));
                const noiseV = fbm(grids, sizes, u, v);
                a = Math.min(1, peak * 0.8 + halo * 0.5 * noiseV);
            }
            const idx = (y * TEX_SIZE + x) * 4;
            data[idx]     = tr;
            data[idx + 1] = tg;
            data[idx + 2] = tb;
            data[idx + 3] = a <= 0 ? 0 : a >= 1 ? 255 : Math.round(a * 255);
        }
    }
    ctx.putImageData(img, 0, 0);
    return cv;
}

export function createNebula() {
    const palette = PALETTES[(Math.random() * PALETTES.length) | 0];
    const clouds = [];
    let driftX = 0, driftY = 0;
    let t = 0;

    // Bake the cloud sprites + seed their placement / animation.
    for (let i = 0; i < CLOUD_COUNT; i++) {
        const kind = Math.random() < 0.6 ? 'wispy' : 'core';
        const tint = palette[(Math.random() * palette.length) | 0];
        const id = `nebula-${i}`;
        const sprite = bakeCloud(kind, tint);
        clouds.push({
            id,
            sprite,
            x: random(0, Viewport.width),
            y: random(0, Viewport.height),
            // Deep clouds (low depth) barely parallax; size scales with
            // depth so nearer clouds read larger.
            depth: random(0.05, 0.45),
            size: random(420, 820) * (kind === 'wispy' ? 1.25 : 1.0),
            baseAlpha: random(0.10, 0.22),
            rotation: random(0, Math.PI * 2),
            rotSpeed: (Math.random() < 0.5 ? -1 : 1) * random(0.002, 0.008),
            pulseSpeed: random(0.004, 0.012),
            pulsePhase: random(0, Math.PI * 2),
            registered: false,
        });
    }

    // Upload the baked sprites to the renderer. Safe to call again if
    // the renderer changes (re-registers the same canvases).
    function register(renderer) {
        for (const c of clouds) {
            renderer.registerTexture(c.id, c.sprite);
            c.registered = true;
        }
    }

    // STATIC for now — the drifting / rotating / pulsing nebula was too
    // distracting during play. tick() is a no-op so the clouds hold
    // position. To bring the motion back, uncomment the body below (and
    // the dynamic branch in draw()).
    function tick(velX = 0, velY = 0) {
        // t += 1;
        // driftX += Math.cos(t * 0.0009) * 0.10 - velX * 0.15;
        // driftY += Math.sin(t * 0.0011) * 0.10 - velY * 0.15;
    }

    function draw(renderer) {
        // Additive so the clouds glow and stack where they overlap, and
        // so the bloom pass picks them up. Drawn before the starfield.
        renderer.setBlend('additive');
        // const w = Viewport.width, h = Viewport.height;
        for (const c of clouds) {
            // ── Static render ──────────────────────────────────────────
            renderer.drawSprite(c.id, c.x, c.y, c.size, c.size, c.rotation, c.baseAlpha);

            // ── Dynamic version (pulse + parallax drift + rotation) ────
            // Uncomment to re-enable motion (and the body of tick()):
            // const pulse = 0.85 + 0.15 * Math.sin(t * c.pulseSpeed + c.pulsePhase);
            // const alpha = c.baseAlpha * pulse;
            // const margin = c.size;
            // let px = (c.x + driftX * c.depth) % (w + margin * 2);
            // let py = (c.y + driftY * c.depth) % (h + margin * 2);
            // if (px < -margin) px += w + margin * 2;
            // if (py < -margin) py += h + margin * 2;
            // const rot = c.rotation + t * c.rotSpeed;
            // renderer.drawSprite(c.id, px, py, c.size, c.size, rot, alpha);
        }
        renderer.setBlend('normal');
    }

    return { register, tick, draw };
}
