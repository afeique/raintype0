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
// Normal stars: per-frame pull multiplied by star depth (z = 0.5..4.5).
// Original mono used 0.05/150 — too weak to actually scoop nearby
// stars before they drifted out of range. 0.12 + 320 px is firm
// enough that a star already inside the radius accelerates toward
// the player faster than it can wrap-drift away, but still well
// below the burst-star numbers so the green orbs feel distinctly
// stronger.
export const STAR_ATTR = 0.12;
export const STAR_ATTRACT_DIST = 320;
export const STAR_FRIC = 0.98;
export const BURST_STAR_ATTRACT_DIST = 350;
export const BURST_STAR_ATTR = 0.3;

export const HIT_SCORE = 10;
export const DESTROY_SCORE = 500;
export const STAR_SCORE = 4;
export const BURST_STAR_SCORE = 7;

export const NORMAL_STAR_COLORS = [
    '#a6b3ff', '#c3a6ff', '#f3a6ff', '#ffa6f8',
    '#ffa6c7', '#ff528e', '#d98cff', '#ff8c00',
];

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
