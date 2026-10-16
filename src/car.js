// AEROLUX — original low wedge two-seat electric hypercar with cold-gas air thrusters.
// Procedural geometry only. Origin = centre of mass, nose +X, wheels touch y = -0.55.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const WHEEL_R = 0.36;
const GROUND_Y = -0.55;
const WHEEL_CY = GROUND_Y + WHEEL_R;
const ARCH_R = 0.435;
const WHEEL_X = [1.5, -1.45];
const XF = 2.32;   // nose tip
const XR = -2.32;  // tail
const NOSE_ROUND = 0.14;
const TAIL_ROUND = 0.12;

// ---------- side profile / plan keys (x ascending) ----------
const TOP = [[-2.32, 0.27], [-2.1, 0.37], [-1.8, 0.43], [-1.42, 0.46], [-1.0, 0.41], [-0.4, 0.33], [0.2, 0.31],
  [0.7, 0.30], [1.1, 0.35], [1.5, 0.40], [1.8, 0.26], [2.05, 0.06], [2.32, -0.13]];
const BOT = [[-2.32, -0.24], [-2.1, -0.33], [-1.85, -0.40], [1.6, -0.40], [1.95, -0.36], [2.32, -0.25]];
const HW = [[-2.32, 0.86], [-2.0, 0.97], [-1.42, 1.0], [-0.9, 0.95], [-0.3, 0.885], [0.4, 0.89], [0.9, 0.93],
  [1.42, 0.975], [1.8, 0.92], [2.05, 0.80], [2.22, 0.64], [2.32, 0.50]];
const DIP = [[-2.32, 0.04], [-1.9, 0.08], [-1.42, 0.10], [-0.9, 0.03], [-0.4, 0.0], [0.5, 0.0], [0.9, 0.04],
  [1.5, 0.08], [1.9, 0.04], [2.32, 0.0]];

function cr(keys, x) {
  const n = keys.length;
  if (x <= keys[0][0]) return keys[0][1];
  if (x >= keys[n - 1][0]) return keys[n - 1][1];
  let i = 0;
  while (x > keys[i + 1][0]) i++;
  const p0 = keys[Math.max(i - 1, 0)][1], p1 = keys[i][1], p2 = keys[i + 1][1], p3 = keys[Math.min(i + 2, n - 1)][1];
  const t = (x - keys[i][0]) / (keys[i + 1][0] - keys[i][0]);
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

function params(x) {
  let top = cr(TOP, x), bot = cr(BOT, x), hw = cr(HW, x), dip = cr(DIP, x);
  let archY = -Infinity;
  for (const wx of WHEEL_X) {
    const dx = x - wx;
    if (Math.abs(dx) < ARCH_R) archY = Math.max(archY, WHEEL_CY + Math.sqrt(ARCH_R * ARCH_R - dx * dx));
  }
  const uf = Math.max(0, (x - (XF - NOSE_ROUND)) / NOSE_ROUND);
  const ur = Math.max(0, ((XR + TAIL_ROUND) - x) / TAIL_ROUND);
  const u = Math.min(1, Math.max(uf, ur));
  const f = Math.sqrt(Math.max(0, 1 - u * u));
  hw *= Math.max(f, 0.012);
  const mid = (top + bot) / 2, fh = 0.62 + 0.38 * f;
  top = mid + (top - mid) * fh;
  bot = mid + (bot - mid) * fh;
  dip *= f;
  const arch = archY > bot;
  const lowY = Math.max(bot, archY);
  const yb = Math.max(bot + 0.52 * (top - bot), lowY + 0.05);
  return { top, bot, hw, dip, lowY, yb, arch };
}

// right half of the cross-section: [z, y] from top centre to bottom centre (23 points)
const M1 = 14, M2 = 5, SIDE_END = M1 + M2;
function contour(p) {
  const pts = [];
  const e = 0.55;
  for (let i = 0; i <= M1; i++) {
    const a = (i / M1) * Math.PI / 2;
    const zn = Math.pow(Math.sin(a), e), yn = Math.pow(Math.cos(a), e);
    pts.push([p.hw * zn, p.yb + (p.top - p.yb) * yn - p.dip * (1 - zn * zn)]);
  }
  for (let i = 1; i <= M2; i++) {
    const s = i / M2;
    pts.push([p.hw * (1 - 0.05 * s * s), p.yb + (p.lowY - p.yb) * s]);
  }
  const innerZ = p.arch ? p.hw - 0.42 : p.hw * 0.55;
  pts.push([innerZ, p.lowY]);
  pts.push([innerZ * 0.98, p.bot]);
  pts.push([0, p.bot]);
  return pts;
}

// outer side-surface z at (x, y), searching the side wall upward
function surfZ(x, y) {
  const pts = contour(params(x));
  for (let j = SIDE_END; j >= 1; j--) {
    const a = pts[j], b = pts[j - 1];
    const lo = Math.min(a[1], b[1]), hi = Math.max(a[1], b[1]);
    if (y >= lo && y <= hi && hi > lo) {
      const t = (y - a[1]) / (b[1] - a[1]);
      return a[0] + (b[0] - a[0]) * t;
    }
  }
  return params(x).hw;
}

// top surface y at (x, z) on the upper squircle
function topY(x, z) {
  const pts = contour(params(x));
  const az = Math.abs(z);
  for (let j = 0; j < M1; j++) {
    const a = pts[j], b = pts[j + 1];
    if (az >= a[0] && az <= b[0] && b[0] > a[0]) return a[1] + (b[1] - a[1]) * (az - a[0]) / (b[0] - a[0]);
  }
  return pts[0][1];
}

// extrusion of an (x, z) plan shape laid onto the top surface; depth goes up
function onTop(pts, depth, inset) {
  const g = new THREE.ExtrudeGeometry(shapeFrom(pts), { depth, bevelEnabled: false });
  const out = prep(g);
  const p = out.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), zz = p.getY(i), d = p.getZ(i);
    p.setXYZ(i, x, topY(x, zz) - inset + d, zz);
  }
  out.computeVertexNormals();
  return out;
}

function bodyGeometry() {
  const xs = new Set();
  for (let x = XR; x <= XF + 1e-6; x += 0.035) xs.add(+x.toFixed(4));
  for (let k = 0; k <= 14; k++) {
    const s = Math.sin((k / 14) * Math.PI / 2);
    xs.add(+(XF - NOSE_ROUND + NOSE_ROUND * s).toFixed(4));
    xs.add(+(XR + TAIL_ROUND - TAIL_ROUND * s).toFixed(4));
  }
  for (const wx of WHEEL_X) for (const d of [-1, 1]) {
    xs.add(+(wx + d * (ARCH_R - 0.0015)).toFixed(4));
    xs.add(+(wx + d * (ARCH_R + 0.0015)).toFixed(4));
    for (let k = 1; k < 8; k++) xs.add(+(wx + d * ARCH_R * (1 - k * k / 64)).toFixed(4));
  }
  xs.add(XF); xs.add(XR);
  const stations = [...xs].filter(x => x >= XR && x <= XF).sort((a, b) => a - b);

  const pos = [];
  let R = 0;
  for (const x of stations) {
    const right = contour(params(x));
    const ring = right.concat(right.slice(1, -1).reverse().map(([z, y]) => [-z, y]));
    R = ring.length;
    for (const [z, y] of ring) pos.push(x, y, z);
  }
  const S = stations.length;
  const idx = [];
  for (let i = 0; i < S - 1; i++) for (let j = 0; j < R; j++) {
    const a = i * R + j, b = (i + 1) * R + j, c = i * R + (j + 1) % R, d = (i + 1) * R + (j + 1) % R;
    idx.push(a, c, b, c, d, b);
  }
  // end caps (fan to ring centroid)
  for (const [i, dir] of [[0, -1], [S - 1, 1]]) {
    let cx = 0, cy = 0, cz = 0;
    for (let j = 0; j < R; j++) { cx += pos[(i * R + j) * 3]; cy += pos[(i * R + j) * 3 + 1]; cz += pos[(i * R + j) * 3 + 2]; }
    const ci = pos.length / 3;
    pos.push(cx / R, cy / R, cz / R);
    for (let j = 0; j < R; j++) {
      const a = i * R + j, b = i * R + (j + 1) % R;
      // ring runs top -> +z -> bottom -> -z, viewed from +x that is clockwise
      if (dir > 0) idx.push(ci, b, a); else idx.push(ci, a, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function canopyGeometry() {
  let g = new THREE.SphereGeometry(1, 72, 28, 0, Math.PI * 2, 0, Math.PI / 2);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const X = x > 0 ? x * 1.22 : x * 1.6;
    const rake = x > 0 ? 1 - 0.38 * x * x : 1 - 0.1 * x * x;
    p.setXYZ(i, X - 0.2, 0.18 + y * 0.52 * rake, z * 0.63 * (1 - 0.2 * y));
  }
  g.computeVertexNormals();
  return g;
}

// prepare a geometry for merging: non-indexed, position+normal only
function prep(g, m) {
  let out = g.index ? g.toNonIndexed() : g;
  if (out.attributes.uv) out.deleteAttribute('uv');
  if (!out.attributes.normal) out.computeVertexNormals();
  if (m) out.applyMatrix4(m);
  return out;
}

function tubeAlong(points, r, seg = 48) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)), false, 'centripetal');
  return prep(new THREE.TubeGeometry(curve, seg, r, 6, false));
}

// line hugging the side surface. path: [[x,y],...], side: +1 / -1
function sideLine(path, side, r, lift = 0.004, seg = 48) {
  return tubeAlong(path.map(([x, y]) => [x, y, side * (surfZ(x, y) + lift)]), r, seg);
}

// wrap an extrusion (depth along +z from 0) onto the side surface
function conform(g, side, inset, sampleY) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const s = surfZ(x, sampleY ?? y) - inset + z;
    p.setZ(i, side * s);
  }
  if (side < 0) flipWinding(g);
  g.computeVertexNormals();
  return g;
}

function flipWinding(g) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i += 3) {
    const x = p.getX(i + 1), y = p.getY(i + 1), z = p.getZ(i + 1);
    p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2));
    p.setXYZ(i + 2, x, y, z);
  }
}

function shapeFrom(pts) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  return s;
}

function extrude(pts, depth, bevel = 0.008, curveSegments = 12) {
  const shape = Array.isArray(pts) ? shapeFrom(pts) : pts;
  return prep(new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments,
  }));
}

// ---------- wheels ----------
function tireGeometry() {
  const pr = [[0.252, -0.15], [0.30, -0.158], [0.335, -0.152], [0.352, -0.135], [0.36, -0.10], [0.36, 0.10],
    [0.352, 0.135], [0.335, 0.152], [0.30, 0.158], [0.252, 0.15]];
  const g = new THREE.LatheGeometry(pr.map(([r, y]) => new THREE.Vector2(r, y)), 64);
  g.rotateX(Math.PI / 2);
  return prep(g);
}

function rimGeometry() {
  const parts = [];
  const spoke = [[0.062, -0.024], [0.243, -0.012], [0.243, 0.012], [0.062, 0.024]];
  for (let k = 0; k < 5; k++) for (const off of [-0.13, 0.13]) {
    const g = extrude(spoke, 0.03, 0.006, 2);
    g.translate(0, 0, 0.085);
    g.rotateZ(k * (Math.PI * 2 / 5) + off);
    parts.push(g);
  }
  const hub = new THREE.CylinderGeometry(0.068, 0.078, 0.06, 28);
  hub.rotateX(Math.PI / 2); hub.translate(0, 0, 0.105);
  parts.push(prep(hub));
  const lip = new THREE.TorusGeometry(0.249, 0.013, 8, 64);
  lip.translate(0, 0, 0.138);
  parts.push(prep(lip));
  return mergeGeometries(parts);
}

function discGeometry() {
  const parts = [];
  const d = new THREE.CylinderGeometry(0.205, 0.205, 0.026, 48);
  d.rotateX(Math.PI / 2); d.translate(0, 0, 0.025);
  parts.push(prep(d));
  const hat = new THREE.CylinderGeometry(0.1, 0.1, 0.05, 24);
  hat.rotateX(Math.PI / 2); hat.translate(0, 0, 0.05);
  parts.push(prep(hat));
  const barrel = new THREE.CylinderGeometry(0.247, 0.247, 0.28, 48, 1, true);
  barrel.rotateX(Math.PI / 2);
  parts.push(prep(barrel));
  return mergeGeometries(parts);
}

function caliperGeometry(centerDeg) {
  const a0 = THREE.MathUtils.degToRad(centerDeg - 24), a1 = THREE.MathUtils.degToRad(centerDeg + 24);
  const s = new THREE.Shape();
  s.absarc(0, 0, 0.228, a0, a1, false);
  s.absarc(0, 0, 0.145, a1, a0, true);
  s.closePath();
  const g = extrude(s, 0.075, 0.01, 16);
  g.translate(0, 0, -0.012);
  return g;
}

// ---------- nozzle ----------
function nozzleBell() {
  const pr = [[0.056, 0.05], [0.07, 0.0], [0.086, -0.04], [0.104, -0.068], [0.112, -0.078], [0.098, -0.082],
    [0.084, -0.066], [0.068, -0.03], [0.058, 0.02], [0.05, 0.05]];
  return prep(new THREE.LatheGeometry(pr.map(([r, y]) => new THREE.Vector2(r, y)), 32));
}

export function createCar() {
  const group = new THREE.Group();
  group.name = 'AEROLUX';
  const body = new THREE.Group();   // sprung mass (bounces on suspension)
  const chassis = new THREE.Group(); // unsprung: wheels + calipers
  group.add(chassis, body);

  // ---------- materials ----------
  const paint = new THREE.MeshPhysicalMaterial({
    color: 0x0b62ff, metalness: 0.6, roughness: 0.24, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.3,
  });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x0a1820, metalness: 0.15, roughness: 0.03, clearcoat: 1, clearcoatRoughness: 0.0,
    envMapIntensity: 1.8, iridescence: 0.15,
  });
  const carbon = new THREE.MeshPhysicalMaterial({
    color: 0x0b0d11, metalness: 0.35, roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.12,
    side: THREE.DoubleSide,
  });
  const accent = new THREE.MeshStandardMaterial({ color: 0x00e6ff, emissive: 0x00e6ff, emissiveIntensity: 1.8, roughness: 0.3 });
  const frontLight = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xc8fbff, emissiveIntensity: 4 });
  const rearLight = new THREE.MeshStandardMaterial({ color: 0xff2040, emissive: 0xff1838, emissiveIntensity: 4 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x121214, roughness: 0.82, metalness: 0 });
  const rimMat = new THREE.MeshPhysicalMaterial({ color: 0xa6adb8, metalness: 1, roughness: 0.2, clearcoat: 0.6 });
  const matte = new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
  const discMat = new THREE.MeshStandardMaterial({ color: 0x5a5e66, metalness: 1, roughness: 0.45, side: THREE.DoubleSide });
  const caliperMat = new THREE.MeshStandardMaterial({
    color: 0x00d8ff, emissive: 0x00c8ff, emissiveIntensity: 1.3, roughness: 0.35, side: THREE.DoubleSide,
  });
  const nozzleMat = new THREE.MeshPhysicalMaterial({
    color: 0xc4cad4, metalness: 1, roughness: 0.16, clearcoat: 0.6, side: THREE.DoubleSide,
  });
  const nozzleGlowBase = new THREE.Color(0x30e8ff);
  const nozzleGlow = new THREE.MeshBasicMaterial({ color: nozzleGlowBase.clone(), side: THREE.DoubleSide });

  const meshes = [];
  const add = (parent, geo, mat, name) => {
    const m = new THREE.Mesh(geo, mat);
    m.name = name; m.castShadow = true; m.receiveShadow = true;
    parent.add(m); meshes.push(m);
    return m;
  };

  // ---------- body + canopy ----------
  add(body, bodyGeometry(), paint, 'body');
  add(body, canopyGeometry(), glass, 'canopy');

  // ---------- dark details (carbon / gloss black), one merged mesh ----------
  const dark = [];
  const mat = [];
  const accentG = [];
  for (const side of [1, -1]) {
    // panel line grooves
    dark.push(sideLine([[0.80, 0.24], [0.83, 0.05], [0.81, -0.14], [0.76, -0.30]], side, 0.006));
    dark.push(sideLine([[-0.24, 0.27], [-0.22, 0.05], [-0.25, -0.30]], side, 0.006));
    dark.push(sideLine([[0.98, -0.02], [0.4, 0.04], [-0.24, 0.10]], side, 0.005));
    dark.push(sideLine([[1.96, 0.04], [1.72, 0.26]], side, 0.005, 0.004, 16));
    // side air intake (forward-pointing scoop ahead of the rear arch)
    const intake = new THREE.ExtrudeGeometry(shapeFrom([[-0.30, 0.03], [-0.97, 0.22], [-0.97, -0.13], [-0.58, -0.11]]),
      { depth: 0.035, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.012, bevelSegments: 2 });
    dark.push(conform(prep(intake), side, 0.02));
    for (const fy of [0.1, 0.02, -0.06]) {
      dark.push(sideLine([[-0.5 + (fy - 0.02) * 0.4, fy], [-0.94, fy + 0.04]], side, 0.008, 0.02, 8));
    }
    accentG.push(sideLine([[-0.30, 0.05], [-0.63, 0.15], [-0.98, 0.245]], side, 0.008, 0.012, 24));
    // sill blade
    const blade = new THREE.ExtrudeGeometry(shapeFrom([[0.97, -0.30], [0.6, -0.33], [-0.97, -0.34], [-0.97, -0.43],
      [0.5, -0.445], [0.97, -0.36]]), { depth: 0.08, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2 });
    dark.push(conform(prep(blade), side, 0.04, -0.3));
    accentG.push(tubeAlong([[0.95, -0.425 + 0.06, 0], [0.5, -0.44, 0], [-0.95, -0.425, 0]].map(([x, y]) =>
      [x, y + 0.012, side * (surfZ(x, -0.3) + 0.045)]), 0.009, 24));
    // arch liners
    for (const wx of WHEEL_X) {
      const hw = params(wx).hw;
      const liner = new THREE.CylinderGeometry(ARCH_R - 0.008, ARCH_R - 0.008, 0.45, 40, 1, true, Math.PI / 2, Math.PI);
      liner.rotateX(Math.PI / 2);
      liner.translate(wx, WHEEL_CY, side * (hw - 0.23));
      mat.push(prep(liner));
    }
    // mirror-cameras
    const mx = 0.66, my = 0.22, mz = surfZ(mx, my);
    const stalk = new THREE.CapsuleGeometry(0.016, 0.14, 4, 8);
    stalk.rotateX(Math.PI / 2); stalk.rotateY(-0.35 * side);
    stalk.translate(mx - 0.03, my + 0.02, side * (mz + 0.06));
    dark.push(prep(stalk));
    const pod = new THREE.CapsuleGeometry(0.034, 0.1, 6, 12);
    pod.rotateZ(Math.PI / 2); pod.scale(1, 0.8, 0.9);
    pod.translate(mx - 0.06, my + 0.04, side * (mz + 0.14));
    dark.push(prep(pod));
    const lens = new THREE.SphereGeometry(0.017, 12, 8);
    lens.translate(mx + 0.025, my + 0.04, side * (mz + 0.14));
    accentG.push(prep(lens));
  }
  // hood vents (dark louvred slots, both sides of the centre line)
  for (const side of [1, -1]) {
    for (let k = 0; k < 3; k++) {
      const o = k * 0.075;
      dark.push(onTop([[1.66 + o, side * 0.2], [1.69 + o, side * 0.2], [1.86 + o, side * 0.5], [1.83 + o, side * 0.5]], 0.012, 0.004));
    }
  }
  // front intake mouth below the light bar
  {
    const pts = [];
    for (let k = 0; k <= 16; k++) {
      const x = 1.86 + (XF - 0.004 - 1.86) * Math.sin((k / 16) * Math.PI / 2);
      const p = params(x);
      const y = p.bot + 0.34 * (p.top - p.bot);
      pts.push([x, y, surfZ(x, y)]);
    }
    const tip = pts[pts.length - 1];
    const path = [...pts.map(([x, y, z]) => [x, y, -z]), [tip[0] + 0.004, tip[1], 0], ...pts.slice().reverse()];
    const mouth = tubeAlong(path.filter((q, i) => i === 0 || Math.hypot(q[0] - path[i - 1][0], q[2] - path[i - 1][2]) > 0.004), 0.034, 96);
    mouth.scale(1, 1.0, 1);
    dark.push(mouth);
  }
  // rear diffuser fins + plate
  for (const fz of [-0.66, -0.33, 0, 0.33, 0.66]) {
    const fin = extrude([[-1.78, -0.395], [-2.30, -0.40], [-2.30, -0.24]], 0.022, 0.004, 1);
    fin.translate(0, 0, fz - 0.011);
    dark.push(fin);
  }
  const plate = extrude([[-1.78, -0.38], [-2.31, -0.25], [-2.31, -0.23], [-1.78, -0.36]], 1.5, 0.006, 1);
  plate.translate(0, 0, -0.75);
  dark.push(plate);
  // front splitter
  const split = extrude([[1.7, -0.395], [2.24, -0.33], [2.36, -0.30], [2.34, -0.275], [2.0, -0.35], [1.7, -0.37]], 1.2, 0.01, 1);
  split.translate(0, 0, -0.6);
  dark.push(split);
  // rear wing (ducktail aero blade on swan necks)
  const wingShape = new THREE.Shape();
  wingShape.moveTo(-1.98, 0.505);
  wingShape.quadraticCurveTo(-2.08, 0.54, -2.26, 0.535);
  wingShape.lineTo(-2.33, 0.548);
  wingShape.lineTo(-2.33, 0.515);
  wingShape.quadraticCurveTo(-2.15, 0.50, -1.98, 0.505);
  const wing = extrude(wingShape, 1.5, 0.012, 12);
  wing.translate(0, 0, -0.75);
  dark.push(wing);
  for (const sz of [-0.46, 0.44]) {
    const neck = extrude([[-2.04, 0.30], [-2.16, 0.30], [-2.22, 0.52], [-2.13, 0.52]], 0.02, 0.005, 1);
    neck.translate(0, 0, sz);
    dark.push(neck);
  }
  accentG.push(tubeAlong([[-2.345, 0.55, -0.74], [-2.345, 0.55, 0.74]], 0.006, 4));
  add(body, mergeGeometries(dark), carbon, 'carbon');
  add(body, mergeGeometries(mat), matte, 'liners');

  // ---------- light bars (wrap around nose / tail) ----------
  function wrapBar(x0, x1, frac, r) {
    const pts = [];
    const n = 18;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const x = x0 + (x1 - x0) * Math.sin(t * Math.PI / 2);
      const p = params(x);
      const y = p.bot + frac * (p.top - p.bot);
      pts.push([x, y, surfZ(x, y)]);
    }
    const dirX = Math.sign(x1 - x0);
    const full = [];
    for (const [x, y, z] of pts) full.push([x, y, -(z + 0.008)]);
    const tip = pts[pts.length - 1];
    full.push([tip[0] + dirX * 0.012, tip[1], 0]);
    for (let k = pts.length - 1; k >= 0; k--) full.push([pts[k][0], pts[k][1], pts[k][2] + 0.008]);
    // de-duplicate near-tip points
    const clean = full.filter((p, i) => i === 0 || Math.hypot(p[0] - full[i - 1][0], p[2] - full[i - 1][2], p[1] - full[i - 1][1]) > 0.004);
    return tubeAlong(clean, r, 96);
  }
  const front = [wrapBar(1.8, XF - 0.001, 0.80, 0.016)];
  add(body, mergeGeometries(front), frontLight, 'lightbar-front');
  const rear = [wrapBar(-1.9, XR + 0.001, 0.70, 0.022)];
  const fog = new THREE.CapsuleGeometry(0.018, 0.16, 4, 8);
  fog.rotateX(Math.PI / 2); fog.translate(-2.305, -0.30, 0);
  rear.push(prep(fog));
  add(body, mergeGeometries(rear), rearLight, 'lightbar-rear');

  // ---------- air-thruster nozzles ----------
  const nozzleDefs = [
    { p: [0.85, -0.37, 0.42], rx: 0 }, { p: [0.85, -0.37, -0.42], rx: 0 },
    { p: [-0.85, -0.37, 0.42], rx: 0 }, { p: [-0.85, -0.37, -0.42], rx: 0 },
  ];
  for (const side of [1, -1]) {
    nozzleDefs.push({ p: [0.02, -0.40, side * (surfZ(0.02, -0.3) + 0.03)], rx: -0.42 * side, s: 1.35 });
  }
  const ringG = [], glowG = [];
  const nozzles = [];
  for (const d of nozzleDefs) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...d.p),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(d.rx, 0, 0)), new THREE.Vector3().setScalar(d.s || 1));
    ringG.push(nozzleBell().applyMatrix4(m));
    const disc = new THREE.CircleGeometry(0.066, 24);
    disc.rotateX(Math.PI / 2); disc.translate(0, -0.05, 0);
    glowG.push(prep(disc, m));
    const core = new THREE.CircleGeometry(0.03, 16);
    core.rotateX(Math.PI / 2); core.translate(0, -0.06, 0);
    glowG.push(prep(core, m));
    const lipGlow = new THREE.TorusGeometry(0.1, 0.009, 6, 32);
    lipGlow.rotateX(Math.PI / 2); lipGlow.translate(0, -0.074, 0);
    glowG.push(prep(lipGlow, m));
    const exit = new THREE.Object3D();
    exit.name = 'nozzle';
    exit.position.set(...d.p);
    exit.rotation.set(d.rx, 0, 0);
    exit.translateY(-0.085 * (d.s || 1));
    body.add(exit);
    nozzles.push(exit);
  }
  add(body, mergeGeometries(ringG), nozzleMat, 'nozzle-rings');
  const glowMesh = add(body, mergeGeometries(glowG), nozzleGlow, 'nozzle-glow');
  glowMesh.castShadow = false;
  add(body, mergeGeometries(accentG), accent, 'accent');

  // ---------- wheels ----------
  const tireG = tireGeometry(), rimG = rimGeometry(), discG = discGeometry();
  const wheelGeo = mergeGeometries([tireG, rimG, discG], true);
  const wheelMats = [rubber, rimMat, discMat];
  const wheels = [];
  const caliperParts = [];
  for (const wx of WHEEL_X) for (const side of [1, -1]) {
    const hw = params(wx).hw;
    const pivot = new THREE.Group();
    pivot.position.set(wx, WHEEL_CY, side * (hw - 0.19));
    if (side < 0) pivot.rotation.y = Math.PI;
    const spin = new THREE.Group();
    pivot.add(spin);
    chassis.add(pivot);
    add(spin, wheelGeo, wheelMats, 'wheel');
    pivot.updateMatrix();
    caliperParts.push(caliperGeometry(side > 0 ? 118 : 62).applyMatrix4(pivot.matrix));
    wheels.push({ spin, sign: side });
  }
  add(chassis, mergeGeometries(caliperParts), caliperMat, 'calipers');

  // ---------- animation state ----------
  let glow = 0, susp = 0, suspV = 0, spinA = 0, life = 1, kick = 0;
  const baseCaliper = caliperMat.emissiveIntensity;

  function thrust() {
    glow = 1;
    kick = 1;
    suspV += 0.95;
  }

  function update(dt, t, state = {}) {
    dt = Math.min(Math.max(dt || 0, 0), 0.05);
    const speed = state.speed ?? 0;
    const alive = state.alive !== false;
    const vy = state.vy ?? 0;

    spinA -= (speed * dt) / WHEEL_R;
    for (const w of wheels) w.spin.rotation.z = spinA * w.sign;

    // spring-damper between sprung body and wheels; falling compresses slightly
    const target = THREE.MathUtils.clamp(vy * 0.004, -0.03, 0.03);
    suspV += (-150 * (susp - target) - 12 * suspV) * dt;
    susp += suspV * dt;
    susp = THREE.MathUtils.clamp(susp, -0.07, 0.1);
    const idle = alive && speed > 0 ? 0.004 * Math.sin(t * 13.0) + 0.003 * Math.sin(t * 7.3) : 0;
    body.position.y = susp + idle;
    body.rotation.z = -kick * 0.015 * Math.sin(Math.min(1, 1 - kick) * Math.PI);

    glow *= Math.exp(-dt * 5.0);
    kick *= Math.exp(-dt * 6.0);
    life += ((alive ? 1 : 0.1) - life) * Math.min(1, dt * 3);

    const pulse = 0.5 + 0.5 * Math.sin(t * 3.2);
    frontLight.emissiveIntensity = (3.4 + 0.8 * pulse) * life;
    rearLight.emissiveIntensity = (3.0 + 0.6 * pulse + glow * 3) * life;
    accent.emissiveIntensity = (1.4 + 0.5 * Math.sin(t * 2.1) + glow * 2.5) * life;
    caliperMat.emissiveIntensity = baseCaliper * (0.8 + 0.2 * pulse) * life;
    const g = (0.55 + 7.5 * glow) * life;
    nozzleGlow.color.copy(nozzleGlowBase).multiplyScalar(g);
  }

  group.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
  glowMesh.castShadow = false;

  return {
    group,
    hitbox: { w: 4.3, h: 1.1 },
    nozzles,
    thrust,
    update,
  };
}
