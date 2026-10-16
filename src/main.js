import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createCar } from './car.js';
import { createTower, TOWER_WIDTH } from './tower.js';
import { createWorld } from './world.js';
import { createFX } from './fx.js';
import { createAudio } from './audio.js';

const params = new URLSearchParams(location.search);
let BOT = params.has('bot');
const REC = params.has('rec');
if (REC) document.documentElement.classList.add('rec');

// ---- tuning ----
const G = -40;            // gravity m/s²
const FLAP = 13.2;        // tap impulse
const CAR_X = -7;
const CEIL = 22;          // top towers hang from here (off-screen)
const PLAY_TOP = 19.2;
const SPEED0 = 12, SPEED_MAX = 25;
const GAP0 = 6.4, GAP_MIN = 4.9;
const SPACING0 = 14;
const BONUS_EVERY = 6;

// ---- renderer ----
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: REC });
const isMobile = matchMedia('(pointer:coarse)').matches;
renderer.setPixelRatio(Math.min(devicePixelRatio, isMobile ? 1.75 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.5, 900);

const world = createWorld(renderer, scene);
const fx = createFX(scene);
const audioRaw = createAudio();
const events = [];
// in capture mode log every sound with game time so the video soundtrack can be rebuilt offline
const audio = new Proxy(audioRaw, { get(o, k) {
  const f = o[k];
  if (typeof f !== 'function') return f;
  return (...a) => { if (REC && k !== 'unlock') events.push({ t, k, a }); return f.apply(o, a); };
} });
const CAR_SCALE = 1.2;
const car = createCar();
car.group.scale.setScalar(CAR_SCALE);
car.hitbox = { w: car.hitbox.w * CAR_SCALE, h: car.hitbox.h * CAR_SCALE };
scene.add(car.group);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.32, 0.55, 0.88);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ---- camera framing: always show ~32 m wide and ~22 m tall of the game plane ----
const camBase = new THREE.Vector3();
function frame() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h);
  composer.setSize(w, h);
  camera.aspect = w / h;
  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const needH = 16.5, needW = 22;
  const dH = needH / 2 / Math.tan(vFov / 2);
  const dW = needW / 2 / (Math.tan(vFov / 2) * camera.aspect);
  const d = Math.max(dH, dW);
  // on wide screens shift view so the car sits left and we see what is coming
  const visW = 2 * d * Math.tan(vFov / 2) * camera.aspect;
  const lookX = CAR_X + visW * 0.27; // car sits at ~23% from the left edge
  camBase.set(lookX - 1.5, 0, d);
  camera.userData.lookAt = new THREE.Vector3(lookX, 0, 0);
  camera.updateProjectionMatrix();
}
addEventListener('resize', frame);
frame();

// ---- DOM ----
const $ = (id) => document.getElementById(id);
const scoreEl = $('score'), multEl = $('mult'), toastEl = $('toast');
const titleEl = $('title'), overEl = $('gameover');
let best = 0;
try { best = +localStorage.getItem('hairforce.best') || 0; } catch {}

// ---- state ----
let state = 'title';
let y = 9, vy = 0, speed = SPEED0, score = 0, dist = 0, nextSpawn = 0;
let deadT = 0, shake = 0, multT = 0, toastT = 0, botCooldown = 0, spawnCount = 0;
let spin = 0;
let camY = 9.6;
const pairs = [];
const tmp = new THREE.Vector3();
const down = new THREE.Vector3(0, -1, 0);

function rand(a, b) { return a + Math.random() * (b - a); }

function spawnPair(x) {
  spawnCount++;
  const t = Math.min(score / 40, 1);
  const gap = THREE.MathUtils.lerp(GAP0, GAP_MIN, t);
  const prev = pairs.length ? pairs[pairs.length - 1].center : 9.5;
  let center = THREE.MathUtils.clamp(rand(4.6, 14.6), 1.2 + gap / 2 + 1, PLAY_TOP - gap / 2 - 1);
  center = THREE.MathUtils.clamp(center, prev - 3.4, prev + 3.4); // keep every gap reachable
  const bonus = spawnCount % BONUS_EVERY === 0;
  const bottomLen = center - gap / 2;
  const topLen = CEIL - (center + gap / 2);
  const bottom = createTower({ height: Math.max(0.5, bottomLen - 1.0), fromTop: false, bonus: false });
  const top = createTower({ height: Math.max(0.5, topLen - 1.0), fromTop: true, bonus });
  // shaft lengths are reduced by ~1 m so the hairdo fills the rest; collision uses real extents
  const bExtent = Math.max(0.5, bottomLen - 1.0) + bottom.tipExtra;
  const tExtent = Math.max(0.5, topLen - 1.0) + top.tipExtra;
  bottom.group.position.set(x, 0, 0);
  top.group.position.set(x, CEIL, 0);
  scene.add(bottom.group, top.group);
  pairs.push({ x, bottom, top, bTop: bExtent, tBot: CEIL - tExtent, center, gap, bonus, passed: false, near: false });
}

function clearPairs() {
  for (const p of pairs) { scene.remove(p.bottom.group, p.top.group); p.bottom.dispose?.(); p.top.dispose?.(); }
  pairs.length = 0;
}

function reset() {
  clearPairs();
  y = 9.5; vy = 0; speed = SPEED0; score = 0; dist = 0; spawnCount = 0; spin = 0;
  car.group.rotation.set(0, 0, 0);
  car.group.position.set(CAR_X, y, 0);
  nextSpawn = 0;
  for (let i = 0; i < 4; i++) spawnPair(CAR_X + 26 + i * SPACING0);
  scoreEl.textContent = '0';
}

function flap() {
  vy = FLAP;
  car.thrust();
  audio.thrust();
  for (const n of car.nozzles) {
    n.getWorldPosition(tmp);
    fx.puff(tmp.clone(), down, speed);
  }
}

function start() {
  reset();
  state = 'play';
  titleEl.classList.add('hidden');
  overEl.classList.add('hidden');
  setTimeout(() => { if (state === 'play') overEl.style.display = 'none'; }, 350);
  scoreEl.style.opacity = 1;
  flap();
}

function die() {
  if (state !== 'play') return;
  if (REC) console.error('DIE', JSON.stringify({ y, vy, pairs: pairs.slice(0, 3).map((p) => ({ x: p.x.toFixed(2), bTop: p.bTop.toFixed(2), tBot: p.tBot.toFixed(2), c: p.center.toFixed(2), g: p.gap })) }));
  state = 'dead';
  deadT = 0; shake = 1;
  car.group.getWorldPosition(tmp);
  fx.crash(tmp.clone());
  audio.crash();
  vy = Math.max(vy, 6);
  spin = (Math.random() < 0.5 ? -1 : 1) * 7;
  const isBest = score > best;
  if (isBest) { best = score; try { localStorage.setItem('hairforce.best', best); } catch {} }
  $('final').textContent = score;
  $('best').textContent = best;
  $('newbest').style.display = isBest && score > 0 ? 'block' : 'none';
}

function showOver() {
  overEl.style.display = 'flex';
  requestAnimationFrame(() => overEl.classList.remove('hidden'));
}

function input(e) {
  if (e && e.target && e.target.id === 'mute') return;
  if (e && e.cancelable) e.preventDefault();
  audio.unlock();
  if (state === 'title') { audio.music(musicOn); start(); }
  else if (state === 'play') flap();
  else if (state === 'dead' && deadT > 0.9) start();
}
addEventListener('pointerdown', input, { passive: false });
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW' || e.code === 'Enter') input(e);
});

let musicOn = true;
$('mute').addEventListener('click', (e) => {
  e.stopPropagation();
  audio.unlock();
  musicOn = !musicOn;
  audio.music(musicOn && state !== 'title');
  $('mute').textContent = musicOn ? '🔊' : '🔈';
});

function popScore() {
  scoreEl.textContent = score;
  scoreEl.classList.add('pop');
  setTimeout(() => scoreEl.classList.remove('pop'), 120);
}
function toast(text) {
  toastEl.textContent = text;
  toastEl.classList.add('on');
  toastT = 0.8;
}

// ---- bot (for gameplay capture) ----
function botThink(dt) {
  botCooldown -= dt;
  const next = pairs.find((p) => p.x + TOWER_WIDTH / 2 > CAR_X - 2.4);
  const target = next ? next.center - next.gap * 0.12 : 9;
  if (botCooldown <= 0 && y < target && vy < 0) { flap(); botCooldown = 0.2; }
}

// ---- loop ----
let t = 0;
function step(dt) {
  t += dt;
  const alive = state === 'play';

  if (state === 'title') {
    y = 9.5 + Math.sin(t * 2.2) * 0.6;
    vy = Math.cos(t * 2.2) * 1.3;
    if ((t % 1.1) < dt) { car.thrust(); for (const n of car.nozzles) { n.getWorldPosition(tmp); fx.puff(tmp.clone(), down, speed); } }
    world.update(dt, speed, t);
  } else {
    if (BOT && alive) botThink(dt);
    vy += G * dt;
    y += vy * dt;
    if (alive) {
      speed = Math.min(SPEED_MAX, SPEED0 + score * 0.28);
      dist += speed * dt;
      if (y > PLAY_TOP) { y = PLAY_TOP; vy = Math.min(vy, 0); }
    } else {
      speed = Math.max(0, speed - 30 * dt);
    }
    const groundY = car.hitbox.h / 2 + 0.05;
    if (y < groundY) {
      y = groundY;
      if (alive) die();
      vy = Math.abs(vy) > 4 ? -vy * 0.25 : 0;
      spin *= 0.6;
    }
    world.update(dt, speed, t);

    // towers
    const hw = car.hitbox.w * 0.42, hh = car.hitbox.h * 0.4;
    for (const p of pairs) {
      p.x -= speed * dt;
      p.bottom.group.position.x = p.x;
      p.top.group.position.x = p.x;
      const dx = Math.abs(p.x - CAR_X);
      const wind = Math.max(0, 1 - dx / 7);
      p.bottom.update(dt, t, wind);
      p.top.update(dt, t, wind);
      if (alive) {
        const overlapX = dx < TOWER_WIDTH / 2 + hw;
        if (overlapX && (y - hh < p.bTop || y + hh > p.tBot)) die();
        if (overlapX && !p.near && (y - hh - p.bTop < 0.55 || p.tBot - (y + hh) < 0.55)) {
          p.near = true;
        }
        if (!p.passed && p.x < CAR_X - TOWER_WIDTH / 2) {
          p.passed = true;
          score += p.bonus ? 2 : 1;
          popScore();
          tmp.set(p.x, p.center, 0);
          fx.score(tmp.clone());
          if (p.bonus) { audio.bonus(); multT = 1.2; } else audio.score();
          if (p.near) { audio.whoosh(); toast(['CLOSE ONE!', 'NICE HAIRCUT', 'TOO CLOSE!'][score % 3]); }
        }
      }
    }
    while (pairs.length && pairs[0].x < CAR_X - 30) {
      const p = pairs.shift();
      scene.remove(p.bottom.group, p.top.group);
      p.bottom.dispose?.(); p.top.dispose?.();
    }
    if (alive) {
      const last = pairs[pairs.length - 1];
      const spacing = Math.max(SPACING0, speed * 1.05 + 4);
      if (!last || last.x < CAR_X + 40) spawnPair((last ? last.x : CAR_X + 26) + spacing);
    }
    if (state === 'dead') {
      deadT += dt;
      if (deadT > 0.85 && overEl.style.display === 'none') showOver();
    }
  }

  // car pose
  car.group.position.set(CAR_X, y, 0);
  if (state === 'dead') car.group.rotation.z += spin * dt;
  else car.group.rotation.z = THREE.MathUtils.damp(car.group.rotation.z, THREE.MathUtils.clamp(vy * 0.035, -0.55, 0.38), 12, dt);
  car.update(dt, t, { vy, speed, alive: state !== 'dead' });
  if (state === 'play') { car.group.getWorldPosition(tmp); fx.trail(tmp.clone(), speed); }
  fx.update(dt);

  // camera
  shake = Math.max(0, shake - dt * 2.2);
  const s = shake * shake * 0.6;
  // vertical follow: frame a 16 m band that slides with the car but always keeps ground or gap edges readable
  camY = THREE.MathUtils.damp(camY, THREE.MathUtils.clamp(y * 0.55 + 4.6, state === 'dead' ? 5.6 : 8.2, 11.4), state === 'dead' ? 2.5 : 4, dt);
  camera.position.set(camBase.x + (Math.random() - 0.5) * s, camY + 0.3 + (Math.random() - 0.5) * s, camBase.z);
  const la = camera.userData.lookAt;
  camera.lookAt(la.x, camY, la.z);
  const targetFov = 42 + (speed - SPEED0) * 0.18;
  if (Math.abs(camera.fov - targetFov) > 0.01) { camera.fov = THREE.MathUtils.damp(camera.fov, targetFov, 3, dt); frame(); }

  // HUD timers
  if (multT > 0) { multT -= dt; multEl.style.opacity = multT > 0 ? 1 : 0; }
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) toastEl.classList.remove('on'); }

  composer.render();
}

// ---- boot ----
reset();
clearPairs();
$('loading').style.opacity = 0;
setTimeout(() => $('loading').remove(), 450);

if (REC) {
  window.__step = (dt) => { step(dt); };
  window.__events = () => events;
  window.__time = () => t;
  window.__bot = (on) => { BOT = on; };
  window.__state = () => ({ state, score, speed, y, alive: state === 'play' });
  window.__start = () => start();
  window.__flap = () => flap();
} else {
  let last = performance.now();
  renderer.setAnimationLoop((now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    step(dt);
  });
  if (BOT) setTimeout(() => { audio.unlock(); start(); }, 800);
}
document.addEventListener('visibilitychange', () => { if (document.hidden) audio.music(false); else if (state !== 'title') audio.music(musicOn); });
