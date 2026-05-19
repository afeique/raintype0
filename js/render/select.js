// URL-flag-driven renderer selection. Reads `?renderer=...` from the
// page URL and async-instantiates the matching backend.
//
// Valid flags:
//   webgl2          — full single-canvas WebGL2 pipeline (DEFAULT — fastest)
//   webgl2-hybrid   — WebGL2 + canvas2d overlay (visual safety, lower FPS)
//   webgpu          — full single-canvas WebGPU pipeline
//   canvas2d        — original canvas2d reference path
//
// If the requested backend fails to init (no WebGL2 support, etc.) we
// fall back to canvas2d and log a warning.

import { Canvas2DRenderer } from './canvas2d-renderer.js';

export const RENDERER_FLAGS = ['canvas2d', 'webgl2', 'webgl2-hybrid', 'webgpu'];
export const DEFAULT_RENDERER = 'webgl2';

export function readRendererFlag() {
    if (typeof window === 'undefined') return DEFAULT_RENDERER;
    const sp = new URLSearchParams(window.location.search);
    const raw = (sp.get('renderer') || sp.get('r') || '').toLowerCase();
    if (RENDERER_FLAGS.includes(raw)) return raw;
    return DEFAULT_RENDERER;
}

export async function createRenderer(canvas, requested) {
    const want = requested || readRendererFlag();
    let renderer = null;

    if (want === 'webgl2') {
        try {
            const { WebGL2Renderer } = await import('./webgl2-renderer.js');
            renderer = new WebGL2Renderer(canvas);
            if (!(await renderer.init())) {
                console.warn('[renderer] webgl2 init failed — falling back to canvas2d');
                renderer = null;
            }
        } catch (e) {
            console.warn('[renderer] webgl2 module failed:', e);
            renderer = null;
        }
    } else if (want === 'webgl2-hybrid') {
        try {
            const { WebGL2HybridRenderer } = await import('./webgl2-hybrid-renderer.js');
            renderer = new WebGL2HybridRenderer(canvas);
            if (!(await renderer.init())) {
                console.warn('[renderer] webgl2-hybrid init failed — falling back to canvas2d');
                renderer = null;
            }
        } catch (e) {
            console.warn('[renderer] webgl2-hybrid module failed:', e);
            renderer = null;
        }
    } else if (want === 'webgpu') {
        try {
            const { WebGPURenderer } = await import('./webgpu-renderer.js');
            renderer = new WebGPURenderer(canvas);
            if (!(await renderer.init())) {
                console.warn('[renderer] webgpu init failed — falling back to canvas2d');
                renderer = null;
            }
        } catch (e) {
            console.warn('[renderer] webgpu module failed:', e);
            renderer = null;
        }
    }

    if (!renderer) {
        renderer = new Canvas2DRenderer(canvas);
        await renderer.init();
    }

    renderer.flag = want;
    return renderer;
}
