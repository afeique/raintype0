// Bootstrap + main loop. Wires every module together; nothing else in
// the project knows about DOM ids or canvas sizing.

import { Viewport, STAR_COUNT, MIN_STAR_DIST, random } from './core/utils.js';
import { bus } from './core/event-bus.js';
import { frameClock } from './core/frame-clock.js';
import { PoolManager } from './core/pool-manager.js';
import { loadHighScore, saveHighScore, loadSettings } from './core/storage.js';

import { isMobile } from './platform/detect.js';
import { vibrate } from './platform/haptic.js';

import { audioManager } from './audio/audio-manager.js';
import { MusicPlayer } from './audio/music-player.js';

import { Player } from './entities/player.js';
import { Bullet } from './entities/bullet.js';
import { Asteroid } from './entities/asteroid.js';
import { Particle } from './entities/particle.js';
import { LineDebris } from './entities/line-debris.js';
import { Star } from './entities/star.js';

import { handleCollisions } from './world/collisions.js';
import { createAttractor } from './world/attractor.js';
import { createSpawner } from './world/spawner.js';

import { setupTitleScreen, hideTitleScreen } from './ui/title-screen.js';
import { showMessage, hideMessage } from './ui/messages.js';
import { setupPauseMenu } from './ui/pause.js';
import { setupMobileControls } from './ui/mobile-controls.js';

// ── DOM + canvas ───────────────────────────────────────────────────────

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const mobilePauseBtn = document.getElementById('mobile-pause-button');

function syncCanvasSize() {
    const w = window.innerWidth, h = window.innerHeight;
    canvas.width = w;
    canvas.height = h;
    Viewport.resize(w, h);
}
syncCanvasSize();

// ── Global game state ──────────────────────────────────────────────────

const game = {
    score: 0,
    highScore: loadHighScore(),
    state: 'TITLE_SCREEN',
    lastState: 'TITLE_SCREEN',
    player: null,
    pools: null,
    spawner: null,
    screenShakeDuration: 0,
    screenShakeMagnitude: 0,
};

const input = {
    up: false, down: false, space: false, rotation: 0,
    // For mobile-controls touch routing — exposes game state.
    gameState: () => game.state,
};

// Music player owns its own Audio instances; picks a random starting
// track each session and shuffles the rest of the playlist.
const music = new MusicPlayer();
const MOBILE = isMobile();

// Title-screen attractor — starfield + drifting asteroids running on
// the canvas while the title overlay is visible. Built lazily after
// canvas + viewport are sized.
const attractor = createAttractor();

// ── Pools ──────────────────────────────────────────────────────────────

function buildPools() {
    game.pools = {
        bullets:    new PoolManager(Bullet, 20),
        particles:  new PoolManager(Particle, 400),
        lineDebris: new PoolManager(LineDebris, 150),
        asteroids:  new PoolManager(Asteroid, 20),
        stars:      new PoolManager(Star, STAR_COUNT + 100),
    };
}

// ── Helpers ────────────────────────────────────────────────────────────

function triggerScreenShake(duration, magnitude) {
    game.screenShakeDuration = duration;
    game.screenShakeMagnitude = magnitude;
}

function haptic(ms) { vibrate(ms); }

function spawnStar() {
    const stars = game.pools.stars;
    let x, y, tooClose, attempts = 0;
    do {
        tooClose = false;
        x = random(0, Viewport.width);
        y = random(0, Viewport.height);
        for (const o of stars.activeObjects) {
            if (Math.hypot(x - o.x, y - o.y) < MIN_STAR_DIST) {
                tooClose = true;
                break;
            }
        }
        attempts++;
        if (attempts > 100) break;
    } while (tooClose);
    if (!tooClose) stars.get(x, y, false);
}

function checkHighScore() {
    if (game.score > game.highScore) {
        game.highScore = game.score;
        saveHighScore(game.highScore);
    }
}

// ── Game lifecycle ─────────────────────────────────────────────────────

function init() {
    game.score = 0;
    buildPools();
    game.player = new Player();
    game.spawner = createSpawner({ pools: game.pools });
    for (let i = 0; i < STAR_COUNT; i++) spawnStar();
    hideMessage();
    game.spawner.seed();
    game.state = 'PLAYING';
}

function playerDie() {
    game.player.active = false;
    game.state = 'GAME_OVER';
    haptic(100);
    audioManager.play('playerExplosion');
    game.pools.particles.get(game.player.x, game.player.y, 'playerExplosion');
    triggerScreenShake(20, 15);
    checkHighScore();
    const restartPrompt = MOBILE ? 'Tap Screen to Restart' : 'Press Enter to Restart';
    showMessage(
        'GAME OVER',
        `YOUR SCORE: ${game.score}\nHIGH SCORE: ${game.highScore}\n\n${restartPrompt}`,
    );
    bus.emit('game:over', { score: game.score, highScore: game.highScore });
}

// ── Pause / resume ─────────────────────────────────────────────────────

let pauseUI = null;

function togglePause() {
    if (game.state === 'PLAYING') {
        game.lastState = game.state;
        game.state = 'PAUSED';
        pauseUI.show();
        mobilePauseBtn.innerHTML = '▶';
    } else if (game.state === 'PAUSED') {
        game.state = game.lastState === 'PAUSED' ? 'PLAYING' : game.lastState;
        pauseUI.hide();
        mobilePauseBtn.innerHTML = '||';
    }
}

// ── Orientation ────────────────────────────────────────────────────────

function checkOrientation() {
    const overlay = document.getElementById('orientation-overlay');
    if (MOBILE && window.innerHeight > window.innerWidth) {
        if (game.state !== 'ORIENTATION_LOCK') {
            game.lastState = game.state;
            game.state = 'ORIENTATION_LOCK';
        }
        overlay.style.display = 'flex';
    } else {
        overlay.style.display = 'none';
        if (game.state === 'ORIENTATION_LOCK') game.state = game.lastState;
    }
}

// ── Keyboard input (desktop) ──────────────────────────────────────────

document.addEventListener('keydown', e => {
    if (e.code === 'Enter' && game.state === 'GAME_OVER') {
        init();
        return;
    }
    if (e.code === 'Escape') {
        togglePause();
        return;
    }
    if (game.state !== 'PLAYING' && game.state !== 'WAVE_TRANSITION') return;
    switch (e.code) {
        case 'ArrowUp':    input.up = true; break;
        case 'ArrowDown':  input.down = true; break;
        case 'ArrowLeft':  input.rotation = -1; break;
        case 'ArrowRight': input.rotation = 1; break;
        case 'Space':      input.space = true; break;
    }
});

document.addEventListener('keyup', e => {
    switch (e.code) {
        case 'ArrowUp':    input.up = false; break;
        case 'ArrowDown':  input.down = false; break;
        case 'ArrowLeft':  if (input.rotation < 0) input.rotation = 0; break;
        case 'ArrowRight': if (input.rotation > 0) input.rotation = 0; break;
        case 'Space':      input.space = false; break;
    }
});

// Desktop click / mobile tap → restart on game over.
window.addEventListener('click', () => {
    if (game.state === 'GAME_OVER') init();
});
window.addEventListener('touchstart', () => {
    if (game.state === 'GAME_OVER') init();
});

// ── Mobile dual-stick controls (only on mobile) ───────────────────────

let mobileCtrl = null;
if (MOBILE) {
    mobileCtrl = setupMobileControls({
        canvas,
        input,
        onPause: togglePause,
    });
}

// ── Main loop ──────────────────────────────────────────────────────────

function update() {
    const mobileInput = mobileCtrl ? mobileCtrl.readInputs() : null;
    game.player.update(ctx, {
        input,
        pools: game.pools,
        audio: audioManager,
        haptic,
        mobile: MOBILE,
        mobileInput,
    });
    game.pools.bullets.updateActive(game.pools);
    game.pools.particles.updateActive(game.pools.particles);
    game.pools.lineDebris.updateActive(game.pools.lineDebris);
    game.pools.asteroids.updateActive();
    game.pools.stars.activeObjects.forEach(s =>
        s.update(game.player.vel, game.player, game.pools.stars),
    );

    const { playerDied } = handleCollisions(
        game, game.pools, audioManager, haptic, triggerScreenShake, spawnStar,
    );
    if (playerDied) playerDie();

    // Continuous spawn — fixed target population; hard cap protects
    // per-frame draw cost. No difficulty scaling.
    game.spawner.tick();

    scoreEl.textContent = game.score;
}

function draw() {
    // Motion-blur veil — defining piece of the look. Runs every frame
    // including the title screen so the attractor entities leave the
    // same colour-trails the gameplay does.
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(0, 0, Viewport.width, Viewport.height);

    if (game.state === 'TITLE_SCREEN') {
        attractor.draw(ctx);
    } else {
        game.pools.stars.drawActive(ctx);
        game.pools.lineDebris.drawActive(ctx);
        game.pools.particles.drawActive(ctx);
        game.pools.asteroids.drawActive(ctx);
        game.pools.bullets.drawActive(ctx);
        game.player.draw(ctx);
    }
}

function gameLoop() {
    frameClock.advance();

    if (game.state === 'TITLE_SCREEN') {
        attractor.tick();
    } else if (game.state === 'PLAYING') {
        update();
    } else if (game.state === 'GAME_OVER' || game.state === 'PAUSED') {
        // Keep particles/debris alive during freeze states so the
        // playerExplosion ring still expands behind the GAME OVER text.
        game.pools.particles.updateActive(game.pools.particles);
        game.pools.lineDebris.updateActive(game.pools.lineDebris);
    }

    ctx.save();
    if (game.screenShakeDuration > 0) {
        const dx = (Math.random() - 0.5) * game.screenShakeMagnitude;
        const dy = (Math.random() - 0.5) * game.screenShakeMagnitude;
        ctx.translate(dx, dy);
        game.screenShakeDuration--;
        if (game.screenShakeDuration <= 0) game.screenShakeMagnitude = 0;
    }
    draw();
    ctx.restore();

    // Mobile sticks render in canvas-space AFTER the shake transform is
    // restored — so they don't shake with the game world.
    if (mobileCtrl && game.state !== 'TITLE_SCREEN') mobileCtrl.draw(ctx);

    if (game.state === 'GAME_OVER') {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(0, 0, Viewport.width, Viewport.height);
    }

    requestAnimationFrame(gameLoop);
}

// ── Title-screen "any key" start ──────────────────────────────────────

function startGame() {
    if (game.state !== 'TITLE_SCREEN') return;
    hideTitleScreen();
    // Gameplay starts immediately. Audio init (AudioContext + sfxr
    // synthesis) runs in parallel — if it succeeds the game gains SFX,
    // if it fails the game still plays. Music play() must also live
    // inside this gesture stack, but its rejection is harmless.
    audioManager.init().catch(e => console.warn('[audio] init failed:', e));
    music.isPlaying = true;
    music.play().catch(() => { /* autoplay blocked */ });
    init();
    window.removeEventListener('keydown', startGame);
    window.removeEventListener('click', startGame);
    window.removeEventListener('touchstart', startGame);
}

// ── Boot ──────────────────────────────────────────────────────────────

function boot() {
    const settings = loadSettings();
    setupTitleScreen(game.highScore);
    checkOrientation();

    window.addEventListener('resize', () => {
        syncCanvasSize();
        checkOrientation();
        if (mobileCtrl) mobileCtrl.resize();
    });
    window.addEventListener('orientationchange', checkOrientation);

    pauseUI = setupPauseMenu({
        audio: audioManager,
        music,
        settings,
        mobile: MOBILE,
        onResume: () => togglePause(),
        onRestart: () => {
            pauseUI.hide();
            mobilePauseBtn.innerHTML = '||';
            init();
            game.state = 'PLAYING';
        },
    });

    window.addEventListener('keydown', startGame);
    window.addEventListener('click', startGame);
    window.addEventListener('touchstart', startGame);

    gameLoop();
}

boot();
