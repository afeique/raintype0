// Full WebGPU single-canvas renderer. Mirrors WebGL2Renderer's batch
// architecture (instanced quads, 5 shader pipelines, persistent texture
// for the motion-blur veil) using the WebGPU API.
//
// Init is async: requestAdapter + requestDevice. The init() method
// returns false if WebGPU is unavailable (no navigator.gpu, no adapter,
// or device creation fails) so the selector falls back to canvas2d.
//
// Two pipelines per shader — one with normal alpha blending, one with
// additive blending. setBlend() switches the active pipeline; flushAll
// is called on each blend transition. The veil draws as a fullscreen
// quad on top of the persistent texture; final present blits the
// texture to the surface.

import { Renderer, BLEND_NORMAL, BLEND_ADDITIVE } from './renderer.js';

// ── WGSL shaders ──────────────────────────────────────────────────────

const COMMON_HEADER = `
struct Globals {
    viewport: vec2f,
    shake:    vec2f,
};
@group(0) @binding(0) var<uniform> u_globals: Globals;
fn worldToClip(world: vec2f) -> vec4f {
    let p = world + u_globals.shake;
    let clip = (p / u_globals.viewport) * 2.0 - vec2f(1.0, 1.0);
    return vec4f(clip.x, -clip.y, 0.0, 1.0);
}
`;

const CIRCLE_WGSL = COMMON_HEADER + `
struct VsIn {
    @location(0) quad:   vec2f,
    @location(1) center: vec2f,
    @location(2) radius: f32,
    @location(3) color:  vec4f,
};
struct VsOut {
    @builtin(position) pos: vec4f,
    @location(0) local:  vec2f,
    @location(1) radius: f32,
    @location(2) color:  vec4f,
};
@vertex fn vs(in: VsIn) -> VsOut {
    var out: VsOut;
    out.local = in.quad * in.radius;
    out.radius = in.radius;
    out.color = in.color;
    out.pos = worldToClip(in.center + out.local);
    return out;
}
@fragment fn fs(in: VsOut) -> @location(0) vec4f {
    let d = length(in.local);
    let innerEdge = max(0.0, in.radius - 1.0);
    let a = smoothstep(in.radius, innerEdge, d);
    if (a <= 0.0) { discard; }
    return vec4f(in.color.rgb, in.color.a * a);
}
`;

const RING_WGSL = COMMON_HEADER + `
struct VsIn {
    @location(0) quad: vec2f,
    @location(1) center: vec2f,
    @location(2) radius: f32,
    @location(3) lineWidth: f32,
    @location(4) color: vec4f,
};
struct VsOut {
    @builtin(position) pos: vec4f,
    @location(0) local: vec2f,
    @location(1) radius: f32,
    @location(2) halfWidth: f32,
    @location(3) color: vec4f,
};
@vertex fn vs(in: VsIn) -> VsOut {
    var out: VsOut;
    let outerR = in.radius + in.lineWidth * 0.5 + 1.0;
    out.local = in.quad * outerR;
    out.radius = in.radius;
    out.halfWidth = in.lineWidth * 0.5;
    out.color = in.color;
    out.pos = worldToClip(in.center + out.local);
    return out;
}
@fragment fn fs(in: VsOut) -> @location(0) vec4f {
    let d = length(in.local);
    let ringDist = abs(d - in.radius);
    let innerEdge = max(0.0, in.halfWidth - 1.0);
    let a = smoothstep(in.halfWidth, innerEdge, ringDist);
    if (a <= 0.0) { discard; }
    return vec4f(in.color.rgb, in.color.a * a);
}
`;

const POINT_WGSL = COMMON_HEADER + `
struct VsIn {
    @location(0) quad: vec2f,
    @location(1) center: vec2f,
    @location(2) size: f32,
    @location(3) borderSize: f32,
    @location(4) fillColor: vec4f,
    @location(5) borderColor: vec4f,
};
struct VsOut {
    @builtin(position) pos: vec4f,
    @location(0) local: vec2f,
    @location(1) size: f32,
    @location(2) borderSize: f32,
    @location(3) fillColor: vec4f,
    @location(4) borderColor: vec4f,
};
@vertex fn vs(in: VsIn) -> VsOut {
    var out: VsOut;
    let outer = in.size + 2.0 * in.borderSize;
    out.local = in.quad * outer * 0.5;
    out.size = in.size;
    out.borderSize = in.borderSize;
    out.fillColor = in.fillColor;
    out.borderColor = in.borderColor;
    out.pos = worldToClip(in.center + out.local);
    return out;
}
@fragment fn fs(in: VsOut) -> @location(0) vec4f {
    let halfSize = in.size * 0.5;
    let dx = abs(in.local.x);
    let dy = abs(in.local.y);
    if (dx <= halfSize && dy <= halfSize) {
        return in.fillColor;
    }
    return in.borderColor;
}
`;

const LINE_WGSL = COMMON_HEADER + `
struct VsIn {
    @location(0) quad: vec2f,
    @location(1) p1: vec2f,
    @location(2) p2: vec2f,
    @location(3) halfWidth: f32,
    @location(4) softness: f32,
    @location(5) color: vec4f,
};
struct VsOut {
    @builtin(position) pos: vec4f,
    @location(0) local: vec2f,
    @location(1) halfLen: f32,
    @location(2) halfWidth: f32,
    @location(3) softness: f32,
    @location(4) color: vec4f,
};
@vertex fn vs(in: VsIn) -> VsOut {
    var out: VsOut;
    let d = in.p2 - in.p1;
    let len = length(d);
    if (len < 0.001) {
        out.pos = vec4f(2.0, 2.0, 0.0, 1.0);
        return out;
    }
    let axis = d / len;
    let perp = vec2f(-axis.y, axis.x);
    let halfLen = len * 0.5;
    let pad = in.halfWidth + 1.0;
    let s = (in.quad.x - 0.5) * 2.0 * (halfLen + pad);
    let t = in.quad.y * pad;
    let mid = (in.p1 + in.p2) * 0.5;
    let world = mid + axis * s + perp * t;
    out.local = vec2f(s, t);
    out.halfLen = halfLen;
    out.halfWidth = in.halfWidth;
    out.softness = in.softness;
    out.color = in.color;
    out.pos = worldToClip(world);
    return out;
}
@fragment fn fs(in: VsOut) -> @location(0) vec4f {
    let x = max(0.0, abs(in.local.x) - in.halfLen);
    let dist = length(vec2f(x, in.local.y));
    var a: f32;
    if (in.softness > 0.5) {
        let k = dist / max(1.0, in.halfWidth);
        a = exp(-k * k * 2.5);
    } else {
        let innerEdge = max(0.0, in.halfWidth - 1.0);
        a = smoothstep(in.halfWidth, innerEdge, dist);
    }
    if (a <= 0.0) { discard; }
    return vec4f(in.color.rgb, in.color.a * a);
}
`;

const RADIAL_WGSL = COMMON_HEADER + `
struct VsIn {
    @location(0) quad: vec2f,
    @location(1) center: vec2f,
    @location(2) radius: f32,
    @location(3) inner: vec4f,
    @location(4) mid: vec4f,
    @location(5) outer: vec4f,
};
struct VsOut {
    @builtin(position) pos: vec4f,
    @location(0) local: vec2f,
    @location(1) radius: f32,
    @location(2) inner: vec4f,
    @location(3) mid: vec4f,
    @location(4) outer: vec4f,
};
@vertex fn vs(in: VsIn) -> VsOut {
    var out: VsOut;
    out.local = in.quad * in.radius;
    out.radius = in.radius;
    out.inner = in.inner;
    out.mid = in.mid;
    out.outer = in.outer;
    out.pos = worldToClip(in.center + out.local);
    return out;
}
@fragment fn fs(in: VsOut) -> @location(0) vec4f {
    let d = length(in.local);
    let t = d / in.radius;
    if (t >= 1.0) { discard; }
    if (t < 0.5) {
        return mix(in.inner, in.mid, t * 2.0);
    }
    return mix(in.mid, in.outer, (t - 0.5) * 2.0);
}
`;

const VEIL_WGSL = `
struct VsOut {
    @builtin(position) pos: vec4f,
    @location(0) uv: vec2f,
};
@vertex fn vs(@location(0) p: vec2f) -> VsOut {
    var out: VsOut;
    out.pos = vec4f(p, 0.0, 1.0);
    out.uv = p * 0.5 + vec2f(0.5);
    return out;
}
struct VeilU { color: vec4f };
@group(0) @binding(0) var<uniform> u_veil: VeilU;
@fragment fn fs(in: VsOut) -> @location(0) vec4f {
    return u_veil.color;
}
`;

const BLIT_WGSL = `
struct VsOut {
    @builtin(position) pos: vec4f,
    @location(0) uv: vec2f,
};
@vertex fn vs(@location(0) p: vec2f) -> VsOut {
    var out: VsOut;
    out.pos = vec4f(p, 0.0, 1.0);
    out.uv = p * 0.5 + vec2f(0.5);
    return out;
}
@group(0) @binding(0) var t_src: texture_2d<f32>;
@group(0) @binding(1) var s_src: sampler;
@fragment fn fs(in: VsOut) -> @location(0) vec4f {
    return textureSample(t_src, s_src, in.uv);
}
`;

// Textured sprite (nebula clouds). group 0 = globals (worldToClip),
// group 1 = per-sprite uniform + texture + sampler.
const SPRITE_WGSL = COMMON_HEADER + `
struct SprU { center: vec2f, size: vec2f, rotation: f32, alpha: f32 };
@group(1) @binding(0) var<uniform> u_spr: SprU;
@group(1) @binding(1) var t_spr: texture_2d<f32>;
@group(1) @binding(2) var s_spr: sampler;

struct VsIn { @location(0) quad: vec2f, @location(1) uv: vec2f };
struct VsOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };

@vertex fn vs(in: VsIn) -> VsOut {
    var out: VsOut;
    let c = cos(u_spr.rotation);
    let s = sin(u_spr.rotation);
    let scaled = in.quad * u_spr.size;
    let rot = vec2f(scaled.x * c - scaled.y * s, scaled.x * s + scaled.y * c);
    let world = u_spr.center + rot;
    out.uv = in.uv;
    out.pos = worldToClip(world);
    return out;
}
@fragment fn fs(in: VsOut) -> @location(0) vec4f {
    let t = textureSample(t_spr, s_spr, in.uv);
    if (t.a <= 0.0) { discard; }
    return vec4f(t.rgb, t.a * u_spr.alpha);
}
`;

// ── Per-batch metadata: instance attribute layout ─────────────────────

const BATCH_SPECS = {
    circle: { floats: 7,  attribs: [
        { shaderLocation: 1, format: 'float32x2', offset: 0  }, // center
        { shaderLocation: 2, format: 'float32',   offset: 8  }, // radius
        { shaderLocation: 3, format: 'float32x4', offset: 12 }, // color
    ], stride: 28 },
    ring: { floats: 8, attribs: [
        { shaderLocation: 1, format: 'float32x2', offset: 0  },
        { shaderLocation: 2, format: 'float32',   offset: 8  },
        { shaderLocation: 3, format: 'float32',   offset: 12 },
        { shaderLocation: 4, format: 'float32x4', offset: 16 },
    ], stride: 32 },
    point: { floats: 12, attribs: [
        { shaderLocation: 1, format: 'float32x2', offset: 0  },
        { shaderLocation: 2, format: 'float32',   offset: 8  },
        { shaderLocation: 3, format: 'float32',   offset: 12 },
        { shaderLocation: 4, format: 'float32x4', offset: 16 },
        { shaderLocation: 5, format: 'float32x4', offset: 32 },
    ], stride: 48 },
    line: { floats: 10, attribs: [
        { shaderLocation: 1, format: 'float32x2', offset: 0  },
        { shaderLocation: 2, format: 'float32x2', offset: 8  },
        { shaderLocation: 3, format: 'float32',   offset: 16 },
        { shaderLocation: 4, format: 'float32',   offset: 20 },
        { shaderLocation: 5, format: 'float32x4', offset: 24 },
    ], stride: 40 },
    radial: { floats: 15, attribs: [
        { shaderLocation: 1, format: 'float32x2', offset: 0  },
        { shaderLocation: 2, format: 'float32',   offset: 8  },
        { shaderLocation: 3, format: 'float32x4', offset: 12 },
        { shaderLocation: 4, format: 'float32x4', offset: 28 },
        { shaderLocation: 5, format: 'float32x4', offset: 44 },
    ], stride: 60 },
};

const INITIAL_BATCH_CAP = {
    circle: 1024, ring: 128, point: 512, line: 2048, radial: 64,
};

// ── Renderer ──────────────────────────────────────────────────────────

class GpuBatch {
    constructor(device, name, spec, capacity) {
        this.device = device;
        this.name = name;
        this.spec = spec;
        this.capacity = capacity;
        this.count = 0;
        this.scratch = new Float32Array(capacity * spec.floats);
        this.vbo = device.createBuffer({
            size: capacity * spec.stride,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
    }
    reserve(n) {
        if (this.count + n <= this.capacity) return;
        const newCap = Math.max(this.capacity * 2, this.count + n);
        const newScratch = new Float32Array(newCap * this.spec.floats);
        newScratch.set(this.scratch);
        this.scratch = newScratch;
        this.capacity = newCap;
        this.vbo.destroy();
        this.vbo = this.device.createBuffer({
            size: newCap * this.spec.stride,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
    }
}

export class WebGPURenderer extends Renderer {
    constructor(canvas) {
        super(canvas);
        this.device = null;
        this.context = null;
        this._blend = BLEND_NORMAL;
        this._shakeX = 0;
        this._shakeY = 0;
        this.batches = null;
    }

    async init() {
        if (typeof navigator === 'undefined' || !navigator.gpu) return false;
        let adapter, device;
        try {
            adapter = await navigator.gpu.requestAdapter();
            if (!adapter) return false;
            device = await adapter.requestDevice();
        } catch (e) {
            console.warn('[webgpu] adapter/device init failed:', e);
            return false;
        }
        this.device = device;

        try {
            this.context = this.canvas.getContext('webgpu');
            if (!this.context) return false;
            this.surfaceFormat = navigator.gpu.getPreferredCanvasFormat();
            this.context.configure({
                device,
                format: this.surfaceFormat,
                alphaMode: 'opaque',
            });
            this._initGlobals();
            this._initPipelines();
            this._initBatches();
            this._initOffscreen();
            this._initFullscreen();
        } catch (e) {
            console.warn('[webgpu] init failed:', e);
            return false;
        }
        return true;
    }

    _initGlobals() {
        // Globals uniform — viewport + shake. 16 bytes (vec2 + vec2).
        // WebGPU uniform blocks must be 16-byte aligned; vec2<f32> is
        // 8 bytes so two vec2s = 16 bytes, exactly one binding.
        this.globalsBuf = this.device.createBuffer({
            size: 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this._globalsData = new Float32Array(4);
    }

    _writeGlobals() {
        this._globalsData[0] = this.canvas.width;
        this._globalsData[1] = this.canvas.height;
        this._globalsData[2] = this._shakeX;
        this._globalsData[3] = this._shakeY;
        this.device.queue.writeBuffer(this.globalsBuf, 0, this._globalsData);
    }

    _initPipelines() {
        const device = this.device;

        const globalsBgl = device.createBindGroupLayout({
            entries: [{
                binding: 0,
                visibility: GPUShaderStage.VERTEX,
                buffer: { type: 'uniform' },
            }],
        });
        this.globalsBg = device.createBindGroup({
            layout: globalsBgl,
            entries: [{ binding: 0, resource: { buffer: this.globalsBuf } }],
        });
        const worldPipelineLayout = device.createPipelineLayout({
            bindGroupLayouts: [globalsBgl],
        });

        const blendNormal = {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
            alpha: { srcFactor: 'one',       dstFactor: 'one-minus-src-alpha' },
        };
        const blendAdditive = {
            color: { srcFactor: 'src-alpha', dstFactor: 'one' },
            alpha: { srcFactor: 'one',       dstFactor: 'one' },
        };

        const makeWorldPipelinePair = (name, wgsl, spec, quadStride) => {
            const module = device.createShaderModule({ code: wgsl });
            const buffers = [
                {
                    arrayStride: 8,
                    stepMode: 'vertex',
                    attributes: [{ shaderLocation: 0, format: 'float32x2', offset: 0 }],
                },
                {
                    arrayStride: spec.stride,
                    stepMode: 'instance',
                    attributes: spec.attribs,
                },
            ];
            const pipelines = {};
            for (const [mode, blend] of [['normal', blendNormal], ['additive', blendAdditive]]) {
                pipelines[mode] = device.createRenderPipeline({
                    layout: worldPipelineLayout,
                    vertex: { module, entryPoint: 'vs', buffers },
                    fragment: {
                        module, entryPoint: 'fs',
                        targets: [{
                            format: this.surfaceFormat,
                            blend,
                        }],
                    },
                    primitive: { topology: 'triangle-strip' },
                });
            }
            return pipelines;
        };

        // World pipelines — one pair (normal/additive) per shader.
        this.pipelines = {
            circle: makeWorldPipelinePair('circle', CIRCLE_WGSL, BATCH_SPECS.circle),
            ring:   makeWorldPipelinePair('ring',   RING_WGSL,   BATCH_SPECS.ring),
            point:  makeWorldPipelinePair('point',  POINT_WGSL,  BATCH_SPECS.point),
            line:   makeWorldPipelinePair('line',   LINE_WGSL,   BATCH_SPECS.line),
            radial: makeWorldPipelinePair('radial', RADIAL_WGSL, BATCH_SPECS.radial),
        };

        // Veil pipeline — fullscreen quad, normal blend, no globals.
        const veilModule = device.createShaderModule({ code: VEIL_WGSL });
        const veilBgl = device.createBindGroupLayout({
            entries: [{
                binding: 0,
                visibility: GPUShaderStage.FRAGMENT,
                buffer: { type: 'uniform' },
            }],
        });
        this.veilUniform = device.createBuffer({
            size: 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.veilBg = device.createBindGroup({
            layout: veilBgl,
            entries: [{ binding: 0, resource: { buffer: this.veilUniform } }],
        });
        this.pipelineVeil = device.createRenderPipeline({
            layout: device.createPipelineLayout({ bindGroupLayouts: [veilBgl] }),
            vertex: {
                module: veilModule, entryPoint: 'vs',
                buffers: [{
                    arrayStride: 8,
                    attributes: [{ shaderLocation: 0, format: 'float32x2', offset: 0 }],
                }],
            },
            fragment: {
                module: veilModule, entryPoint: 'fs',
                targets: [{ format: this.surfaceFormat, blend: blendNormal }],
            },
            primitive: { topology: 'triangle-strip' },
        });

        // Blit pipeline — fullscreen quad, samples the persistent
        // offscreen texture, no blend.
        const blitModule = device.createShaderModule({ code: BLIT_WGSL });
        const blitBgl = device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
            ],
        });
        this.blitBgl = blitBgl;
        this.pipelineBlit = device.createRenderPipeline({
            layout: device.createPipelineLayout({ bindGroupLayouts: [blitBgl] }),
            vertex: {
                module: blitModule, entryPoint: 'vs',
                buffers: [{
                    arrayStride: 8,
                    attributes: [{ shaderLocation: 0, format: 'float32x2', offset: 0 }],
                }],
            },
            fragment: {
                module: blitModule, entryPoint: 'fs',
                targets: [{ format: this.surfaceFormat }],
            },
            primitive: { topology: 'triangle-strip' },
        });
        this.sampler = device.createSampler({ magFilter: 'nearest', minFilter: 'nearest' });
        this.linearSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

        // ── Sprite pipeline (nebula clouds) ──────────────────────────
        const blendNormalSpr = {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
            alpha: { srcFactor: 'one',       dstFactor: 'one-minus-src-alpha' },
        };
        const blendAddSpr = {
            color: { srcFactor: 'src-alpha', dstFactor: 'one' },
            alpha: { srcFactor: 'one',       dstFactor: 'one' },
        };
        const spriteModule = device.createShaderModule({ code: SPRITE_WGSL });
        const spriteBgl = device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
                { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
            ],
        });
        this.spriteBgl = spriteBgl;
        const spriteLayout = device.createPipelineLayout({
            bindGroupLayouts: [globalsBgl, spriteBgl],
        });
        const spriteVertexBuffers = [{
            arrayStride: 16,
            attributes: [
                { shaderLocation: 0, format: 'float32x2', offset: 0 }, // quad
                { shaderLocation: 1, format: 'float32x2', offset: 8 }, // uv
            ],
        }];
        this.pipelineSprite = {};
        for (const [mode, blend] of [['normal', blendNormalSpr], ['additive', blendAddSpr]]) {
            this.pipelineSprite[mode] = device.createRenderPipeline({
                layout: spriteLayout,
                vertex: { module: spriteModule, entryPoint: 'vs', buffers: spriteVertexBuffers },
                fragment: {
                    module: spriteModule, entryPoint: 'fs',
                    targets: [{ format: this.surfaceFormat, blend }],
                },
                primitive: { topology: 'triangle-strip' },
            });
        }

        // Ring of per-sprite uniform buffers — each drawSprite in a frame
        // grabs a distinct slot so multiple sprites in one render pass
        // don't all read the last-written uniforms (queue.writeBuffer
        // coalesces by region, not by draw). 32 slots >> nebula count.
        this.SPRITE_RING = 32;
        this.spriteUniformBuffers = [];
        for (let i = 0; i < this.SPRITE_RING; i++) {
            this.spriteUniformBuffers.push(device.createBuffer({
                size: 32, // vec2 + vec2 + f32 + f32, padded to 16-multiple
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            }));
        }
        this._spriteScratch = new Float32Array(8);
        this._spriteIdx = 0;
        this._textures = new Map();
    }

    _initBatches() {
        this.batches = {};
        for (const name of Object.keys(BATCH_SPECS)) {
            this.batches[name] = new GpuBatch(
                this.device, name, BATCH_SPECS[name], INITIAL_BATCH_CAP[name],
            );
        }
    }

    _initOffscreen() {
        // Two textures: ping-pong. WebGPU can't both sample and render
        // the same texture in one pass — so each frame we render the
        // veil + new content to "dst", which reads "src" as background
        // for the veil (via blit), then swap roles for the next frame.
        const w = Math.max(1, this.canvas.width);
        const h = Math.max(1, this.canvas.height);
        if (this.texA) this.texA.destroy();
        if (this.texB) this.texB.destroy();
        const desc = {
            size: { width: w, height: h },
            format: this.surfaceFormat,
            usage: GPUTextureUsage.RENDER_ATTACHMENT
                 | GPUTextureUsage.TEXTURE_BINDING
                 | GPUTextureUsage.COPY_DST
                 | GPUTextureUsage.COPY_SRC,
        };
        this.texA = this.device.createTexture(desc);
        this.texB = this.device.createTexture(desc);
        this._dstIsA = true;
        // Clear both initially so the first frame has known state.
        const enc = this.device.createCommandEncoder();
        for (const t of [this.texA, this.texB]) {
            const pass = enc.beginRenderPass({
                colorAttachments: [{
                    view: t.createView(),
                    loadOp: 'clear',
                    storeOp: 'store',
                    clearValue: { r: 0, g: 0, b: 0, a: 1 },
                }],
            });
            pass.end();
        }
        this.device.queue.submit([enc.finish()]);
    }

    _initFullscreen() {
        // Fullscreen quad (TRIANGLE_STRIP) — same one used for veil + blit.
        const verts = new Float32Array([
            -1, -1,  1, -1,  -1, 1,  1, 1,
        ]);
        this.fullscreenVbo = this.device.createBuffer({
            size: verts.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(this.fullscreenVbo, 0, verts);

        // Centered + line quads for batches.
        const centered = new Float32Array([-1,-1, 1,-1, -1,1, 1,1]);
        const lineQuad = new Float32Array([0,-1, 1,-1, 0,1, 1,1]);
        this.centeredQuadVbo = this.device.createBuffer({
            size: centered.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(this.centeredQuadVbo, 0, centered);
        this.lineQuadVbo = this.device.createBuffer({
            size: lineQuad.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(this.lineQuadVbo, 0, lineQuad);

        // Sprite quad — interleaved [pos.xy in -0.5..0.5, uv.xy].
        const spriteQuad = new Float32Array([
            -0.5, -0.5,  0, 1,
             0.5, -0.5,  1, 1,
            -0.5,  0.5,  0, 0,
             0.5,  0.5,  1, 0,
        ]);
        this.spriteVbo = this.device.createBuffer({
            size: spriteQuad.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(this.spriteVbo, 0, spriteQuad);
    }

    resize(w, h) {
        super.resize(w, h);
        if (!this.device) return;
        this._initOffscreen();
    }

    // ── Frame lifecycle ──────────────────────────────────────────────

    beginFrame(shakeX = 0, shakeY = 0) {
        this._shakeX = shakeX;
        this._shakeY = shakeY;
        this._blend = BLEND_NORMAL;
        // Reset all batch counts.
        for (const b of Object.values(this.batches)) b.count = 0;
        this._spriteIdx = 0;

        this._writeGlobals();

        // Start a render pass to the destination ("write") texture.
        // load = 'load' would preserve last frame — but WebGPU can't
        // load from texB to texA in the same pass when binding texB as
        // sampler. So we instead: copy the previous "src" → "dst",
        // then load = 'load' into dst, draw veil + entities into dst.
        const dstTex = this._dstIsA ? this.texA : this.texB;
        const srcTex = this._dstIsA ? this.texB : this.texA;
        this._dstView = dstTex.createView();
        this._srcTex = srcTex;
        this._dstTex = dstTex;

        // Copy src → dst so dst carries forward last frame's pixels.
        const enc = this.device.createCommandEncoder();
        enc.copyTextureToTexture(
            { texture: srcTex }, { texture: dstTex },
            { width: this.canvas.width, height: this.canvas.height },
        );
        this.device.queue.submit([enc.finish()]);

        this._encoder = this.device.createCommandEncoder();
        this._pass = this._encoder.beginRenderPass({
            colorAttachments: [{
                view: this._dstView,
                loadOp: 'load',
                storeOp: 'store',
            }],
        });
        this._pass.setBindGroup(0, this.globalsBg);
    }

    applyVeil(r, g, b, a) {
        this.flushAll();
        // Write veil uniform.
        this.device.queue.writeBuffer(this.veilUniform, 0, new Float32Array([r, g, b, a]));
        const pass = this._pass;
        pass.setPipeline(this.pipelineVeil);
        pass.setBindGroup(0, this.veilBg);
        pass.setVertexBuffer(0, this.fullscreenVbo);
        pass.draw(4, 1, 0, 0);
        // Restore globals binding for subsequent world draws.
        pass.setBindGroup(0, this.globalsBg);
    }

    setBlend(mode) {
        if (mode === this._blend) return;
        this.flushAll();
        this._blend = mode;
    }

    endFrame() {
        this.flushAll();
        this._pass.end();
        this.device.queue.submit([this._encoder.finish()]);
        this._encoder = null;
        this._pass = null;

        // Blit dst → swapchain surface.
        const blitEnc = this.device.createCommandEncoder();
        const blitPass = blitEnc.beginRenderPass({
            colorAttachments: [{
                view: this.context.getCurrentTexture().createView(),
                loadOp: 'clear',
                storeOp: 'store',
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
            }],
        });
        const bg = this.device.createBindGroup({
            layout: this.blitBgl,
            entries: [
                { binding: 0, resource: this._dstTex.createView() },
                { binding: 1, resource: this.sampler },
            ],
        });
        blitPass.setPipeline(this.pipelineBlit);
        blitPass.setBindGroup(0, bg);
        blitPass.setVertexBuffer(0, this.fullscreenVbo);
        blitPass.draw(4, 1, 0, 0);
        blitPass.end();
        this.device.queue.submit([blitEnc.finish()]);

        this._dstIsA = !this._dstIsA;
    }

    flushAll() {
        // Order matches WebGL2: point → ring → radial → circle → line.
        this._flushBatch('point');
        this._flushBatch('ring');
        this._flushBatch('radial');
        this._flushBatch('circle');
        this._flushBatch('line');
    }

    _flushBatch(name) {
        const b = this.batches[name];
        if (b.count === 0) return;
        const pass = this._pass;
        const pipeline = this.pipelines[name][this._blend === BLEND_ADDITIVE ? 'additive' : 'normal'];
        this.device.queue.writeBuffer(
            b.vbo, 0, b.scratch, 0, b.count * b.spec.floats,
        );
        pass.setPipeline(pipeline);
        const quadVbo = name === 'line' ? this.lineQuadVbo : this.centeredQuadVbo;
        pass.setVertexBuffer(0, quadVbo);
        pass.setVertexBuffer(1, b.vbo);
        pass.draw(4, b.count, 0, 0);
        b.count = 0;
    }

    // ── Primitive emitters — identical layout to WebGL2 ───────────────

    fillCircle(x, y, radius, r, g, b, a) {
        if (a <= 0 || radius <= 0) return;
        const batch = this.batches.circle;
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
        const batch = this.batches.ring;
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
        const batch = this.batches.point;
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
        const batch = this.batches.line;
        if (batch.count >= batch.capacity) batch.reserve(1);
        let i = batch.count * 10;
        const s = batch.scratch;
        s[i++] = x1; s[i++] = y1;
        s[i++] = x2; s[i++] = y2;
        s[i++] = lineWidth * 0.5;
        s[i++] = 0;
        s[i++] = r; s[i++] = g; s[i++] = b; s[i++] = a;
        batch.count++;
    }

    drawGlowLine(
        x1, y1, x2, y2, lineWidth,
        r, g, b, a,
        glowWidth, glowR, glowG, glowB, glowA,
    ) {
        if (glowA > 0 && glowWidth > 0) {
            const batch = this.batches.line;
            if (batch.count >= batch.capacity) batch.reserve(1);
            let i = batch.count * 10;
            const s = batch.scratch;
            s[i++] = x1; s[i++] = y1;
            s[i++] = x2; s[i++] = y2;
            s[i++] = glowWidth * 0.5;
            s[i++] = 1;
            s[i++] = glowR; s[i++] = glowG; s[i++] = glowB; s[i++] = glowA;
            batch.count++;
        }
        this.drawLine(x1, y1, x2, y2, lineWidth, r, g, b, a);
    }

    drawRadialFlash(
        cx, cy, radius,
        iR, iG, iB, iA,
        mR, mG, mB, mA,
        oR, oG, oB, oA,
    ) {
        if (radius <= 0) return;
        const batch = this.batches.radial;
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

    // ── Textured sprites (nebula clouds) ──────────────────────────────

    registerTexture(id, source) {
        const device = this.device;
        const w = source.width, h = source.height;
        let entry = this._textures.get(id);
        if (!entry || entry.w !== w || entry.h !== h) {
            if (entry) entry.texture.destroy();
            const texture = device.createTexture({
                size: { width: w, height: h },
                format: 'rgba8unorm',
                usage: GPUTextureUsage.TEXTURE_BINDING
                     | GPUTextureUsage.COPY_DST
                     | GPUTextureUsage.RENDER_ATTACHMENT,
            });
            entry = { texture, view: texture.createView(), w, h };
            this._textures.set(id, entry);
        }
        device.queue.copyExternalImageToTexture(
            { source }, { texture: entry.texture }, { width: w, height: h },
        );
    }

    drawSprite(id, cx, cy, width, height, rotation, alpha) {
        const entry = this._textures.get(id);
        if (!entry || alpha <= 0) return;
        if (this._spriteIdx >= this.SPRITE_RING) return; // ring exhausted this frame
        this.flushAll(); // preserve draw order vs batched primitives

        const slot = this._spriteIdx++;
        const ubo = this.spriteUniformBuffers[slot];
        const s = this._spriteScratch;
        s[0] = cx; s[1] = cy; s[2] = width; s[3] = height;
        s[4] = rotation; s[5] = alpha; s[6] = 0; s[7] = 0;
        this.device.queue.writeBuffer(ubo, 0, s);

        const bg = this.device.createBindGroup({
            layout: this.spriteBgl,
            entries: [
                { binding: 0, resource: { buffer: ubo } },
                { binding: 1, resource: entry.view },
                { binding: 2, resource: this.linearSampler },
            ],
        });

        const pass = this._pass;
        pass.setPipeline(this.pipelineSprite[this._blend === BLEND_ADDITIVE ? 'additive' : 'normal']);
        pass.setBindGroup(0, this.globalsBg);
        pass.setBindGroup(1, bg);
        pass.setVertexBuffer(0, this.spriteVbo);
        pass.draw(4, 1, 0, 0);
    }
}
