// WebAudio playback for runtime-synthesised sfxr sounds.
//
// At init() we render every SOUND_DEFS entry into AudioBuffer(s) once
// (multi-layer defs render N AudioBuffers, one per layer). At play time
// we spawn fresh AudioBufferSourceNodes — those are single-shot per spec
// — share one start timestamp, and route through gain nodes scaled by
// master × layer × per-layer gain.
//
// Throttling per name prevents the same SFX stacking on top of itself
// when an effect fires faster than the human ear can distinguish (the
// monosrc bullet rate triggers shoot() 5× per second; thrust fires
// every frame while accelerating).

import { SOUND_DEFS } from './sound-defs.js';

const DEFAULT_THROTTLE_MS = {
    shoot:           60,
    hit:             40,
    coin:            70,
    explosion:       60,
    playerExplosion: 500,
    thruster:        90,
};

export class AudioManager {
    constructor() {
        this.audioContext = null;
        this.audioReady = false;

        // 0..1 master gain knob for SFX.
        this.sfxMasterVol = 0.4;
        this.sfxMuted = false;

        // name → [ { buffer, gain, sampleRate } ]  (one entry per layer)
        this._renderedSounds = new Map();
        this._lastPlayedAt = new Map();
        this._loaded = false;
    }

    // Called from a user gesture (the title-screen "start" tap).
    // Resumes the suspended AudioContext and pre-renders every SFX.
    async init() {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) {
            console.warn('[audio] WebAudio unavailable; SFX disabled.');
            return;
        }
        if (!this.audioContext) this.audioContext = new Ctor();
        if (this.audioContext.state === 'suspended') {
            try { await this.audioContext.resume(); } catch { /* noop */ }
        }

        this._renderAll();
        this._loaded = true;
        this.audioReady = true;
    }

    _renderAll() {
        // sfxr.js is loaded as a plain <script>; SoundEffect + sfxr live
        // on window.
        const sfxr = window.sfxr;
        const SoundEffect = window.SoundEffect;
        if (!sfxr || !SoundEffect) {
            console.warn('[audio] sfxr not loaded; SFX disabled.');
            return;
        }

        for (const [name, def] of Object.entries(SOUND_DEFS)) {
            const layers = this._layersFromDef(def);
            const rendered = [];
            for (const layer of layers) {
                const params = this._paramsFromLayer(layer, sfxr);
                try {
                    const fx = new SoundEffect(params);
                    const raw = fx.getRawBuffer().normalized;
                    const sampleRate = fx.sampleRate || 44100;
                    const buffer = this.audioContext.createBuffer(1, raw.length, sampleRate);
                    const channel = buffer.getChannelData(0);
                    for (let i = 0; i < raw.length; i++) channel[i] = raw[i];
                    rendered.push({ buffer, gain: layer.gain ?? 1 });
                } catch (e) {
                    console.warn(`[audio] failed to render "${name}":`, e?.message || e);
                }
            }
            if (rendered.length) this._renderedSounds.set(name, rendered);
        }
    }

    _layersFromDef(def) {
        if (def.layers) return def.layers;
        // preset / params single-voice → 1-entry layer array
        return [{ params: def.params, preset: def.preset, overrides: def.overrides, gain: 1 }];
    }

    _paramsFromLayer(layer, sfxr) {
        // Start from a preset if given, else a blank Params; then merge
        // in the explicit params / overrides.
        let params;
        if (layer.preset) {
            params = sfxr.generate(layer.preset);
        } else {
            params = new window.Params();
        }
        const merge = layer.params || layer.overrides;
        if (merge) Object.assign(params, merge);
        return params;
    }

    play(name) {
        if (!this.audioReady || !this._loaded) return;
        if (this.sfxMuted) return;
        const rendered = this._renderedSounds.get(name);
        if (!rendered) return;

        // Throttle so identical SFX don't pile up.
        const now = performance.now();
        const min = DEFAULT_THROTTLE_MS[name] ?? 30;
        const last = this._lastPlayedAt.get(name) ?? 0;
        if (now - last < min) return;
        this._lastPlayedAt.set(name, now);

        // Lazy resume — Safari sometimes flips state back to suspended.
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume().catch(() => {});
        }

        // Bias gain down when layering so 3 stacked voices don't peak.
        const layerScale = rendered.length === 1 ? 1 : 1 / Math.sqrt(rendered.length);
        const startAt = this.audioContext.currentTime;

        for (const layer of rendered) {
            try {
                const src = this.audioContext.createBufferSource();
                src.buffer = layer.buffer;
                const gain = this.audioContext.createGain();
                gain.gain.value = this.sfxMasterVol * layerScale * layer.gain;
                src.connect(gain).connect(this.audioContext.destination);
                src.start(startAt);
            } catch { /* noop */ }
        }
    }

    setSfxVolume(v) {
        this.sfxMasterVol = Math.max(0, Math.min(1, v));
    }

    getSfxVolume() {
        return this.sfxMasterVol;
    }

    setSfxMuted(muted) {
        this.sfxMuted = !!muted;
    }

    isSfxMuted() {
        return this.sfxMuted;
    }
}

export const audioManager = new AudioManager();
