// Playlist-aware background music. Adapted from rainsrc HEAD's
// music-player.js, trimmed to drop the buffered-progress callback and
// shuffle/repeat toggles (we always shuffle, never repeat-one).
//
// Each session:
//   1. Playlist initialised + shuffled in-place.
//   2. A RANDOM track index is chosen as the starting track (so even
//      a re-shuffle of the same order picks a different first track).
//   3. The next sequential track is speculatively pre-loaded so the
//      auto-advance on track-end feels gapless.
//
// Playback is gated on user gesture (browser autoplay policy) — caller
// must invoke .play() inside a click/touch/keydown handler.

import { PLAYLIST_DATA } from '../playlist-data.js';

export class MusicPlayer {
    constructor() {
        this.playlist = [...PLAYLIST_DATA];
        this._shufflePlaylist();
        this.currentTrackIndex = Math.floor(Math.random() * this.playlist.length);

        this.currentAudio = null;
        this.nextAudio = null;
        this.nextAudioIndex = -1;

        this.volume = 0.5;
        this.muted = false;
        this.isPlaying = false;

        // UI hooks (optional).
        this.onTrackChange = null;
        this.onPlayStateChange = null;

        this._loadTrack(this.currentTrackIndex);
    }

    _shufflePlaylist() {
        for (let i = this.playlist.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.playlist[i], this.playlist[j]] = [this.playlist[j], this.playlist[i]];
        }
    }

    // ── Audio lifecycle helpers ────────────────────────────────────────

    _disposeAudio(audio) {
        if (!audio) return;
        audio._disposing = true;
        try {
            audio.pause();
            if (audio._handlers) {
                audio.removeEventListener('ended',  audio._handlers.ended);
                audio.removeEventListener('error',  audio._handlers.error);
                audio._handlers = null;
            }
            audio.src = '';
            audio.load();
        } catch { /* some browsers throw on load() after empty src */ }
    }

    _attachListeners(audio, track) {
        audio.volume = this.muted ? 0 : this.volume;
        const handlers = {
            ended: () => this.next(),
            error: () => {
                if (audio._disposing) return;
                console.warn('[music] failed to load', track.path);
                // Auto-skip on load error so a broken file doesn't stall the queue.
                setTimeout(() => this.next(), 800);
            },
        };
        audio._handlers = handlers;
        audio.addEventListener('ended', handlers.ended);
        audio.addEventListener('error', handlers.error);
    }

    _preloadNext() {
        const nextIndex = (this.currentTrackIndex + 1) % this.playlist.length;
        if (this.nextAudio && this.nextAudioIndex === nextIndex) return;
        this._disposeAudio(this.nextAudio);
        this.nextAudio = new Audio(this.playlist[nextIndex].path);
        this.nextAudio.volume = this.muted ? 0 : this.volume;
        this.nextAudioIndex = nextIndex;
    }

    _clearNextPreload() {
        this._disposeAudio(this.nextAudio);
        this.nextAudio = null;
        this.nextAudioIndex = -1;
    }

    _loadTrack(index, opts = {}) {
        if (index < 0 || index >= this.playlist.length) return;
        this.currentTrackIndex = index;
        const track = this.playlist[index];

        this._disposeAudio(this.currentAudio);

        // Promote a matching preload into the current slot if we have one.
        if (this.nextAudio && this.nextAudioIndex === index) {
            this.currentAudio = this.nextAudio;
            this.nextAudio = null;
            this.nextAudioIndex = -1;
        } else {
            this._clearNextPreload();
            this.currentAudio = new Audio(track.path);
        }

        this._attachListeners(this.currentAudio, track);

        if (!opts.skipPreload) this._preloadNext();

        if (this.onTrackChange) this.onTrackChange(track);

        if (this.isPlaying) {
            setTimeout(() => this.play(), 100);
        }
    }

    // ── Playback controls ──────────────────────────────────────────────

    play() {
        if (!this.currentAudio) return Promise.resolve();
        if (this.muted) return Promise.resolve();
        const p = this.currentAudio.play();
        const handled = (p instanceof Promise ? p : Promise.resolve())
            .then(() => {
                this.isPlaying = true;
                if (this.onPlayStateChange) this.onPlayStateChange(true);
            })
            .catch(() => {
                this.isPlaying = false;
                if (this.onPlayStateChange) this.onPlayStateChange(false);
            });
        return handled;
    }

    pause() {
        if (!this.currentAudio) return;
        this.currentAudio.pause();
        this.isPlaying = false;
        if (this.onPlayStateChange) this.onPlayStateChange(false);
    }

    togglePlayPause() {
        if (this.isPlaying) { this.pause(); return false; }
        this.play();
        return true;
    }

    next() {
        const wasPlaying = this.isPlaying;
        this.isPlaying = wasPlaying;
        this._loadTrack((this.currentTrackIndex + 1) % this.playlist.length);
    }

    previous() {
        if (this.currentAudio && this.currentAudio.currentTime > 3) {
            this.currentAudio.currentTime = 0;
            return;
        }
        const prevIndex = (this.currentTrackIndex - 1 + this.playlist.length) % this.playlist.length;
        this._loadTrack(prevIndex);
    }

    // ── Volume / mute ──────────────────────────────────────────────────

    setVolume(v) {
        this.volume = Math.max(0, Math.min(1, v));
        if (this.muted) return;
        if (this.currentAudio) this.currentAudio.volume = this.volume;
        if (this.nextAudio)    this.nextAudio.volume    = this.volume;
    }

    getVolume() { return this.volume; }

    setMuted(muted) {
        this.muted = !!muted;
        const v = this.muted ? 0 : this.volume;
        if (this.currentAudio) this.currentAudio.volume = v;
        if (this.nextAudio)    this.nextAudio.volume    = v;
    }

    isMuted() { return this.muted; }

    // ── Introspection ──────────────────────────────────────────────────

    getCurrentTrack() { return this.playlist[this.currentTrackIndex]; }
}
