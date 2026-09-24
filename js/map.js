// 평면 세계지도: 바다 셰이더, 국가별 얇은 입체 영토, 국경선, 경위선, 바다 이름
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const LAND_H = 0.12;
const W = 400;
export function project(lon, lat) {
  let l = lon - 150; while (l < -180) l += 360; while (l > 180) l -= 360;
  const x = (l / 360) * W;
  const y = -(W / (2 * Math.PI)) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  return [x, y];
}

const noiseChunk = `
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v+=a*vnoise(p); p*=2.03; a*=0.5; } return v; }
`;

export class WorldMap {
  constructor(scene, world) {
    this.scene = scene; this.world = world;
    this.meshes = []; this.time = { value: 0 };
    this.group = new THREE.Group(); scene.add(this.group);
    this.buildOcean();
    this.buildGraticule();
    this.buildLand();
    this.buildBorders();
    this.buildSeaLabels();
    this.highlight = null;
  }

  buildOcean() {
    const g = new THREE.PlaneGeometry(W * 1.6, (this.world.yS - this.world.yN) * 1.8, 1, 1);
    g.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: this.time },
      vertexShader: 'varying vec2 vP; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vP = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: noiseChunk + `
        uniform float uTime; varying vec2 vP;
        void main(){
          vec2 p = vP * 0.35;
          float n = fbm(p + vec2(uTime*0.05, uTime*0.03));
          float n2 = fbm(p*2.7 - vec2(uTime*0.08, -uTime*0.04));
          vec3 deep = vec3(0.03,0.12,0.24), shallow = vec3(0.06,0.27,0.42);
          vec3 c = mix(deep, shallow, n*0.9);
          float caust = smoothstep(0.62, 0.78, n2) * 0.18;
          c += vec3(0.5,0.75,0.9) * caust;
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    const m = new THREE.Mesh(g, mat);
    m.position.set(0, -0.02, (this.world.yN + this.world.yS) / 2);
    m.receiveShadow = false;
    this.group.add(m);
    this.ocean = m;
  }

  buildGraticule() {
    const pts = [];
    for (let lon = -180; lon < 180; lon += 15) {
      for (let lat = -56; lat < 80; lat += 2) {
        const a = project(lon, lat), b = project(lon, lat + 2);
        if (Math.abs(a[0] - b[0]) < 10) pts.push(a[0], 0.0, a[1], b[0], 0.0, b[1]);
      }
    }
    for (let lat = -45; lat <= 75; lat += 15) {
      const y = project(0, lat)[1];
      pts.push(-W / 2, 0.0, y, W / 2, 0.0, y);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x7fb4d8, transparent: true, opacity: 0.12 }));
    this.group.add(l);
  }

  // 나라마다 메시 하나. 각 정점에 '지방 번호'를 넣어 지방별 색·점령 진행을 셰이더에서 칠한다.
  buildLand() {
    const W = this.world, C = W.countries, P = W.provinces;
    this.provLocal = new Int16Array(P.length);  // 지방 → 나라 안에서의 번호
    const areaRank = [...C.keys()].sort((a, b) => C[b].area - C[a].area);
    const rankOf = new Map(areaRank.map((i, r) => [i, r]));
    C.forEach((c, ci) => {
      const geos = [];
      c.provs.forEach((pi, local) => {
        this.provLocal[pi] = local;
        const shapes = P[pi].rings.map((r) => { const v = []; for (let k = 0; k < r.length; k += 2) v.push(new THREE.Vector2(r[k], -r[k + 1])); return new THREE.Shape(v); });
        const g = new THREE.ExtrudeGeometry(shapes, { depth: LAND_H, bevelEnabled: false, curveSegments: 1 });
        g.deleteAttribute('uv');
        const n = g.attributes.position.count;
        g.setAttribute('prov', new THREE.BufferAttribute(new Float32Array(n).fill(local), 1));
        geos.push(g);
      });
      const g = geos.length === 1 ? geos[0] : mergeGeometries(geos);
      g.rotateX(-Math.PI / 2); // (x, -y) 평면 → XZ 평면, 두께는 +Y
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0.0 });
      const u = mat.userData.u = {
        uProvCol: { value: Array.from({ length: 48 }, () => new THREE.Color(0x888888)) },
        uOccProv: { value: new Int32Array([-1, -1, -1, -1]) }, uOccN: { value: new Int32Array(4) },
        uOccPts: { value: Array.from({ length: 48 }, () => new THREE.Vector2()) },
        uOccAdv: { value: new Float32Array(4) }, uOccCol: { value: Array.from({ length: 4 }, () => new THREE.Color()) },
        uTimeL: this.time,
      };
      mat.userData.slots = [null, null, null, null]; // 점령 진행 슬롯 → 지방 번호
      mat.userData.tweens = new Map();
      mat.onBeforeCompile = (s) => {
        Object.assign(s.uniforms, u);
        s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute float prov;\nvarying vec3 vW;\nflat varying int vProv;')
          .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvW = (modelMatrix * vec4(transformed,1.0)).xyz;\nvProv = int(prov + 0.5);');
        s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>
            varying vec3 vW; flat varying int vProv;
            uniform vec3 uProvCol[48];
            uniform int uOccProv[4]; uniform int uOccN[4]; uniform vec2 uOccPts[48]; uniform float uOccAdv[4]; uniform vec3 uOccCol[4]; uniform float uTimeL;
            ` + noiseChunk)
          .replace('#include <color_fragment>', `#include <color_fragment>
            diffuseColor.rgb *= uProvCol[vProv];
            float t = fbm(vW.xz * 0.9);
            float t2 = fbm(vW.xz * 4.0);
            diffuseColor.rgb *= 0.78 + 0.34 * t + 0.1 * (t2 - 0.5);
            for (int s = 0; s < 4; s++) {
              if (uOccProv[s] != vProv || uOccN[s] == 0) continue;
              float md = 1e9;
              for (int i = 0; i < 12; i++) { if (i >= uOccN[s]) break; md = min(md, distance(vW.xz, uOccPts[s * 12 + i])); }
              float adv = uOccAdv[s];
              float edge = adv - md + (fbm(vW.xz * 1.3) - 0.5) * 0.9 * min(1.0, adv);
              if (edge > 0.0) {
                float stripe = step(0.55, fract((vW.x - vW.z) * 2.2));
                diffuseColor.rgb = mix(diffuseColor.rgb, uOccCol[s] * (0.78 + 0.34 * t) * (1.0 - 0.18 * stripe), 0.9);
              }
              float glow = smoothstep(0.32, 0.0, abs(edge)) * step(0.02, adv);
              diffuseColor.rgb += vec3(1.0, 0.42, 0.1) * glow * (0.55 + 0.45 * sin(uTimeL * 9.0 + md * 5.0));
            }
            if (vW.y < ${(LAND_H - 0.01).toFixed(3)}) diffuseColor.rgb *= 0.55;`);
      };
      mat.customProgramCacheKey = () => 'land-prov';
      const m = new THREE.Mesh(g, mat);
      m.position.y = (rankOf.get(ci) / C.length) * 0.03; // 작은 나라(엔클레이브)가 위로
      m.receiveShadow = true;
      m.userData.country = ci;
      this.group.add(m);
      this.meshes.push(m);
    });
  }

  // 클릭한 위치의 지방 번호
  provAt(hit) {
    const ci = hit.object.userData.country;
    const local = Math.round(hit.object.geometry.attributes.prov.getX(hit.face.a));
    return this.world.countries[ci].provs[local];
  }
  meshOf(pi) { return this.meshes[this.world.provinces[pi].c]; }
  heightOf(pi) { return LAND_H + this.meshOf(pi).position.y; }

  buildBorders() {
    // 나라 국경(진하게) + 지방 경계(옅게)
    const cpts = [], ppts = [];
    this.world.countries.forEach((c, i) => {
      const y = LAND_H + this.meshes[i].position.y + 0.004;
      for (const r of c.rings) for (let k = 0; k < r.length; k += 2) { const j = (k + 2) % r.length; cpts.push(r[k], y, r[k + 1], r[j], y, r[j + 1]); }
      if (c.provs.length > 1) for (const pi of c.provs) for (const r of this.world.provinces[pi].rings) for (let k = 0; k < r.length; k += 2) { const j = (k + 2) % r.length; ppts.push(r[k], y - 0.001, r[k + 1], r[j], y - 0.001, r[j + 1]); }
    });
    const mk = (pts, color, opacity) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity })); };
    this.provBorders = mk(ppts, 0x2a2f36, 0.35);
    this.borders = mk(cpts, 0x14171b, 0.85);
    this.group.add(this.provBorders, this.borders);
  }

  outline(idx, color = 0xffffff) {
    if (this.highlight) { this.group.remove(this.highlight); this.highlight.geometry.dispose(); this.highlight = null; }
    if (idx == null) return;
    const p = this.world.provinces[idx]; const y = this.heightOf(idx) + 0.02;
    const pts = [];
    for (const r of p.rings) for (let k = 0; k < r.length; k += 2) { const j = (k + 2) % r.length; pts.push(r[k], y, r[k + 1], r[j], y, r[j + 1]); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.highlight = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 }));
    this.group.add(this.highlight);
  }

  // ---------- 점령 진행 (나라 메시마다 동시에 4곳까지) ----------
  slot(pi, create) {
    const ud = this.meshOf(pi).material.userData, local = this.provLocal[pi];
    let s = ud.slots.indexOf(local);
    if (s < 0 && create) { s = ud.slots.indexOf(null); if (s < 0) s = 0; ud.slots[s] = local; }
    return [ud, s];
  }
  setOcc(pi, pts, color) {
    const [ud, s] = this.slot(pi, true), u = ud.u;
    const step = Math.max(1, Math.ceil(pts.length / 12));
    let n = 0; for (let i = 0; i < pts.length && n < 12; i += step) u.uOccPts.value[s * 12 + n++].set(pts[i].x, pts[i].z);
    u.uOccN.value[s] = n; u.uOccProv.value[s] = this.provLocal[pi]; u.uOccCol.value[s].set(color); u.uOccAdv.value[s] = 0;
    ud.fade = ud.fade || [false, false, false, false]; ud.fade[s] = false;
  }
  hasOcc(pi) { const [, s] = this.slot(pi, false); return s >= 0; }
  setOccAdv(pi, adv) { const [ud, s] = this.slot(pi, false); if (s >= 0) ud.u.uOccAdv.value[s] = adv; }
  clearOcc(pi) {
    const [ud, s] = this.slot(pi, false); if (s < 0) return;
    ud.u.uOccN.value[s] = 0; ud.u.uOccProv.value[s] = -1; ud.u.uOccAdv.value[s] = 0; ud.slots[s] = null; if (ud.fade) ud.fade[s] = false;
  }
  fadeOcc(pi) { const [ud, s] = this.slot(pi, false); if (s >= 0) { ud.fade = ud.fade || [false, false, false, false]; ud.fade[s] = true; } } // 격퇴되면 서서히 되돌림

  setColor(pi, color, tween = false) {
    const ud = this.meshOf(pi).material.userData, local = this.provLocal[pi];
    const target = new THREE.Color(color);
    if (!tween) { ud.u.uProvCol.value[local].copy(target); ud.tweens.delete(local); return; }
    ud.tweens.set(local, { from: ud.u.uProvCol.value[local].clone(), to: target, t: 0 });
  }

  update(dt) {
    this.time.value += dt;
    for (const m of this.meshes) {
      const ud = m.material.userData;
      if (ud.fade) for (let s = 0; s < 4; s++) if (ud.fade[s]) { ud.u.uOccAdv.value[s] -= dt * 3; if (ud.u.uOccAdv.value[s] <= 0) { const local = ud.slots[s]; this.clearOcc(this.world.countries[m.userData.country].provs[local]); } }
      for (const [local, tw] of ud.tweens) {
        tw.t = Math.min(1, tw.t + dt / 1.2);
        const f = tw.t < 1 ? (Math.sin(tw.t * 30) > 0 ? 1 : 0.4) * tw.t : 1; // 깜빡이며 전환
        ud.u.uProvCol.value[local].copy(tw.from).lerp(tw.to, tw.t).multiplyScalar(0.7 + 0.3 * f + (tw.t < 1 ? 0.3 : 0));
        if (tw.t >= 1) { ud.u.uProvCol.value[local].copy(tw.to); ud.tweens.delete(local); }
      }
    }
  }

  buildSeaLabels() {
    const seas = [['동해', 134, 40], ['서해', 123.5, 36], ['태평양', -170, 15], ['태평양', 160, 25], ['대서양', -35, 25], ['인도양', 78, -15],
      ['남중국해', 114, 14], ['동중국해', 126, 29], ['오호츠크해', 150, 54], ['필리핀해', 132, 20], ['지중해', 18, 35], ['북극해', 30, 78], ['남대서양', -15, -30]];
    for (const [name, lon, lat] of seas) {
      const d = document.createElement('div'); d.className = 'sea-label'; d.textContent = name;
      const o = new CSS2DObject(d); const [x, y] = project(lon, lat); o.position.set(x, 0.1, y);
      this.group.add(o);
    }
  }
}
