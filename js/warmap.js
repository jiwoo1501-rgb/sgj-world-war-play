// 하츠 오브 아이언 풍 지도 연출
//  - 전쟁 중인 모든 나라 사이의 실제 국경에 양측 색으로 빛나는 전선
//  - 전선을 따라 늘어선 부대 표식(국기 + 병력)과, 가까이 보면 서로 마주 선 3D 병력
//  - 땅 위에 크게 쓰인 나라 이름 (영토 모양 방향으로)
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const key = (x, y) => x.toFixed(2) + ',' + y.toFixed(2);

const frontVS = `
  attribute vec2 offs; attribute vec3 col; attribute float edge;
  uniform float uWidth; varying vec3 vC; varying float vE;
  void main(){ vC = col; vE = edge; vec3 p = position; p.xz += offs * uWidth; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`;
const frontFS = `
  uniform float uTime; varying vec3 vC; varying float vE;
  void main(){
    float glow = pow(1.0 - vE, 1.6);
    float pulse = 0.8 + 0.2 * sin(uTime * 4.0);
    vec3 c = mix(vC * 1.25, vec3(1.0, 0.92, 0.75), smoothstep(0.75, 1.0, 1.0 - vE) * 0.8);
    gl_FragColor = vec4(c, (0.18 + 0.8 * glow) * pulse);
  }`;

export class WarMap {
  constructor(scene, world, game, deps) {
    this.scene = scene; this.world = world; this.game = game; this.deps = deps; // { tY, makeUnit, U, fx, sound, sfxAt }
    this.shared = new Map(); this.vsets = new Map();
    this.uTime = { value: 0 }; this.uWidth = { value: 0.2 };
    this.mesh = null; this.counters = []; this.dirty = true; this.cool = 0;
    this.pool = []; this.poolUsed = 0; this.garT = 0; this.fireT = 0;
    this.names = new Map(); this.nameDirty = new Set(); this.nameT = 0;
    this.nameGroup = new THREE.Group(); scene.add(this.nameGroup);
    this.garGroup = new THREE.Group(); scene.add(this.garGroup);
    for (const n of game.nations.values()) this.nameDirty.add(n.id);
    // 지방 표본점도 쉬는 틈에 미리 계산
    const idle = window.requestIdleCallback || ((f) => setTimeout(() => f({ timeRemaining: () => 8 }), 50));
    let pi = 0; const run = (dl) => { while (pi < world.provinces.length && dl.timeRemaining() > 2) this.provSamples(pi++); if (pi < world.provinces.length) idle(run); };
    idle(run);
  }

  vset(i) {
    if (!this.vsets.has(i)) { const s = new Set(); for (const r of this.world.provinces[i].rings) for (let k = 0; k < r.length; k += 2) s.add(key(r[k], r[k + 1])); this.vsets.set(i, s); }
    return this.vsets.get(i);
  }
  // 두 영토가 실제로 맞닿은 국경 선분 (캐시)
  sharedSegs(i, j) {
    const k = i < j ? i + '|' + j : j + '|' + i;
    if (this.shared.has(k)) return this.shared.get(k);
    const set = this.vset(i), segs = [];
    for (const r of this.world.provinces[j].rings) for (let q = 0; q < r.length; q += 2) {
      const w = (q + 2) % r.length;
      if (set.has(key(r[q], r[q + 1])) && set.has(key(r[w], r[w + 1]))) segs.push([r[q], r[q + 1], r[w], r[w + 1]]);
    }
    this.shared.set(k, segs);
    return segs;
  }

  // 전선 띠: 정점 버퍼를 한 번 잡아 두고 채워 쓰기 (매번 새 배열을 만들면 GC로 끊김)
  ensureBuf(nv) {
    if (this.cap >= nv) return;
    this.cap = Math.max(nv, (this.cap || 0) * 2, 30000);
    this.bPos = new Float32Array(this.cap * 3); this.bOffs = new Float32Array(this.cap * 2); this.bCol = new Float32Array(this.cap * 3); this.bEdge = new Float32Array(this.cap);
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh = null; }
  }
  rebuild() {
    const g = this.game, T = g.territories;
    const fronts = [];
    let nSeg = 0;
    for (const w of g.wars.values()) {
      const A = g.nations.get(w.a), B = g.nations.get(w.b);
      if (!A?.alive || !B?.alive) continue;
      const segs = [];
      for (const ta of g.owned(w.a)) for (const j of ta.land) {
        if (T[j].owner !== w.b) continue;
        for (const sg of this.sharedSegs(ta.idx, j)) segs.push({ s: sg, a: ta, b: T[j] });
      }
      if (!segs.length) continue;
      fronts.push({ A, B, segs }); nSeg += segs.length;
    }
    this.ensureBuf(nSeg * 12);
    const P = this.bPos, O = this.bOffs, Cc = this.bCol, E = this.bEdge;
    let v = 0;
    const put = (x, y, z, ox, oz, c, e) => { P[v * 3] = x; P[v * 3 + 1] = y; P[v * 3 + 2] = z; O[v * 2] = ox; O[v * 2 + 1] = oz; Cc[v * 3] = c.r; Cc[v * 3 + 1] = c.g; Cc[v * 3 + 2] = c.b; E[v] = e; v++; };
    const ca = new THREE.Color(), cb = new THREE.Color();
    for (const { A, B, segs } of fronts) {
      ca.set(A.color); cb.set(B.color);
      for (const { s: [x1, z1, x2, z2], a, b } of segs) {
        const dx = x2 - x1, dz = z2 - z1, L = Math.hypot(dx, dz) || 1;
        let nx = -dz / L, nz = dx / L;
        if (nx * (b.cx - (x1 + x2) / 2) + nz * (b.cy - (z1 + z2) / 2) < 0) { nx = -nx; nz = -nz; } // n → B 쪽
        const y = Math.max(this.deps.tY(a.idx), this.deps.tY(b.idx)) + 0.03;
        for (let side = 1; side >= -1; side -= 2) {
          const c = side > 0 ? cb : ca, ox = nx * side, oz = nz * side;
          put(x1, y, z1, 0, 0, c, 0); put(x2, y, z2, 0, 0, c, 0); put(x1, y, z1, ox, oz, c, 1);
          put(x2, y, z2, 0, 0, c, 0); put(x2, y, z2, ox, oz, c, 1); put(x1, y, z1, ox, oz, c, 1);
        }
      }
    }
    if (!this.mesh) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(P, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('offs', new THREE.BufferAttribute(O, 2).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('col', new THREE.BufferAttribute(Cc, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('edge', new THREE.BufferAttribute(E, 1).setUsage(THREE.DynamicDrawUsage));
      this.mesh = new THREE.Mesh(geo, this.mat ||= new THREE.ShaderMaterial({ vertexShader: frontVS, fragmentShader: frontFS, transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: { uTime: this.uTime, uWidth: this.uWidth } }));
      this.mesh.renderOrder = 1; this.mesh.frustumCulled = false;
      this.scene.add(this.mesh);
    }
    const ga = this.mesh.geometry.attributes;
    for (const k of ['position', 'offs', 'col', 'edge']) { ga[k].clearUpdateRanges?.(); ga[k].addUpdateRange?.(0, v * ga[k].itemSize); ga[k].needsUpdate = true; }
    this.mesh.geometry.setDrawRange(0, v);
    this.buildCounters(fronts);
    this.fronts = fronts;
  }

  // 전선을 따라 일정 간격으로 양측 부대 표식
  buildCounters(fronts) {
    const pool = this.counters; // 기존 표식 재사용 (DOM 생성·삭제가 가장 비쌈)
    let used = 0;
    this.counters = []; this.cnt = new Map();
    for (const { A, B, segs } of fronts) {
      const total = segs.reduce((s, { s: q }) => s + Math.hypot(q[2] - q[0], q[3] - q[1]), 0);
      const spacing = Math.max(1.6, total / 10);
      let acc = spacing / 2; const pts = [];
      for (const { s: [x1, z1, x2, z2], b } of segs) {
        const L = Math.hypot(x2 - x1, z2 - z1); if (!L) continue;
        while (acc < L) {
          const t = acc / L, x = x1 + (x2 - x1) * t, z = z1 + (z2 - z1) * t;
          let nx = -(z2 - z1) / L, nz = (x2 - x1) / L;
          if (nx * (b.cx - x) + nz * (b.cy - z) < 0) { nx = -nx; nz = -nz; }
          pts.push({ x, z, nx, nz, b });
          acc += spacing;
        }
        acc -= L;
      }
      for (const p of pts) for (const [N, side] of [[A, -1], [B, 1]]) {
        let c = pool[used++];
        if (!c) {
          const div = document.createElement('div');
          div.innerHTML = '<span class="cf"></span><b></b><i></i>';
          const obj = new CSS2DObject(div); this.scene.add(obj);
          c = { obj, num: div.querySelector('b'), bar: div.querySelector('i'), cf: div.querySelector('.cf') };
        }
        if (c.nid !== N.id) {
          c.nid = N.id; c.obj.element.className = 'counter' + (N.isPlayer ? ' me' : '');
          c.obj.element.style.setProperty('--c', N.color); c.cf.textContent = N.flag;
        }
        c.obj.position.set(p.x + p.nx * side * 0.55, this.deps.tY(p.b.idx) + 0.3, p.z + p.nz * side * 0.55);
        Object.assign(c, { n: N, p, side });
        this.cnt.set(N.id, (this.cnt.get(N.id) || 0) + 1);
        this.counters.push(c);
      }
    }
    for (let i = used; i < pool.length; i++) { pool[i].obj.element.remove(); this.scene.remove(pool[i].obj); }
  }

  // ---------- 땅 위 나라 이름 ----------
  buildName(n) {
    const old = this.names.get(n.id);
    if (old) { this.nameGroup.remove(old); old.geometry.dispose(); old.material.map.dispose(); old.material.dispose(); this.names.delete(n.id); }
    if (!n.alive) return;
    const g = this.game, T = g.territories;
    // 수도에서 육로로 이어진 영토 덩어리
    const start = T[n.capital]; if (start.owner !== n.id) return;
    const seen = new Set([start.idx]), q = [start.idx];
    while (q.length) { const i = q.pop(); for (const j of T[i].land) if (!seen.has(j) && T[j].owner === n.id) { seen.add(j); q.push(j); } }
    // 영토 내부의 고른 표본점 (지방마다 한 번 계산해 캐시 → 해안선 굴곡에 휘둘리지 않는 면적 기준)
    const P = [];
    for (const i of seen) { const pp = this.provSamples(i); for (let k = 0; k < pp.length; k++) P.push(pp[k]); }
    const m = P.length / 2; if (m < 6) return;
    let mx = 0, mz = 0; for (let k = 0; k < P.length; k += 2) { mx += P[k]; mz += P[k + 1]; } mx /= m; mz /= m;
    let sxx = 0, sxz = 0, szz = 0;
    for (let k = 0; k < P.length; k += 2) { const a = P[k] - mx, b = P[k + 1] - mz; sxx += a * a; sxz += a * b; szz += b * b; }
    let ang = 0.5 * Math.atan2(2 * sxz, sxx - szz); // 주축 방향
    ang = THREE.MathUtils.clamp(ang, -0.6, 0.6); // 글자가 너무 기울지 않게
    const ux = Math.cos(ang), uz = Math.sin(ang);
    const a1 = [], a2 = [];
    for (let k = 0; k < P.length; k += 2) { const a = P[k] - mx, b = P[k + 1] - mz; a1.push(a * ux + b * uz); a2.push(-a * uz + b * ux); }
    a1.sort((x, y) => x - y); a2.sort((x, y) => x - y);
    const pct = (arr, p) => arr[Math.floor(p * (arr.length - 1))];
    const len = pct(a1, 0.95) - pct(a1, 0.05), wid = pct(a2, 0.9) - pct(a2, 0.1);
    const c1 = (pct(a1, 0.95) + pct(a1, 0.05)) / 2, c2 = (pct(a2, 0.9) + pct(a2, 0.1)) / 2;
    const cx = mx + ux * c1 - uz * c2, cz = mz + uz * c1 + ux * c2;
    const name = n.name.length > 8 ? n.name.replace(/ /g, '') : n.name;
    const chars = [...name].length;
    let h = Math.min(wid * 0.5, (len * 0.8) / (chars * 1.15));
    if (h < 0.55) return; // 작은 나라는 라벨 칩으로 충분
    h = Math.min(h, 9);
    // 캔버스에 글자 그리기 (넓은 자간)
    const cv = document.createElement('canvas'); const ctx = cv.getContext('2d');
    const fs = 120; ctx.font = `800 ${fs}px "Noto Sans KR", sans-serif`;
    const spacing = fs * 0.28;
    const widths = [...name].map((ch) => ctx.measureText(ch).width);
    const tw = widths.reduce((s, w) => s + w, 0) + spacing * (chars - 1);
    cv.width = Math.ceil(tw + 40); cv.height = Math.ceil(fs * 1.4);
    ctx.font = `800 ${fs}px "Noto Sans KR", sans-serif`; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round'; ctx.lineWidth = 14; ctx.strokeStyle = 'rgba(10,14,20,0.55)'; ctx.fillStyle = n.isPlayer ? 'rgba(235,245,255,0.92)' : 'rgba(245,240,230,0.82)';
    let x = 20;
    [...name].forEach((ch, i) => { ctx.strokeText(ch, x, cv.height / 2); ctx.fillText(ch, x, cv.height / 2); x += widths[i] + spacing; });
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const pw = h * (cv.width / cv.height) * 1.0, ph = h * 1.4 * (cv.height / cv.height);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 }));
    mesh.rotation.set(-Math.PI / 2, 0, -ang, 'XYZ');
    mesh.position.set(cx, 0.22, cz);
    mesh.renderOrder = 3;
    mesh.userData.h = h;
    this.nameGroup.add(mesh); this.names.set(n.id, mesh);
  }
  provSamples(i) {
    (this._ps ||= new Map());
    let out = this._ps.get(i);
    if (out) return out;
    const rings = this.world.provinces[i].rings;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const r of rings) for (let k = 0; k < r.length; k += 2) { x0 = Math.min(x0, r[k]); x1 = Math.max(x1, r[k]); z0 = Math.min(z0, r[k + 1]); z1 = Math.max(z1, r[k + 1]); }
    const step = Math.max(0.25, Math.max(x1 - x0, z1 - z0) / 9);
    out = [];
    for (let x = x0 + step / 2; x < x1; x += step) for (let z = z0 + step / 2; z < z1; z += step) {
      let hit = false;
      for (const r of rings) { let inn = false; for (let k = 0, j = r.length - 2; k < r.length; j = k, k += 2) if ((r[k + 1] > z) !== (r[j + 1] > z) && x < ((r[j] - r[k]) * (z - r[k + 1])) / (r[j + 1] - r[k + 1]) + r[k]) inn = !inn; if (inn) { hit = true; break; } }
      // 넓은 지방일수록 점 하나가 대표하는 면적이 크므로 가중치 삼아 여러 번 넣음
      if (hit) { const w = Math.max(1, Math.round((step * step) / 0.5)); for (let q = 0; q < Math.min(w, 6); q++) out.push(x, z); }
    }
    this._ps.set(i, out);
    return out;
  }
  markNames(...ids) { for (const id of ids) if (id) this.nameDirty.add(id); }

  // ---------- 매 프레임 ----------
  update(dt, camD, target) {
    this.uTime.value += dt;
    this.uWidth.value = THREE.MathUtils.clamp(camD * 0.006, 0.17, 1.4);
    this.cool -= dt;
    if (this.dirty && this.cool <= 0) { this.dirty = false; this.cool = 2.5; this.rebuild(); }
    // 나라 이름: 멀리서 보일 때 드러남
    this.nameT -= dt;
    if (this.nameT <= 0 && this.nameDirty.size) { this.nameT = 0.4; let k = 0; for (const id of this.nameDirty) { this.buildName(this.game.nations.get(id)); this.nameDirty.delete(id); if (++k > 8) break; } }
    const nameA = THREE.MathUtils.clamp((camD - 30) / 40, 0, 1);
    for (const m of this.names.values()) m.material.opacity = nameA * THREE.MathUtils.clamp(m.userData.h * 60 / camD, 0.25, 1);
    this.nameGroup.visible = nameA > 0.01;
    // 부대 표식
    const showC = camD < 110;
    const powOf = new Map();
    for (const c of this.counters) {
      const vis = showC && Math.hypot(c.p.x - target.x, c.p.z - target.z) < camD * 1.3;
      c.obj.visible = vis;
      if (!vis) continue;
      let p = powOf.get(c.n.id);
      if (p === undefined) { p = this.game.power(c.n.units, (u) => u.cls === 'ground') * c.n.tech; powOf.set(c.n.id, p); }
      const nc = this.cnt.get(c.n.id) || 1;
      const v = p / nc;
      c.num.textContent = v >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.max(1, Math.round(v));
      c.bar.style.width = Math.min(100, 20 + Math.log10(v + 1) * 30) + '%';
    }
    // 가까이 보면 전선 양쪽에 3D 병력 배치 + 전선 곳곳의 포격전
    this.garT -= dt;
    // (3D 병력 배치는 garrison.js가 모든 국경에 대해 담당)
    this.fireT -= dt;
    if (this.fireT <= 0 && this.counters.length && camD < 90) {
      this.fireT = 0.25 + Math.random() * 0.4;
      const near = this.counters.filter((c) => c.obj.visible);
      const c = near[Math.floor(Math.random() * near.length)];
      if (c) {
        const s = Math.random() < 0.5 ? 1 : -1;
        const x = c.p.x + c.p.nx * s * (0.5 + Math.random() * 1.2) + (Math.random() - 0.5) * 0.8;
        const z = c.p.z + c.p.nz * s * (0.5 + Math.random() * 1.2) + (Math.random() - 0.5) * 0.8;
        const sz = 0.35 + Math.random() * 0.45;
        this.deps.fx.explosion(x, this.deps.tY(c.p.b.idx), z, sz);
        const [v, pan] = this.deps.sfxAt(x, z);
        this.deps.sound.explosion(v * 0.5, pan, sz);
        if (Math.random() < 0.4) this.deps.sound.gunfire(v * 0.4, pan);
      }
    }
  }

  placeGarrisons(camD, target) {
    const close = camD < 45 ? this.counters.filter((c) => Math.hypot(c.p.x - target.x, c.p.z - target.z) < Math.max(10, camD * 0.8)) : [];
    let used = 0;
    const take = (type, color) => {
      let m = this.pool[used];
      if (!m || m.userData.type !== type || m.userData.color !== color) {
        if (m) this.garGroup.remove(m);
        m = this.deps.makeUnit(type, color); m.scale.setScalar(this.deps.U); m.userData = { type, color };
        this.pool[used] = m; this.garGroup.add(m);
      }
      m.visible = true; used++; return m;
    };
    for (const c of close.slice(0, 60)) {
      const y = this.deps.tY(c.p.b.idx) + 0.02;
      const face = Math.atan2(c.p.nz * c.side, -c.p.nx * c.side); // 전선 너머 적을 향함
      const px = -c.p.nz, pz = c.p.nx;
      const units = [['tank', 0], ['inf', -0.35], ['inf', 0.35]];
      for (const [type, lat] of units) {
        const m = take(type, c.n.color);
        const back = type === 'tank' ? 0.45 : 0.25;
        m.position.set(c.p.x + c.p.nx * c.side * (0.3 + back) + px * lat, y, c.p.z + c.p.nz * c.side * (0.3 + back) + pz * lat);
        m.rotation.set(0, face, 0);
      }
    }
    for (let i = used; i < this.pool.length; i++) if (this.pool[i]) this.pool[i].visible = false;
  }
}
