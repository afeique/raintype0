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

import { setupTitleScreen, hideTitleScreen, playTitleLaunchAnimation } from './ui/title-screen.js';
import { showMessage, hideMessage } from './ui/messages.js';
import { setupPauseMenu } from './ui/pause.js';
import { setupMobileControls } from './ui/mobile-controls.js';

import { createRenderer } from './render/select.js';
import { createUIOverlay } from './render/ui-overlay.js';
import { FPSOverlay } from './render/fps-overlay.js';
import { BloomDebugOverlay } from './render/bloom-debug-overlay.js';

// ── DOM + canvas ───────────────────────────────────────────────────────

const canvas = document.getElementById('gameCanvas');
const scoreEl = document.getElementById('score');
const mobilePauseBtn = document.getElementById('mobile-pause-button');

let renderer = null;
let ui = null;
let fpsOverlay = null;
let bloomDebug = null;

function syncCanvasSize() {
    const w = window.innerWidth, h = window.innerHeight;
    Viewport.resize(w, h);
    if (renderer) renderer.resize(w, h);
    else { canvas.width = w; canvas.height = h; }
    if (ui) ui.resize(w, h);
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
    gameState: () => game.state,
};

const music = new MusicPlayer();
const MOBILE = isMobile();

const attractor = createAttractor();

function buildPools() {
    game.pools = {
        bullets:    new PoolManager(Bullet, 20),
        particles:  new PoolManager(Particle, 400),
        lineDebris: new PoolManager(LineDebris, 150),
        asteroids:  new PoolManager(Asteroid, 20),
        stars:      new PoolManager(Star, STAR_COUNT + 100),
    };
}

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
    if (e.shiftKey && e.code === 'KeyF') {
        if (fpsOverlay) fpsOverlay.toggleVisible();
        return;
    }
    if (e.shiftKey && e.code === 'KeyB') {
        if (bloomDebug) bloomDebug.toggleVisible();
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
    game.player.update(null, {
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

    game.spawner.tick();
    scoreEl.textContent = game.score;
}

function draw() {
    if (game.state === 'TITLE_SCREEN') {
        attractor.draw(renderer);
    } else {
        game.pools.stars.drawActive(renderer);
        game.pools.lineDebris.drawActive(renderer);
        game.pools.particles.drawActive(renderer);
        game.pools.asteroids.drawActive(renderer);
        game.pools.bullets.drawActive(renderer);
        game.player.draw(renderer);
    }
}

function gameLoop() {
    frameClock.advance();

    if (game.state === 'TITLE_SCREEN') {
        attractor.tick();
    } else if (game.state === 'PLAYING') {
        update();
    } else if (game.state === 'GAME_OVER' || game.state === 'PAUSED') {
        game.pools.particles.updateActive(game.pools.particles);
        game.pools.lineDebris.updateActive(game.pools.lineDebris);
    }

    let shakeX = 0, shakeY = 0;
    if (game.screenShakeDuration > 0) {
        shakeX = (Math.random() - 0.5) * game.screenShakeMagnitude;
        shakeY = (Math.random() - 0.5) * game.screenShakeMagnitude;
        game.screenShakeDuration--;
        if (game.screenShakeDuration <= 0) game.screenShakeMagnitude = 0;
    }

    // Live bloom tunables from the SHIFT+B debug overlay (no-op when
    // the panel is closed or the renderer doesn't have bloom fields).
    if (bloomDebug && renderer.bloomThreshold !== undefined) {
        const p = bloomDebug.getParams(renderer);
        if (p) {
            renderer.bloomIntensity = p.intensity;
            renderer.bloomThreshold = p.threshold;
            renderer.bloomKnee      = p.knee;
        }
    }

    renderer.beginFrame(shakeX, shakeY);
    renderer.applyVeil(0, 0, 0, 0.3);
    draw();

    if (game.state === 'GAME_OVER') {
        // Darkening wash over the whole screen.
        renderer.applyVeil(0, 0, 0, 0.5);
    }
    renderer.endFrame();

    // FPS overlay tick + per-batch instance counts (visible only when
    // toggled on via SHIFT+F).
    if (fpsOverlay) {
        fpsOverlay.tick(performance.now());
        if (game.pools) {
            fpsOverlay.setInstanceCount('stars',      game.pools.stars.activeObjects.length);
            fpsOverlay.setInstanceCount('particles',  game.pools.particles.activeObjects.length);
            fpsOverlay.setInstanceCount('bullets',    game.pools.bullets.activeObjects.length);
            fpsOverlay.setInstanceCount('lineDebris', game.pools.lineDebris.activeObjects.length);
            fpsOverlay.setInstanceCount('asteroids',  game.pools.asteroids.activeObjects.length);
        }
    }

    // UI overlay (mobile sticks + FPS) — always rendered on canvas2d.
    ui.beginFrame();
    if (mobileCtrl && game.state !== 'TITLE_SCREEN') mobileCtrl.draw(ui.ctx);
    ui.endFrame(renderer.flag || 'canvas2d');

    requestAnimationFrame(gameLoop);
}

// ── Title-screen "any key" start ──────────────────────────────────────

function startGame() {
    if (game.state !== 'TITLE_SCREEN') return;
    // De-register first so the launch animation doesn't re-fire on
    // every keystroke / extra click during its ~1 s window.
    window.removeEventListener('keydown', startGame);
    window.removeEventListener('click', startGame);
    window.removeEventListener('touchstart', startGame);

    audioManager.init().catch(e => console.warn('[audio] init failed:', e));
    music.isPlaying = true;
    music.play().catch(() => { /* autoplay blocked */ });

    // Each letter of RAINTYPE0 flies outward + spins + fades while
    // the title overlay dissolves. init() fires after the animation
    // completes so the gameplay scene appears as the explosion
    // clears, rather than under it. The attractor keeps running
    // behind the launching title so the world feels alive.
    playTitleLaunchAnimation(() => init());
}

// ── Boot ──────────────────────────────────────────────────────────────

async function boot() {
    renderer = await createRenderer(canvas);
    ui = createUIOverlay(canvas);
    syncCanvasSize();

    // Diagnostic overlays — invisible until SHIFT+F / SHIFT+B.
    fpsOverlay = new FPSOverlay();
    fpsOverlay.setRenderMode(renderer.flag || 'canvas2d');
    bloomDebug = new BloomDebugOverlay();
    if (renderer.bloomThreshold !== undefined) {
        bloomDebug.attach(renderer, `${renderer.flag} bloom`);
    }

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
