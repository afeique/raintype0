// Live-tuning sliders for bloom intensity/threshold/knee. Toggled with
// SHIFT+B. Backported from rainboids' js/modules/hud/bloom-debug-overlay.js.
//
// Usage:
//   const dbg = new BloomDebugOverlay();
//   dbg.attach(webgl2Renderer, 'WebGL2 bloom');
//   each frame:
//     const p = dbg.getParams(webgl2Renderer);
//     if (p) { renderer.bloomIntensity = p.intensity; ... }
//
// Sliders write to a plain object; the engine reads back each frame.
// pointerEvents:auto so sliders work; whole panel is display:none when
// hidden so nothing in the page is blocked.

const SLIDER_DEFS = [
    { key: 'intensity', min: 0, max: 2,   step: 0.01 },
    { key: 'threshold', min: 0, max: 1,   step: 0.01 },
    { key: 'knee',      min: 0, max: 0.5, step: 0.01 },
];

export class BloomDebugOverlay {
    constructor() {
        this._visible = false;
        this._paramsByPipeline = new Map();

        const root = document.createElement('div');
        root.id = 'bloom-debug-overlay';
        Object.assign(root.style, {
            position: 'fixed',
            top: '8px',
            right: '8px',
            zIndex: '99999',
            padding: '10px 12px',
            minWidth: '260px',
            background: 'rgba(0,0,0,0.75)',
            color: '#ddd',
            fontFamily: "'Courier New', monospace",
            fontSize: '11px',
            lineHeight: '1.4',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: '4px',
            pointerEvents: 'auto',
            display: 'none',
            userSelect: 'none',
        });

        const header = document.createElement('div');
        header.textContent = 'BLOOM DEBUG';
        Object.assign(header.style, {
            fontWeight: 'bold',
            letterSpacing: '0.08em',
            marginBottom: '6px',
            color: '#fff',
            borderBottom: '1px solid rgba(255,255,255,0.2)',
            paddingBottom: '4px',
        });
        root.appendChild(header);
        document.body.appendChild(root);
        this._root = root;
    }

    /**
     * Attach a renderer that exposes bloomIntensity / bloomThreshold /
     * bloomKnee tunables. The sliders read initial values from those
     * fields; the engine should write the slider values back each
     * frame via getParams().
     */
    attach(renderer, label) {
        if (!renderer || this._paramsByPipeline.has(renderer)) return;
        const initial = {
            intensity: renderer.bloomIntensity ?? 0.85,
            threshold: renderer.bloomThreshold ?? 0.5,
            knee:      renderer.bloomKnee ?? 0.3,
        };

        const section = document.createElement('div');
        Object.assign(section.style, {
            marginTop: '8px',
            paddingTop: '6px',
            borderTop: this._paramsByPipeline.size > 0
                ? '1px dashed rgba(255,255,255,0.15)'
                : 'none',
        });

        const labelEl = document.createElement('div');
        labelEl.textContent = label;
        Object.assign(labelEl.style, { color: '#9cf', marginBottom: '4px' });
        section.appendChild(labelEl);

        const params = {
            intensity: initial.intensity,
            threshold: initial.threshold,
            knee:      initial.knee,
            sectionEl: section,
        };

        for (const def of SLIDER_DEFS) {
            const row = document.createElement('div');
            Object.assign(row.style, {
                display: 'grid',
                gridTemplateColumns: '70px 1fr 44px',
                alignItems: 'center',
                gap: '6px',
                marginTop: '2px',
            });

            const name = document.createElement('label');
            name.textContent = def.key;
            name.style.color = '#bbb';

            const input = document.createElement('input');
            input.type = 'range';
            input.min = String(def.min);
            input.max = String(def.max);
            input.step = String(def.step);
            input.value = String(params[def.key]);
            input.style.width = '100%';
            input.style.accentColor = '#9cf';

            const valueSpan = document.createElement('span');
            valueSpan.style.textAlign = 'right';
            valueSpan.style.color = '#fff';
            valueSpan.textContent = Number(params[def.key]).toFixed(2);

            input.addEventListener('input', () => {
                const v = parseFloat(input.value);
                params[def.key] = v;
                valueSpan.textContent = v.toFixed(2);
            });

            row.appendChild(name);
            row.appendChild(input);
            row.appendChild(valueSpan);
            section.appendChild(row);
        }

        this._root.appendChild(section);
        this._paramsByPipeline.set(renderer, params);
    }

    setVisible(bool) {
        this._visible = !!bool;
        if (this._root) this._root.style.display = this._visible ? 'block' : 'none';
    }

    toggleVisible() { this.setVisible(!this._visible); }
    get visible() { return this._visible; }

    getParams(renderer) {
        const entry = this._paramsByPipeline.get(renderer);
        if (!entry) return null;
        return {
            intensity: entry.intensity,
            threshold: entry.threshold,
            knee:      entry.knee,
        };
    }
}
