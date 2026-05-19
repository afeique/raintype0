// Full WebGL2 single-canvas renderer. Replaces every canvas2d draw
// path with instanced batched draws.
//
// Architecture:
//   • One offscreen framebuffer (R8G8B8A8 colour) preserves the
//     motion-blur veil across frames. The final present blits the
//     texture to the default framebuffer.
//   • Five batch shaders share a static unit quad:
//       1. Circle SDF      — fillCircle
//       2. Ring SDF        — strokeRing
//       3. Bordered rect   — fillBorderedRect (point star)
//       4. Line capsule    — drawLine and drawGlowLine
//       5. Radial 3-stop   — drawRadialFlash
//   • Each batch carries its own scratch Float32Array. setBlend(mode)
//     flushes ALL batches at the current blend state, then switches
//     the GL blend func so subsequent draws batch under the new mode.
//   • All draws transform from world pixels → clip space in the vertex
//     shader using a u_viewport uniform; screen shake is applied as a
//     uniform translation, no per-vertex CPU work.

import { Renderer, BLEND_NORMAL, BLEND_ADDITIVE } from './renderer.js';

// ── Shaders ───────────────────────────────────────────────────────────

const VS_HEADER = `#version 300 es
precision highp float;
uniform vec2 u_viewport;
uniform vec2 u_shake;
vec2 worldToClip(vec2 world) {
    vec2 px = world + u_shake;
    vec2 clip = (px / u_viewport) * 2.0 - 1.0;
    return vec2(clip.x, -clip.y);
}
`;

const FS_HEADER = `#version 300 es
precision highp float;
out vec4 fragColor;
`;

// ── 1. Circle SDF ─────────────────────────────────────────────────────

const CIRCLE_VS = VS_HEADER + `
in vec2 a_quad;          // [-1,1]^2
in vec2 a_center;
in float a_radius;
in vec4 a_color;
out vec2 v_local;        // pixel offset from center — varies per vertex
flat out float v_radius; // per-instance constant — skip rasterizer interp
flat out vec4 v_color;
void main() {
    v_local  = a_quad * a_radius;
    v_radius = a_radius;
    v_color  = a_color;
    vec2 world = a_center + v_local;
    gl_Position = vec4(worldToClip(world), 0.0, 1.0);
}
`;
const CIRCLE_FS = FS_HEADER + `
in vec2 v_local;
flat in float v_radius;
flat in vec4 v_color;
void main() {
    float d = length(v_local);
    // Coverage model matching canvas2d ctx.arc()+fill: full inside
    // (radius - 0.5), 1-px AA at the edge, sub-pixel radii dim toward
    // πr² area coverage.
    float innerEdge = max(0.0, v_radius - 0.5);
    float outerEdge = v_radius + 0.5;
    float coverageScale = clamp(v_radius * 2.0, 0.0, 1.0);
    float a = (1.0 - smoothstep(innerEdge, outerEdge, d)) * coverageScale;
    if (a <= 0.0) discard;
    fragColor = vec4(v_color.rgb, v_color.a * a);
}
`;

// ── 2. Ring SDF ───────────────────────────────────────────────────────

const RING_VS = VS_HEADER + `
in vec2 a_quad;
in vec2 a_center;
in float a_radius;
in float a_lineWidth;
in vec4 a_color;
out vec2 v_local;
flat out float v_radius;
flat out float v_halfWidth;
flat out vec4 v_color;
void main() {
    // Pad quad by half lineWidth so we don't clip the outer edge.
    float outerR = a_radius + a_lineWidth * 0.5 + 1.0;
    v_local     = a_quad * outerR;
    v_radius    = a_radius;
    v_halfWidth = a_lineWidth * 0.5;
    v_color     = a_color;
    vec2 world  = a_center + v_local;
    gl_Position = vec4(worldToClip(world), 0.0, 1.0);
}
`;
const RING_FS = FS_HEADER + `
in vec2 v_local;
flat in float v_radius;
flat in float v_halfWidth;
flat in vec4 v_color;
void main() {
    float d = length(v_local);
    // Signed distance from the ring centre line. Same coverage model
    // as the line capsule — see LINE_FS comment.
    float ringDist = abs(d - v_radius);
    float innerEdge = max(0.0, v_halfWidth - 0.5);
    float outerEdge = v_halfWidth + 0.5;
    float coverageScale = clamp(v_halfWidth * 2.0, 0.0, 1.0);
    float a = (1.0 - smoothstep(innerEdge, outerEdge, ringDist)) * coverageScale;
    if (a <= 0.0) discard;
    fragColor = vec4(v_color.rgb, v_color.a * a);
}
`;

// ── 3. Bordered rect (point star) ─────────────────────────────────────

const POINT_VS = VS_HEADER + `
in vec2 a_quad;
in vec2 a_center;
in float a_size;
in float a_borderSize;
in vec4 a_fillColor;
in vec4 a_borderColor;
out vec2 v_local;
flat out float v_size;
flat out vec4 v_fill;
flat out vec4 v_border;
void main() {
    // Quad sized to (size + 2*borderSize).
    float outer = a_size + 2.0 * a_borderSize;
    v_local = a_quad * outer * 0.5;
    v_size  = a_size;
    v_fill  = a_fillColor;
    v_border = a_borderColor;
    vec2 world = a_center + v_local;
    gl_Position = vec4(worldToClip(world), 0.0, 1.0);
}
`;
const POINT_FS = FS_HEADER + `
in vec2 v_local;
flat in float v_size;
flat in vec4 v_fill;
flat in vec4 v_border;
void main() {
    float halfSize = v_size * 0.5;
    // Inside fill rect — Chebyshev distance for the rectangle border.
    float dx = abs(v_local.x);
    float dy = abs(v_local.y);
    bool inFill = (dx <= halfSize && dy <= halfSize);
    fragColor = inFill ? v_fill : v_border;
}
`;

// ── 4. Line capsule (drawLine, also drawGlowLine after R15 audit) ─────
//
// Each instance is a quad oriented along the line axis. The fragment
// shader computes the capsule SDF (distance from the line segment) and
// emits a crisp anti-aliased edge. The earlier per-line gaussian-halo
// branch (a_softness) was removed once the post-process bloom replaced
// per-line glows — every emitted instance now uses softness=0, so the
// branch was dead code and shipped one wasted float per instance.

const LINE_VS = VS_HEADER + `
in vec2 a_quad;          // (u, v) where u in [0,1] along line, v in [-1,1] across
in vec2 a_p1;
in vec2 a_p2;
in float a_halfWidth;
in vec4 a_color;
flat out float v_halfLen;
flat out float v_halfWidth;
flat out vec4 v_color;
out vec2 v_local;        // local-space coord: x along axis, y across
void main() {
    vec2 d = a_p2 - a_p1;
    float len = length(d);
    if (len < 1e-3) { gl_Position = vec4(2.0, 2.0, 0.0, 1.0); return; }
    vec2 axis = d / len;
    vec2 perp = vec2(-axis.y, axis.x);

    float halfLen = len * 0.5;
    float pad = a_halfWidth + 1.0;
    float s = (a_quad.x - 0.5) * 2.0 * (halfLen + pad);
    float t = a_quad.y * pad;

    vec2 mid = (a_p1 + a_p2) * 0.5;
    vec2 world = mid + axis * s + perp * t;

    v_local     = vec2(s, t);
    v_halfLen   = halfLen;
    v_halfWidth = a_halfWidth;
    v_color     = a_color;
    gl_Position = vec4(worldToClip(world), 0.0, 1.0);
}
`;
const LINE_FS = FS_HEADER + `
flat in float v_halfLen;
flat in float v_halfWidth;
flat in vec4 v_color;
in vec2 v_local;
void main() {
    // Capsule SDF — distance from segment of half-length v_halfLen.
    float x = max(0.0, abs(v_local.x) - v_halfLen);
    float dist = length(vec2(x, v_local.y));
    // Coverage model that matches canvas2d ctx.stroke():
    //   • inside (halfWidth - 0.5) the pixel is fully covered → alpha 1
    //   • single-pixel AA band straddles the edge (halfWidth ± 0.5)
    //   • sub-pixel widths (halfWidth < 0.5) shrink alpha proportionally
    //     to approximate canvas2d's "covers 30 % of a pixel" behaviour
    // The previous formula (smoothstep from halfWidth → 0) collapsed
    // thin lines to a triangular profile, halving the integrated
    // brightness and making asteroid wireframes render at ~50 % of
    // their canvas2d brightness.
    float innerEdge = max(0.0, v_halfWidth - 0.5);
    float outerEdge = v_halfWidth + 0.5;
    float coverageScale = clamp(v_halfWidth * 2.0, 0.0, 1.0);
    float a = (1.0 - smoothstep(innerEdge, outerEdge, dist)) * coverageScale;
    if (a <= 0.0) discard;
    fragColor = vec4(v_color.rgb, v_color.a * a);
}
`;

// ── 5. Radial 3-stop gradient ─────────────────────────────────────────

const RADIAL_VS = VS_HEADER + `
in vec2 a_quad;
in vec2 a_center;
in float a_radius;
in vec4 a_inner;
in vec4 a_mid;
in vec4 a_outer;
out vec2 v_local;
flat out float v_radius;
flat out vec4 v_inner;
flat out vec4 v_mid;
flat out vec4 v_outer;
void main() {
    v_local  = a_quad * a_radius;
    v_radius = a_radius;
    v_inner  = a_inner;
    v_mid    = a_mid;
    v_outer  = a_outer;
    vec2 world = a_center + v_local;
    gl_Position = vec4(worldToClip(world), 0.0, 1.0);
}
`;
const RADIAL_FS = FS_HEADER + `
in vec2 v_local;
flat in float v_radius;
flat in vec4 v_inner;
flat in vec4 v_mid;
flat in vec4 v_outer;
void main() {
    float d = length(v_local);
    float t = d / v_radius;
    if (t >= 1.0) discard;
    vec4 c;
    if (t < 0.5) {
        c = mix(v_inner, v_mid, t * 2.0);
    } else {
        c = mix(v_mid, v_outer, (t - 0.5) * 2.0);
    }
    fragColor = c;
}
`;

// ── 6. Full-screen blit / veil ────────────────────────────────────────

const FULLSCREEN_VS = `#version 300 es
in vec2 a_pos;       // [-1, 1]^2
out vec2 v_uv;
void main() {
    v_uv = a_pos * 0.5 + 0.5;
    gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;
const BLIT_FS = FS_HEADER + `
in vec2 v_uv;
uniform sampler2D u_tex;
void main() {
    fragColor = texture(u_tex, v_uv);
}
`;
const VEIL_FS = FS_HEADER + `
uniform vec4 u_color;
void main() { fragColor = u_color; }
`;

// ── 7. Bright pass (soft-knee threshold + 4x downsample) ──────────────
//
// Samples the scene at full res with a 2x2 box average for free AA on
// the downsample, then applies a soft-knee Hi-pass that smoothly lets
// bright (additive ship lines, hit flashes, bright bullets) bleed
// while clipping the dim starfield. Output lives in the bloom A
// framebuffer at 1/4 res.

const BRIGHT_PASS_FS = FS_HEADER + `
in vec2 v_uv;
uniform sampler2D u_scene;
uniform vec2 u_srcTexel;          // 1 / scene size  — for 2x2 box sample
uniform float u_threshold;        // luminance start of bloom (0..1+)
uniform float u_softKnee;         // smoothing width below threshold

vec3 sceneSample(vec2 uv) {
    // 2x2 box average — cheap pre-blur during downsample.
    vec3 a = texture(u_scene, uv + vec2(-0.5, -0.5) * u_srcTexel).rgb;
    vec3 b = texture(u_scene, uv + vec2( 0.5, -0.5) * u_srcTexel).rgb;
    vec3 c = texture(u_scene, uv + vec2(-0.5,  0.5) * u_srcTexel).rgb;
    vec3 d = texture(u_scene, uv + vec2( 0.5,  0.5) * u_srcTexel).rgb;
    return (a + b + c + d) * 0.25;
}

void main() {
    vec3 rgb = sceneSample(v_uv);
    float lum = max(max(rgb.r, rgb.g), rgb.b);
    // Soft-knee curve (Unity / COD-style): smooth transition from no
    // bloom at lum=threshold-knee to full bloom at lum=threshold+knee.
    float knee = max(1e-4, u_softKnee);
    float soft = lum - u_threshold + knee;
    soft = clamp(soft, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee);
    float weight = max(soft, lum - u_threshold) / max(lum, 1e-4);
    fragColor = vec4(rgb * weight, 1.0);
}
`;

// ── 8. Separable gaussian blur — 5-tap linear-sampled (R15A backport) ─
//
// Exploits bilinear filtering to collapse the canonical 9-tap discrete
// gaussian into 5 hardware-filtered samples per direction. Per-pair
// offset = (t1·w1 + t2·w2) / (w1+w2); combined weight = w1+w2. The GPU
// returns the weighted average of the two neighbours in one fetch, so
// the math is identical to the 9-tap result while doing ~40 % fewer
// texture lookups. Requires LINEAR filter on the source FBO texture
// (already set in _configureFboTex).
//
// Source 9-tap weights: 0.227027, 0.194595, 0.121622, 0.054054, 0.016216
// Pair (1,2): w = 0.316216, offset = 1.384615
// Pair (3,4): w = 0.070270, offset = 3.230769

const BLUR_FS = FS_HEADER + `
in vec2 v_uv;
uniform sampler2D u_src;
uniform vec2 u_dir;       // (texelW, 0) or (0, texelH) — texture-space step
void main() {
    vec3 c = texture(u_src, v_uv).rgb * 0.227027;
    c += texture(u_src, v_uv + u_dir * 1.384615).rgb * 0.316216;
    c += texture(u_src, v_uv - u_dir * 1.384615).rgb * 0.316216;
    c += texture(u_src, v_uv + u_dir * 3.230769).rgb * 0.070270;
    c += texture(u_src, v_uv - u_dir * 3.230769).rgb * 0.070270;
    fragColor = vec4(c, 1.0);
}
`;

// ── 9. Composite (scene + bloom) ──────────────────────────────────────
//
// Pure additive — no tone-map. The earlier soft-Reinhard variant was
// the cause of the "dark as shit" look: `c / (1 + c * 0.6)` compresses
// 0.5 → 0.38 and 1.0 → 0.625, darkening every pixel including the
// starfield. Rainboids ships plain `scene + bloom * intensity` and
// relies on the default-framebuffer's RGBA8 clamp to land bright
// pixels at fully-on. Hue is preserved per-channel when one channel
// clips before others (cyan ship stays cyan because R stays at 0).

const COMPOSITE_FS = FS_HEADER + `
in vec2 v_uv;
uniform sampler2D u_scene;
uniform sampler2D u_bloom;
uniform float u_bloomIntensity;
void main() {
    vec3 scene = texture(u_scene, v_uv).rgb;
    vec3 bloom = texture(u_bloom, v_uv).rgb;
    fragColor = vec4(scene + bloom * u_bloomIntensity, 1.0);
}
`;

// ── Helpers ───────────────────────────────────────────────────────────

function compile(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(sh);
        const kind = type === gl.VERTEX_SHADER ? 'vertex' : 'fragment';
        throw new Error(`[webgl2] ${kind} compile failed: ${log}\n--- source ---\n${src}`);
    }
    return sh;
}
function link(gl, vsSrc, fsSrc) {
    const vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        throw new Error(`[webgl2] link failed: ${gl.getProgramInfoLog(p)}`);
    }
    return p;
}

// Each batch tracks its program, VAO, instance VBO, scratch buffer and count.
class Batch {
    constructor(gl, program, floatsPerInstance, capacity) {
        this.gl = gl;
        this.program = program;
        this.floatsPerInstance = floatsPerInstance;
        this.capacity = capacity;
        this.count = 0;
        this.scratch = new Float32Array(capacity * floatsPerInstance);
        this.vbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        gl.bufferData(gl.ARRAY_BUFFER, this.scratch.byteLength, gl.DYNAMIC_DRAW);
        this.vao = gl.createVertexArray();
    }
    reserve(n) {
        if (this.count + n <= this.capacity) return true;
        // Grow the scratch buffer + VBO.
        const newCap = Math.max(this.capacity * 2, this.count + n);
        const newScratch = new Float32Array(newCap * this.floatsPerInstance);
        newScratch.set(this.scratch);
        this.scratch = newScratch;
        this.capacity = newCap;
        const gl = this.gl;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
        gl.bufferData(gl.ARRAY_BUFFER, this.scratch.byteLength, gl.DYNAMIC_DRAW);
        return true;
    }
}

// ── Renderer ──────────────────────────────────────────────────────────

export class WebGL2Renderer extends Renderer {
    constructor(canvas) {
        super(canvas);
        this.gl = null;
        this.fbo = null;
        this.fboTex = null;
        this._blend = BLEND_NORMAL;
        this._shakeX = 0;
        this._shakeY = 0;
        this.batches = null;
    }

    async init() {
        const gl = this.canvas.getContext('webgl2', {
            alpha: false,
            antialias: false,
            premultipliedAlpha: false,
            preserveDrawingBuffer: false,
        });
        if (!gl) return false;
        this.gl = gl;

        try {
            this._initPrograms();
            this._initStaticQuad();
            this._initBatches();
            this._initFramebuffer();
            this._uploadViewportUniform();
        } catch (e) {
            console.warn('[webgl2] init failed:', e);
            return false;
        }
        return true;
    }

    _initStaticQuad() {
        const gl = this.gl;
        // Two quad VBOs:
        //   • Centred quad [-1,1]^2 for circle/ring/point/radial.
        //   • Unit quad [0,1]×[-1,1] for line capsule (u along axis, v across).
        this.centeredQuad = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.centeredQuad);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, -1,  1, -1,  -1, 1,  1, 1,
        ]), gl.STATIC_DRAW);

        this.lineQuad = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.lineQuad);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            0, -1,  1, -1,  0, 1,  1, 1,
        ]), gl.STATIC_DRAW);

        this.fullscreenQuad = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.fullscreenQuad);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, -1,  1, -1,  -1, 1,  1, 1,
        ]), gl.STATIC_DRAW);
    }

    _initPrograms() {
        const gl = this.gl;
        this.progCircle = link(gl, CIRCLE_VS, CIRCLE_FS);
        this.progRing   = link(gl, RING_VS,   RING_FS);
        this.progPoint  = link(gl, POINT_VS,  POINT_FS);
        this.progLine   = link(gl, LINE_VS,   LINE_FS);
        this.progRadial = link(gl, RADIAL_VS, RADIAL_FS);
        this.progBlit   = link(gl, FULLSCREEN_VS, BLIT_FS);
        this.progVeil   = link(gl, FULLSCREEN_VS, VEIL_FS);
        this.progBright = link(gl, FULLSCREEN_VS, BRIGHT_PASS_FS);
        this.progBlur   = link(gl, FULLSCREEN_VS, BLUR_FS);
        this.progComp   = link(gl, FULLSCREEN_VS, COMPOSITE_FS);

        // Cache uniform locations for the world programs (all share u_viewport, u_shake).
        this.worldPrograms = [this.progCircle, this.progRing, this.progPoint, this.progLine, this.progRadial];
        this.uViewport = new Map();
        this.uShake = new Map();
        for (const p of this.worldPrograms) {
            this.uViewport.set(p, gl.getUniformLocation(p, 'u_viewport'));
            this.uShake.set(p, gl.getUniformLocation(p, 'u_shake'));
        }
        this.uBlitTex   = gl.getUniformLocation(this.progBlit, 'u_tex');
        this.uVeilColor = gl.getUniformLocation(this.progVeil, 'u_color');

        // Bloom uniforms.
        this.uBrightScene     = gl.getUniformLocation(this.progBright, 'u_scene');
        this.uBrightSrcTexel  = gl.getUniformLocation(this.progBright, 'u_srcTexel');
        this.uBrightThreshold = gl.getUniformLocation(this.progBright, 'u_threshold');
        this.uBrightKnee      = gl.getUniformLocation(this.progBright, 'u_softKnee');
        this.uBlurSrc         = gl.getUniformLocation(this.progBlur,   'u_src');
        this.uBlurDir         = gl.getUniformLocation(this.progBlur,   'u_dir');
        this.uCompScene       = gl.getUniformLocation(this.progComp,   'u_scene');
        this.uCompBloom       = gl.getUniformLocation(this.progComp,   'u_bloom');
        this.uCompIntensity   = gl.getUniformLocation(this.progComp,   'u_bloomIntensity');

        // Bloom tuning — chosen to mimic canvas2d shadowBlur=15 on the
        // ship without washing out the starfield. Tuned after the
        // Reinhard tone-map was removed (composite now passes scene
        // through unmodified, so brightness lands on display naturally).
        this.bloomThreshold = 0.50;
        this.bloomKnee      = 0.30;
        this.bloomIntensity = 0.85;
        // Separable-blur iterations on the 1/4-res mip. 2 with the
        // 5-tap linear-sampled kernel ≈ shadowBlur=15 in canvas2d.
        this.bloomBlurIter  = 2;
    }

    _initBatches() {
        const gl = this.gl;

        // Helper to set up per-instance attribute binding inside a VAO.
        const bindCenteredQuadAttrib = (program, vao) => {
            gl.bindVertexArray(vao);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.centeredQuad);
            const aQuad = gl.getAttribLocation(program, 'a_quad');
            gl.enableVertexAttribArray(aQuad);
            gl.vertexAttribPointer(aQuad, 2, gl.FLOAT, false, 0, 0);
            gl.vertexAttribDivisor(aQuad, 0);
        };
        const bindLineQuadAttrib = (program, vao) => {
            gl.bindVertexArray(vao);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.lineQuad);
            const aQuad = gl.getAttribLocation(program, 'a_quad');
            gl.enableVertexAttribArray(aQuad);
            gl.vertexAttribPointer(aQuad, 2, gl.FLOAT, false, 0, 0);
            gl.vertexAttribDivisor(aQuad, 0);
        };
        const setInst = (program, vbo, attribs) => {
            // attribs: [{ name, size }]
            gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
            let stride = 0;
            for (const a of attribs) stride += a.size * 4;
            let off = 0;
            for (const a of attribs) {
                const loc = gl.getAttribLocation(program, a.name);
                if (loc >= 0) {
                    gl.enableVertexAttribArray(loc);
                    gl.vertexAttribPointer(loc, a.size, gl.FLOAT, false, stride, off);
                    gl.vertexAttribDivisor(loc, 1);
                }
                off += a.size * 4;
            }
            return stride / 4;
        };

        // ── Circle: a_center(2) + a_radius(1) + a_color(4) = 7 floats ──
        this.circle = new Batch(gl, this.progCircle, 7, 1024);
        bindCenteredQuadAttrib(this.progCircle, this.circle.vao);
        setInst(this.progCircle, this.circle.vbo, [
            { name: 'a_center', size: 2 },
            { name: 'a_radius', size: 1 },
            { name: 'a_color',  size: 4 },
        ]);

        // ── Ring: a_center(2) + a_radius(1) + a_lineWidth(1) + a_color(4) = 8 ──
        this.ring = new Batch(gl, this.progRing, 8, 128);
        bindCenteredQuadAttrib(this.progRing, this.ring.vao);
        setInst(this.progRing, this.ring.vbo, [
            { name: 'a_center',    size: 2 },
            { name: 'a_radius',    size: 1 },
            { name: 'a_lineWidth', size: 1 },
            { name: 'a_color',     size: 4 },
        ]);

        // ── Point: a_center(2) + a_size(1) + a_borderSize(1) + a_fillColor(4) + a_borderColor(4) = 12 ──
        this.point = new Batch(gl, this.progPoint, 12, 512);
        bindCenteredQuadAttrib(this.progPoint, this.point.vao);
        setInst(this.progPoint, this.point.vbo, [
            { name: 'a_center',      size: 2 },
            { name: 'a_size',        size: 1 },
            { name: 'a_borderSize',  size: 1 },
            { name: 'a_fillColor',   size: 4 },
            { name: 'a_borderColor', size: 4 },
        ]);

        // ── Line: a_p1(2) + a_p2(2) + a_halfWidth(1) + a_color(4) = 9 ──
        // (a_softness dropped — every emitter now uses crisp mode after
        // the post-process bloom replaced per-line gaussian halos.)
        this.line = new Batch(gl, this.progLine, 9, 2048);
        bindLineQuadAttrib(this.progLine, this.line.vao);
        setInst(this.progLine, this.line.vbo, [
            { name: 'a_p1',        size: 2 },
            { name: 'a_p2',        size: 2 },
            { name: 'a_halfWidth', size: 1 },
            { name: 'a_color',     size: 4 },
        ]);

        // ── Radial: a_center(2) + a_radius(1) + a_inner(4) + a_mid(4) + a_outer(4) = 15 ──
        this.radial = new Batch(gl, this.progRadial, 15, 64);
        bindCenteredQuadAttrib(this.progRadial, this.radial.vao);
        setInst(this.progRadial, this.radial.vbo, [
            { name: 'a_center', size: 2 },
            { name: 'a_radius', size: 1 },
            { name: 'a_inner',  size: 4 },
            { name: 'a_mid',    size: 4 },
            { name: 'a_outer',  size: 4 },
        ]);

        // Fullscreen quad VAOs (one per shader since attribute locations differ).
        const mkFullVao = (program) => {
            const v = gl.createVertexArray();
            gl.bindVertexArray(v);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.fullscreenQuad);
            const loc = gl.getAttribLocation(program, 'a_pos');
            gl.enableVertexAttribArray(loc);
            gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
            return v;
        };
        this.veilVao    = mkFullVao(this.progVeil);
        this.blitVao    = mkFullVao(this.progBlit);
        this.brightVao  = mkFullVao(this.progBright);
        this.blurVao    = mkFullVao(this.progBlur);
        this.compVao    = mkFullVao(this.progComp);
        gl.bindVertexArray(null);
    }

    _initFramebuffer() {
        const gl = this.gl;
        // Try to enable RGBA16F render targets — gives the scene
        // framebuffer real HDR range so additive ship lines can spike
        // above 1.0, which then drives a richer bloom. On hardware
        // without EXT_color_buffer_float we silently use RGBA8 + linear
        // filtering and the result is just a slightly clamped bloom.
        this._floatFbo = !!gl.getExtension('EXT_color_buffer_float');
        gl.getExtension('OES_texture_float_linear');   // permits LINEAR filter on float
        gl.getExtension('EXT_float_blend');            // permits blending into float FBO
        this.fbo    = gl.createFramebuffer();
        this.fboTex = gl.createTexture();
        // 1/4 res bloom ping-pong.
        this.bloomA    = gl.createFramebuffer();
        this.bloomATex = gl.createTexture();
        this.bloomB    = gl.createFramebuffer();
        this.bloomBTex = gl.createTexture();
        this._configureFboTex();
    }

    _configureFboTex() {
        const gl = this.gl;
        const w = Math.max(1, this.canvas.width);
        const h = Math.max(1, this.canvas.height);
        const bw = Math.max(1, Math.floor(w / 4));
        const bh = Math.max(1, Math.floor(h / 4));
        const sceneFmt = this._floatFbo ? gl.RGBA16F : gl.RGBA8;
        const sceneType = this._floatFbo ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;

        // Main scene FBO.
        gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, sceneFmt, w, h, 0, gl.RGBA, sceneType, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fboTex, 0);
        gl.viewport(0, 0, w, h);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);

        // Bloom A.
        gl.bindTexture(gl.TEXTURE_2D, this.bloomATex);
        gl.texImage2D(gl.TEXTURE_2D, 0, sceneFmt, bw, bh, 0, gl.RGBA, sceneType, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomA);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.bloomATex, 0);
        gl.viewport(0, 0, bw, bh);
        gl.clear(gl.COLOR_BUFFER_BIT);

        // Bloom B.
        gl.bindTexture(gl.TEXTURE_2D, this.bloomBTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, sceneFmt, bw, bh, 0, gl.RGBA, sceneType, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomB);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.bloomBTex, 0);
        gl.viewport(0, 0, bw, bh);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        this._sceneW = w;
        this._sceneH = h;
        this._bloomW = bw;
        this._bloomH = bh;
    }

    resize(w, h) {
        super.resize(w, h);
        if (!this.gl) return;
        this._configureFboTex();
        this._uploadViewportUniform();
    }

    // u_viewport only changes on canvas resize, not per frame. Push it
    // here so beginFrame doesn't spend 5 uniform calls/frame on a
    // constant. (R15 audit pattern #3.)
    _uploadViewportUniform() {
        const gl = this.gl;
        for (const p of this.worldPrograms) {
            gl.useProgram(p);
            gl.uniform2f(this.uViewport.get(p), this.canvas.width, this.canvas.height);
        }
    }

    // ── Frame lifecycle ──────────────────────────────────────────────

    beginFrame(shakeX = 0, shakeY = 0) {
        this._shakeX = shakeX;
        this._shakeY = shakeY;
        const gl = this.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);
        gl.enable(gl.BLEND);
        this._applyBlendMode(BLEND_NORMAL);
        this._blend = BLEND_NORMAL;

        // u_viewport lives on resize. u_shake actually changes per
        // frame (screen-shake offset).
        for (const p of this.worldPrograms) {
            gl.useProgram(p);
            gl.uniform2f(this.uShake.get(p), shakeX, shakeY);
        }
    }

    applyVeil(r, g, b, a) {
        const gl = this.gl;
        this.flushAll();
        // Veil is a fullscreen quad with constant color, blended on top
        // of the persistent FBO. blend = SRC_ALPHA, ONE_MINUS_SRC_ALPHA
        // so a 30%-alpha black gradually fades the prior frame to black.
        this._applyBlendMode(BLEND_NORMAL);
        gl.useProgram(this.progVeil);
        gl.bindVertexArray(this.veilVao);
        gl.uniform4f(this.uVeilColor, r, g, b, a);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindVertexArray(null);
        // Restore the user's blend mode.
        this._applyBlendMode(this._blend);
    }

    setBlend(mode) {
        if (mode === this._blend) return;
        this.flushAll();
        this._blend = mode;
        this._applyBlendMode(mode);
    }

    _applyBlendMode(mode) {
        const gl = this.gl;
        if (mode === BLEND_ADDITIVE) {
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        } else {
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        }
    }

    endFrame() {
        const gl = this.gl;
        this.flushAll();
        this._runBloomAndComposite();
    }

    // ── Post-process: bright pass → blur ping-pong → composite ───────

    _runBloomAndComposite() {
        const gl = this.gl;
        const w = this._sceneW, h = this._sceneH;
        const bw = this._bloomW, bh = this._bloomH;

        gl.disable(gl.BLEND);

        // 1. Bright pass — scene → bloomA (1/4 res, soft-knee threshold).
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomA);
        gl.viewport(0, 0, bw, bh);
        gl.useProgram(this.progBright);
        gl.bindVertexArray(this.brightVao);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
        gl.uniform1i(this.uBrightScene, 0);
        gl.uniform2f(this.uBrightSrcTexel, 1 / w, 1 / h);
        gl.uniform1f(this.uBrightThreshold, this.bloomThreshold);
        gl.uniform1f(this.uBrightKnee, this.bloomKnee);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        // 2. Separable gaussian — ping-pong between bloomA and bloomB.
        //    iter passes of (H into B, V into A) → widens the gaussian
        //    radius proportionally.
        gl.useProgram(this.progBlur);
        gl.bindVertexArray(this.blurVao);
        gl.uniform1i(this.uBlurSrc, 0);
        for (let i = 0; i < this.bloomBlurIter; i++) {
            // Horizontal: bloomA → bloomB.
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomB);
            gl.viewport(0, 0, bw, bh);
            gl.bindTexture(gl.TEXTURE_2D, this.bloomATex);
            gl.uniform2f(this.uBlurDir, 1 / bw, 0);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            // Vertical: bloomB → bloomA.
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomA);
            gl.viewport(0, 0, bw, bh);
            gl.bindTexture(gl.TEXTURE_2D, this.bloomBTex);
            gl.uniform2f(this.uBlurDir, 0, 1 / bh);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }

        // 3. Composite scene + bloom → screen.
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.useProgram(this.progComp);
        gl.bindVertexArray(this.compVao);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
        gl.uniform1i(this.uCompScene, 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.bloomATex);
        gl.uniform1i(this.uCompBloom, 1);
        gl.uniform1f(this.uCompIntensity, this.bloomIntensity);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        gl.bindVertexArray(null);
        gl.activeTexture(gl.TEXTURE0);
    }

    // ── Batch flush — single draw call per non-empty batch ────────────

    flushAll() {
        // Fixed draw order. Within a blend group:
        //   point → ring → radial → circle → line
        // (Ordering is mostly cosmetic; lines on top of circles tends to
        // look right for ship wireframes drawn after particles.)
        this._flushBatch(this.point);
        this._flushBatch(this.ring);
        this._flushBatch(this.radial);
        this._flushBatch(this.circle);
        this._flushBatch(this.line);
    }

    _flushBatch(b) {
        if (b.count === 0) return;
        const gl = this.gl;
        gl.useProgram(b.program);
        gl.bindBuffer(gl.ARRAY_BUFFER, b.vbo);
        gl.bufferSubData(
            gl.ARRAY_BUFFER, 0,
            b.scratch, 0, b.count * b.floatsPerInstance,
        );
        gl.bindVertexArray(b.vao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, b.count);
        b.count = 0;
    }

    // ── Primitive emitters ────────────────────────────────────────────

    fillCircle(x, y, radius, r, g, b, a) {
        if (a <= 0 || radius <= 0) return;
        const batch = this.circle;
        if (batch.count >= batch.capacity) batch.reserve(1);
        let i = batch.count * 7;
        const s = batch.scratch;
        s[i++] = x; s[i++] = y;
        s[i++] = radius;
        s[i++] = r; s[i++] = g; s[i++] = b; s[i++] = a;
        batch.count++;
    }

    strokeRing(x, y, radius, lineWidth, r, g, b, a) {
        if (a <= 0 || radius <= 0) return;
        const batch = this.ring;
        if (batch.count >= batch.capacity) batch.reserve(1);
        let i = batch.count * 8;
        const s = batch.scratch;
        s[i++] = x; s[i++] = y;
        s[i++] = radius; s[i++] = lineWidth;
        s[i++] = r; s[i++] = g; s[i++] = b; s[i++] = a;
        batch.count++;
    }

    fillBorderedRect(
        cx, cy, size, borderSize,
        fillR, fillG, fillB, fillA,
        borderR, borderG, borderB, borderA,
    ) {
        if (fillA <= 0 && borderA <= 0) return;
        const batch = this.point;
        if (batch.count >= batch.capacity) batch.reserve(1);
        let i = batch.count * 12;
        const s = batch.scratch;
        s[i++] = cx; s[i++] = cy;
        s[i++] = size; s[i++] = borderSize;
        s[i++] = fillR; s[i++] = fillG; s[i++] = fillB; s[i++] = fillA;
        s[i++] = borderR; s[i++] = borderG; s[i++] = borderB; s[i++] = borderA;
        batch.count++;
    }

    drawLine(x1, y1, x2, y2, lineWidth, r, g, b, a) {
        if (a <= 0 || lineWidth <= 0) return;
        const batch = this.line;
        if (batch.count >= batch.capacity) batch.reserve(1);
        let i = batch.count * 9;
        const s = batch.scratch;
        s[i++] = x1; s[i++] = y1;
        s[i++] = x2; s[i++] = y2;
        s[i++] = lineWidth * 0.5;
        s[i++] = r; s[i++] = g; s[i++] = b; s[i++] = a;
        batch.count++;
    }

    drawGlowLine(
        x1, y1, x2, y2, lineWidth,
        r, g, b, a,
        glowWidth, glowR, glowG, glowB, glowA,
    ) {
        // The HDR bloom post-process produces the halo from the bright
        // additive line, so we skip the per-line gaussian quad here —
        // emitting one would over-saturate small shapes (ship triangle).
        // A small emissive boost on RGBA16F framebuffers pushes the
        // colour above 1.0 so bloom picks it up reliably even at narrow
        // line widths. 1.4 is the sweet spot: bright enough to bloom,
        // dim enough to keep cyan distinct from white after composite.
        const boost = this._floatFbo ? 1.4 : 1.0;
        this.drawLine(x1, y1, x2, y2, lineWidth, r * boost, g * boost, b * boost, a);
    }

    drawRadialFlash(
        cx, cy, radius,
        iR, iG, iB, iA,
        mR, mG, mB, mA,
        oR, oG, oB, oA,
    ) {
        if (radius <= 0) return;
        const batch = this.radial;
        if (batch.count >= batch.capacity) batch.reserve(1);
        let i = batch.count * 15;
        const s = batch.scratch;
        s[i++] = cx; s[i++] = cy;
        s[i++] = radius;
        s[i++] = iR; s[i++] = iG; s[i++] = iB; s[i++] = iA;
        s[i++] = mR; s[i++] = mG; s[i++] = mB; s[i++] = mA;
        s[i++] = oR; s[i++] = oG; s[i++] = oB; s[i++] = oA;
        batch.count++;
    }
}
