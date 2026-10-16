// HAIR FORCE — world: desert rocket test range at golden-hour sunset.
// createWorld(renderer, scene) → { update(dt, speed, t), setFlip(amount) }
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------- utils
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _up = new THREE.Vector3(0, 1, 0);

// Normalise a geometry for merging: non-indexed, position/normal/uv/color only.
function prep(geo, color, matrix) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  for (const k of Object.keys(g.attributes)) {
    if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
  }
  if (!g.attributes.uv) {
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  if (matrix) g.applyMatrix4(matrix);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  if (typeof color === 'function') {
    const pos = g.attributes.position;
    for (let i = 0; i < n; i++) {
      color(pos.getX(i), pos.getY(i), pos.getZ(i), _c);
      col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
    }
  } else {
    _c.set(color);
    for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.groups.length = 0;
  return g;
}

function put(list, geo, color, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
  list.push(prep(geo, color, _m));
}

// Thin box beam from a to b.
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3();
function beam(list, ax, ay, az, bx, by, bz, t, color) {
  _a.set(ax, ay, az); _b.set(bx, by, bz);
  _d.subVectors(_b, _a);
  const len = _d.length();
  _q.setFromUnitVectors(_up, _d.normalize());
  _m.compose(_p.addVectors(_a, _b).multiplyScalar(0.5), _q, _s.set(1, 1, 1));
  list.push(prep(new THREE.BoxGeometry(t, len, t), color, _m));
}

// Square lattice tower, returns top y.
function lattice(list, x, z, h, w, color, t = 0.22) {
  const hw = w / 2;
  const cs = [[-hw, -hw], [hw, -hw], [hw, hw], [-hw, hw]];
  for (const [cx, cz] of cs) put(list, new THREE.BoxGeometry(t * 1.5, h, t * 1.5), color, x + cx, h / 2, z + cz);
  const step = w * 1.15;
  let flip = false;
  for (let y = 0; y < h - 0.01; y += step) {
    const y1 = Math.min(h, y + step);
    for (let i = 0; i < 4; i++) {
      const [ax, az] = cs[i], [bx, bz] = cs[(i + 1) % 4];
      beam(list, x + ax, y1, z + az, x + bx, y1, z + bz, t, color);
      if (flip) beam(list, x + ax, y, z + az, x + bx, y1, z + bz, t * 0.8, color);
      else beam(list, x + bx, y, z + bz, x + ax, y1, z + az, t * 0.8, color);
    }
    flip = !flip;
  }
  return h;
}

// Tileable value noise for canvas textures.
function makeNoise(period, seed) {
  const r = rng(seed);
  const g = new Float32Array(period * period);
  for (let i = 0; i < g.length; i++) g[i] = r();
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const x0 = ((xi % period) + period) % period, y0 = ((yi % period) + period) % period;
    const x1 = (x0 + 1) % period, y1 = (y0 + 1) % period;
    const a = g[y0 * period + x0], b = g[y0 * period + x1], c = g[y1 * period + x0], d = g[y1 * period + x1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

// ---------------------------------------------------------------- textures
function sandTexture(renderer) {
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(S, S);
  const n1 = makeNoise(8, 11), n2 = makeNoise(32, 12), n3 = makeNoise(64, 13);
  const r = rng(7);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      const macro = n1(u * 8, v * 8);
      const mid = n2(u * 32, v * 32);
      const warp = n3(u * 64, v * 64);
      // wind ripples running mostly across the travel direction
      const rip = Math.sin((u * 2 + v * 22 + warp * 0.35 + macro * 0.6) * Math.PI * 2 * 3);
      let k = 0.86 + macro * 0.16 + mid * 0.06 + rip * 0.035 + (r() - 0.5) * 0.09;
      const i = (y * S + x) * 4;
      img.data[i] = Math.min(255, 214 * k);
      img.data[i + 1] = Math.min(255, 140 * k);
      img.data[i + 2] = Math.min(255, 88 * k);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // sparse pebbles
  for (let i = 0; i < 260; i++) {
    const x = r() * S, y = r() * S, s = 0.6 + r() * 1.6;
    ctx.fillStyle = r() < 0.5 ? 'rgba(120,70,45,0.45)' : 'rgba(255,225,180,0.35)';
    ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

// Concrete pad: 32 m (x) × 14 m (z, -8..+6) at 32 px/m.
function padTexture(renderer) {
  const W = 1024, H = 448, PX = 32;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const zRow = (z) => (z + 8) * PX; // canvas row for world z
  ctx.fillStyle = '#958676';
  ctx.fillRect(0, 0, W, H);
  // slab tone variation
  const r = rng(21);
  for (let sx = 0; sx < 4; sx++) {
    for (let sz = 0; sz < 3; sz++) {
      const l = 0.9 + r() * 0.16;
      ctx.fillStyle = `rgba(${l > 1 ? 255 : 60},${l > 1 ? 240 : 50},${l > 1 ? 220 : 40},${Math.abs(l - 1) * 0.9})`;
      ctx.fillRect(sx * 256, [0, zRow(-3.5), zRow(1.5)][sz], 256, [zRow(-3.5), zRow(1.5) - zRow(-3.5), H - zRow(1.5)][sz]);
    }
  }
  // tyre / scorch marks along the car lane
  for (let i = 0; i < 14; i++) {
    const y = zRow(-0.9 + (r() - 0.5) * 1.6), x = r() * W, len = 120 + r() * 380;
    ctx.strokeStyle = `rgba(40,28,22,${0.05 + r() * 0.09})`;
    ctx.lineWidth = 6 + r() * 10;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.bezierCurveTo(x + len * 0.3, y + (r() - 0.5) * 20, x + len * 0.6, y + (r() - 0.5) * 20, x + len, y + (r() - 0.5) * 10); ctx.stroke();
  }
  // scorch blast circle
  const g = ctx.createRadialGradient(700, zRow(-4.5), 4, 700, zRow(-4.5), 90);
  g.addColorStop(0, 'rgba(30,22,18,0.35)'); g.addColorStop(1, 'rgba(30,22,18,0)');
  ctx.fillStyle = g; ctx.fillRect(560, zRow(-8), 280, 200);
  // joints
  ctx.strokeStyle = 'rgba(70,58,48,0.55)'; ctx.lineWidth = 2;
  for (let x = 0; x <= W; x += 256) { ctx.beginPath(); ctx.moveTo(x + 1, 0); ctx.lineTo(x + 1, H); ctx.stroke(); }
  for (const z of [-3.5, 1.5]) { ctx.beginPath(); ctx.moveTo(0, zRow(z)); ctx.lineTo(W, zRow(z)); ctx.stroke(); }
  // markings: yellow edge lines, white dashed lane centre, hazard chevrons at back edge
  ctx.fillStyle = '#f2b726';
  ctx.fillRect(0, zRow(-6.9), W, 0.32 * PX);
  ctx.fillRect(0, zRow(4.6), W, 0.32 * PX);
  ctx.fillStyle = '#f4efe6';
  for (let x = 32; x < W; x += 256) ctx.fillRect(x, zRow(-0.15), 4 * PX, 0.3 * PX);
  ctx.fillRect(0, zRow(-6.25), W, 0.12 * PX);
  ctx.fillRect(0, zRow(4.2), W, 0.12 * PX);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, zRow(-8), W, zRow(-7.15) - zRow(-8)); ctx.clip();
  for (let x = -40; x < W + 40; x += 40) {
    ctx.fillStyle = '#f2b726';
    ctx.beginPath(); ctx.moveTo(x, zRow(-8)); ctx.lineTo(x + 20, zRow(-8)); ctx.lineTo(x + 40, zRow(-7.15)); ctx.lineTo(x + 20, zRow(-7.15)); ctx.fill();
  }
  ctx.restore();
  ctx.fillStyle = 'rgba(28,24,22,0.85)';
  ctx.fillRect(0, zRow(-7.15), W, 3);
  // wear / grain pass
  const img = ctx.getImageData(0, 0, W, H);
  const nA = makeNoise(16, 31), nB = makeNoise(128, 32);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const wear = nA((x / W) * 16, (y / H) * 7) * 0.12 + nB((x / W) * 128, (y / H) * 56) * 0.08;
      let k = 0.92 + wear + (r() - 0.5) * 0.1;
      // sand blown onto the slab edges
      const edge = Math.min(y, H - 1 - y) / (0.9 * PX);
      const sand = Math.max(0, 1 - edge) * (0.6 + nB((x / W) * 128, (y / H) * 56) * 0.6);
      const sr = 214 * k, sg = 152 * k, sb = 102 * k;
      img.data[i] = Math.min(255, img.data[i] * k * (1 - sand) + sr * sand);
      img.data[i + 1] = Math.min(255, img.data[i + 1] * k * (1 - sand) + sg * sand);
      img.data[i + 2] = Math.min(255, img.data[i + 2] * k * (1 - sand) + sb * sand);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

// ---------------------------------------------------------------- sky
const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = p.xyww;
}`;

const SKY_FRAG = /* glsl */`
uniform vec3 uTop, uMid, uLow, uHor, uBelow, uSunCol, uRidgeA, uRidgeB, uCloudLit, uCloudDark;
uniform vec3 uTopF, uMidF, uLowF, uHorF;
uniform vec3 uSunDir;
uniform float uTime, uFlip;
varying vec3 vDir;

float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vn(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }

void main() {
  vec3 d = normalize(vDir);
  float el = asin(clamp(d.y, -1.0, 1.0));          // radians
  float az = atan(d.x, -d.z);                        // 0 = straight ahead (-Z)
  float e = degrees(el);

  vec3 top = mix(uTop, uTopF, uFlip), mid = mix(uMid, uMidF, uFlip);
  vec3 low = mix(uLow, uLowF, uFlip), hor = mix(uHor, uHorF, uFlip);

  // gradient dome
  vec3 col = mix(hor, low, smoothstep(0.0, 7.0, e));
  col = mix(col, mid, smoothstep(4.0, 17.0, e));
  col = mix(col, top, smoothstep(13.0, 48.0, e));
  col = mix(uBelow, col, smoothstep(-3.0, 0.4, e));

  // sun
  float sd = max(dot(d, normalize(uSunDir)), 0.0);
  float horizonBoost = 1.0 - smoothstep(0.0, 30.0, e);
  col += uSunCol * (pow(sd, 6.0) * 0.28 * horizonBoost + pow(sd, 60.0) * 0.55 + pow(sd, 900.0) * 1.6);
  float disc = smoothstep(0.99935, 0.99965, sd);

  // stylised streak clouds (flat, horizontal, lit from below by the low sun)
  vec2 cp = vec2(az * 2.6 + uTime * 0.004, e * 0.16);
  float band = smoothstep(4.0, 9.0, e) * (1.0 - smoothstep(22.0, 34.0, e));
  float shape = fbm(vec2(cp.x * 1.4, cp.y * 9.0)) * 0.75 + fbm(cp * vec2(5.0, 22.0)) * 0.35;
  float mask = fbm(vec2(az * 0.9 + 3.0, 1.7));
  float cl = smoothstep(0.56, 0.74, shape * (0.55 + mask * 0.75)) * band;
  float under = smoothstep(0.62, 0.95, shape);
  vec3 cloudCol = mix(uCloudLit, uCloudDark, smoothstep(10.0, 28.0, e) * 0.85 + under * 0.25);
  cloudCol += uSunCol * pow(sd, 10.0) * 0.6;            // silver lining near the sun
  cloudCol = mix(cloudCol, mix(cloudCol, vec3(1.0, 0.25, 0.75), 0.45), uFlip);
  col = mix(col, cloudCol, cl * 0.92);

  // sun disc sits in front of the far haze but behind the clouds' dense parts
  col = mix(col, uSunCol * 2.4, disc * (1.0 - cl * 0.8));

  // far ridges (two layers, lighter = farther), purely atmospheric
  float r1 = 1.1 + 2.6 * fbm(vec2(az * 3.0 + 7.0, 0.5)) + 1.2 * fbm(vec2(az * 11.0, 2.0));
  float r2 = 0.4 + 1.9 * fbm(vec2(az * 4.5 + 31.0, 0.3)) + 0.7 * fbm(vec2(az * 17.0, 5.0));
  vec3 ra = mix(uRidgeA, uRidgeA * vec3(1.15, 0.7, 1.25), uFlip);
  vec3 rb = mix(uRidgeB, uRidgeB * vec3(1.1, 0.75, 1.2), uFlip);
  float base = smoothstep(-1.0, 1.5, e);
  col = mix(col, mix(hor, ra, base * 0.9), (1.0 - smoothstep(r1 - 0.06, r1 + 0.06, e)) * step(-2.0, e));
  col = mix(col, mix(hor, rb, base * 0.85), (1.0 - smoothstep(r2 - 0.05, r2 + 0.05, e)) * step(-2.0, e));
  // sun glare washes over the ridges
  col += uSunCol * pow(sd, 18.0) * 0.35 * (1.0 - smoothstep(0.0, 6.0, e));

  // dither against banding
  col += (h21(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// ---------------------------------------------------------------- beacons
const BEACON_VERT = /* glsl */`
attribute float aPhase;
attribute float aSize;
uniform float uTime, uHalfH;
varying float vI;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float b = 0.5 + 0.5 * sin(uTime * 2.2 + aPhase);
  b = pow(b, 5.0);
  vI = 0.18 + 0.82 * b;
  gl_PointSize = 1.7 * aSize * projectionMatrix[1][1] * uHalfH / -mv.z * (0.55 + 0.45 * b);
}`;
const BEACON_FRAG = /* glsl */`
uniform vec3 uColor;
varying float vI;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float glow = exp(-d * d * 6.0) * (1.0 - d);
  float core = smoothstep(0.22, 0.0, d);
  vec3 c = uColor * glow * 1.6 + vec3(1.0, 0.85, 0.75) * core * 1.2;
  gl_FragColor = vec4(c * vI, 1.0);
}`;

// ---------------------------------------------------------------- props
const C = {
  rust: '#b8452b', rustDark: '#7c2f22', white: '#ece6dc', cream: '#e3d7c4', steel: '#8d8a8e',
  dark: '#3a3036', concrete: '#a89a8a', olive: '#6d6a3a', oliveDark: '#4c4a2a', rock: '#9a5a3a', rockDark: '#6e3c28',
  pole: '#4a3428', amber: '#ffb347', lampW: '#fff2d6',
};

function rockGeo(r, rnd, sx = 1, sy = 0.7, sz = 1) {
  const g = new THREE.IcosahedronGeometry(r, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const k = 0.75 + rnd() * 0.5;
    p.setXYZ(i, p.getX(i) * k * sx, p.getY(i) * k * sy, p.getZ(i) * k * sz);
  }
  g.computeVertexNormals();
  return g;
}

// Near dressing: rocks, scrub, runway edge lights. z -9..-28. Moves at ground speed.
function buildNear(W, seed) {
  const solid = [], lamps = [], beacons = [];
  const r = rng(seed);
  for (let i = 0; i < 46; i++) {
    const x = -W / 2 + r() * W, z = -10.5 - r() * 17, s = 0.25 + Math.pow(r(), 2.2) * 2.2;
    const g = rockGeo(s, r, 1 + r() * 0.8, 0.55 + r() * 0.3, 1);
    put(solid, g, r() < 0.5 ? C.rock : C.rockDark, x, s * 0.15, z, 0, r() * 6.28, 0);
  }
  for (let i = 0; i < 60; i++) {
    const x = -W / 2 + r() * W, z = -9.6 - r() * 20, s = 0.25 + r() * 0.55;
    const g = new THREE.IcosahedronGeometry(s, 1);
    put(solid, g, r() < 0.5 ? C.olive : C.oliveDark, x, s * 0.5, z, 0, r() * 6, 0, 1.3, 0.8, 1.2);
  }
  // runway edge lights on the back edge of the pad
  for (let x = -W / 2 + 4; x < W / 2; x += 8) {
    put(solid, new THREE.CylinderGeometry(0.07, 0.09, 0.45, 6), C.dark, x, 0.22, -8.6);
    put(lamps, new THREE.SphereGeometry(0.13, 8, 6), C.amber, x, 0.5, -8.6);
  }
  // a pair of jersey barriers + a blast deflector block per tile
  for (let i = 0; i < 2; i++) {
    const x = -W / 2 + (i + 0.3 + r() * 0.4) * (W / 2);
    for (let k = 0; k < 4; k++) {
      put(solid, new THREE.CylinderGeometry(0.25, 0.42, 0.85, 4, 1), k % 2 ? C.white : C.rust, x + k * 2.1, 0.42, -12.5, 0, Math.PI / 4, 0, 1.45, 1, 0.55);
    }
  }
  return { solid, lamps, beacons };
}

// Power line: poles every 25 m at z -34.
function buildPoles(W) {
  const solid = [];
  const wires = [];
  const z = -34, H = 11, sp = 25, n = Math.round(W / sp);
  const arm = [-1.6, 0, 1.6];
  for (let i = 0; i < n; i++) {
    const x = -W / 2 + sp / 2 + i * sp;
    put(solid, new THREE.CylinderGeometry(0.16, 0.24, H, 7), C.pole, x, H / 2, z);
    put(solid, new THREE.BoxGeometry(0.18, 0.2, 4.0), C.pole, x, H - 0.6, z);
    for (const a of arm) put(solid, new THREE.CylinderGeometry(0.08, 0.08, 0.35, 6), C.steel, x, H - 0.3, z + a);
    // spans to next pole (last one crosses the tile seam; the copy continues it)
    const x2 = x + sp;
    for (const a of arm) {
      const segs = 10;
      for (let s = 0; s < segs; s++) {
        const t0 = s / segs, t1 = (s + 1) / segs;
        const y0 = H - 0.15 - Math.sin(Math.PI * t0) * 1.3, y1 = H - 0.15 - Math.sin(Math.PI * t1) * 1.3;
        wires.push(x + (x2 - x) * t0, y0, z + a, x + (x2 - x) * t1, y1, z + a);
      }
    }
  }
  return { solid, wires };
}

// Test stand complex: lattice gantries, spherical tanks, horizontal tanks, water-tower tank. z -60..-110.
function buildIndustry(W, seed) {
  const solid = [], lamps = [], beacons = [];
  const r = rng(seed);
  const slots = 5;
  for (let i = 0; i < slots; i++) {
    const x0 = -W / 2 + (i + 0.5) * (W / slots) + (r() - 0.5) * 18;
    const kind = i % 5;
    if (kind === 0 || kind === 3) {
      // lattice test gantry with a service arm and a cap
      const z = -78 - r() * 22, h = 26 + r() * 14, w = 3.2;
      lattice(solid, x0, z, h, w, kind === 0 ? C.rust : C.steel, 0.24);
      put(solid, new THREE.BoxGeometry(w + 1.2, 0.6, w + 1.2), C.dark, x0, h + 0.3, z);
      put(solid, new THREE.BoxGeometry(2.2, 2.2, 2.2), C.white, x0, h + 1.7, z);
      for (const hy of [h * 0.55, h * 0.8]) put(solid, new THREE.BoxGeometry(7, 0.5, 0.9), C.rustDark, x0 + w / 2 + 3.5, hy, z);
      put(solid, new THREE.BoxGeometry(w + 3, 1.2, w + 3), C.concrete, x0, 0.6, z);
      beacons.push(x0, h + 3.2, z, 3.2);
      beacons.push(x0 + w / 2 + 7, h * 0.8 + 0.6, z, 1.8);
    } else if (kind === 1) {
      // pair of spherical tanks on legs
      for (let k = 0; k < 2; k++) {
        const z = -66 - r() * 10 - k * 9, R = 4 + r() * 1.5, x = x0 + k * 12;
        const cy = R + 3.2;
        put(solid, new THREE.SphereGeometry(R, 22, 14), C.white, x, cy, z);
        put(solid, new THREE.CylinderGeometry(R * 1.01, R * 1.01, 0.5, 22, 1, true), C.steel, x, cy, z);
        for (let l = 0; l < 6; l++) {
          const a = (l / 6) * Math.PI * 2;
          put(solid, new THREE.CylinderGeometry(0.22, 0.25, cy, 6), C.steel, x + Math.cos(a) * R * 0.86, cy / 2, z + Math.sin(a) * R * 0.86);
        }
        put(solid, new THREE.CylinderGeometry(0.4, 0.4, 0.8, 8), C.steel, x, cy + R + 0.3, z);
        beacons.push(x, cy + R + 1.1, z, 2.2);
      }
    } else if (kind === 2) {
      // horizontal propellant tanks on saddles
      const z = -70 - r() * 12;
      for (let k = 0; k < 3; k++) {
        const x = x0 + (k - 1) * 1.2, zz = z - k * 5.5, R = 1.7, L = 16;
        put(solid, new THREE.CylinderGeometry(R, R, L, 18), k === 1 ? C.cream : C.white, x, R + 1, zz, 0, 0, Math.PI / 2);
        put(solid, new THREE.SphereGeometry(R, 14, 10), C.white, x - L / 2, R + 1, zz, 0, 0, 0, 0.45, 1, 1);
        put(solid, new THREE.SphereGeometry(R, 14, 10), C.white, x + L / 2, R + 1, zz, 0, 0, 0, 0.45, 1, 1);
        for (const sx of [-5, 0, 5]) put(solid, new THREE.BoxGeometry(0.6, 1.4, R * 1.8), C.concrete, x + sx, 0.7, zz);
      }
    } else {
      // water-tower style test tank on lattice legs
      const z = -92 - r() * 14, h = 18, R = 5;
      lattice(solid, x0, z, h, 5.5, C.steel, 0.28);
      put(solid, new THREE.CylinderGeometry(R, R, 7, 24), C.white, x0, h + 3.5, z);
      put(solid, new THREE.CylinderGeometry(R * 1.02, R * 1.02, 1.1, 24, 1, true), C.rust, x0, h + 5.2, z);
      put(solid, new THREE.ConeGeometry(R * 1.05, 2.6, 24), C.cream, x0, h + 8.3, z);
      beacons.push(x0, h + 10, z, 2.6);
    }
    // small blockhouse / shed between landmarks
    const bx = x0 + W / slots / 2 + (r() - 0.5) * 8, bz = -58 - r() * 10;
    put(solid, new THREE.BoxGeometry(6 + r() * 4, 3, 5), C.concrete, bx, 1.5, bz);
    put(solid, new THREE.BoxGeometry(7 + r() * 4, 0.4, 6), C.dark, bx, 3.2, bz);
    put(lamps, new THREE.BoxGeometry(0.9, 0.5, 0.05), C.lampW, bx - 1.5, 1.8, bz + 2.53);
  }
  return { solid, lamps, beacons };
}

// Distant rocket on its pad with an umbilical tower. z ≈ -165.
function buildRocket(W, seed) {
  const solid = [], lamps = [], beacons = [];
  const r = rng(seed);
  const x = -W * 0.18, z = -165;
  // pad
  put(solid, new THREE.BoxGeometry(30, 3, 22), C.concrete, x, 1.5, z);
  put(solid, new THREE.BoxGeometry(8, 1.2, 8), C.dark, x, 3.4, z);
  // rocket body
  const R = 2.3, H = 40, y0 = 4.4;
  const bodyCol = (px, py) => {
    const yy = py - y0;
    if (yy > H * 0.62 && yy < H * 0.66) return _c.set(C.dark);
    if (yy > H * 0.18 && yy < H * 0.2) return _c.set(C.dark);
    return _c.set(C.white);
  };
  put(solid, new THREE.CylinderGeometry(R, R, H, 28, 12), bodyCol, x, y0 + H / 2, z);
  // ogive nose via lathe
  const pts = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(new THREE.Vector2(R * Math.sqrt(1 - t * t * 0.98) * (1 - t * 0.02), t * 9)); }
  pts.push(new THREE.Vector2(0, 9.2));
  put(solid, new THREE.LatheGeometry(pts, 28), C.white, x, y0 + H, z);
  // engine skirt + fins
  put(solid, new THREE.CylinderGeometry(R, R * 1.25, 2.5, 28), C.dark, x, y0 + 1.25, z);
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    put(solid, new THREE.BoxGeometry(0.25, 5, 3.0), C.dark, x + Math.cos(a) * (R + 1.2), y0 + 3.2, z + Math.sin(a) * (R + 1.2), 0, -a, 0);
  }
  // side boosters
  for (const s of [-1, 1]) {
    const bx = x + s * (R + 1.3);
    put(solid, new THREE.CylinderGeometry(1.15, 1.15, 22, 18), C.cream, bx, y0 + 11, z);
    put(solid, new THREE.ConeGeometry(1.15, 3.2, 18), C.cream, bx, y0 + 23.6, z);
    put(solid, new THREE.CylinderGeometry(1.0, 1.25, 1.4, 18), C.dark, bx, y0 + 0.7, z);
  }
  // umbilical tower
  const tx = x + 11, th = 52;
  lattice(solid, tx, z, th, 5, C.rust, 0.32);
  put(solid, new THREE.BoxGeometry(6.5, 0.8, 6.5), C.dark, tx, th + 0.4, z);
  put(solid, new THREE.CylinderGeometry(0.2, 0.2, 9, 6), C.steel, tx, th + 5, z);
  for (const hy of [16, 30, 41]) put(solid, new THREE.BoxGeometry(7.5, 0.7, 1.4), C.rustDark, tx - 5.6, y0 + hy, z);
  beacons.push(tx, th + 9.6, z, 4.0, tx - 2.4, th + 0.9, z - 2.4, 2.6, tx + 2.4, th + 0.9, z + 2.4, 2.6);
  // lightning-protection masts
  for (const mx of [x - 18, x + 26]) {
    put(solid, new THREE.CylinderGeometry(0.35, 0.6, 46, 8), C.steel, mx, 23, z - 6);
    beacons.push(mx, 46.6, z - 6, 3.0);
  }
  // pad floodlights
  for (const fx of [x - 13, x + 13]) {
    put(solid, new THREE.CylinderGeometry(0.2, 0.25, 9, 6), C.dark, fx, 7.5, z + 9);
    put(lamps, new THREE.BoxGeometry(1.8, 0.9, 0.3), C.lampW, fx, 12.4, z + 9.2);
  }
  // second, smaller stand far away in the tile
  const x2 = x + W * 0.48, z2 = -185;
  lattice(solid, x2, z2, 34, 4, C.steel, 0.3);
  put(solid, new THREE.BoxGeometry(18, 2, 14), C.concrete, x2, 1, z2);
  put(solid, new THREE.CylinderGeometry(1.5, 1.5, 22, 18), C.white, x2 - 6, 2 + 11, z2);
  put(solid, new THREE.ConeGeometry(1.5, 4, 18), C.white, x2 - 6, 2 + 24, z2);
  beacons.push(x2, 36, z2, 3.0);
  void r;
  return { solid, lamps, beacons };
}

// Mesas and buttes. z -220..-300.
function buildMesas(W, seed) {
  const solid = [];
  const r = rng(seed);
  const strata = ['#8e3a26', '#a24a2c', '#7a3022', '#b0573a', '#86362a'];
  const n = 6;
  for (let i = 0; i < n; i++) {
    const x = -W / 2 + (i + 0.5) * (W / n) + (r() - 0.5) * 50;
    const z = -225 - r() * 110;
    const butte = i % 3 === 1;
    const h = butte ? 38 + r() * 20 : 16 + r() * 30;
    const rt = butte ? 6 + r() * 4 : 14 + r() * 18;
    const rb = rt * (1.25 + r() * 0.35);
    const g = new THREE.CylinderGeometry(rt, rb, h, 14, 7);
    const p = g.attributes.position;
    const nz = makeNoise(16, 100 + i);
    for (let k = 0; k < p.count; k++) {
      const px = p.getX(k), py = p.getY(k), pz = p.getZ(k);
      const a = Math.atan2(pz, px);
      const yy = (py + h / 2) / h;
      if (yy > 0.02 && yy < 0.98) {
        const j = 0.82 + nz((a + Math.PI) * 2.5, yy * 5) * 0.4;
        p.setX(k, px * j); p.setZ(k, pz * j);
      }
      if (yy > 0.99) p.setY(k, py + (nz(a * 3 + 9, 1) - 0.5) * 1.2);
    }
    const sx = butte ? 1 + r() * 0.4 : 1.3 + r() * 1.0;
    _m.compose(_p.set(x, h / 2 - 0.5, z), _q.setFromEuler(_e.set(0, r() * 3, 0)), _s.set(sx, 1, 0.8));
    const off = r() * 10;
    solid.push(prep(g, (px, py, pz, c) => {
      const band = Math.floor((py + off) / 4.2);
      c.set(strata[((band % strata.length) + strata.length) % strata.length]);
      const t = Math.max(0, Math.min(1, py / 50));
      return c.multiplyScalar(0.72 + t * 0.4);
    }, _m));
    // talus skirt
    const sk = new THREE.CylinderGeometry(rb * 0.98, rb * 1.4, h * 0.34, 14, 1);
    _m.compose(_p.set(x, h * 0.17 - 0.3, z), _q, _s.set(sx, 1, 0.8));
    solid.push(prep(sk, '#874230', _m));
  }
  return { solid };
}

// ---------------------------------------------------------------- layer helper
function mergeTile(list, W) {
  if (!list.length) return null;
  const a = mergeGeometries(list, false);
  for (const g of list) g.dispose();
  const b = a.clone();
  b.translate(W, 0, 0);
  const m = mergeGeometries([a, b], false);
  a.dispose(); b.dispose();
  m.computeBoundingSphere();
  return m;
}

function beaconPoints(arr, W, mat) {
  if (!arr.length) return null;
  const n = arr.length / 4;
  const pos = new Float32Array(n * 2 * 3), size = new Float32Array(n * 2), phase = new Float32Array(n * 2);
  for (let c = 0; c < 2; c++) {
    for (let i = 0; i < n; i++) {
      const j = c * n + i;
      pos[j * 3] = arr[i * 4] + c * W; pos[j * 3 + 1] = arr[i * 4 + 1]; pos[j * 3 + 2] = arr[i * 4 + 2];
      size[j] = arr[i * 4 + 3];
      phase[j] = ((i * 2.399) % 6.283);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  return pts;
}

// ---------------------------------------------------------------- main
export function createWorld(renderer, scene) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const disposables = [];

  // --- environment: RoomEnvironment PMREM, emitters tinted to golden hour
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const warm = new THREE.Color(1.0, 0.8, 0.6), cool = new THREE.Color(0.86, 0.72, 1.0);
  let li = 0;
  const seen = new Set();
  room.traverse((o) => {
    if (!o.isMesh || seen.has(o.material)) return;
    seen.add(o.material);
    if (o.material.isMeshBasicMaterial) o.material.color.multiply(li++ % 3 === 2 ? cool : warm);
    else if (o.material.color) o.material.color.multiply(new THREE.Color(1.0, 0.86, 0.78));
  });
  const envTex = pmrem.fromScene(room, 0.04).texture;
  if (room.dispose) room.dispose();
  pmrem.dispose();
  scene.environment = envTex;
  scene.environmentIntensity = 1.25;

  // --- palette (sRGB hex → linear via THREE.Color)
  const col = {
    top: new THREE.Color('#251046'), mid: new THREE.Color('#8e2f6c'), low: new THREE.Color('#ff6326'),
    hor: new THREE.Color('#ffbf72'), below: new THREE.Color('#e9965e'),
    topF: new THREE.Color('#1c0640'), midF: new THREE.Color('#d0218f'), lowF: new THREE.Color('#ff4f9e'),
    horF: new THREE.Color('#ffb2dc'),
    fog: new THREE.Color('#f1a670'), fogF: new THREE.Color('#f7a6cf'),
    hemiSky: new THREE.Color('#c3a6e6'), hemiSkyF: new THREE.Color('#e48ad8'),
  };

  const sunDir = new THREE.Vector3(-0.36, 0.105, -1).normalize();

  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: col.top }, uMid: { value: col.mid }, uLow: { value: col.low }, uHor: { value: col.hor },
      uBelow: { value: col.below },
      uTopF: { value: col.topF }, uMidF: { value: col.midF }, uLowF: { value: col.lowF }, uHorF: { value: col.horF },
      uSunCol: { value: new THREE.Color('#ffe6b0') },
      uRidgeA: { value: new THREE.Color('#b8707a') }, uRidgeB: { value: new THREE.Color('#d99482') },
      uCloudLit: { value: new THREE.Color('#ff9a6a') }, uCloudDark: { value: new THREE.Color('#7a3f6e') },
      uSunDir: { value: sunDir }, uTime: { value: 0 }, uFlip: { value: 0 },
    },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), skyMat);
  sky.frustumCulled = false;
  sky.renderOrder = -1000;
  sky.name = 'sky';
  scene.add(sky);
  disposables.push(sky.geometry, skyMat);

  const fogColor = col.fog.clone();
  scene.fog = new THREE.Fog(fogColor, 70, 620);
  scene.background = fogColor;

  // --- lights
  const hemi = new THREE.HemisphereLight(col.hemiSky.clone(), new THREE.Color('#a85a34'), 0.6);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(new THREE.Color('#ffbb7a'), 2.7);
  sun.position.set(-26, 30, 28);
  sun.target.position.set(0, 4, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -30; sc.right = 30; sc.top = 20; sc.bottom = -16; sc.near = 5; sc.far = 110;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.035;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);

  // --- ground
  const sandTex = sandTexture(renderer);
  const GW = 1400, GD = 640, SAND_TILE = 36;
  sandTex.repeat.set(GW / SAND_TILE, GD / SAND_TILE);
  const groundMat = new THREE.MeshStandardMaterial({ map: sandTex, roughness: 0.96, metalness: 0, color: '#ffffff' });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(GW, GD), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, 40 - GD / 2);
  ground.receiveShadow = true;
  ground.name = 'ground';
  scene.add(ground);
  disposables.push(ground.geometry, groundMat, sandTex);

  const padTex = padTexture(renderer);
  const PAD_TILE = 32;
  padTex.repeat.set(GW / PAD_TILE, 1);
  const padMat = new THREE.MeshStandardMaterial({
    map: padTex, roughness: 0.82, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(GW, 14), padMat);
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(0, 0.005, -1);
  pad.receiveShadow = true;
  pad.name = 'pad';
  scene.add(pad);
  disposables.push(pad.geometry, padMat, padTex);

  // --- parallax layers
  const solidMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.15 });
  const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, flatShading: true });
  const mesaMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, flatShading: true });
  const lampMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const wireMat = new THREE.LineBasicMaterial({ color: '#3a2a26' });
  const beaconMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uHalfH: { value: 400 }, uColor: { value: new THREE.Color(1.0, 0.12, 0.05) } },
    vertexShader: BEACON_VERT, fragmentShader: BEACON_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  disposables.push(solidMat, rockMat, mesaMat, lampMat, wireMat, beaconMat);

  const layers = [];
  function addLayer(name, W, factor, parts, opts = {}) {
    const group = new THREE.Group();
    group.name = 'layer-' + name;
    const add = (list, mat, shadow) => {
      const g = mergeTile(list, W);
      if (!g) return;
      const m = new THREE.Mesh(g, mat);
      m.castShadow = !!shadow; m.receiveShadow = !!shadow;
      group.add(m);
      disposables.push(g);
    };
    add(parts.solid || [], opts.mat || solidMat, opts.shadow);
    add(parts.lamps || [], lampMat, false);
    if (parts.wires && parts.wires.length) {
      const w = parts.wires;
      const arr = new Float32Array(w.length * 2);
      arr.set(w, 0);
      for (let i = 0; i < w.length; i += 3) { arr[w.length + i] = w[i] + W; arr[w.length + i + 1] = w[i + 1]; arr[w.length + i + 2] = w[i + 2]; }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      const ls = new THREE.LineSegments(g, wireMat);
      ls.frustumCulled = false;
      group.add(ls);
      disposables.push(g);
    }
    if (parts.beacons) {
      const pts = beaconPoints(parts.beacons, W, beaconMat);
      if (pts) { group.add(pts); disposables.push(pts.geometry); }
    }
    scene.add(group);
    layers.push({ group, W, factor, offset: (opts.phase || 0) * W });
  }

  addLayer('near', 160, 1.0, buildNear(160, 3), { mat: rockMat, shadow: true });
  addLayer('poles', 200, 1.0, buildPoles(200));
  addLayer('industry', 340, 0.8, buildIndustry(340, 5));
  addLayer('rocket', 440, 0.55, buildRocket(440, 9), { phase: 0.15 });
  addLayer('mesas', 720, 0.22, buildMesas(720, 17), { mat: mesaMat });

  // --- flip state
  let flipTarget = 0, flip = 0;
  const drawSize = new THREE.Vector2();

  function update(dt, speed, t) {
    dt = Math.min(dt || 0, 0.1);
    const v = speed || 0;

    // ground scroll (same rate as the near layer → props stay glued to the sand)
    sandTex.offset.x = (sandTex.offset.x + (v * dt) / SAND_TILE) % 1;
    padTex.offset.x = (padTex.offset.x + (v * dt) / PAD_TILE) % 1;

    for (let i = 0; i < layers.length; i++) {
      const L = layers[i];
      L.offset = (L.offset + v * L.factor * dt) % L.W;
      L.group.position.x = -L.offset;
    }

    // flip tint
    const k = 1 - Math.exp(-dt * 4);
    flip += (flipTarget - flip) * k;
    skyMat.uniforms.uFlip.value = flip;
    fogColor.copy(col.fog).lerp(col.fogF, flip);
    scene.fog.color.copy(fogColor);
    hemi.color.copy(col.hemiSky).lerp(col.hemiSkyF, flip);

    skyMat.uniforms.uTime.value = t;
    beaconMat.uniforms.uTime.value = t;
    renderer.getDrawingBufferSize(drawSize);
    beaconMat.uniforms.uHalfH.value = drawSize.y * 0.5;
  }

  function setFlip(amount) {
    flipTarget = Math.max(0, Math.min(1, amount || 0));
  }

  function dispose() {
    for (const d of disposables) d.dispose();
    envTex.dispose();
  }

  return { update, setFlip, dispose, sun, hemi };
}
