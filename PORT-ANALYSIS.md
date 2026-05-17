# Hybrid Port: monosrc → rainsrc

A careful, opinionated forward-port of the original single-file
**monosrc** game into a small, modular **rainsrc** codebase.

The aim is preservation, not reinvention: the player should not be
able to tell, from looking at the screen, that anything has changed.
The aim under the hood is to cut up the monolith into focused modules
and selectively absorb a handful of code-quality wins from the
heavily-developed rainsrc HEAD, without dragging in any of its
gameplay-bloat features.

## Ground rules

| Rule                          | Why                                                        |
| ----------------------------- | ---------------------------------------------------------- |
| Preserve classic visuals 1:1  | This is the entire point of "hybrid"                       |
| Modular ES-module layout      | Easier to read, change, and test than a 1351-line `<script>` |
| Bring music + SFX forward     | User explicitly asked                                       |
| Don't add powerups / drops / inventory / assists | User explicitly excluded |
| Don't ship more code than needed | A 1.3k-line game does not need a quadtree, WebGL renderer, multiplayer protocol, etc. |

## What I'm porting forward (and why)

### From monosrc — the **gameplay** (full fidelity)

Everything that defines the look and feel of the classic game is
carried across without alteration:

- **Cyan glowing ship**, twin-triangle hull, `globalCompositeOperation = 'lighter'` glow
- **Rainbow hue-cycling wave-modulated bullets** with phantom trail particles
- **3D icosahedron asteroids** (12 vertices, 30 edges, jittered radius, depth-fade alpha)
- Asteroid **break-apart** physics (conservation of momentum + tangential kick)
- Asteroid–asteroid **elastic collision** with rocky-debris spray
- **Multi-coloured shaped stars** (point / diamond / star4 / star8 / plus) with twinkle, parallax, light gravity toward the ship, and golden-bordered **burst stars** on asteroid destruction
- **Particle vocabulary**: thrust, explosion, asteroidHit, asteroidDestroy, debris, rockDebris, playerExplosion ring, phantom, pickupPulse
- **Line debris** from asteroid edges on destruction
- **Wave progression** with center-on-screen target spawning and gentle speed ramp
- **Screen shake** on big hits
- **CRT scanline overlay** + **Press Start 2P** font + **black bg**
- **Title screen** with animated colour-cycling, wavy letters and high-score display
- **Pause menu** (will be cleaned up — see below)
- **Mobile controls** (joystick + fire button) and the customise-controls drag layout
- **Mobile orientation lock** overlay

### From rainsrc — the **code-quality** wins (modernised but feel-equivalent)

I picked these because each one improves the codebase without
changing what the player sees or feels. Anything that would alter the
visual aesthetic or add a new gameplay system was rejected.

| Pulled forward                | Source file in rainsrc HEAD                  | Why it earned its place |
| ----------------------------- | -------------------------------------------- | ----------------------- |
| **ES-module layout**          | `js/modules/**`                              | A 1.3k-line monolith is hard to read and change. Split into ~12 focused files. |
| **Modern `PoolManager`** with `_poolIndex` (O(1) release, no `indexOf` scan) and `highWaterMark` audit | `js/modules/core/pool-manager.js` | The mono version's `splice(indexOf(...))` is O(n) per release — fine for small N but trivially better. Free win. |
| **`frameClock`** (one `Date.now()` per frame, cached `tick` counter) | `js/modules/core/frame-clock.js` | Tiny, dependency-free. Lets future-me write throttled effects without per-call syscalls. |
| **`EventBus`** (synchronous pub/sub) | `js/modules/core/event-bus.js`        | Used sparingly for `game:over`, `wave:start`, `pickup:star` etc. Decouples UI updates from game logic without changing behaviour. |
| **`color-cache`** (`rgba()`/`hsl()` with quantised lookup tables) | `js/modules/core/color-cache.js` | The bullets, particles, and asteroids spin colour template literals every frame — this is a clean, ~10× win at zero behaviour cost. |
| **`storage.js`** (try/catch wrappers around localStorage with a settings namespace) | `js/modules/core/storage.js`  | Mono uses raw `localStorage.getItem`. The wrapped version is safe in private mode and centralises the keys. Save-game schema dropped — irrelevant. |
| **`platform-detect`** (`isMobile`/`isPortrait`/`isTouchDevice` + `?mobile=1\|0` override) | `js/modules/platform/platform-detect.js` | Mono uses `window.matchMedia("(any-pointer: coarse)")` inline at three call sites. Centralised version is also test-friendly. |
| **`haptic`** wrapper (mobile-gated, try/catch, `HAPTIC` constant patterns) | `js/modules/platform/haptic.js`     | Direct port — mono already does this, the rainsrc wrapper is just tidier. |
| **Music player** structure   | `js/modules/audio/music-player.js`           | Carried across as a clean class with `play/pause/togglePlayPause/setVolume`. **Playlist machinery dropped** — we ship one track (`bgm.mp3`) and the 67-track playlist is irrelevant. The forward/preload/shuffle dance only earns its complexity with N>1 tracks. |
| **SFX layer recipes** from `sound-defs.js` (multi-voice sfxr stacks for `shoot/hit/coin/explosion`) | `js/modules/audio/sound-defs.js` | The rainsrc SFX design is genuinely better-sounding than the mono single-voice presets. I pull a handful of recipes and **render them at runtime via sfxr.js** (no offline WAV pipeline). Keeps the classic 8-bit character, adds depth. |
| **WebAudio playback path** (one `AudioContext`, `BufferSource` per play, gain mixing, per-name throttle map) | `js/modules/audio/audio-manager.js` | Mono creates a fresh `<audio>` element per SFX (`sfxr.toAudio(...)`) — works, but garbage-heavy. WebAudio is the right substrate. We keep the design without the WAV-fetch pipeline. |

### Rejected explicitly (with reasons)

| Not ported                    | Why                                                       |
| ----------------------------- | --------------------------------------------------------- |
| **Powerups, drops, inventory, assists, shop, gold, jewels, levelling, trinkets, regen** | User excluded these explicitly. The whole rainsrc economy was retired/reworked across many versions; bringing any of it back would defeat the hybrid. |
| **Enemies, weapons system, defense skills, formations, boss rage** | Out of scope — classic game has only asteroids. |
| **Multiplayer** (`js/net/**`, `js/sim/**`) | Massive subsystem; no value without enemies/economy. |
| **WebGL renderers** (`webgl-bullet/particle/starfield`)            | 2D Canvas is fast enough for this entity count; WebGL would change the look (anti-aliasing, glow). |
| **Quadtree / spatial grid**   | The mono game's per-frame collision count is small (≤25 asteroids × bullets). The brute-force loop is fine and matches the original's frame budget exactly. |
| **Camera system** (zoom, large field) | Mono uses 1:1 viewport coords with wraparound. Adding a camera changes feel. |
| **Wave manager system**, **shop manager**, **HUD overlays**, **stats overlay** | Each is built around features we're not porting. |
| **Pre-rendered WAV pipeline** + 30+ sfx assets | Adds bulk for marginal gain; runtime sfxr rendering preserves the classic feel and ships no extra files. |
| **`sim/*` deterministic engine, fixed-step / RNG seeding**          | These only matter for the multiplayer rollback netcode. Visual game runs on RAF with `Math.random()` just like mono. |
| **Multi-track playlist UI + auto-shuffle preloading**              | We only have `bgm.mp3` — one track. Sequential preload of the "next" track is a no-op with N=1. |
| **`/dist/`, vite build, jest, playwright, allure**                 | This stays a zero-build, drop-in-a-browser project. |

## File layout

```
./
├── PORT-ANALYSIS.md       (this file)
├── index.html             — DOM scaffold + game shell
├── favicon.png            — copied from monosrc
├── bgm.mp3                — copied from monosrc
├── css/styles.css         — extracted from the mono inline <style>
├── js/
│   ├── main.js                  — bootstrap + main loop + wiring
│   ├── core/
│   │   ├── event-bus.js         — ported from rainsrc
│   │   ├── frame-clock.js       — ported from rainsrc
│   │   ├── pool-manager.js      — ported from rainsrc (O(1) release)
│   │   ├── storage.js           — ported, slimmed (settings only)
│   │   ├── color-cache.js       — ported from rainsrc
│   │   └── utils.js             — random, wrap, collision, constants
│   ├── platform/
│   │   ├── detect.js            — isMobile / isPortrait / isTouchDevice
│   │   └── haptic.js            — HAPTIC presets + vibrate()
│   ├── audio/
│   │   ├── audio-manager.js     — WebAudio + sfxr runtime synth
│   │   ├── sound-defs.js        — recipes (multi-voice sfxr) for our 6 sounds
│   │   └── music-player.js      — single-track bgm.mp3 player
│   ├── entities/
│   │   ├── player.js            — Ship class
│   │   ├── bullet.js            — Rainbow wave bullets
│   │   ├── asteroid.js          — 12-vertex 3D icosahedron
│   │   ├── particle.js          — All particle types
│   │   ├── line-debris.js       — Asteroid-edge debris
│   │   └── star.js              — Background + burst stars
│   ├── world/
│   │   ├── waves.js             — Wave spawn / progression
│   │   └── collisions.js        — All collision resolution
│   └── ui/
│       ├── title-screen.js      — Animated title + high score
│       ├── pause.js             — Cleaned pause menu (see below)
│       ├── mobile-controls.js   — Joystick + fire button + drag-to-customise
│       └── messages.js          — Center-screen WAVE/GAME OVER banners
```

## Pause menu cleanup

Mono's pause overlay is already fairly clean (control list +
"Customize Controls" button). It does carry a hard-coded "Spacebar:
Fire" entry that's confusing on mobile. The cleaned version:

- **Title:** PAUSED
- **Controls block** — desktop and mobile lines shown separately, gated by `isMobile()`
- **BGM volume slider** + **mute toggle** (new — surfaces the music
  player controls instead of leaving them invisible)
- **SFX volume slider** + **mute toggle**
- **Customize Controls** button (mobile only, hidden on desktop)
- **Resume** button (also: `Esc` keyboard)
- **Restart** button (clears the current run — no game-save complexity)

What does **not** go in: skills tab, assists tab, timer tab, sfx
per-sound toggles, music tab with shuffle/repeat/track picker, shop
tab — all rainsrc-only and tied to features we're not porting.

## Key behavioural preservations

These are details that would be easy to drift on:

- Bullets: `setTimeout(canShoot = true, 200)` fire-rate gate stays
- Thrust particle burst: 4 particles per frame from rear, ±0.3 rad cone
- Asteroid split: 2-or-3 children, `newR = baseR / sqrt(count)`, momentum-conserving COM velocity + tangential kick
- Asteroid wrap buffer: `baseRadius * 4` (so a half-off-screen asteroid doesn't pop)
- Star attraction radius: 150px (normal) / 350px (burst)
- Star `STAR_ATTR`/`BURST_STAR_ATTR`: 0.05 / 0.3
- Phantom bullet trail: every 2 frames with `hsl(life*5 % 360, 100%, 50%)`
- Player death: `playerExplosion` ring grows to maxRadius 150, screen-shake 20/15
- Background draw: `fillStyle = 'rgba(0,0,0,0.3)'` per-frame motion-blur veil

## What I will not be able to verify without you

- **Mobile orientation lock + drag-customise layout** — I'll wire the
  same logic but can only confirm visually on a real phone.
- **bgm.mp3 playback** — the file is large (~7 MB) and loads via the
  page; I'll confirm the `<audio>` element wires up, but can't
  audibly verify in a non-headed environment.
- **Haptic feedback** — desktop browsers won't vibrate.

I'll call those out in the smoke-test report at the end.
