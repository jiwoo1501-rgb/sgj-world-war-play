// 주둔군: 모든 국경선 양쪽과 주요 도시에 각 나라 병력을 배치
//  - 정복하면 안쪽 국경의 병력은 사라지고 새 바깥 국경·점령 도시에 정복국 병력이 들어섬
//  - 전쟁 중인 국경은 병력이 더 촘촘하고 자주포까지 배치
//  - InstancedMesh로 수백 대를 한 번에 그려 가볍게 유지
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { makeInstanced, variantKey } from './models.js';
import { project } from './map.js';
import { CITIES } from './cities.js';

const MAX = { inf: 1400, tank: 600, arty: 160, town: 200 };

export class Garrisons {
  constructor(scene, world, game, deps) {
    this.scene = scene; this.world = world; this.game = game; this.deps = deps; // { tY, sharedSegs, U }
    this.mesh = {};
    this.pools = new Map(); // (유닛 종류, 나라별 모델) → InstancedMesh
    this.posts = []; this.dirty = true; this.cool = 0; this.t = 0;
    this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.v = new THREE.Vector3(); this.s = new THREE.Vector3(); this.c = new THREE.Color(); this.up = new THREE.Vector3(0, 1, 0);
    this.buildCities();
  }

  // 주요 도시: 어느 영토에 속하는지 찾아 작은 도시 모형과 이름표를 둠
  buildCities() {
    const W = this.world.provinces;
    const inside = (x, z, i) => {
      for (const r of W[i].rings) {
        let inn = false;
        for (let k = 0, j = r.length - 2; k < r.length; j = k, k += 2) if ((r[k + 1] > z) !== (r[j + 1] > z) && x < ((r[j] - r[k]) * (z - r[k + 1])) / (r[j + 1] - r[k + 1]) + r[k]) inn = !inn;
        if (inn) return true;
      }
      return false;
    };
    this.cities = [];
    for (const [name, lon, lat] of CITIES) {
      const [x, z] = project(lon, lat);
      let idx = -1, best = Infinity;
      for (let i = 0; i < W.length; i++) { const d = Math.hypot(W[i].cx - x, W[i].cy - z); if (d < 40 && inside(x, z, i)) { if (d < best) { best = d; idx = i; } } }
      if (idx < 0) continue;
      this.cities.push({ name, x, z, idx });
    }
    const towns = makeInstanced('town', this.cities.length);
    this.cities.forEach((c, i) => {
      this.m4.compose(this.v.set(c.x, this.deps.tY(c.idx), c.z), this.q.identity(), this.s.setScalar(0.55));
      towns.setMatrixAt(i, this.m4); towns.setColorAt(i, this.c.set(0xffffff));
      const d = document.createElement('div'); d.className = 'city-label'; d.textContent = c.name;
      const o = new CSS2DObject(d); o.position.set(c.x, this.deps.tY(c.idx) + 0.35, c.z); o.visible = false;
      this.scene.add(o); c.label = o;
    });
    towns.count = this.cities.length; towns.castShadow = false; towns.receiveShadow = true;
    towns.instanceMatrix.needsUpdate = true;
    this.scene.add(towns);
  }

  // 국경 초소 계산: 주인이 다른 두 영토가 맞닿은 곳마다 양쪽에 초소
  // 두 지방 사이 국경 초소 자리 (지형은 변하지 않으므로 쌍마다 한 번만 계산해 캐시)
  pairPts(a, b, spacing) {
    const key = a.idx + '|' + b.idx + '|' + spacing;
    (this._pp ||= new Map());
    let pts = this._pp.get(key);
    if (pts) return pts;
    pts = [];
    let acc = spacing * 0.5;
    for (const [x1, z1, x2, z2] of this.deps.sharedSegs(a.idx, b.idx)) {
      const L = Math.hypot(x2 - x1, z2 - z1); if (!L) continue;
      while (acc < L) {
        const t = acc / L, x = x1 + (x2 - x1) * t, z = z1 + (z2 - z1) * t;
        let nx = -(z2 - z1) / L, nz = (x2 - x1) / L;
        if (nx * (b.cx - x) + nz * (b.cy - z) < 0) { nx = -nx; nz = -nz; } // n → b 쪽
        pts.push(x, z, nx, nz);
        acc += spacing;
      }
      acc -= L;
    }
    this._pp.set(key, pts);
    return pts;
  }
  // 국경 초소: 주인이 다른 두 지방이 맞닿은 곳마다 양쪽에 초소
  rebuild() {
    const g = this.game, T = g.territories, posts = [];
    for (const a of T) for (const j of a.land) {
      if (j <= a.idx) continue;
      const b = T[j];
      if (a.owner === b.owner) continue;
      const war = g.atWar(a.owner, b.owner);
      const pts = this.pairPts(a, b, war ? 1.1 : 2.2);
      for (let k = 0; k < pts.length; k += 4) {
        const x = pts[k], z = pts[k + 1], nx = pts[k + 2], nz = pts[k + 3];
        posts.push({ x: x - nx * 0.45, z: z - nz * 0.45, fx: nx, fz: nz, t: a, war });   // a 쪽 초소는 b를 바라봄
        posts.push({ x: x + nx * 0.45, z: z + nz * 0.45, fx: -nx, fz: -nz, t: b, war });
      }
    }
    this.posts = posts;
  }

  update(dt, camD, target) {
    this.cool -= dt;
    if (this.dirty && this.cool <= 0) { this.dirty = false; this.cool = 2; this.rebuild(); }
    this.t -= dt;
    for (const c of this.cities) c.label.visible = camD < 32 && Math.hypot(c.x - target.x, c.z - target.z) < camD * 1.2;
    if (this.t > 0) return;
    this.t = 0.3;
    for (const p of this.pools.values()) p.n = 0;
    const R = camD * 1.15 + 4;
    const show = camD < 75;
    const tier = new Map();
    const U = this.deps.U;
    // 나라마다 실제 장비 모델이 다르므로, 모델별 InstancedMesh에 나눠 담는다
    const put = (type, x, z, y, yaw, n) => {
      const key = type + ':' + variantKey(type, n.id);
      let p = this.pools.get(key);
      if (!p) { p = { m: makeInstanced(type, MAX[type], n.id), n: 0 }; this.scene.add(p.m); this.pools.set(key, p); }
      if (p.n >= MAX[type]) return;
      this.q.setFromAxisAngle(this.up, yaw);
      this.m4.compose(this.v.set(x, y, z), this.q, this.s.setScalar(U));
      p.m.setMatrixAt(p.n, this.m4);
      p.m.setColorAt(p.n, this.c.set(n.color));
      p.n++;
    };
    const tierOf = (n) => {
      if (!tier.has(n.id)) { const p = this.game.armyPow(n) * n.tech; tier.set(n.id, p < 60 ? 0 : p < 300 ? 1 : p < 1200 ? 2 : 3); }
      return tier.get(n.id);
    };
    if (show) {
      // 국경 초소
      for (const p of this.posts) {
        if (Math.abs(p.x - target.x) > R || Math.abs(p.z - target.z) > R) continue;
        const n = this.game.nations.get(p.t.owner); if (!n?.alive) continue;
        const tr = tierOf(n) + (p.war ? 1 : 0);
        const y = this.deps.tY(p.t.idx) + 0.01;
        const yaw = Math.atan2(-p.fz, p.fx);
        const px = -p.fz, pz = p.fx; // 국경 방향
        const infN = Math.min(3, 1 + tr);
        for (let k = 0; k < infN; k++) { const l = (k - (infN - 1) / 2) * 0.2; put('inf', p.x + px * l, p.z + pz * l, y, yaw, n); }
        if (tr >= 1) put('tank', p.x - p.fx * 0.35 + px * 0.25, p.z - p.fz * 0.35 + pz * 0.25, y, yaw, n);
        if (tr >= 3) put('tank', p.x - p.fx * 0.35 - px * 0.3, p.z - p.fz * 0.35 - pz * 0.3, y, yaw, n);
        if (p.war && tr >= 2) put('arty', p.x - p.fx * 1.0, p.z - p.fz * 1.0, y, yaw, n);
      }
      // 도시 주둔군 (점령된 도시엔 정복국 병력)
      for (const c of this.cities) {
        if (Math.abs(c.x - target.x) > R || Math.abs(c.z - target.z) > R) continue;
        const t = this.game.territories[c.idx], n = this.game.nations.get(t.owner); if (!n?.alive) continue;
        const y = this.deps.tY(c.idx) + 0.01, tr = tierOf(n);
        put('tank', c.x + 0.45, c.z + 0.2, y, 0.4, n);
        for (let k = 0; k < 2 + tr; k++) put('inf', c.x - 0.35 + k * 0.17, c.z + 0.45, y, 0.9, n);
      }
      // 점령지 수도에 정복국 부대
      for (const t of this.game.territories) {
        if (t.owner === t.home || Math.abs(t.cx - target.x) > R || Math.abs(t.cy - target.z) > R) continue;
        const n = this.game.nations.get(t.owner); if (!n?.alive) continue;
        const y = this.deps.tY(t.idx) + 0.01;
        put('tank', t.cx + 0.5, t.cy - 0.3, y, -0.5, n); put('tank', t.cx + 0.7, t.cy + 0.1, y, -0.5, n);
        for (let k = 0; k < 4; k++) put('inf', t.cx - 0.5 + k * 0.18, t.cy + 0.55, y, -0.3, n);
      }
    }
    for (const p of this.pools.values()) {
      p.m.count = p.n;
      p.m.instanceMatrix.needsUpdate = true; if (p.m.instanceColor) p.m.instanceColor.needsUpdate = true;
    }
  }
}
