// 전쟁 연출: 진격 화살표(흐르는 줄무늬), 실제 국경을 따라 그어지는 전선, 전선을 따라 흩어진 공격군·방어군 배치 계산
import * as THREE from 'three';

// ---------- 진격 화살표 ----------
const arrowVS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const arrowFS = `
  uniform vec3 uColor; uniform float uTime, uLen, uAlpha, uDanger; varying vec2 vUv;
  void main(){
    float across = abs(vUv.y - 0.5) * 2.0;
    float edge = smoothstep(0.62, 0.9, across);
    float stripe = step(0.5, fract(vUv.x * uLen / 0.9 - uTime * 1.6));
    vec3 c = uColor * (0.75 + 0.35 * stripe);
    vec3 rim = mix(vec3(1.0), vec3(1.0, 0.25, 0.2), uDanger * (0.6 + 0.4 * sin(uTime * 8.0)));
    c = mix(c, rim, edge * 0.85);
    float a = uAlpha * (0.5 + 0.35 * stripe * (1.0 - edge) + edge * 0.4) * smoothstep(0.0, 0.06, vUv.x) * (1.0 - smoothstep(0.93, 1.0, across));
    gl_FragColor = vec4(c, a);
  }`;

export function makeArrow(from, to, color, width, y, danger = false) {
  const dx = to.x - from.x, dz = to.z - from.z, L = Math.hypot(dx, dz) || 1;
  const px = -dz / L, pz = dx / L;
  const bend = Math.min(3, L * 0.14) * (Math.random() < 0.5 ? 1 : -1);
  const cx = (from.x + to.x) / 2 + px * bend, cz = (from.z + to.z) / 2 + pz * bend;
  width *= THREE.MathUtils.clamp(L / 9, 0.35, 1); // 짧은 진격로는 화살표도 가늘게
  const N = 48, head = Math.min(0.3, (width * 1.8) / L + 0.05);
  const pos = [], uv = [], idx = [];
  const at = (t) => { const a = 1 - t; return [a * a * from.x + 2 * a * t * cx + t * t * to.x, a * a * from.z + 2 * a * t * cz + t * t * to.z]; };
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const [x, z] = at(t); const [x2, z2] = at(Math.min(1, t + 0.01)); const [x0, z0] = at(Math.max(0, t - 0.01));
    let tx = x2 - x0, tz = z2 - z0; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    let w;
    if (t < 1 - head) w = width * (0.75 + 0.25 * (t / (1 - head)));
    else w = width * 2.3 * (1 - (t - (1 - head)) / head);
    pos.push(x - tz * w / 2, y, z + tx * w / 2, x + tz * w / 2, y, z - tx * w / 2);
    uv.push(t, 0, t, 1);
    if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    vertexShader: arrowVS, fragmentShader: arrowFS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(color) }, uTime: { value: 0 }, uLen: { value: L }, uAlpha: { value: 0 }, uDanger: { value: danger ? 1 : 0 } },
  });
  const m = new THREE.Mesh(g, mat);
  m.renderOrder = 1;
  return m;
}

// ---------- 전선 계산 ----------
const key = (x, y) => x.toFixed(2) + ',' + y.toFixed(2);

// src 영토와 tgt 영토 사이 실제 국경(공유 경계) 또는 상륙 해안선을 찾아 일정 간격 점으로 반환
export function computeFront(world, srcIdx, tgtIdx, kind, from) {
  const S = world.countries[srcIdx], T = world.countries[tgtIdx];
  const segs = [];
  if (kind === 'land') {
    const set = new Set();
    for (const r of S.rings) for (let k = 0; k < r.length; k += 2) set.add(key(r[k], r[k + 1]));
    for (const r of T.rings) for (let k = 0; k < r.length; k += 2) {
      const j = (k + 2) % r.length;
      if (set.has(key(r[k], r[k + 1])) && set.has(key(r[j], r[j + 1]))) segs.push([r[k], r[k + 1], r[j], r[j + 1]]);
    }
  }
  let anchor;
  if (segs.length) {
    // 출발점과 목표를 잇는 선의 중간에서 가장 가까운 국경점을 전선 중심으로
    const mx = (from.x + T.cx) / 2, mz = (from.z + T.cy) / 2;
    let best = Infinity;
    for (const s of segs) { const d = (s[0] - mx) ** 2 + (s[1] - mz) ** 2; if (d < best) { best = d; anchor = [s[0], s[1]]; } }
  } else {
    // 상륙: 목표 해안선 중 출발지에서 가장 가까운 지점 주변
    let best = Infinity;
    for (const r of T.rings) for (let k = 0; k < r.length; k += 2) { const d = (r[k] - from.x) ** 2 + (r[k + 1] - from.z) ** 2; if (d < best) { best = d; anchor = [r[k], r[k + 1]]; } }
    for (const r of T.rings) for (let k = 0; k < r.length; k += 2) {
      const j = (k + 2) % r.length;
      segs.push([r[k], r[k + 1], r[j], r[j + 1]]);
    }
  }
  const R = kind === 'land' ? 4.5 : 2.2;
  const near = segs.filter((s) => Math.hypot((s[0] + s[2]) / 2 - anchor[0], (s[1] + s[3]) / 2 - anchor[1]) < R);
  // 일정 간격으로 점 찍기
  const pts = [];
  const step = 0.3;
  let carry = 0;
  for (const [x1, z1, x2, z2] of near) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len === 0) continue;
    let d = carry;
    while (d < len) {
      const t = d / len, x = x1 + (x2 - x1) * t, z = z1 + (z2 - z1) * t;
      // 안쪽(목표 방향) 법선
      let nx = -(z2 - z1) / len, nz = (x2 - x1) / len;
      if (nx * (T.cx - x) + nz * (T.cy - z) < 0) { nx = -nx; nz = -nz; }
      pts.push({ x, z, nx, nz });
      d += step;
    }
    carry = d - len;
  }
  if (!pts.length) pts.push({ x: anchor[0], z: anchor[1], nx: (T.cx - anchor[0]) / (Math.hypot(T.cx - anchor[0], T.cy - anchor[1]) || 1), nz: (T.cy - anchor[1]) / (Math.hypot(T.cx - anchor[0], T.cy - anchor[1]) || 1) });
  // 법선 부드럽게 (들쭉날쭉한 해안선 대비)
  for (let i = 0; i < pts.length; i++) {
    let sx = 0, sz = 0;
    for (let j = Math.max(0, i - 3); j <= Math.min(pts.length - 1, i + 3); j++) { sx += pts[j].nx; sz += pts[j].nz; }
    const l = Math.hypot(sx, sz) || 1; pts[i].snx = sx / l; pts[i].snz = sz / l;
  }
  const maxPush = Math.min(2.2, Math.hypot(T.cx - anchor[0], T.cy - anchor[1]) * 0.7);
  const P = pts.length > 60 ? pts.filter((_, i) => i % Math.ceil(pts.length / 60) === 0) : pts;
  // 각 점에서 안쪽 방향으로 영토를 벗어나기까지의 거리 (병력이 바다로 나가지 않게)
  const edges = [];
  for (const r of T.rings) for (let k = 0; k < r.length; k += 2) { const j = (k + 2) % r.length; edges.push(r[k], r[k + 1], r[j], r[j + 1]); }
  for (const p of P) {
    let best = 60;
    for (let k = 0; k < edges.length; k += 4) {
      const ex = edges[k + 2] - edges[k], ez = edges[k + 3] - edges[k + 1];
      const den = p.snx * ez - p.snz * ex; if (Math.abs(den) < 1e-9) continue;
      const qx = edges[k] - p.x, qz = edges[k + 1] - p.z;
      const t = (qx * ez - qz * ex) / den, u = (qx * p.snz - qz * p.snx) / den;
      if (t > 0.15 && u >= 0 && u <= 1 && t < best) best = t;
    }
    p.lim = best;
  }
  // 영토 전체를 덮는 데 필요한 진격 거리 (가장 먼 지점까지)
  let reach = 1;
  for (let k = 0; k < edges.length; k += 8) {
    let md = Infinity; for (const p of P) md = Math.min(md, Math.hypot(edges[k] - p.x, edges[k + 1] - p.z));
    if (md < 80) reach = Math.max(reach, md);
  }
  return { pts: P, anchor, maxPush, reach: reach * 1.05 };
}

// ---------- 전선 불꽃 띠 ----------
const frontFS = `
  uniform float uTime; varying vec2 vUv;
  float h(float x){ return fract(sin(x * 91.7) * 4375.5); }
  void main(){
    float across = abs(vUv.y - 0.5) * 2.0;
    float flick = 0.6 + 0.4 * sin(uTime * 13.0 + vUv.x * 40.0) * sin(uTime * 7.0 + vUv.x * 17.0);
    float core = 1.0 - smoothstep(0.0, 0.35, across);
    float glow = 1.0 - smoothstep(0.2, 1.0, across);
    vec3 c = mix(vec3(1.0, 0.25, 0.05), vec3(1.0, 0.85, 0.4), core);
    gl_FragColor = vec4(c * (0.8 + 0.6 * flick), (glow * 0.55 + core * 0.45) * flick);
  }`;

export class FrontLine {
  constructor(scene, front, y) {
    this.front = front; this.y = y; this.scene = scene;
    const n = front.pts.length;
    this.pos = new Float32Array(n * 2 * 3);
    const uv = [], idx = [];
    for (let i = 0; i < n; i++) {
      uv.push(i / Math.max(1, n - 1), 0, i / Math.max(1, n - 1), 1);
      if (i < n - 1) {
        const a = front.pts[i], b = front.pts[i + 1];
        if (Math.hypot(a.x - b.x, a.z - b.z) < 0.8) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    this.uTime = { value: 0 };
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({ vertexShader: arrowVS, fragmentShader: frontFS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { uTime: this.uTime } }));
    this.mesh.renderOrder = 2; this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.alpha = 0; this.adv = 0;
  }
  // push: 0~1 (공격군이 밀고 들어간 정도)
  place(i, push, side) { // side: -1 공격군 쪽, +1 방어군 쪽
    const p = this.front.pts[i]; const a = Math.min(this.adv, p.lim - 0.2);
    let d = a + side * 0.42; if (side > 0) d = Math.min(d, p.lim - 0.1);
    return [p.x + p.snx * d, p.z + p.snz * d, p.snx, p.snz];
  }
  update(dt, push) {
    this.uTime.value += dt;
    const w = 0.22 + 0.06 * Math.sin(this.uTime.value * 3);
    this.front.pts.forEach((p, i) => {
      const d = Math.max(0, Math.min(this.adv, p.lim - 0.2));
      const x = p.x + p.snx * d, z = p.z + p.snz * d;
      // 전선 방향에 수직(=법선)으로 폭을 준다
      this.pos.set([x - p.snx * w, this.y, z - p.snz * w, x + p.snx * w, this.y, z + p.snz * w], i * 6);
    });
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }
  dispose() { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
