// Animated title screen.

import { VERSION } from '../core/version.js';

export function setupTitleScreen(highScore) {
    const titleText = 'RAINTYPE0';
    const gameTitle = document.getElementById('game-title');
    const highScoreDisplay = document.getElementById('high-score-display');
    const versionTag = document.getElementById('version-tag');

    gameTitle.innerHTML = '';
    titleText.split('').forEach((char, i) => {
        const span = document.createElement('span');
        span.textContent = char;
        span.className = 'title-char';
        span.style.animationDelay = `${i * 0.1}s`;
        gameTitle.appendChild(span);
    });

    highScoreDisplay.textContent = `HIGH SCORE: ${highScore}`;
    if (versionTag) versionTag.textContent = `v${VERSION}`;
}

export function hideTitleScreen() {
    document.getElementById('title-screen').style.display = 'none';
}
