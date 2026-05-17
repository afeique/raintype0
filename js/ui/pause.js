// Cleaned-up pause menu. Wires volume / mute + music play / next /
// previous, persists settings, surfaces the current track name.

import { saveSettings } from '../core/storage.js';

export function setupPauseMenu({ audio, music, onResume, onRestart, settings }) {
    const overlay   = document.getElementById('pause-overlay');
    const resumeBtn = document.getElementById('resume-button');
    const restartBtn = document.getElementById('restart-button');
    const bgmVol    = document.getElementById('bgm-vol');
    const sfxVol    = document.getElementById('sfx-vol');
    const bgmMute   = document.getElementById('bgm-mute');
    const sfxMute   = document.getElementById('sfx-mute');

    const nowPlaying = document.getElementById('now-playing');
    const bgmPrev    = document.getElementById('bgm-prev');
    const bgmNext    = document.getElementById('bgm-next');
    const bgmToggle  = document.getElementById('bgm-toggle');

    // Apply persisted settings on boot.
    if (typeof settings.bgmVolume === 'number') {
        music.setVolume(settings.bgmVolume);
        bgmVol.value = String((settings.bgmVolume * 100) | 0);
    }
    if (typeof settings.sfxVolume === 'number') {
        audio.setSfxVolume(settings.sfxVolume);
        sfxVol.value = String((settings.sfxVolume * 100) | 0);
    }
    if (settings.bgmMuted) {
        music.setMuted(true);
        bgmMute.classList.add('muted');
    }
    if (settings.sfxMuted) {
        audio.setSfxMuted(true);
        sfxMute.classList.add('muted');
    }

    // Now-playing display + play/pause icon stay in sync with the player.
    function refreshNowPlaying() {
        const track = music.getCurrentTrack ? music.getCurrentTrack() : null;
        if (track && nowPlaying) {
            nowPlaying.textContent = `${track.name}${track.artist ? ' — ' + track.artist : ''}`;
        }
        if (bgmToggle) bgmToggle.textContent = music.isPlaying ? '❚❚' : '▶';
    }
    music.onTrackChange = refreshNowPlaying;
    music.onPlayStateChange = () => {
        if (bgmToggle) bgmToggle.textContent = music.isPlaying ? '❚❚' : '▶';
    };
    refreshNowPlaying();

    // Volume + mute.
    bgmVol.addEventListener('input', () => {
        const v = bgmVol.valueAsNumber / 100;
        music.setVolume(v);
        saveSettings({ bgmVolume: v });
    });
    sfxVol.addEventListener('input', () => {
        const v = sfxVol.valueAsNumber / 100;
        audio.setSfxVolume(v);
        saveSettings({ sfxVolume: v });
    });
    bgmMute.addEventListener('click', () => {
        const muted = !music.isMuted();
        music.setMuted(muted);
        bgmMute.classList.toggle('muted', muted);
        if (muted) music.pause(); else music.play();
        saveSettings({ bgmMuted: muted });
    });
    sfxMute.addEventListener('click', () => {
        const muted = !audio.isSfxMuted();
        audio.setSfxMuted(muted);
        sfxMute.classList.toggle('muted', muted);
        saveSettings({ sfxMuted: muted });
    });

    // Track navigation.
    if (bgmPrev) bgmPrev.addEventListener('click', () => music.previous());
    if (bgmNext) bgmNext.addEventListener('click', () => music.next());
    if (bgmToggle) bgmToggle.addEventListener('click', () => music.togglePlayPause());

    resumeBtn.addEventListener('click', onResume);
    restartBtn.addEventListener('click', onRestart);

    return {
        show() { overlay.style.display = 'flex'; refreshNowPlaying(); },
        hide() { overlay.style.display = 'none'; },
        isOpen() { return overlay.style.display === 'flex'; },
    };
}
