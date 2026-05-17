// Mobile / touch / portrait detection. Supports a ?mobile=0|1 URL
// override so we can force-test the mobile path on a desktop browser.

export function isTouchDevice() {
    if (typeof window === 'undefined') return false;
    if ('ontouchstart' in window) return true;
    if (typeof navigator !== 'undefined' && (navigator.maxTouchPoints || 0) > 0) return true;
    return false;
}

export function isPortrait() {
    if (typeof window === 'undefined') return false;
    return window.innerHeight > window.innerWidth;
}

let _urlOverride = null;
function _readUrlOverride() {
    if (typeof window === 'undefined' || !window.location) return null;
    try {
        const params = new URLSearchParams(window.location.search || '');
        if (!params.has('mobile')) return null;
        const v = (params.get('mobile') || '').toLowerCase();
        if (v === '1' || v === 'true' || v === 'on' || v === 'yes') return true;
        if (v === '0' || v === 'false' || v === 'off' || v === 'no') return false;
    } catch {
        return null;
    }
    return null;
}
_urlOverride = _readUrlOverride();

export function isMobile() {
    if (_urlOverride !== null) return _urlOverride;
    if (!isTouchDevice()) return false;
    if (typeof window === 'undefined') return false;
    return Math.min(window.innerWidth || 0, window.innerHeight || 0) < 900;
}
