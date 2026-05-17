// One Date.now() per frame. Game code reads frameClock.now instead of
// calling Date.now() repeatedly. `tick` increments each frame for cheap
// frame-parity throttles.

export const frameClock = {
    now: Date.now(),
    tick: 0,
    advance() {
        this.now = Date.now();
        this.tick = (this.tick + 1) | 0;
    },
};
