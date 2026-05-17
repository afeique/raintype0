// Mobile aim assist.
//
// Two helpers:
//   findNearestAsteroid(fromX, fromY, pools, maxDist)
//     → { x, y, dist, target } | null
//   snapAim(angle, fromX, fromY, pools, opts)
//     → angle (snapped to nearest asteroid in cone, or original)
//
// Aim assist makes mobile fun by letting the player focus on dodging.
// Shots auto-correct toward the nearest in-cone asteroid; if there's
// no valid target, the bullet flies straight along the input angle.

export function findNearestAsteroid(fromX, fromY, pools, maxDist = Infinity) {
    let best = null;
    let bestD2 = maxDist * maxDist;
    const objs = pools.asteroids.activeObjects;
    for (let i = 0; i < objs.length; i++) {
        const o = objs[i];
        const dx = o.x - fromX;
        const dy = o.y - fromY;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) {
            bestD2 = d2;
            best = o;
        }
    }
    if (!best) return null;
    return { x: best.x, y: best.y, dist: Math.sqrt(bestD2), target: best };
}

// Snap `angle` toward the nearest asteroid whose bearing from
// (fromX, fromY) lies within ±halfConeRad of `angle`, distance ≤ maxDist.
// Returns the snapped angle, or `angle` unchanged if nothing qualifies.
export function snapAim(angle, fromX, fromY, pools, opts = {}) {
    const halfCone = opts.halfCone ?? (Math.PI / 6); // ±30°
    const maxDist  = opts.maxDist  ?? 700;
    let best = null;
    let bestD2 = maxDist * maxDist;
    const objs = pools.asteroids.activeObjects;
    const cosCone = Math.cos(halfCone);
    const fcosA = Math.cos(angle), fsinA = Math.sin(angle);
    for (let i = 0; i < objs.length; i++) {
        const o = objs[i];
        const dx = o.x - fromX;
        const dy = o.y - fromY;
        const d2 = dx * dx + dy * dy;
        if (d2 >= bestD2 || d2 < 1) continue;
        const d = Math.sqrt(d2);
        // Cone test via dot product — cheaper than atan2 + diff.
        const dot = (dx * fcosA + dy * fsinA) / d;
        if (dot < cosCone) continue;
        bestD2 = d2;
        best = o;
    }
    if (!best) return angle;
    return Math.atan2(best.y - fromY, best.x - fromX);
}
