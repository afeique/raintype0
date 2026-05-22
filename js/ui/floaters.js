// Rising score / combo text floaters, drawn on the canvas2d UI overlay
// (the game renderers have no text primitive — text stays on the HUD
// canvas). Spawned from gameplay events (bus 'score:popup'), they drift
// upward and fade. Screen-space; coords match world space since there's
// no camera (screen shake is small enough to ignore here).

export function createFloaters() {
    const items = [];

    // text at (x, y). color is a CSS string. `big` scales the font + rise.
    function spawn(x, y, text, color = '#ffffff', big = false) {
        items.push({
            x, y,
            vy: big ? -0.9 : -0.6,
            life: 1,
            text,
            color,
            size: big ? 18 : 12,
        });
    }

    // Advance one fixed logic step (called from the 60Hz step).
    function update() {
        for (let i = items.length - 1; i >= 0; i--) {
            const f = items[i];
            f.y += f.vy;
            f.life -= 0.018;
            if (f.life <= 0) items.splice(i, 1);
        }
    }

    function draw(ctx) {
        if (items.length === 0) return;
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const f of items) {
            const a = f.life > 1 ? 1 : f.life;
            ctx.globalAlpha = a;
            ctx.font = `${f.size}px "Press Start 2P", monospace`;
            // Black drop-shadow for legibility over bright bloom.
            ctx.fillStyle = '#000';
            ctx.fillText(f.text, f.x + 1.5, f.y + 1.5);
            ctx.fillStyle = f.color;
            ctx.fillText(f.text, f.x, f.y);
        }
        ctx.restore();
    }

    function clear() { items.length = 0; }

    return { spawn, update, draw, clear };
}
