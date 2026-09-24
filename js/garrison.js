// 주둔군: 모든 국경선 양쪽과 주요 도시에 각 나라 병력을 배치
//  - 정복하면 안쪽 국경의 병력은 사라지고 새 바깥 국경·점령 도시에 정복국 병력이 들어섬
//  - 전쟁 중인 국경은 병력이 더 촘촘하고 자주포까지 배치
//  - InstancedMesh로 수백 대를 한 번에 그려 가볍게 유지
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { makeInstanced } from './models.js';
import { project } from './map.js';
import { CITIES } from './cities.js';

const MAX = { inf: 2600, tank: 1100, arty: 300, town: 200 };

export class Garrisons {
  constructor(scene, world, game, deps) {
    this.scene = scene; this.world = world; this.game = game; this.deps = deps; // { tY, sharedSegs, U }
    this.mesh = {};
    for (const k of ['inf', 'tank', 'arty']) { this.mesh[k] = makeInstanced(k, MAX[k]); scene.add(this.mesh[k]); }
    this.posts = []; this.dirty = true; this.cool = 0; this.t = 0;
    this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.v = new THREE.Vector3(); this.s = new THREE.Vector3(); this.c = new THREE.Color(); this.up = new THREE.Vector3(0, 1, 0);
    this.buildCities();
  }

  // 주요 도시: 어느 영토에 속하는지 찾아 작은 도시 모형과 이름표를 둠
  buildCities() {
    const W = this.world.countries;
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
  rebuild() {
    const g = this.game, T = g.territories, posts = [];
    for (const a of T) for (const j of a.land) {
      if (j <= a.idx) continue;
      const b = T[j];
      if (a.owner === b.owner) continue;
      const war = g.atWar(a.owner, b.owner);
      const spacing = war ? 1.1 : 2.2;
      let acc = spacing * 0.5;
      for (const [x1, z1, x2, z2] of this.deps.sharedSegs(a.idx, j)) {
        const L = Math.hypot(x2 - x1, z2 - z1); if (!L) continue;
        while (acc < L) {
          const t = acc / L, x = x1 + (x2 - x1) * t, z = z1 + (z2 - z1) * t;
          let nx = -(z2 - z1) / L, nz = (x2 - x1) / L;
          if (nx * (b.cx - x) + nz * (b.cy - z) < 0) { nx = -nx; nz = -nz; } // n → b 쪽
          posts.push({ x: x - nx * 0.45, z: z - nz * 0.45, fx: nx, fz: nz, t: a, war });   // a 쪽 초소는 b를 바라봄
          posts.push({ x: x + nx * 0.45, z: z + nz * 0.45, fx: -nx, fz: -nz, t: b, war });
          acc += spacing;
        }
        acc -= L;
      }
    }
    this.posts = posts;
  }

  update(dt, camD, target) {
    this.cool -= dt;
    if (this.dirty && this.cool <= 0) { this.dirty = false; this.cool = 0.8; this.rebuild(); }
    this.t -= dt;
    for (const c of this.cities) c.label.visible = camD < 32 && Math.hypot(c.x - target.x, c.z - target.z) < camD * 1.2;
    if (this.t > 0) return;
    this.t = 0.3;
    const cnt = { inf: 0, tank: 0, arty: 0 };
    const R = camD * 1.15 + 4;
    const show = camD < 75;
    const tier = new Map();
    const U = this.deps.U;
    const put = (type, x, z, y, yaw, color) => {
      if (cnt[type] >= MAX[type]) return;
      this.q.setFromAxisAngle(this.up, yaw);
      this.m4.compose(this.v.set(x, y, z), this.q, this.s.setScalar(U));
      this.mesh[type].setMatrixAt(cnt[type], this.m4);
      this.mesh[type].setColorAt(cnt[type], this.c.set(color));
      cnt[type]++;
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
        for (let k = 0; k < infN; k++) { const l = (k - (infN - 1) / 2) * 0.2; put('inf', p.x + px * l, p.z + pz * l, y, yaw, n.color); }
        if (tr >= 1) put('tank', p.x - p.fx * 0.35 + px * 0.25, p.z - p.fz * 0.35 + pz * 0.25, y, yaw, n.color);
        if (tr >= 3) put('tank', p.x - p.fx * 0.35 - px * 0.3, p.z - p.fz * 0.35 - pz * 0.3, y, yaw, n.color);
        if (p.war && tr >= 2) put('arty', p.x - p.fx * 1.0, p.z - p.fz * 1.0, y, yaw, n.color);
      }
      // 도시 주둔군 (점령된 도시엔 정복국 병력)
      for (const c of this.cities) {
        if (Math.abs(c.x - target.x) > R || Math.abs(c.z - target.z) > R) continue;
        const t = this.game.territories[c.idx], n = this.game.nations.get(t.owner); if (!n?.alive) continue;
        const y = this.deps.tY(c.idx) + 0.01, tr = tierOf(n);
        put('tank', c.x + 0.45, c.z + 0.2, y, 0.4, n.color);
        for (let k = 0; k < 2 + tr; k++) put('inf', c.x - 0.35 + k * 0.17, c.z + 0.45, y, 0.9, n.color);
      }
      // 점령지 수도에 정복국 부대
      for (const t of this.game.territories) {
        if (t.owner === t.home || Math.abs(t.cx - target.x) > R || Math.abs(t.cy - target.z) > R) continue;
        const n = this.game.nations.get(t.owner); if (!n?.alive) continue;
        const y = this.deps.tY(t.idx) + 0.01;
        put('tank', t.cx + 0.5, t.cy - 0.3, y, -0.5, n.color); put('tank', t.cx + 0.7, t.cy + 0.1, y, -0.5, n.color);
        for (let k = 0; k < 4; k++) put('inf', t.cx - 0.5 + k * 0.18, t.cy + 0.55, y, -0.3, n.color);
      }
    }
    for (const k of Object.keys(cnt)) {
      const m = this.mesh[k]; m.count = cnt[k];
      m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
}
