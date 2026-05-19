// Animated title screen.
//
// Each letter of RAINTYPE0 is a <span class="title-char"> with its
// own --i custom property (0..N-1) and --launch-x/y/rot for the
// game-start explosion animation. CSS keyframes read --i to phase-
// shift the wavy-rainbow effect across letters so the colour wave
// flows from left to right.

import { VERSION } from '../core/version.js';

const TITLE_TEXT = 'RAINTYPE0';
const LAUNCH_DURATION_MS = 900;
const LAUNCH_STAGGER_MS  = 45;

export function setupTitleScreen(highScore) {
    const gameTitle = document.getElementById('game-title');
    const highScoreDisplay = document.getElementById('high-score-display');
    const versionTag = document.getElementById('version-tag');

    gameTitle.innerHTML = '';
    gameTitle.classList.remove('title-launching');
    const n = TITLE_TEXT.length;
    [...TITLE_TEXT].forEach((char, i) => {
        const span = document.createElement('span');
        span.textContent = char;
        span.className = 'title-char';
        // --i drives the per-letter colour/wave phase offsets so each
        // glyph is at a different point in the rainbow cycle.
        span.style.setProperty('--i', String(i));
        span.style.setProperty('--n', String(n));
        gameTitle.appendChild(span);
    });

    highScoreDisplay.textContent = `HIGH SCORE: ${highScore}`;
    if (versionTag) versionTag.textContent = `v${VERSION}`;
}

// Instant hide — used on pause-menu restart, GAME_OVER → restart, etc.
export function hideTitleScreen() {
    document.getElementById('title-screen').style.display = 'none';
}

/**
 * Game-start launch animation: each letter flies outward in a random
 * direction with spin + blur + fade, then the overlay hides and the
 * onDone callback fires so main.js can call init(). CSS-only — the
 * keyframes are wired in styles.css; this function just seeds the
 * per-letter custom properties and applies the trigger class.
 */
export function playTitleLaunchAnimation(onDone) {
    const titleScreen = document.getElementById('title-screen');
    const gameTitle = document.getElementById('game-title');
    const chars = gameTitle.querySelectorAll('.title-char');

    // Seed each letter with a randomised launch trajectory so even two
    // back-to-back runs look different. Distance is normalized to the
    // viewport's longer axis so the letters always fly off-screen.
    const reach = Math.max(window.innerWidth, window.innerHeight) * 0.85;
    chars.forEach((c) => {
        const ang = Math.random() * Math.PI * 2;
        const dist = reach * (0.6 + Math.random() * 0.6);
        c.style.setProperty('--launch-x', `${Math.cos(ang) * dist}px`);
        c.style.setProperty('--launch-y', `${Math.sin(ang) * dist}px`);
        c.style.setProperty('--launch-rot', `${(Math.random() - 0.5) * 1440}deg`);
    });
    gameTitle.classList.add('title-launching');

    // Also fade the title-screen overlay (radial vignette + subtitle)
    // out in parallel. CSS animation on .title-screen-fading class.
    titleScreen.classList.add('title-screen-fading');

    const totalMs = LAUNCH_DURATION_MS + chars.length * LAUNCH_STAGGER_MS;
    setTimeout(() => {
        titleScreen.style.display = 'none';
        titleScreen.classList.remove('title-screen-fading');
        if (onDone) onDone();
    }, totalMs);
}
