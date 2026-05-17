// Object pool with O(1) release via swap-and-pop using a stored
// _poolIndex. Ported from rainsrc HEAD, trimmed to remove the
// per-class particle cap (we don't need a hard cap at our scale).

export class PoolManager {
    constructor(ObjectClass, initialSize) {
        this.ObjectClass = ObjectClass;
        this.pool = [];
        this.activeObjects = [];
        this.initialSize = initialSize;
        this.highWaterMark = 0;
        this.totalAllocations = initialSize;

        for (let i = 0; i < initialSize; i++) this.pool.push(new ObjectClass());
    }

    get(...args) {
        let obj;
        if (this.pool.length > 0) {
            obj = this.pool.pop();
        } else {
            obj = new this.ObjectClass();
            this.totalAllocations++;
        }
        obj.reset(...args);
        obj._poolIndex = this.activeObjects.length;
        this.activeObjects.push(obj);
        if (this.activeObjects.length > this.highWaterMark) {
            this.highWaterMark = this.activeObjects.length;
        }
        return obj;
    }

    release(obj) {
        const index = obj._poolIndex;
        // Fallback for objects released twice or never tracked.
        if (index === undefined || index < 0 || this.activeObjects[index] !== obj) {
            const i = this.activeObjects.indexOf(obj);
            if (i === -1) return;
            const last = this.activeObjects[this.activeObjects.length - 1];
            this.activeObjects[i] = last;
            if (last !== obj) last._poolIndex = i;
            this.activeObjects.pop();
            obj.active = false;
            obj._poolIndex = -1;
            this.pool.push(obj);
            return;
        }
        const last = this.activeObjects[this.activeObjects.length - 1];
        this.activeObjects[index] = last;
        last._poolIndex = index;
        this.activeObjects.pop();
        obj.active = false;
        obj._poolIndex = -1;
        this.pool.push(obj);
    }

    updateActive(...args) {
        // Iterate backwards so inline release() doesn't skip the next entry.
        for (let i = this.activeObjects.length - 1; i >= 0; i--) {
            this.activeObjects[i].update(...args);
        }
    }

    drawActive(ctx) {
        for (let i = 0; i < this.activeObjects.length; i++) {
            this.activeObjects[i].draw(ctx);
        }
    }

    forEachActive(fn) {
        for (let i = 0; i < this.activeObjects.length; i++) fn(this.activeObjects[i]);
    }
}
