# HAIR FORCE — browser game contract

Flappy-style side-scroller in real 3D (Three.js r170 via import map, no build step).
Player = **AEROLUX**, an original fictional low wedge two-seat hypercar with cold-gas air-thruster nozzles
(underbody + side sills). Each tap fires a visible white compressed-air burst that pops it upward; gravity pulls it down.
Obstacles = pairs of **golden luxury towers**: one rising from the ground, one hanging from above, with a gap between.
Each tower tip carries a huge swept golden-blond pompadour comb-over hairdo (caricature by hair only — NO face, NO name,
NO flags, NO text, NO logos). Bonus towers have a long red necktie fluttering from the tip instead.
Setting: desert rocket test range at sunset. No IP anywhere: no Tesla/SpaceX/Trump names or logos, no copied designs.

Quality bar: impressive, glossy, fun, readable at a glance on phone and desktop. 60 fps on a MacBook and a mid phone.
Keep draw calls modest (merge/instance where it matters), no external model files, no textures from the web —
procedural geometry, procedural canvas textures, MeshPhysicalMaterial / MeshStandardMaterial.

## Tech
- `index.html` has an import map: `"three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js"`,
  `"three/addons/": "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"`.
- Every module: `import * as THREE from 'three';` ES module in `src/`. No other dependencies.
- Renderer: ACESFilmic tone mapping, sRGB output, shadows on (PCFSoft), one RoomEnvironment PMREM env map set by world.js.
- Units: 1 = 1 metre. Side view. Game plane is z = 0. +X = forward (direction of travel), +Y = up.
  Ground surface at y = 0. Play ceiling y = 18. Camera looks from +Z toward -Z.
- The game moves obstacles/world toward -X; the car stays near x = 0 and only moves in Y (plus pitch).

## Module interfaces (exact)

### src/car.js
```js
export function createCar() → {
  group,            // THREE.Group, origin at car centre of mass, nose pointing +X, wheels touching y = -0.55
  hitbox,           // {w, h} metres for the collision rectangle in XY (about 4.3 × 1.1)
  nozzles,          // array of THREE.Object3D placed at nozzle exits (world pos via getWorldPosition), local -Y facing
  thrust(),         // call on each tap: nozzle flare flash + small body kick animation
  update(dt, t, state) // state = {vy, speed, alive}; animates wheel spin, light pulse, nozzle glow decay, suspension
}
```
### src/tower.js
```js
export const TOWER_WIDTH = 2.8;   // collision width (X)
export function createTower({ height, fromTop, bonus }) → {
  group,            // origin at the tower's ATTACHED end: ground base (fromTop=false) at y=0 grows +Y;
                    // fromTop=true: origin at the ceiling, tower hangs down -Y. Hairdo/tie at the free tip.
  tipExtra,         // extra metres the hairdo adds beyond `height` (collision includes it, keep ≤ 1.2)
  update(dt, t, wind) // wind 0..1: hair sways/bounces, tie flutters; idle sway always
  dispose()
}
```
Height is the shaft length (golden glass-and-gilt skyscraper vibe, setbacks, gold fins, lit windows). Gap math is the game's job.

### src/world.js
```js
export function createWorld(renderer, scene) → {
  update(dt, speed, t),   // scroll ground/props parallax by speed (m/s)
  setFlip(amount)          // 0..1 optional tint for "flip zone" (can be a no-op)
}
```
Sets scene.background/fog/env, sun + hemi lights with shadows, desert ground (endless scroll), distant mesas,
far parallax: launch gantries, water-tower-like test tanks, blinking beacons, sunset sky gradient, dust haze.

### src/fx.js
```js
export function createFX(scene) → {
  puff(worldPos, dirVec3),  // compressed-air burst (white, expanding, fast fade, slight cold condensate)
  trail(worldPos, speed),   // per-frame subtle exhaust shimmer/speed streaks behind car (cheap)
  crash(worldPos),          // gold sparks + debris + flash
  score(worldPos),          // little golden ring pop when passing a gap
  update(dt)
}
```
### src/audio.js
```js
export function createAudio() → {
  unlock(),        // call from first user gesture
  thrust(), score(), bonus(), crash(), whoosh(),   // SFX
  music(on)        // start/stop looped music
}
```
Audio files go in `assets/` (mp3/ogg, small).

## Rules for agents
- Write ONLY your own file(s). Do not touch other modules or index.html/main.js.
- Self-check: `node --check src/<file>.js`. You may make `preview/<module>.html` to look at your piece in the built-in
  browser via a local server, using your own tab only.
- Temporary screenshots: delete them right after use with
  `find /literal/absolute/path -mindepth 1 -delete` (no `rm`, no globs, no variables, no `cd`).
- Finish fast (target ≤ 20 min). Report back: the interface as implemented and anything the integrator must know.
