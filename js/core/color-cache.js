// Quantised CSS color caches. Cuts per-frame template-literal churn
// for hot paths (bullets, particles, asteroid wireframes).

const rgbaTables = new Map();

export function rgba(r, g, b, a) {
    const key = (r << 16) | (g << 8) | b;
    let table = rgbaTables.get(key);
    if (!table) {
        table = new Array(101);
        for (let i = 0; i <= 100; i++) {
            table[i] = `rgba(${r},${g},${b},${(i / 100).toFixed(2)})`;
        }
        rgbaTables.set(key, table);
    }
    const idx = a <= 0 ? 0 : a >= 1 ? 100 : (a * 100) | 0;
    return table[idx];
}

const hslCache = new Map();

export function hsl(h, s, l) {
    const hi = ((h | 0) % 361 + 361) % 361;
    const si = s <= 0 ? 0 : s >= 100 ? 100 : (s | 0);
    const li = l <= 0 ? 0 : l >= 100 ? 100 : (l | 0);
    const key = `${hi}|${si}|${li}`;
    let cached = hslCache.get(key);
    if (cached === undefined) {
        cached = `hsl(${hi}, ${si}%, ${li}%)`;
        hslCache.set(key, cached);
    }
    return cached;
}
