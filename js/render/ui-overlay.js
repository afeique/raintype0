// UI overlay — a second canvas always rendered via Canvas2D, regardless
// of which game renderer is selected. Holds the mobile analog stick and
// the FPS counter. Sits on top of the game canvas in the DOM. Keeping
// these on canvas2d means the renderer interface doesn't have to grow
// a text/gradient API just for HUD.

export function createUIOverlay(gameCanvas) {
    const ui = document.createElement('canvas');
    ui.id = 'uiCanvas';
    ui.style.position = 'absolute';
    ui.style.top = '0';
    ui.style.left = '0';
    ui.style.pointerEvents = 'none';
    ui.style.zIndex = '5';
    // Override the global `canvas { background-color: #000 }` rule —
    // the overlay must be transparent or it would hide the game canvas.
    ui.style.background = 'transparent';
    // Insert directly after the game canvas in the DOM.
    gameCanvas.parentNode.insertBefore(ui, gameCanvas.nextSibling);

    const ctx = ui.getContext('2d');
    let fpsAvg = 0;
    let lastFrameStart = performance.now();
    let frameSamples = 0;

    function resize(w, h) {
        ui.width = w;
        ui.height = h;
    }
    resize(gameCanvas.width, gameCanvas.height);

    function beginFrame() {
        ctx.clearRect(0, 0, ui.width, ui.height);
    }

    function endFrame(rendererName) {
        const now = performance.now();
        const dt = now - lastFrameStart;
        lastFrameStart = now;
        // Simple exponential moving average so the FPS reading doesn't
        // flicker. 1/16 weight = ~16-frame window.
        const fps = 1000 / Math.max(1e-3, dt);
        if (frameSamples === 0) fpsAvg = fps;
        else fpsAvg += (fps - fpsAvg) / 16;
        frameSamples++;

        // Bottom-right FPS readout.
        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.fillRect(ui.width - 132, ui.height - 30, 124, 22);
        ctx.fillStyle = '#0ff';
        ctx.font = '10px "Press Start 2P", monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${fpsAvg.toFixed(0)} FPS  ${rendererName}`, ui.width - 126, ui.height - 19);
        ctx.restore();
    }

    return { ctx, canvas: ui, resize, beginFrame, endFrame };
}
