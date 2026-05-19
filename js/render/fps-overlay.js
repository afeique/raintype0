// Diagnostic FPS + per-batch instance count overlay. Toggled with
// SHIFT+F. Backported from rainboids' js/modules/hud/fps-overlay.js,
// trimmed for raintype0's smaller renderer set.
//
// Engine wiring:
//   const fps = new FPSOverlay();
//   fps.setRenderMode(renderer.flag);
//   each frame:
//     fps.tick(performance.now());
//     for each batch name -> fps.setInstanceCount(name, count);
//
// DOM refresh is throttled to ~4 Hz so the overlay itself doesn't bias
// the measurement (full DOM rewrite at 60 Hz would skew frametimes).

const CANONICAL_ORDER = ['stars', 'particles', 'bullets', 'lineDebris', 'asteroids'];
const FPS_SAMPLE_COUNT = 60;
const DOM_REFRESH_INTERVAL = 15;   // 60 fps / 15 = 4 refreshes/sec
const NAME_COL_WIDTH = 12;
const COUNT_COL_WIDTH = 5;

export class FPSOverlay {
    constructor() {
        this._frameTimestamps = new Float32Array(FPS_SAMPLE_COUNT);
        this._frameWriteIdx = 0;
        this._frameCount = 0;
        this._currentFPS = 0;
        this._domUpdateTimer = 0;
        this._visible = false;
        this._renderModeLabel = '(unknown)';
        this._instanceCounts = new Map();

        const root = document.createElement('div');
        root.id = 'fps-overlay';
        Object.assign(root.style, {
            position: 'fixed',
            top: '8px',
            left: '8px',
            zIndex: '1001',
            padding: '6px 8px',
            background: 'rgba(0,0,0,0.75)',
            color: '#ddd',
            fontFamily: "'Courier New', monospace",
            fontSize: '11px',
            lineHeight: '1.35',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: '3px',
            pointerEvents: 'none',
            display: 'none',
            userSelect: 'none',
            whiteSpace: 'pre',
        });

        const modeRow = document.createElement('div');
        modeRow.style.color = '#9cf';
        modeRow.textContent = 'RENDER: (unknown)';

        const fpsRow = document.createElement('div');
        fpsRow.style.color = '#fff';
        fpsRow.textContent = 'FPS:  --';

        const divider = document.createElement('div');
        divider.style.color = '#555';
        divider.textContent = '------';

        const instancesRow = document.createElement('div');
        instancesRow.style.color = '#ddd';
        instancesRow.textContent = '';

        root.appendChild(modeRow);
        root.appendChild(fpsRow);
        root.appendChild(divider);
        root.appendChild(instancesRow);
        document.body.appendChild(root);

        this._root = root;
        this._modeRow = modeRow;
        this._fpsRow = fpsRow;
        this._instancesRow = instancesRow;
    }

    setRenderMode(label) {
        this._renderModeLabel = String(label ?? '(unknown)');
        if (this._modeRow) this._modeRow.textContent = `RENDER: ${this._renderModeLabel}`;
    }

    tick(timeMs) {
        this._frameTimestamps[this._frameWriteIdx] = timeMs;
        this._frameWriteIdx = (this._frameWriteIdx + 1) % FPS_SAMPLE_COUNT;
        if (this._frameCount < FPS_SAMPLE_COUNT) this._frameCount++;

        if (this._frameCount >= 2) {
            const oldestIdx = this._frameCount < FPS_SAMPLE_COUNT ? 0 : this._frameWriteIdx;
            const elapsed = timeMs - this._frameTimestamps[oldestIdx];
            const frames = this._frameCount - 1;
            if (elapsed > 0) this._currentFPS = (frames * 1000) / elapsed;
        }

        this._domUpdateTimer++;
        if (this._domUpdateTimer >= DOM_REFRESH_INTERVAL) {
            this._domUpdateTimer = 0;
            if (this._visible) this._refreshDOM();
        }
    }

    setInstanceCount(name, count) {
        let rec = this._instanceCounts.get(name);
        if (!rec) {
            rec = { current: 0, max: 0 };
            this._instanceCounts.set(name, rec);
        }
        rec.current = count;
        if (count > rec.max) rec.max = count;
    }

    setVisible(bool) {
        this._visible = !!bool;
        if (this._root) this._root.style.display = this._visible ? 'block' : 'none';
        if (this._visible) this._refreshDOM();
    }

    toggleVisible() { this.setVisible(!this._visible); }
    get visible() { return this._visible; }

    _refreshDOM() {
        this._fpsRow.textContent = `FPS:  ${this._currentFPS.toFixed(1)}`;
        const seen = new Set();
        const ordered = [];
        for (const name of CANONICAL_ORDER) {
            if (this._instanceCounts.has(name)) { ordered.push(name); seen.add(name); }
        }
        for (const name of this._instanceCounts.keys()) {
            if (!seen.has(name)) ordered.push(name);
        }
        const lines = [];
        for (const name of ordered) {
            const rec = this._instanceCounts.get(name);
            const label = `${name}:`.padEnd(NAME_COL_WIDTH, ' ');
            const cur = String(rec.current).padStart(COUNT_COL_WIDTH, ' ');
            const mx = String(rec.max).padStart(COUNT_COL_WIDTH, ' ');
            lines.push(`${label}${cur} / ${mx}`);
        }
        this._instancesRow.textContent = lines.join('\n');
    }
}
