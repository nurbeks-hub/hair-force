// HAIR FORCE — particle effects (puff / trail / crash / score)
// Pooled THREE.Points with a custom ShaderMaterial (two pools: soft normal-blended + additive),
// a pooled InstancedMesh for chunky debris, and a small pool of billboard ring quads.
// No per-frame allocation. ~1400 particles max.
import * as THREE from 'three';

const SOFT_MAX = 640;   // condensate, smoke
const ADD_MAX = 760;    // sparks, streaks, flash, sparkles, puff core
const DEBRIS_MAX = 28;
const RING_PER_KIND = 4;
const GROUND_Y = 0;

// ---------- procedural textures ----------
function makeSoftTexture() {
  const s = 128, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  // lumpy condensate blob: a few overlapping radial gradients, kept soft at the edge
  const blobs = [[0.5, 0.5, 0.46, 0.9], [0.4, 0.44, 0.3, 0.55], [0.6, 0.42, 0.28, 0.5], [0.47, 0.6, 0.3, 0.5], [0.62, 0.6, 0.24, 0.4]];
  for (const [x, y, r, a] of blobs) {
    const gr = g.createRadialGradient(x * s, y * s, 0, x * s, y * s, r * s);
    gr.addColorStop(0, `rgba(255,255,255,${a})`);
    gr.addColorStop(0.5, `rgba(255,255,255,${a * 0.45})`);
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, s, s);
  }
  // hard clip to circle so the quad edge never shows
  g.globalCompositeOperation = 'destination-in';
  const m = g.createRadialGradient(s / 2, s / 2, s * 0.3, s / 2, s / 2, s * 0.5);
  m.addColorStop(0, 'rgba(0,0,0,1)');
  m.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = m;
  g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

function makeGlowTexture() {
  const s = 64, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.18, 'rgba(255,255,255,0.85)');
  gr.addColorStop(0.45, 'rgba(255,255,255,0.22)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

// ---------- point shader ----------
const pointVert = /* glsl */`
  attribute vec3 aColor;
  attribute float aAlpha;
  attribute float aSize;
  attribute vec3 aVel;
  attribute float aStretch;
  attribute float aRot;
  uniform float uViewH;
  varying vec3 vColor;
  varying float vAlpha;
  varying vec2 vDir;
  varying float vStretch;
  varying float vRot;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec4 c0 = projectionMatrix * mv;
    gl_Position = c0;
    float st = aStretch;
    vec2 dir = vec2(1.0, 0.0);
    if (st > 0.001) {
      vec4 c1 = projectionMatrix * (modelViewMatrix * vec4(position + aVel * 0.02, 1.0));
      vec2 d = c1.xy / c1.w - c0.xy / c0.w;
      float l = length(d);
      if (l > 1e-5) dir = d / l; else st = 0.0;
    }
    float px = aSize * uViewH * projectionMatrix[1][1] * 0.5 / max(-mv.z, 0.1);
    gl_PointSize = clamp(px * (1.0 + st), 0.0, 768.0);
    vColor = aColor;
    vAlpha = (aSize > 0.0) ? aAlpha : 0.0;
    vDir = dir;
    vStretch = st;
    vRot = aRot;
  }
`;

const pointFrag = /* glsl */`
  uniform sampler2D uMap;
  uniform float uAdditive;
  varying vec3 vColor;
  varying float vAlpha;
  varying vec2 vDir;
  varying float vStretch;
  varying float vRot;
  void main() {
    if (vAlpha <= 0.002) discard;
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    p.y = -p.y;
    // stretch: squash across the screen-space velocity direction
    vec2 perp = vec2(-vDir.y, vDir.x);
    vec2 q = vec2(dot(p, vDir), dot(p, perp) * (1.0 + vStretch));
    // per-particle spin of the sprite (only matters for the lumpy soft texture)
    float cs = cos(vRot), sn = sin(vRot);
    q = vec2(cs * q.x - sn * q.y, sn * q.x + cs * q.y);
    if (dot(q, q) > 1.0) discard;
    vec4 tex = texture2D(uMap, q * 0.5 + 0.5);
    float a = tex.a * vAlpha;
    if (uAdditive > 0.5) {
      gl_FragColor = vec4(vColor * tex.rgb * a, 1.0);
    } else {
      gl_FragColor = vec4(vColor * tex.rgb, a);
    }
  }
`;

// ---------- particle pool ----------
function createPool(scene, max, map, additive, renderOrder) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(max * 3);
  const col = new Float32Array(max * 3);
  const alpha = new Float32Array(max);
  const size = new Float32Array(max);
  const velA = new Float32Array(max * 3);
  const stretch = new Float32Array(max);
  const rot = new Float32Array(max);
  const mk = (arr, n) => { const a = new THREE.BufferAttribute(arr, n); a.setUsage(THREE.DynamicDrawUsage); return a; };
  const aPos = mk(pos, 3), aCol = mk(col, 3), aAl = mk(alpha, 1), aSz = mk(size, 1), aVel = mk(velA, 3), aSt = mk(stretch, 1), aRot = mk(rot, 1);
  geo.setAttribute('position', aPos);
  geo.setAttribute('aColor', aCol);
  geo.setAttribute('aAlpha', aAl);
  geo.setAttribute('aSize', aSz);
  geo.setAttribute('aVel', aVel);
  geo.setAttribute('aStretch', aSt);
  geo.setAttribute('aRot', aRot);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

  const mat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: map }, uViewH: { value: 900 }, uAdditive: { value: additive ? 1 : 0 } },
    vertexShader: pointVert,
    fragmentShader: pointFrag,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = renderOrder;
  const tmp2 = new THREE.Vector2();
  points.onBeforeRender = (renderer) => {
    renderer.getDrawingBufferSize(tmp2);
    mat.uniforms.uViewH.value = tmp2.y;
  };
  scene.add(points);

  // simulation state (CPU)
  const vel = new Float32Array(max * 3);
  const life = new Float32Array(max);       // remaining
  const maxLife = new Float32Array(max);
  const s0 = new Float32Array(max), s1 = new Float32Array(max);
  const a0 = new Float32Array(max);
  const c0 = new Float32Array(max * 3), c1 = new Float32Array(max * 3);
  const drag = new Float32Array(max);
  const grav = new Float32Array(max);
  const scroll = new Float32Array(max);
  const stretchK = new Float32Array(max);
  const fadeIn = new Float32Array(max);
  const fadePow = new Float32Array(max);
  const spin = new Float32Array(max);
  const twinkle = new Float32Array(max);
  let cursor = 0;
  let live = 0;
  let clock = 0;

  function spawn(o) {
    const i = cursor;
    cursor = (cursor + 1) % max;
    const i3 = i * 3;
    pos[i3] = o.x; pos[i3 + 1] = o.y; pos[i3 + 2] = o.z;
    vel[i3] = o.vx; vel[i3 + 1] = o.vy; vel[i3 + 2] = o.vz;
    life[i] = maxLife[i] = o.life;
    s0[i] = o.s0; s1[i] = o.s1;
    a0[i] = o.a;
    c0[i3] = o.r0; c0[i3 + 1] = o.g0; c0[i3 + 2] = o.b0;
    c1[i3] = o.r1; c1[i3 + 1] = o.g1; c1[i3 + 2] = o.b1;
    drag[i] = o.drag; grav[i] = o.grav; scroll[i] = o.scroll;
    stretchK[i] = o.stretch; fadeIn[i] = o.fadeIn; fadePow[i] = o.fadePow;
    rot[i] = o.rot; spin[i] = o.spin; twinkle[i] = o.twinkle;
    size[i] = o.s0; alpha[i] = 0;
  }

  function update(dt) {
    clock += dt;
    let count = 0;
    for (let i = 0; i < max; i++) {
      if (life[i] <= 0) {
        if (size[i] !== 0) { size[i] = 0; alpha[i] = 0; }
        continue;
      }
      life[i] -= dt;
      if (life[i] <= 0) { size[i] = 0; alpha[i] = 0; continue; }
      count++;
      const i3 = i * 3;
      const k = Math.exp(-drag[i] * dt);
      vel[i3] *= k; vel[i3 + 1] = vel[i3 + 1] * k + grav[i] * dt; vel[i3 + 2] *= k;
      const ex = vel[i3] - scroll[i];
      pos[i3] += ex * dt; pos[i3 + 1] += vel[i3 + 1] * dt; pos[i3 + 2] += vel[i3 + 2] * dt;
      // sparks skid on the ground
      if (pos[i3 + 1] < GROUND_Y + 0.02 && grav[i] < 0) {
        pos[i3 + 1] = GROUND_Y + 0.02;
        if (vel[i3 + 1] < 0) vel[i3 + 1] *= -0.35;
        vel[i3] *= 0.7; vel[i3 + 2] *= 0.7;
      }
      velA[i3] = ex; velA[i3 + 1] = vel[i3 + 1]; velA[i3 + 2] = vel[i3 + 2];
      const t = 1 - life[i] / maxLife[i];           // 0 → 1
      const e = 1 - (1 - t) * (1 - t) * (1 - t);     // ease-out cubic growth
      size[i] = s0[i] + (s1[i] - s0[i]) * e;
      let a = a0[i] * Math.pow(1 - t, fadePow[i]);
      if (fadeIn[i] > 0 && t < fadeIn[i]) a *= t / fadeIn[i];
      if (twinkle[i] > 0) a *= 0.55 + 0.45 * Math.sin(clock * twinkle[i] + i * 1.7);
      alpha[i] = a;
      col[i3] = c0[i3] + (c1[i3] - c0[i3]) * t;
      col[i3 + 1] = c0[i3 + 1] + (c1[i3 + 1] - c0[i3 + 1]) * t;
      col[i3 + 2] = c0[i3 + 2] + (c1[i3 + 2] - c0[i3 + 2]) * t;
      // stretch scales with speed so slow sparks round off
      const sp = Math.sqrt(ex * ex + vel[i3 + 1] * vel[i3 + 1] + vel[i3 + 2] * vel[i3 + 2]);
      stretch[i] = stretchK[i] > 0 ? Math.min(stretchK[i] * sp * 0.08, stretchK[i]) : 0;
      rot[i] += spin[i] * dt;
    }
    if (count > 0 || live > 0) {
      aPos.needsUpdate = aCol.needsUpdate = aAl.needsUpdate = aSz.needsUpdate = true;
      aVel.needsUpdate = aSt.needsUpdate = aRot.needsUpdate = true;
    }
    live = count;
    points.visible = count > 0;
  }

  return { spawn, update, points };
}

// ---------- ring billboards ----------
const ringVert = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const ringFrag = /* glsl */`
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uThick;
  uniform float uAdditive;
  varying vec2 vUv;
  void main() {
    float d = length(vUv - 0.5) * 2.0;
    float r = 0.86;
    float w = uThick;
    float ring = exp(-pow((d - r) / w, 2.0));
    float inner = smoothstep(r, 0.0, d) * 0.12;     // faint fill inside (refraction-ish haze)
    float a = (ring + inner) * uOpacity * smoothstep(1.0, 0.94, d);
    if (a < 0.003) discard;
    if (uAdditive > 0.5) gl_FragColor = vec4(uColor * a, 1.0);
    else gl_FragColor = vec4(uColor, a);
  }
`;

function createRingPool(scene, n, additive, renderOrder) {
  const geo = new THREE.PlaneGeometry(1, 1);
  const rings = [];
  const camQ = new THREE.Quaternion();
  const rollQ = new THREE.Quaternion();
  const zAxis = new THREE.Vector3(0, 0, 1);
  for (let i = 0; i < n; i++) {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(1, 1, 1) },
        uOpacity: { value: 0 },
        uThick: { value: 0.06 },
        uAdditive: { value: additive ? 1 : 0 },
      },
      vertexShader: ringVert,
      fragmentShader: ringFrag,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(geo, mat);
    m.visible = false;
    m.frustumCulled = false;
    m.renderOrder = renderOrder;
    const r = {
      mesh: m, mat, life: 0, maxLife: 1, r0: 0, r1: 1, squash: 1, roll: 0, a0: 1, thick0: 0.06, thick1: 0.03,
      scroll: 0,
    };
    m.onBeforeRender = (renderer, sc, camera) => {
      camera.getWorldQuaternion(camQ);
      rollQ.setFromAxisAngle(zAxis, r.roll);
      m.quaternion.copy(camQ).multiply(rollQ);
      m.updateMatrixWorld();
    };
    scene.add(m);
    rings.push(r);
  }
  let cursor = 0;
  function spawn(x, y, z, o) {
    const r = rings[cursor];
    cursor = (cursor + 1) % n;
    r.mesh.position.set(x, y, z);
    r.life = r.maxLife = o.life;
    r.r0 = o.r0; r.r1 = o.r1; r.squash = o.squash; r.roll = o.roll;
    r.a0 = o.a; r.thick0 = o.thick0; r.thick1 = o.thick1; r.scroll = o.scroll;
    r.mat.uniforms.uColor.value.setRGB(o.r, o.g, o.b);
    r.mesh.visible = true;
    apply(r, 0);
  }
  function apply(r, t) {
    const e = 1 - Math.pow(1 - t, 3);
    const rad = r.r0 + (r.r1 - r.r0) * e;
    r.mesh.scale.set(rad * 2 * r.squash, rad * 2, 1);
    r.mat.uniforms.uOpacity.value = r.a0 * Math.pow(1 - t, 1.6) * Math.min(1, t * 12 + 0.2);
    r.mat.uniforms.uThick.value = r.thick0 + (r.thick1 - r.thick0) * t;
  }
  function update(dt) {
    for (let i = 0; i < n; i++) {
      const r = rings[i];
      if (r.life <= 0) continue;
      r.life -= dt;
      if (r.life <= 0) { r.mesh.visible = false; continue; }
      r.mesh.position.x -= r.scroll * dt;
      apply(r, 1 - r.life / r.maxLife);
    }
  }
  return { spawn, update };
}

// ---------- debris ----------
function createDebris(scene) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.75, roughness: 0.32 });
  const mesh = new THREE.InstancedMesh(geo, mat, DEBRIS_MAX);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.count = DEBRIS_MAX;
  const st = [];
  const c = new THREE.Color();
  for (let i = 0; i < DEBRIS_MAX; i++) {
    st.push({
      p: new THREE.Vector3(), v: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(),
      s: new THREE.Vector3(), life: 0, maxLife: 1,
    });
    mesh.setColorAt(i, c.setRGB(1, 1, 1));
  }
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < DEBRIS_MAX; i++) mesh.setMatrixAt(i, zero);
  scene.add(mesh);
  const m4 = new THREE.Matrix4();
  const dq = new THREE.Quaternion();
  const axis = new THREE.Vector3();
  const sc = new THREE.Vector3();
  let cursor = 0;
  let any = false;
  function spawn(x, y, z, vx, vy, vz, sx, sy, sz, r, g, b, life) {
    const d = st[cursor];
    mesh.setColorAt(cursor, c.setRGB(r, g, b));
    cursor = (cursor + 1) % DEBRIS_MAX;
    d.p.set(x, y, z); d.v.set(vx, vy, vz);
    d.q.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    d.w.set((Math.random() - 0.5) * 22, (Math.random() - 0.5) * 22, (Math.random() - 0.5) * 22);
    d.s.set(sx, sy, sz);
    d.life = d.maxLife = life;
    mesh.instanceColor.needsUpdate = true;
    any = true;
  }
  function update(dt) {
    if (!any) return;
    let alive = false;
    for (let i = 0; i < DEBRIS_MAX; i++) {
      const d = st[i];
      if (d.life <= 0) continue;
      d.life -= dt;
      if (d.life <= 0) { mesh.setMatrixAt(i, zero); continue; }
      alive = true;
      d.v.y -= 22 * dt;
      d.v.multiplyScalar(Math.exp(-0.6 * dt));
      d.p.addScaledVector(d.v, dt);
      const half = d.s.y * 0.5;
      if (d.p.y < GROUND_Y + half) {
        d.p.y = GROUND_Y + half;
        if (d.v.y < 0) d.v.y *= -0.38;
        d.v.x *= 0.6; d.v.z *= 0.6; d.w.multiplyScalar(0.6);
      }
      const wl = d.w.length();
      if (wl > 1e-4) {
        axis.copy(d.w).divideScalar(wl);
        dq.setFromAxisAngle(axis, wl * dt);
        d.q.premultiply(dq);
      }
      const t = 1 - d.life / d.maxLife;
      const k = t > 0.75 ? 1 - (t - 0.75) / 0.25 : 1;   // shrink out at the end
      sc.copy(d.s).multiplyScalar(k);
      m4.compose(d.p, d.q, sc);
      mesh.setMatrixAt(i, m4);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (!alive) any = false;
  }
  return { spawn, update };
}

// ---------- public API ----------
export function createFX(scene) {
  const soft = createPool(scene, SOFT_MAX, makeSoftTexture(), false, 20);
  const add = createPool(scene, ADD_MAX, makeGlowTexture(), true, 22);
  const shock = createRingPool(scene, RING_PER_KIND, false, 21);
  const gold = createRingPool(scene, RING_PER_KIND, true, 23);
  const debris = createDebris(scene);

  const R = Math.random;
  const rr = (a, b) => a + (b - a) * R();
  // reusable spawn descriptor (no per-call allocation)
  const o = {
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, s0: 1, s1: 1, a: 1,
    r0: 1, g0: 1, b0: 1, r1: 1, g1: 1, b1: 1, drag: 0, grav: 0, scroll: 0,
    stretch: 0, fadeIn: 0, fadePow: 1, rot: 0, spin: 0, twinkle: 0,
  };
  function reset() {
    o.vx = o.vy = o.vz = 0; o.drag = 0; o.grav = 0; o.scroll = 0; o.stretch = 0;
    o.fadeIn = 0; o.fadePow = 1; o.rot = 0; o.spin = 0; o.twinkle = 0;
  }
  // basis around a direction (for spreads)
  const D = new THREE.Vector3(), P1 = new THREE.Vector3(), P2 = new THREE.Vector3();
  function basis(dir) {
    if (dir && dir.lengthSq() > 1e-8) D.copy(dir).normalize(); else D.set(0, -1, 0);
    P1.set(0, 0, 1).cross(D);
    if (P1.lengthSq() < 1e-6) P1.set(1, 0, 0);
    P1.normalize();
    P2.copy(D).cross(P1).normalize();
  }

  let lastSpeed = 12;
  let trailAcc = 0;
  let hazeAcc = 0;

  function puff(p, dir, worldSpeed = 12) {
    basis(dir);
    const ws = worldSpeed;
    // 1) condensate cloud — fast out, heavy drag, blooms and hangs
    for (let i = 0; i < 26; i++) {
      reset();
      const along = rr(5, 15), side = rr(-6, 6), side2 = rr(-3.5, 3.5);
      o.x = p.x + D.x * 0.15; o.y = p.y + D.y * 0.15; o.z = p.z + D.z * 0.15;
      o.vx = D.x * along + P1.x * side + P2.x * side2;
      o.vy = D.y * along + P1.y * side + P2.y * side2;
      o.vz = D.z * along + P1.z * side + P2.z * side2;
      o.drag = rr(5, 8); o.grav = 0.6; o.scroll = ws;
      o.life = rr(0.4, 0.8);
      o.s0 = rr(0.3, 0.5); o.s1 = rr(1.8, 3.0);
      o.a = rr(0.45, 0.7); o.fadeIn = 0.06; o.fadePow = 1.4;
      const cool = R();
      o.r0 = 1; o.g0 = 1; o.b0 = 1;
      o.r1 = 0.78 + 0.1 * cool; o.g1 = 0.88 + 0.06 * cool; o.b1 = 1;
      o.rot = rr(0, 6.28); o.spin = rr(-2, 2);
      soft.spawn(o);
    }
    // 2) hot white core flash — the "pop"
    for (let i = 0; i < 3; i++) {
      reset();
      o.x = p.x + D.x * 0.3; o.y = p.y + D.y * 0.3; o.z = p.z + D.z * 0.3;
      o.vx = D.x * 4; o.vy = D.y * 4; o.vz = D.z * 4; o.drag = 6; o.scroll = ws;
      o.life = rr(0.08, 0.13); o.s0 = 0.9; o.s1 = 2.0; o.a = 0.55; o.fadePow = 2;
      o.r0 = 0.9; o.g0 = 0.96; o.b0 = 1; o.r1 = 0.7; o.g1 = 0.85; o.b1 = 1;
      add.spawn(o);
    }
    // 3) jet streaks — thin fast lines along the blast direction
    for (let i = 0; i < 9; i++) {
      reset();
      const along = rr(16, 30), side = rr(-3.5, 3.5);
      o.x = p.x; o.y = p.y; o.z = p.z + rr(-0.3, 0.3);
      o.vx = D.x * along + P1.x * side; o.vy = D.y * along + P1.y * side; o.vz = D.z * along + P1.z * side;
      o.drag = 7; o.scroll = ws;
      o.life = rr(0.12, 0.22); o.s0 = 0.28; o.s1 = 0.2; o.a = 0.5; o.fadePow = 1.5;
      o.stretch = 6;
      o.r0 = 0.85; o.g0 = 0.93; o.b0 = 1; o.r1 = 0.6; o.g1 = 0.8; o.b1 = 1;
      add.spawn(o);
    }
    // 4) shock ring, squashed along the blast axis, rolled to face it
    shock.spawn(p.x + D.x * 0.5, p.y + D.y * 0.5, p.z + 0.4, {
      life: 0.35, r0: 0.35, r1: 2.6, squash: 0.42, roll: Math.atan2(D.y, D.x),
      a: 0.75, thick0: 0.07, thick1: 0.025, r: 0.92, g: 0.97, b: 1, scroll: ws * 0.6,
    });
  }

  function trail(p, speed = 12) {
    lastSpeed = speed;
    const dt = frameDt;
    if (dt <= 0) return;
    const sp = Math.max(0, speed);
    // speed streaks: rate scales with speed, ~36/s at 12 m/s
    trailAcc += dt * sp * 3;
    let n = Math.min(4, Math.floor(trailAcc));
    trailAcc -= n;
    while (n-- > 0) {
      reset();
      o.x = p.x - rr(1.6, 2.6); o.y = p.y + rr(-0.5, 0.55); o.z = p.z + rr(-1.1, 1.1);
      o.vx = rr(-1, 1); o.scroll = sp * rr(0.9, 1.2);
      o.life = rr(0.18, 0.32); o.s0 = 0.16; o.s1 = 0.12; o.a = 0.16 + Math.min(sp, 30) * 0.005;
      o.fadeIn = 0.25; o.fadePow = 1.2; o.stretch = 10;
      o.r0 = 1; o.g0 = 0.93; o.b0 = 0.82; o.r1 = 1; o.g1 = 0.8; o.b1 = 0.6;
      add.spawn(o);
    }
    // faint heat/air shimmer wisps off the tail
    hazeAcc += dt * 14;
    let h = Math.min(2, Math.floor(hazeAcc));
    hazeAcc -= h;
    while (h-- > 0) {
      reset();
      o.x = p.x - rr(1.9, 2.3); o.y = p.y + rr(-0.2, 0.2); o.z = p.z + rr(-0.6, 0.6);
      o.vy = rr(0.2, 0.8); o.scroll = sp; o.drag = 1;
      o.life = rr(0.35, 0.55); o.s0 = 0.35; o.s1 = 1.1; o.a = 0.07; o.fadeIn = 0.2; o.fadePow = 1.5;
      o.r0 = 1; o.g0 = 0.95; o.b0 = 0.9; o.r1 = 0.95; o.g1 = 0.85; o.b1 = 0.8;
      o.rot = rr(0, 6.28); o.spin = rr(-1, 1);
      soft.spawn(o);
    }
  }

  function crash(p) {
    // flash
    reset();
    o.x = p.x; o.y = p.y; o.z = p.z + 0.8;
    o.life = 0.28; o.s0 = 4; o.s1 = 11; o.a = 1; o.fadePow = 2.2;
    o.r0 = 1; o.g0 = 0.95; o.b0 = 0.8; o.r1 = 1; o.g1 = 0.6; o.b1 = 0.25;
    add.spawn(o);
    reset();
    o.x = p.x; o.y = p.y; o.z = p.z + 0.9;
    o.life = 0.12; o.s0 = 2.2; o.s1 = 3; o.a = 1; o.fadePow = 1;
    o.r0 = 1; o.g0 = 1; o.b0 = 1; o.r1 = 1; o.g1 = 0.95; o.b1 = 0.85;
    add.spawn(o);
    // gold sparks, stretched along velocity
    for (let i = 0; i < 110; i++) {
      reset();
      const th = rr(0, 6.283), ph = Math.acos(rr(-1, 1)), v = rr(6, 24);
      o.x = p.x + rr(-0.6, 0.6); o.y = p.y + rr(-0.3, 0.3); o.z = p.z + rr(-0.4, 0.4);
      o.vx = Math.sin(ph) * Math.cos(th) * v;
      o.vy = Math.abs(Math.cos(ph)) * v * 0.9 + 3;
      o.vz = Math.sin(ph) * Math.sin(th) * v * 0.7;
      o.drag = rr(0.8, 2); o.grav = -20; o.scroll = lastSpeed * 0.15;
      o.life = rr(0.45, 1.2); o.s0 = rr(0.12, 0.22); o.s1 = 0.06; o.a = rr(0.8, 1); o.fadePow = 0.8;
      o.stretch = 5;
      o.r0 = 1; o.g0 = rr(0.85, 0.95); o.b0 = 0.6; o.r1 = 1; o.g1 = 0.42; o.b1 = 0.08;
      add.spawn(o);
    }
    // smoke
    for (let i = 0; i < 16; i++) {
      reset();
      o.x = p.x + rr(-1, 1); o.y = p.y + rr(-0.3, 0.5); o.z = p.z + rr(-0.6, 0.6);
      o.vx = rr(-2.5, 2.5); o.vy = rr(1, 3.5); o.vz = rr(-1, 1);
      o.drag = 1.4; o.grav = 0.8; o.scroll = lastSpeed * 0.1;
      o.life = rr(1.2, 2.1); o.s0 = rr(0.8, 1.3); o.s1 = rr(3, 4.5); o.a = rr(0.35, 0.5);
      o.fadeIn = 0.12; o.fadePow = 1.3;
      o.r0 = 0.32; o.g0 = 0.24; o.b0 = 0.18; o.r1 = 0.22; o.g1 = 0.19; o.b1 = 0.18;
      o.rot = rr(0, 6.28); o.spin = rr(-0.8, 0.8);
      soft.spawn(o);
    }
    // chunky debris: gold panels + dark carbon bits
    for (let i = 0; i < 16; i++) {
      const goldBit = i % 3 !== 0;
      const s = rr(0.12, 0.38);
      debris.spawn(
        p.x + rr(-0.5, 0.5), p.y + rr(-0.2, 0.3), p.z + rr(-0.4, 0.4),
        rr(-9, 9), rr(4, 13), rr(-5, 5),
        s * rr(1, 2.2), s * rr(0.25, 0.6), s * rr(0.8, 1.6),
        goldBit ? 1.0 : 0.08, goldBit ? 0.72 : 0.08, goldBit ? 0.3 : 0.09,
        rr(1.6, 2.6),
      );
    }
  }

  function score(p) {
    const ws = lastSpeed;
    gold.spawn(p.x, p.y, p.z, {
      life: 0.5, r0: 0.4, r1: 3.4, squash: 1, roll: 0,
      a: 1, thick0: 0.09, thick1: 0.03, r: 1, g: 0.78, b: 0.32, scroll: ws,
    });
    gold.spawn(p.x, p.y, p.z, {
      life: 0.38, r0: 0.2, r1: 2.1, squash: 1, roll: 0,
      a: 0.6, thick0: 0.05, thick1: 0.02, r: 1, g: 0.92, b: 0.7, scroll: ws,
    });
    for (let i = 0; i < 14; i++) {
      reset();
      const a = (i / 14) * 6.283 + rr(-0.2, 0.2), v = rr(3, 6);
      o.x = p.x + Math.cos(a) * 0.6; o.y = p.y + Math.sin(a) * 0.6; o.z = p.z + rr(-0.3, 0.3);
      o.vx = Math.cos(a) * v; o.vy = Math.sin(a) * v; o.vz = 0;
      o.drag = 3.5; o.grav = -1.5; o.scroll = ws;
      o.life = rr(0.45, 0.75); o.s0 = rr(0.25, 0.4); o.s1 = 0.08; o.a = 1; o.fadePow = 0.7;
      o.twinkle = rr(25, 40);
      o.r0 = 1; o.g0 = 0.95; o.b0 = 0.75; o.r1 = 1; o.g1 = 0.68; o.b1 = 0.2;
      add.spawn(o);
    }
  }

  let frameDt = 1 / 60;
  function update(dt) {
    dt = Math.min(Math.max(dt, 0), 0.05);
    frameDt = dt;
    soft.update(dt);
    add.update(dt);
    shock.update(dt);
    gold.update(dt);
    debris.update(dt);
  }

  return { puff, trail, crash, score, update };
}
