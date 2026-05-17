// Single source of truth for SFX. Each entry is either:
//   { preset: 'laserShoot', overrides?: {...} }
//   { params: { ... raw sfxr Params ... } }
//   { layers: [{ params, gain? }, ...] }       — sum-mixed in audio-manager
//
// The runtime renders each layer with sfxr.toWebAudio (which builds an
// AudioBuffer from a SoundEffect's normalized samples). Layers are
// summed at play time into separate BufferSources sharing one start
// timestamp, so they hit as one chord-like impact.
//
// Preserves the monosrc sound set exactly — shoot, hit, coin, explosion,
// playerExplosion, thruster — but the recipes are upgraded from the
// stock 1-voice presets to richer multi-voice stacks adapted from the
// rainsrc sound design vocabulary.

export const SOUND_DEFS = {

    // Player primary fire — energy pulse with sub-thump and bright tail.
    shoot: {
        layers: [
            { params: {
                wave_type: 0, p_base_freq: 0.55, p_freq_ramp: -0.45,
                p_env_attack: 0, p_env_sustain: 0.08, p_env_decay: 0.18,
                p_env_punch: 0.35, p_duty: 0.4, p_duty_ramp: -0.1,
                sound_vol: 0.4, sample_rate: 44100, sample_size: 8,
            }, gain: 0.55 },
            { params: {
                wave_type: 2, p_base_freq: 0.18, p_freq_ramp: -0.2,
                p_env_attack: 0, p_env_sustain: 0.04, p_env_decay: 0.12,
                p_env_punch: 0.4,
                sound_vol: 0.35, sample_rate: 44100, sample_size: 8,
            }, gain: 0.30 },
            { params: {
                wave_type: 0, p_base_freq: 0.85, p_freq_ramp: -0.5,
                p_env_attack: 0, p_env_sustain: 0.01, p_env_decay: 0.05,
                p_hpf_freq: 0.3, p_env_punch: 0.5,
                sound_vol: 0.2, sample_rate: 44100, sample_size: 8,
            }, gain: 0.20 },
        ],
    },

    // Bullet–asteroid hit. Crisp, synthetic, no boom.
    hit: {
        layers: [
            { params: {
                wave_type: 0, p_base_freq: 0.42, p_freq_ramp: -0.28,
                p_env_attack: 0, p_env_sustain: 0.04, p_env_decay: 0.14,
                p_arp_mod: -0.3, p_arp_speed: 0.65, p_env_punch: 0.4,
                p_duty: 0.45,
                sound_vol: 0.36, sample_rate: 44100, sample_size: 8,
            }, gain: 0.60 },
            { params: {
                wave_type: 3, p_base_freq: 0.50, p_freq_ramp: -0.3,
                p_env_attack: 0, p_env_sustain: 0.02, p_env_decay: 0.08,
                p_hpf_freq: 0.2,
                sound_vol: 0.25, sample_rate: 44100, sample_size: 8,
            }, gain: 0.40 },
        ],
    },

    // Star / burst-star pickup. Bright ascending blip.
    coin: { preset: 'pickupCoin' },

    // Asteroid fully destroyed — wide noisy boom.
    explosion: { preset: 'explosion' },

    // Player ship destroyed — slower, deeper boom.
    playerExplosion: {
        preset: 'explosion',
        overrides: {
            p_env_attack: 0.2,
            p_env_sustain: 0.3,
            p_base_freq: 0.4,
            p_freq_limit: 0.1,
        },
    },

    // Thrust loop one-shot. Played every frame while accelerating;
    // the audio-manager throttles to avoid stacking.
    thruster: {
        preset: 'explosion',
        overrides: {
            wave_type: 3, // NOISE
            p_env_attack: 0.1,
            p_env_sustain: 0.3,
            p_env_decay: 0.2,
            p_base_freq: 0.8,
            p_freq_ramp: -0.05,
            p_hpf_freq: 0.4,
            p_lpf_freq: 0.9,
            sound_vol: 0.25,
        },
    },
};
