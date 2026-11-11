// HAIR FORCE — golden luxury tower obstacle with a giant swept pompadour at the free tip.
// Caricature by hair only: no face, no names, no text, no logos.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const TOWER_WIDTH = 2.8;          // collision width (X)
const TIP_EXTRA = 1.2;                   // hair height beyond `height` used for collision
const HAIR_TOP = 1.02;                   // rest-pose hair top (leaves room for the springy bounce)
const HALF = TOWER_WIDTH / 2;
const PLINTH_H = 1.0;

// ---------------------------------------------------------------- shared resources (built once, lazily)
let S = null;

function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  return t;
}

// deterministic PRNG so every tower shares the same façade
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const COLS = 7, FLOORS = 22;            // per texture tile: 2.8 m wide × 12 m tall
const TILE_H = 12;

function buildFacadeTextures() {
  const W = 384, H = 1024, cw = W / COLS, fh = H / FLOORS;
  const r = rng(7);
  const lit = [];
  for (let f = 0; f < FLOORS; f++) for (let c = 0; c < COLS; c++) lit.push(r());
  const map = canvasTex(W, H, (g) => {
    // mirror-gold glass panes (metal tint), bright gilt mullions + spandrels
    for (let f = 0; f < FLOORS; f++) for (let c = 0; c < COLS; c++) {
      const v = 0.85 + 0.15 * r();
      const grd = g.createLinearGradient(0, f * fh, 0, (f + 1) * fh);
      grd.addColorStop(0, `rgb(${178 * v | 0},${124 * v | 0},${46 * v | 0})`);
      grd.addColorStop(1, `rgb(${120 * v | 0},${80 * v | 0},${26 * v | 0})`);
      g.fillStyle = grd;
      g.fillRect(c * cw, f * fh, cw, fh);
    }
    g.fillStyle = '#f2cf78';
    for (let f = 0; f <= FLOORS; f++) g.fillRect(0, f * fh - 5, W, 10);   // spandrels
    for (let c = 0; c <= COLS; c++) g.fillRect(c * cw - 3, 0, 6, H);       // mullions
  });
  const emissive = canvasTex(W, H, (g) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    let i = 0;
    for (let f = 0; f < FLOORS; f++) for (let c = 0; c < COLS; c++, i++) {
      const p = lit[i];
      if (p < 0.42) {
        const k = 0.55 + p;
        g.fillStyle = `rgb(255,${(190 * k) | 0},${(95 * k) | 0})`;
        g.fillRect(c * cw + 5, f * fh + 7, cw - 10, fh - 14);
        g.fillStyle = 'rgba(0,0,0,0.35)';                       // blind line
        g.fillRect(c * cw + 5, f * fh + 7, cw - 10, 4);
      }
    }
  });
  const rough = canvasTex(W, H, (g) => {
    g.fillStyle = 'rgb(0,30,0)'; g.fillRect(0, 0, W, H);       // panes: mirror
    g.fillStyle = 'rgb(0,95,0)';                                // gilt: satin
    for (let f = 0; f <= FLOORS; f++) g.fillRect(0, f * fh - 5, W, 10);
    for (let c = 0; c <= COLS; c++) g.fillRect(c * cw - 3, 0, 6, H);
  }, false);
  return { map, emissive, rough };
}

function buildHairTexture() {
  // streaks run along the strand (u); variation across the strand (v)
  const r = rng(42);
  return canvasTex(8, 64, (g, w, h) => {
    for (let y = 0; y < h; y++) {
      const groove = Math.pow(Math.abs(Math.sin((Math.PI * 3 * y) / h)), 0.45);
      const v = 0.6 + 0.32 * groove + 0.08 * r();
      const c = Math.min(255, 255 * v);
      g.fillStyle = `rgb(${c | 0},${(c * 0.97) | 0},${(c * 0.9) | 0})`;
      g.fillRect(0, y, w, 1);
    }
  });
}

function buildTieTexture() {
  return canvasTex(64, 64, (g) => {
    g.fillStyle = '#c4101c'; g.fillRect(0, 0, 64, 64);
    g.strokeStyle = '#8a0712'; g.lineWidth = 7;
    for (let k = -64; k < 128; k += 22) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + 64, 64); g.stroke(); }
  });
}

function buildGlowTexture() {
  return canvasTex(128, 128, (g) => {
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,220,130,0.9)');
    grd.addColorStop(0.35, 'rgba(255,190,80,0.35)');
    grd.addColorStop(1, 'rgba(255,170,60,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  });
}

// Tapered, flattened tube along a smooth curve. fx = thickness factor (Frenet normal), fy = width factor (binormal).
function strand(points, radius, fx, fy, tubular = 40, radial = 10, taper) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const g = new THREE.TubeGeometry(curve, tubular, radius, radial, false);
  const pos = g.attributes.position;
  const P = new THREE.Vector3(), v = new THREE.Vector3();
  const tp = taper || ((u) => Math.pow(Math.sin(Math.PI * (0.06 + 0.88 * u)), 0.55));
  for (let i = 0; i <= tubular; i++) {
    curve.getPointAt(i / tubular, P);
    const N = g.normals[i], B = g.binormals[i], s = tp(i / tubular);
    for (let j = 0; j <= radial; j++) {
      const idx = i * (radial + 1) + j;
      v.fromBufferAttribute(pos, idx).sub(P);
      const a = v.dot(N) * fx * s, b = v.dot(B) * fy * s;
      pos.setXYZ(idx, P.x + N.x * a + B.x * b, P.y + N.y * a + B.y * b, P.z + N.z * a + B.z * b);
    }
  }
  g.computeVertexNormals();
  return g;
}

function ellipsoid(cx, cy, cz, sx, sy, sz) {
  const g = new THREE.SphereGeometry(1, 36, 22);
  g.scale(sx, sy, sz).translate(cx, cy, cz);
  return g;
}

// Hair space: origin at the shaft tip centre, +Y away from the tower, -X = "forward" (toward the player).
function buildHairGeometries() {
  // 1) under-volume: rounded crown + back/side wings that hug the top of the shaft (darker roots)
  const cap = mergeGeometries([
    ellipsoid(0.35, 0.0, 0, 1.45, 0.72, 1.24),
    ellipsoid(0.62, -0.62, 0, 1.22, 0.86, 1.3),
  ]);

  // 2) the big swept layer: nape → up the back → over the crown → forward to a high front peak.
  //    Strands start at a side part (-Z) and sweep across (+Z) like a comb-over.
  const prof = [[1.3, -1.1], [1.7, -0.45], [1.55, 0.25], [0.95, 0.68], [0.0, 0.84], [-0.8, 0.94], [-1.4, 0.84], [-1.68, 0.6], [-1.62, 0.38]];
  const zs = [-1.14, -0.8, -0.46, -0.12, 0.22, 0.56, 0.9];
  const swoopParts = zs.map((z0) => {
    const k = z0 / 1.15, dome = 1 - 0.42 * k * k, narrow = 1 - 0.16 * k * k;
    const pts = prof.map(([x, y], i) => {
      const s = i / (prof.length - 1);
      return new THREE.Vector3(x * narrow, y > 0 ? y * dome : y, z0 * (1 - 0.1 * s) + 0.34 * s);
    });
    return strand(pts, 0.34, 0.62, 1.3, 48, 10,
      (u) => Math.pow(Math.sin(Math.PI * (0.05 + 0.9 * u)), 0.5) * (0.8 + 0.4 * u));
  });
  // side wings: strands swept from the temples back over the "ears" to the nape, stacked in layers
  for (const sd of [-1, 1]) {
    for (let l = 0; l < 4; l++) {
      const dy = -0.34 * l, zz = sd * (1.0 + 0.04 * l);
      swoopParts.push(strand([
        new THREE.Vector3(-1.08 + 0.12 * l, 0.5 + dy, zz * 1.0),
        new THREE.Vector3(-0.45, 0.4 + dy, zz * 1.3),
        new THREE.Vector3(0.45, 0.18 + dy, zz * 1.38),
        new THREE.Vector3(1.25, -0.3 + dy * 0.9, zz * 1.28),
        new THREE.Vector3(1.6, -0.95 + dy * 0.6, zz * 0.9),
      ], 0.3, 1.5, 0.45, 40, 10, (u) => Math.pow(Math.sin(Math.PI * (0.04 + 0.92 * u)), 0.5) * (1.05 - 0.3 * u)));
    }
  }
  const swoop = mergeGeometries(swoopParts);

  // 3) front pompadour swoop: a lighter, puffier wave that rises off the crown, overhangs forward
  //    and flicks down at the tip (pivot at its root; geometry stored relative to pivot)
  const LIP_PIVOT = new THREE.Vector3(-0.1, 0.85, 0.2);
  const lipProf = [[0.3, 0.8], [-0.45, 0.98], [-1.15, 1.02], [-1.65, 0.9], [-1.95, 0.64], [-1.92, 0.4], [-1.68, 0.3]];
  const lipParts = [-0.75, -0.3, 0.15, 0.6, 1.0].map((z0) => {
    const k = (z0 - 0.12) / 0.95, dome = 1 - 0.3 * k * k;
    const pts = lipProf.map(([x, y], i) => {
      const s = i / (lipProf.length - 1);
      return new THREE.Vector3(x * (1 - 0.12 * k * k), y * dome, z0 + 0.22 * s);
    });
    return strand(pts, 0.32, 0.62, 1.32, 44, 10,
      (u) => Math.pow(Math.sin(Math.PI * (0.03 + 0.94 * u)), 0.5) * (0.7 + 0.5 * Math.sin(Math.PI * u)));
  });
  const lip = mergeGeometries(lipParts);

  // 4) the loose comb-over flap that crosses the dome diagonally (lifts like a lid in wind)
  const FLAP_PIVOT = new THREE.Vector3(1.35, -0.1, -1.05);
  const flap = strand([
    new THREE.Vector3(1.35, -0.1, -1.05),
    new THREE.Vector3(1.22, 0.5, -0.9),
    new THREE.Vector3(0.5, 0.86, -0.4),
    new THREE.Vector3(-0.45, 0.93, 0.3),
    new THREE.Vector3(-1.15, 0.74, 0.95),
    new THREE.Vector3(-1.42, 0.4, 1.3),
  ], 0.36, 0.3, 1.75, 48, 12);

  // honest collision: squash everything above the tip so the hairdo never exceeds HAIR_TOP
  let maxY = 0;
  for (const g of [cap, swoop, lip, flap]) { g.computeBoundingBox(); maxY = Math.max(maxY, g.boundingBox.max.y); }
  const k = Math.min(1, HAIR_TOP / maxY);
  for (const g of [cap, swoop, lip, flap]) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y > 0) p.setY(i, y * k); }
    p.needsUpdate = true; g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
  }
  LIP_PIVOT.y *= k; FLAP_PIVOT.y = FLAP_PIVOT.y > 0 ? FLAP_PIVOT.y * k : FLAP_PIVOT.y;
  lip.translate(-LIP_PIVOT.x, -LIP_PIVOT.y, -LIP_PIVOT.z);
  flap.translate(-FLAP_PIVOT.x, -FLAP_PIVOT.y, -FLAP_PIVOT.z);

  return { cap, swoop, lip, flap, LIP_PIVOT, FLAP_PIVOT };
}

function boxUV(w, h, d, uScale, vScale) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uScale, uv.getY(i) * vScale);
  return g;
}

function shared() {
  if (S) return S;
  const fac = buildFacadeTextures();
  const hairTex = buildHairTexture();
  hairTex.repeat.set(1, 1);
  const tieTex = buildTieTexture();
  tieTex.repeat.set(1, 6);
  const mats = {
    glass: new THREE.MeshPhysicalMaterial({
      color: 0xffffff, map: fac.map, metalness: 1.0, roughness: 1.0, roughnessMap: fac.rough,
      emissive: 0xffb45a, emissiveMap: fac.emissive, emissiveIntensity: 1.5, envMapIntensity: 1.15,
      clearcoat: 0.6, clearcoatRoughness: 0.08,
    }),
    gold: new THREE.MeshStandardMaterial({ color: 0xe0ac45, metalness: 1, roughness: 0.22, envMapIntensity: 1.2 }),
    hairBase: new THREE.MeshPhysicalMaterial({
      color: 0xb87a24, roughness: 0.5, sheen: 0.7, sheenColor: new THREE.Color(0xffc860), sheenRoughness: 0.45,
    }),
    black: new THREE.MeshPhysicalMaterial({ color: 0x0c0b0d, metalness: 0.2, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.05 }),
    hair: new THREE.MeshPhysicalMaterial({
      color: 0xd0801a, map: hairTex, bumpMap: hairTex, bumpScale: 0.6, roughness: 0.4, metalness: 0.0,
      sheen: 0.35, sheenColor: new THREE.Color(0xffb040), sheenRoughness: 0.35,
      anisotropy: 0.75, clearcoat: 0.25, clearcoatRoughness: 0.35, envMapIntensity: 0.9,
    }),
    hairLight: new THREE.MeshPhysicalMaterial({
      color: 0xe39a26, map: hairTex, bumpMap: hairTex, bumpScale: 0.6, roughness: 0.36,
      sheen: 0.45, sheenColor: new THREE.Color(0xffc45a), sheenRoughness: 0.3,
      anisotropy: 0.8, clearcoat: 0.3, clearcoatRoughness: 0.3, envMapIntensity: 0.9,
    }),
    tie: new THREE.MeshPhysicalMaterial({
      color: 0xffffff, map: tieTex, roughness: 0.45, sheen: 1, sheenColor: new THREE.Color(0xff8080),
      sheenRoughness: 0.4, side: THREE.DoubleSide, emissive: 0x300000,
    }),
    glow: new THREE.SpriteMaterial({
      map: buildGlowTexture(), color: 0xffd27a, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, opacity: 0.8,
    }),
  };
  const hair = buildHairGeometries();
  const geos = {
    plinth: boxUV(3.2, PLINTH_H, 3.2, 1, 1),
    band: new THREE.BoxGeometry(3.32, 0.16, 3.32).translate(0, PLINTH_H - 0.1, 0),
    collar: new THREE.BoxGeometry(2.95, 0.12, 2.95),
    knot: (() => { const g = new THREE.CylinderGeometry(0.2, 0.12, 0.34, 10, 1); g.scale(1, 1, 0.55); return g; })(),
  };
  const byHeight = new Map();
  S = { mats, hair, geos, byHeight };
  return S;
}

// per-height geometry: shaft + setbacks + fins + cornices (cached by 0.1 m bucket)
function heightGeos(height) {
  const key = Math.round(height * 10) / 10;
  const S0 = shared();
  let e = S0.byHeight.get(key);
  if (e) return e;
  const L = Math.max(1.5, key - PLINTH_H);
  const s2 = Math.min(1.0, L * 0.12), s1 = Math.min(1.5, L * 0.16);
  const main = L - s1 - s2;
  const y0 = PLINTH_H, y1 = y0 + main, y2 = y1 + s1, y3 = y2 + s2;
  const W1 = 2.4, W2 = 2.0;
  const glass = mergeGeometries([
    boxUV(TOWER_WIDTH, main, TOWER_WIDTH, 1, main / TILE_H).translate(0, y0 + main / 2, 0),
    boxUV(W1, s1, W1, W1 / TOWER_WIDTH, s1 / TILE_H).translate(0, y1 + s1 / 2, 0),
    boxUV(W2, s2, W2, W2 / TOWER_WIDTH, s2 / TILE_H).translate(0, y2 + s2 / 2, 0),
  ]);
  const gilt = [];
  // vertical fins on all four faces of the main shaft
  for (let c = 0; c <= COLS; c++) {
    const p = -HALF + (c * TOWER_WIDTH) / COLS;
    const fw = c === 0 || c === COLS ? 0.14 : 0.07;
    gilt.push(new THREE.BoxGeometry(fw, main, 0.16).translate(p, y0 + main / 2, HALF + 0.04));
    gilt.push(new THREE.BoxGeometry(fw, main, 0.16).translate(p, y0 + main / 2, -HALF - 0.04));
    gilt.push(new THREE.BoxGeometry(0.16, main, fw).translate(HALF + 0.04, y0 + main / 2, p));
    gilt.push(new THREE.BoxGeometry(0.16, main, fw).translate(-HALF - 0.04, y0 + main / 2, p));
  }
  // setback fins (corners only) + cornices at every step
  for (const [w, yb, h] of [[W1, y1, s1]]) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      gilt.push(new THREE.BoxGeometry(0.12, h, 0.12).translate(sx * w / 2, yb + h / 2, sz * w / 2));
    }
  }
  gilt.push(new THREE.BoxGeometry(TOWER_WIDTH + 0.32, 0.18, TOWER_WIDTH + 0.32).translate(0, y1, 0));
  gilt.push(new THREE.BoxGeometry(W1 + 0.26, 0.16, W1 + 0.26).translate(0, y2, 0));
  gilt.push(new THREE.BoxGeometry(W2 + 0.22, 0.2, W2 + 0.22).translate(0, y3 - 0.1, 0));
  gilt.push(new THREE.BoxGeometry(TOWER_WIDTH + 0.22, 0.14, TOWER_WIDTH + 0.22).translate(0, y0 + 0.07, 0));
  const fins = mergeGeometries(gilt.map((g) => g.deleteAttribute('uv') && g));
  e = { glass, fins, top: y3, collarY: y0 };
  S0.byHeight.set(key, e);
  return e;
}

// ---------------------------------------------------------------- tie ribbon (per bonus instance, animated)
const TIE_ROWS = 26;
function tieWidth(s) {
  if (s < 0.06) return 0.34;
  if (s < 0.9) return 0.34 + (s - 0.06) / 0.84 * 0.42;
  return 0.76 * (1 - (s - 0.9) / 0.1) + 0.001;
}
function createTieGeometry() {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(TIE_ROWS * 2 * 3), uv = new Float32Array(TIE_ROWS * 2 * 2), idx = [];
  for (let i = 0; i < TIE_ROWS; i++) {
    const s = i / (TIE_ROWS - 1);
    uv.set([0, s, 1, s], i * 4);
    if (i < TIE_ROWS - 1) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- factory
export function createTower({ height = 8, fromTop = false, bonus = false } = {}) {
  const R = shared();
  const { mats, hair, geos } = R;
  const hg = heightGeos(height);
  const shaftTop = hg.top;                 // == height (bucketed)

  const group = new THREE.Group();
  group.name = fromTop ? 'tower-top' : 'tower-bottom';
  const body = new THREE.Group();          // built upright, flipped for ceiling towers
  if (fromTop) body.rotation.x = Math.PI;  // keeps +X forward, tip points -Y
  group.add(body);

  const mesh = (geo, mat, parent, shadow = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = shadow; m.receiveShadow = true;
    parent.add(m);
    return m;
  };

  // plinth / ceiling collar
  mesh(geos.plinth, mats.black, body).position.y = PLINTH_H / 2;
  mesh(geos.band, mats.gold, body);
  // shaft + setbacks, gilded fins & cornices
  mesh(hg.glass, mats.glass, body);
  mesh(hg.fins, mats.gold, body);

  // hairdo rig
  const hairRoot = new THREE.Group();
  hairRoot.position.y = shaftTop;
  body.add(hairRoot);
  const hairSway = new THREE.Group();      // springy sway pivot at the tip
  hairRoot.add(hairSway);
  mesh(hair.cap, mats.hairBase, hairSway);
  mesh(hair.swoop, mats.hair, hairSway);
  const lipPivot = new THREE.Group();
  lipPivot.position.copy(hair.LIP_PIVOT);
  hairSway.add(lipPivot);
  mesh(hair.lip, mats.hairLight, lipPivot);
  const flapPivot = new THREE.Group();
  flapPivot.position.copy(hair.FLAP_PIVOT);
  hairSway.add(flapPivot);
  mesh(hair.flap, mats.hairLight, flapPivot);
  // hanging towers reuse the same rig: rotation.x = PI flips the hairdo so it flops downward

  // bonus: long red necktie + golden glow
  let tie = null, tieGeo = null, glow = null;
  const tipSign = fromTop ? -1 : 1;
  if (bonus) {
    tieGeo = createTieGeometry();
    tie = mesh(tieGeo, mats.tie, group);
    tie.frustumCulled = false;
    const knot = mesh(geos.knot, mats.tie, group);
    if (fromTop) {
      knot.position.set(-0.2, tipSign * (shaftTop - 0.25), 1.12);
      knot.rotation.z = Math.PI / 2 + 0.3;
    } else {
      knot.position.set(-0.1, shaftTop - 1.15, 1.18);
      knot.rotation.x = Math.PI; // narrow end down
    }
    glow = new THREE.Sprite(mats.glow);
    glow.position.set(-0.2, tipSign * (shaftTop + 0.2), 0.5);
    glow.scale.setScalar(5.5);
    group.add(glow);
  }

  // springs
  const phase = Math.random() * Math.PI * 2;
  const sp = { a: 0, v: 0, lip: 0, lipV: 0, flap: 0, flapV: 0, bob: 0, bobV: 0 };
  const spring = (x, v, target, k, c, dt) => {
    v += (-k * (x - target) - c * v) * dt;
    return [x + v * dt, v];
  };

  const tmpC = new THREE.Vector3();
  function updateTie(t, wind) {
    const pos = tieGeo.attributes.position;
    const L = fromTop ? 3.4 : 4.6;
    const amp = 0.12 + 0.55 * wind;
    for (let i = 0; i < TIE_ROWS; i++) {
      const s = i / (TIE_ROWS - 1);
      const wv = Math.sin(t * (6 + 5 * wind) - s * 7 + phase) * amp * Math.pow(s, 1.25);
      const wv2 = Math.sin(t * 3.1 - s * 4 + phase * 1.7) * 0.18 * s;
      let cx, cy, cz, ax, ay;           // centre + across-ribbon axis (in XY)
      if (fromTop) {
        // streams backward (+X) from the hanging tip, sagging a little
        cx = -0.2 + s * L * 0.95; cy = -(shaftTop - 0.25) - s * L * 0.28 - s * s * 0.5 + wv;
        cz = 1.12 + wv2 * 0.6;
        ax = 0.28; ay = 0.96;
      } else {
        // hangs down the camera-facing front face, swinging back (+X) with the airflow
        cx = -0.1 + s * s * (0.35 + 0.9 * wind) + wv; cy = shaftTop - 1.15 - s * L;
        cz = 1.5 + 0.06 * s + Math.max(0, wv2) * 0.8;
        ax = 1; ay = 0.12 * Math.sin(t * 5 + s * 6);
      }
      const hw = tieWidth(s) / 2, tw = Math.sin(t * 4 - s * 5 + phase) * 0.25 * s;
      tmpC.set(ax, ay, tw).normalize().multiplyScalar(hw);
      pos.setXYZ(i * 2, cx - tmpC.x, cy - tmpC.y, cz - tmpC.z);
      pos.setXYZ(i * 2 + 1, cx + tmpC.x, cy + tmpC.y, cz + tmpC.z);
    }
    pos.needsUpdate = true;
    tieGeo.computeVertexNormals();
  }
  if (bonus) updateTie(0, 0);

  function update(dt, t, wind = 0) {
    dt = Math.min(Math.max(dt || 0, 0), 1 / 20);
    const w = Math.min(1, Math.max(0, wind || 0));
    // whole hairdo: gentle idle sway, big springy flap when the car is close
    const tA = 0.03 * Math.sin(t * 1.6 + phase) + w * (0.02 + 0.05 * Math.sin(t * 11 + phase));
    [sp.a, sp.v] = spring(sp.a, sp.v, tA, 60, 5, dt);
    hairSway.rotation.z = Math.min(0.07, Math.max(-0.07, sp.a));
    hairSway.rotation.x = 0.03 * Math.sin(t * 1.2 + phase * 0.7) + w * 0.06 * Math.sin(t * 9.3);
    const tB = 0.03 * Math.sin(t * 2.4 + phase) + w * 0.05 * Math.sin(t * 13 + 1.0);
    [sp.bob, sp.bobV] = spring(sp.bob, sp.bobV, tB, 90, 6, dt);
    const bob = Math.min(0.04, Math.max(-0.06, sp.bob));
    const sy = 1 + bob;
    hairSway.scale.y = sy; hairSway.scale.x = 1 - bob * 0.5;
    // pompadour roll flops (positive z = flop down/forward)
    const tL = 0.05 + 0.05 * Math.sin(t * 2.1 + phase) + w * (0.2 + 0.22 * Math.sin(t * 15 + phase));
    [sp.lip, sp.lipV] = spring(sp.lip, sp.lipV, tL, 80, 4, dt);
    lipPivot.rotation.z = Math.min(0.5, Math.max(-0.12, sp.lip));
    // comb-over flap lifts like a lid in the airflow
    const tF = 0.03 + 0.03 * Math.sin(t * 1.9 + phase) + w * (0.12 + 0.1 * Math.sin(t * 19 + phase));
    [sp.flap, sp.flapV] = spring(sp.flap, sp.flapV, tF, 70, 3.5, dt);
    flapPivot.rotation.z = -Math.min(0.1, Math.max(-0.05, sp.flap));
    flapPivot.rotation.y = 0.8 * Math.min(0.25, Math.max(0, sp.flap)); // peels outward, toward camera
    if (bonus) {
      updateTie(t, w);
      glow.material.opacity = 0.45 + 0.15 * Math.sin(t * 3) + 0.15 * w; // shared mat; harmless
    }
  }

  function dispose() {
    if (group.parent) group.parent.remove(group);
    if (tieGeo) tieGeo.dispose();
    // shared geometries/materials are cached at module level and intentionally kept alive
  }

  return { group, tipExtra: TIP_EXTRA, update, dispose };
}
