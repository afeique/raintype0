// Safe wrappers around localStorage. localStorage can be unavailable
// (private mode, disabled by user) — every helper try/catches so the
// game never crashes on a storage error.

const SETTINGS_KEY = 'raintype0Settings';
const HIGH_SCORE_KEY = 'raintype0HighScore';
const CONTROL_LAYOUT_KEY = 'raintype0ControlLayout';

export function loadSettings() {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

export function saveSettings(patch) {
    try {
        const merged = { ...loadSettings(), ...patch };
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
        return merged;
    } catch {
        return null;
    }
}

export function loadHighScore() {
    try {
        return parseInt(localStorage.getItem(HIGH_SCORE_KEY), 10) || 0;
    } catch {
        return 0;
    }
}

export function saveHighScore(score) {
    try {
        localStorage.setItem(HIGH_SCORE_KEY, String(score));
    } catch { /* noop */ }
}

export function loadControlLayout() {
    try {
        const raw = localStorage.getItem(CONTROL_LAYOUT_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

export function saveControlLayout(layout) {
    try {
        localStorage.setItem(CONTROL_LAYOUT_KEY, JSON.stringify(layout));
    } catch { /* noop */ }
}
