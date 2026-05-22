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
import { MoneyPiece } from './entities/money-piece.js';

import { handleCollisions } from './world/collisions.js';
import { createAttractor } from './world/attractor.js';
import { createSpawner } from './world/spawner.js';
import { createNebula } from './world/nebula.js';

import { setupTitleScreen, hideTitleScreen, playTitleLaunchAnimation } from './ui/title-screen.js';
import { showMessage, hideMessage } from './ui/messages.js';
import { setupPauseMenu } from './ui/pause.js';
import { setupMobileControls } from './ui/mobile-controls.js';
import { createFloaters } from './ui/floaters.js';

import { COMBO_WINDOW_MS, COMBO_MAX } from './core/utils.js';

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
let nebula = null;

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
    // Kill-combo + impact freeze (set by collisions, consumed by the loop).
    combo: 0,
    comboTimerMs: 0,
    hitstopMs: 0,
};

const input = {
    up: false, down: false, space: false, rotation: 0,
    gameState: () => game.state,
};

const music = new MusicPlayer();
const MOBILE = isMobile();

const attractor = createAttractor();

// Rising score / combo text on the HUD overlay, fed by gameplay events.
const floaters = createFloaters();
bus.on('score:popup', ({ x, y, amount, mult }) => {
    const text = mult > 1 ? `+${amount}  x${mult}` : `+${amount}`;
    floaters.spawn(x, y, text, comboColor(mult), mult >= 3);
});
bus.on('money:popup', ({ x, y, amount }) => {
    floaters.spawn(x, y, `+${amount}`, '#ffd700', false);
});

// Combo multiplier → colour ramp: white → gold → orange → hot red.
function comboColor(mult) {
    if (mult >= 7) return '#ff3030';
    if (mult >= 5) return '#ff8c00';
    if (mult >= 3) return '#ffd700';
    if (mult >= 2) return '#aef0ff';
    return '#ffffff';
}

function buildPools() {
    game.pools = {
        bullets:    new PoolManager(Bullet, 20),
        particles:  new PoolManager(Particle, 400),
        lineDebris: new PoolManager(LineDebris, 150),
        asteroids:  new PoolManager(Asteroid, 20),
        stars:      new PoolManager(Star, STAR_COUNT),
        money:      new PoolManager(MoneyPiece, 128),
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
    if (!tooClose) stars.get(x, y);
}

function checkHighScore() {
    if (game.score > game.highScore) {
        game.highScore = game.score;
        saveHighScore(game.highScore);
    }
}

function init() {
    game.score = 0;
    game.combo = 0;
    game.comboTimerMs = 0;
    game.hitstopMs = 0;
    floaters.clear();
    buildPools();
    if (location.search.includes('debug')) window.__game = game; // TEMP debug hook
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
    // Background stars: parallax only (no player arg — they're inert).
    game.pools.stars.activeObjects.forEach(s => s.update(game.player.vel));
    // Money pieces: parallax + magnet toward the ship.
    game.pools.money.activeObjects.forEach(m => m.update(game.player.vel, game.player));

    const { playerDied } = handleCollisions(
        game, game.pools, audioManager, haptic, triggerScreenShake,
    );
    if (playerDied) playerDie();

    game.spawner.tick();
    scoreEl.textContent = game.score;
}

function draw() {
    // Nebula clouds sit behind everything (drawn first, after the veil),
    // in both the title attractor and gameplay.
    if (nebula) nebula.draw(renderer);
    if (game.state === 'TITLE_SCREEN') {
        attractor.draw(renderer);
    } else {
        game.pools.stars.drawActive(renderer);
        game.pools.lineDebris.drawActive(renderer);
        game.pools.particles.drawActive(renderer);
        game.pools.asteroids.drawActive(renderer);
        game.pools.money.drawActive(renderer);
        game.pools.bullets.drawActive(renderer);
        game.player.draw(renderer);
    }
}

// ── Fixed-timestep loop ────────────────────────────────────────────────
// Logic runs in fixed 1/60 s steps so the simulation speed is identical
// on a 60, 120 or 144 Hz display (previously entities integrated once
// per RAF, so high-refresh monitors ran the game 2–2.4× too fast).
// Rendering happens once per RAF; the accumulator catches logic up.

const STEP_MS = 1000 / 60;
const MAX_STEPS = 5;            // spiral-of-death guard (tab refocus, hitches)
let _accumulator = 0;
let _lastTime = performance.now();

// One fixed logic step. All per-step game state advances here.
function stepLogic() {
    if (game.state === 'TITLE_SCREEN') {
        attractor.tick();
        if (nebula) nebula.tick();
    } else if (game.state === 'PLAYING') {
        update();
        if (nebula) nebula.tick(game.player.vel.x, game.player.vel.y);
        // Combo decays when no destroy renews the window.
        if (game.comboTimerMs > 0) {
            game.comboTimerMs -= STEP_MS;
            if (game.comboTimerMs <= 0) game.combo = 0;
        }
    } else if (game.state === 'GAME_OVER' || game.state === 'PAUSED') {
        game.pools.particles.updateActive(game.pools.particles);
        game.pools.lineDebris.updateActive(game.pools.lineDebris);
        if (nebula) nebula.tick();
    }

    // Screen-shake countdown is now per logic step (time-consistent).
    if (game.screenShakeDuration > 0) {
        game.screenShakeDuration--;
        if (game.screenShakeDuration <= 0) game.screenShakeMagnitude = 0;
    }

    floaters.update();
}

function gameLoop() {
    const now = performance.now();
    let frameDt = now - _lastTime;
    _lastTime = now;
    if (frameDt > 250) frameDt = 250; // clamp huge gaps (background tab)

    frameClock.advance(); // wall-clock for hue cycling + spawn cadence

    if (game.hitstopMs > 0) {
        // Impact freeze — hold the whole sim, keep rendering (the shake
        // jitter below still plays, which sells the hit).
        game.hitstopMs -= frameDt;
    } else {
        _accumulator += frameDt;
        let steps = 0;
        while (_accumulator >= STEP_MS && steps < MAX_STEPS) {
            stepLogic();
            _accumulator -= STEP_MS;
            steps++;
        }
        if (steps === MAX_STEPS) _accumulator = 0; // drop backlog
    }

    // Screen-shake offset is sampled at render time from the live
    // magnitude (the countdown lives in stepLogic).
    let shakeX = 0, shakeY = 0;
    if (game.screenShakeMagnitude > 0) {
        shakeX = (Math.random() - 0.5) * game.screenShakeMagnitude;
        shakeY = (Math.random() - 0.5) * game.screenShakeMagnitude;
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
            fpsOverlay.setInstanceCount('money',      game.pools.money.activeObjects.length);
            fpsOverlay.setInstanceCount('particles',  game.pools.particles.activeObjects.length);
            fpsOverlay.setInstanceCount('bullets',    game.pools.bullets.activeObjects.length);
            fpsOverlay.setInstanceCount('lineDebris', game.pools.lineDebris.activeObjects.length);
            fpsOverlay.setInstanceCount('asteroids',  game.pools.asteroids.activeObjects.length);
        }
    }

    // UI overlay (mobile sticks + combo + score floaters + FPS) — canvas2d.
    ui.beginFrame();
    if (mobileCtrl && game.state !== 'TITLE_SCREEN') mobileCtrl.draw(ui.ctx);
    if (game.state === 'PLAYING' || game.state === 'GAME_OVER') {
        drawComboHud(ui.ctx);
        floaters.draw(ui.ctx);
    }
    ui.endFrame(renderer.flag || 'canvas2d');

    requestAnimationFrame(gameLoop);
}

// Combo multiplier indicator, just under the score (top-left). Pulses
// and brightens as the combo climbs; hidden below x2.
function drawComboHud(ctx) {
    const mult = Math.min(game.combo, COMBO_MAX);
    if (mult < 2) return;
    const frac = game.comboTimerMs / COMBO_WINDOW_MS; // 1 → 0 as it lapses
    const pulse = 1 + 0.08 * Math.sin(performance.now() * 0.012);
    ctx.save();
    ctx.translate(24, 64);
    ctx.scale(pulse, pulse);
    ctx.font = '20px "Press Start 2P", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000';
    ctx.fillText(`x${mult}`, 2, 2);
    ctx.fillStyle = comboColor(mult);
    ctx.fillText(`x${mult}`, 0, 0);
    // Decay bar — shrinks as the combo window lapses.
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(0, 16, 64, 3);
    ctx.fillStyle = comboColor(mult);
    ctx.fillRect(0, 16, 64 * Math.max(0, frac), 3);
    ctx.restore();
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

    // Nebula clouds — baked once, textures uploaded to the active
    // renderer. Created after the renderer so registerTexture can run.
    // Disabled for now for a cleaner background; re-enable by uncommenting.
    // nebula = createNebula();
    // nebula.register(renderer);

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
