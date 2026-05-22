// Mobile control layer — single canvas analog stick (drag-to-move /
// Sky Force / Galaxy Attack model). Auto-aim and auto-fire are handled
// by the player; the stick just reports its deflection vector.
//
// One stick on the left — the player only needs to think about dodging.

import { AnalogStick } from './analog-stick.js';
import { vibrate } from '../platform/haptic.js';

export function setupMobileControls({ canvas, input, onPause }) {
    const moveStick = new AnalogStick({ side: 'left', label: 'MOVE' });
    const mobilePauseBtn = document.getElementById('mobile-pause-button');

    // Double-tap the move stick to dash. Tracks the time of the last
    // stick-claiming touchstart; a second within DOUBLE_TAP_MS flags a
    // dash, consumed by readInputs(). Dash direction is resolved by the
    // player (stick push → momentum → heading).
    const DOUBLE_TAP_MS = 280;
    let lastStickTapAt = 0;
    let dashRequested = false;

    function resize() {
        moveStick.resize(canvas.width, canvas.height);
    }
    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', resize);

    function toCanvas(touch) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: (touch.clientX - rect.left) * (canvas.width / rect.width),
            y: (touch.clientY - rect.top)  * (canvas.height / rect.height),
        };
    }

    canvas.addEventListener('touchstart', e => {
        if (input.gameState && input.gameState() === 'TITLE_SCREEN') return;
        for (const t of e.changedTouches) {
            const { x, y } = toCanvas(t);
            if (moveStick.onTouchStart(t.identifier, x, y)) {
                vibrate(10);
                const now = performance.now();
                if (now - lastStickTapAt < DOUBLE_TAP_MS) { dashRequested = true; vibrate(25); }
                lastStickTapAt = now;
            }
        }
        e.preventDefault();
    }, { passive: false });

    canvas.addEventListener('touchmove', e => {
        for (const t of e.changedTouches) {
            const { x, y } = toCanvas(t);
            moveStick.onTouchMove(t.identifier, x, y);
        }
        e.preventDefault();
    }, { passive: false });

    canvas.addEventListener('touchend', e => {
        for (const t of e.changedTouches) moveStick.onTouchEnd(t.identifier);
        e.preventDefault();
    }, { passive: false });

    canvas.addEventListener('touchcancel', e => {
        for (const t of e.changedTouches) moveStick.onTouchEnd(t.identifier);
    });

    mobilePauseBtn.addEventListener('click', onPause);

    return {
        moveStick,
        draw(ctx) { moveStick.draw(ctx); },
        readInputs() {
            const dash = dashRequested;
            dashRequested = false; // consume the edge
            return { move: moveStick.getInput(), dash };
        },
        resize,
    };
}
