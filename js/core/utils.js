// Shared constants and pure helpers.
// Constants preserve monosrc's exact tuning — do not change without a
// design reason. They are the load-bearing reason the game feels the way
// it does.

export const SHIP_SIZE = 30;
export const SHIP_THRUST = 0.15;
export const SHIP_FRICTION = 0.985;
export const MAX_V = 6;
export const TURN_SPEED = 0.06;
export const BULLET_SPEED = 8;

export const INITIAL_AST_COUNT = 3;
export const AST_SPEED = 1.2;
export const MIN_AST_RAD = 15;
export const SAFE_ZONE = 250;

export const STAR_COUNT = 150;
export const MIN_STAR_DIST = 30;

// Background stars are purely decorative: they twinkle and parallax-drift,
// but are NOT attracted to the ship and cannot be collected. (Before the
// split they shared a magnet with the collectibles — that conflation is
// gone; the only attracted/collectible thing is a MoneyPiece.) STAR_FRIC
// is the shared float-decay friction, also used by money pieces.
export const STAR_FRIC = 0.98;

// Money pieces — the collectible currency that destroyed asteroids drop —
// are the ONLY entities the ship attracts. MONEY_ATTR is a flat per-frame
// pull (px) once a piece is within MONEY_ATTRACT_DIST: firm enough to
// scoop, gentle enough not to teleport. Per-denomination colour + score
// live in entities/money-piece.js.
export const MONEY_ATTRACT_DIST = 350;
export const MONEY_ATTR = 1.1;

export const HIT_SCORE = 10;
export const DESTROY_SCORE = 500;

export const random = (a, b) => Math.random() * (b - a) + a;

// Toroidal wrap. `bounds` carries the live viewport size (see Viewport).
export function wrap(obj, bounds) {
    if (obj.x < 0)            obj.x += bounds.width;
    if (obj.x > bounds.width) obj.x -= bounds.width;
    if (obj.y < 0)             obj.y += bounds.height;
    if (obj.y > bounds.height) obj.y -= bounds.height;
}

export function collision(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.hypot(dx, dy) < a.radius + b.radius;
}

// Live viewport. The shell calls .resize() on window resize; modules read
// .width / .height. Avoids passing dimensions through every constructor.
export const Viewport = {
    width: typeof window !== 'undefined' ? window.innerWidth : 800,
    height: typeof window !== 'undefined' ? window.innerHeight : 600,
    resize(w, h) {
        this.width = w;
        this.height = h;
    },
};

// AABB intersection vs. the live viewport — used by entity draw() guards
// to skip everything off-screen. Cheap (4 compares) and lets the renderer
// avoid uploading + rasterising instances the user will never see.
export function inView(x, y, radius) {
    return x + radius >= 0
        && x - radius <= Viewport.width
        && y + radius >= 0
        && y - radius <= Viewport.height;
}
