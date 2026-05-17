// Haptic feedback wrapper. Gated on isMobile() so a desktop with
// vibrate support doesn't shake somebody's laptop. Best-effort —
// iOS Safari has never implemented Vibration API.

import { isMobile } from './detect.js';

export const HAPTIC = {
    LIGHT: 10,
    MEDIUM: 25,
    HEAVY: 50,
    DOUBLE: [15, 30, 15],
    LONG: 100,
};

function _hasVibrate() {
    return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

export function vibrate(pattern) {
    if (!isMobile()) return false;
    if (!_hasVibrate()) return false;
    try {
        navigator.vibrate(pattern);
        return true;
    } catch {
        return false;
    }
}
