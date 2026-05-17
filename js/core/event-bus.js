// Synchronous pub/sub. Use for game-level events (game:over, wave:start,
// pickup:star). Do NOT use for per-frame hot paths.

export class EventBus {
    constructor() {
        this._listeners = {};
    }

    on(event, callback) {
        (this._listeners[event] ||= []).push(callback);
        return () => this.off(event, callback);
    }

    off(event, callback) {
        const list = this._listeners[event];
        if (!list) return;
        const idx = list.indexOf(callback);
        if (idx !== -1) list.splice(idx, 1);
    }

    emit(event, data) {
        const list = this._listeners[event];
        if (!list) return;
        for (let i = 0; i < list.length; i++) list[i](data);
    }

    clear() {
        this._listeners = {};
    }
}

export const bus = new EventBus();
