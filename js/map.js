// 평면 세계지도: 바다 셰이더, 국가별 얇은 입체 영토, 국경선, 경위선, 바다 이름
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

export const LAND_H = 0.12;
const W = 400;
export function project(lon, lat) {
  let l = lon - 150; while (l < -180) l += 360; while (l > 180) l -= 360;
  const x = (l / 360) * W;
  const y = -(W / (2 * Math.PI)) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  return [x, y];
}

// 미리 계산한 반복 가능한 잡음 질감 (픽셀마다 잡음 함수를 계산하던 것을 조회 한 번으로)
function makeNoiseTex(n = 256) {
  const hash = (x, y) => { const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); };
  const vn = (x, y, per) => { const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const h = (a, b) => hash(((a % per) + per) % per, ((b % per) + per) % per);
    return (h(xi, yi) * (1 - u) + h(xi + 1, yi) * u) * (1 - v) + (h(xi, yi + 1) * (1 - u) + h(xi + 1, yi + 1) * u) * v; };
  const d = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let f = 0, a = 0.5, fr = 8 / n, per = 8;
    for (let o = 0; o < 4; o++) { f += a * vn(x * fr, y * fr, per); fr *= 2; per *= 2; a *= 0.5; }
    const g = vn(x * 32 / n, y * 32 / n, 32);
    const i = (y * n + x) * 4; d[i] = Math.min(255, (f / 0.94) * 255); d[i + 1] = g * 255; d[i + 2] = 0; d[i + 3] = 255;
  }
  const t = new THREE.DataTexture(d, n, n); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}
export const noiseTex = { value: makeNoiseTex() };
const noiseChunk = `
uniform sampler2D uNoise;
float fbmT(vec2 p){ return texture2D(uNoise, p / 8.0).r; }   // 4옥타브 잡음 (주기 8)
float vnT(vec2 p){ return texture2D(uNoise, p / 32.0).g; }   // 1옥타브 잡음
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<4;i++){ v+=a*vnoise(p); p*=2.03; a*=0.5; } return v; }
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
      uniforms: { uTime: this.time, uNoise: noiseTex },
      vertexShader: 'varying vec2 vP; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vP = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: noiseChunk + `
        uniform float uTime; varying vec2 vP;
        void main(){
          vec2 p = vP * 0.35;
          float n = fbmT(p + vec2(uTime*0.05, uTime*0.03));
          float n2 = vnT(p*2.7 - vec2(uTime*0.08, -uTime*0.04));
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

  // 세계의 모든 지방을 메시 하나로 (그리기 호출 1번). 지방 색은 색상표 이미지(지방 번호 → 색)에서 읽음.
  buildLand() {
    const P = this.world.provinces, N = P.length;
    this.TW = 128; this.TH = Math.ceil(N / this.TW);
    this.colData = new Uint8Array(this.TW * this.TH * 4).fill(136);
    this.colTex = new THREE.DataTexture(this.colData, this.TW, this.TH);
    this.colTex.colorSpace = THREE.SRGBColorSpace; this.colTex.needsUpdate = true;
    this.cur = Array.from({ length: N }, () => new THREE.Color(0x888888)); // 현재 표시 색 (깜빡임 전환용)
    this.tweens = new Map();
    const ek = (a, b, c2, d) => { const k1 = a + ',' + b, k2 = c2 + ',' + d; return k1 < k2 ? k1 + '|' + k2 : k2 + '|' + k1; };
    // 변 공유 수: 1이면 해안(옆면·진한 선), 2 이상이면 이웃 지방과의 경계
    this.edgeOwners = new Map();
    P.forEach((p, i) => { for (const r of p.rings) for (let k = 0; k < r.length; k += 2) { const j = (k + 2) % r.length; const e = ek(r[k], r[k + 1], r[j], r[j + 1]); const o = this.edgeOwners.get(e); if (o) o.push(i); else this.edgeOwners.set(e, [i]); } });
    const pos = [], nor = [], prov = [];
    P.forEach((p, i) => {
      // 윗면: 조각(바깥 고리 + 구멍)마다 삼각분할
      let ri = 0;
      for (const cnt of p.polys || p.rings.map(() => 1)) {
        const rs = p.rings.slice(ri, ri + cnt); ri += cnt;
        const toV = (r) => { const v = []; for (let k = 0; k < r.length; k += 2) v.push(new THREE.Vector2(r[k], r[k + 1])); return v; };
        const outer = toV(rs[0]), holes = rs.slice(1).map(toV);
        const all = outer.concat(...holes);
        for (const t of THREE.ShapeUtils.triangulateShape(outer, holes)) {
          const A = all[t[0]], B = all[t[1]], Cc = all[t[2]];
          const cross = (B.x - A.x) * (Cc.y - A.y) - (B.y - A.y) * (Cc.x - A.x);
          for (const q of (cross > 0 ? [t[0], t[2], t[1]] : t)) { pos.push(all[q].x, LAND_H, all[q].y); nor.push(0, 1, 0); prov.push(i); }
        }
      }
      // 옆면: 해안(공유되지 않은 변)만
      for (const r of p.rings) for (let k = 0; k < r.length; k += 2) {
        const j = (k + 2) % r.length;
        if (this.edgeOwners.get(ek(r[k], r[k + 1], r[j], r[j + 1])).length !== 1) continue;
        const x1 = r[k], z1 = r[k + 1], x2 = r[j], z2 = r[j + 1];
        let nx = z2 - z1, nz = -(x2 - x1); const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
        for (const [x, y, z] of [[x1, 0, z1], [x2, 0, z2], [x2, LAND_H, z2], [x1, 0, z1], [x2, LAND_H, z2], [x1, LAND_H, z1]]) { pos.push(x, y, z); nor.push(nx, 0, nz); prov.push(i); }
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('prov', new THREE.Float32BufferAttribute(prov, 1));
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0.0, side: THREE.DoubleSide });
    const S = 8; // 동시에 표시하는 점령 진행 수
    const u = this.occU = {
      uProvTex: { value: this.colTex },
      uOccProv: { value: new Int32Array(S).fill(-1) }, uOccN: { value: new Int32Array(S) },
      uOccPts: { value: Array.from({ length: S * 12 }, () => new THREE.Vector2()) },
      uOccAdv: { value: new Float32Array(S) }, uOccCol: { value: Array.from({ length: S }, () => new THREE.Color()) },
      uTimeL: this.time, uNoise: noiseTex,
    };
    this.slots = new Array(S).fill(null); this.fade = new Array(S).fill(false);
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float prov;\nvarying vec3 vW;\nflat varying int vProv;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvW = (modelMatrix * vec4(transformed,1.0)).xyz;\nvProv = int(prov + 0.5);');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
          varying vec3 vW; flat varying int vProv;
          uniform sampler2D uProvTex;
          uniform int uOccProv[${S}]; uniform int uOccN[${S}]; uniform vec2 uOccPts[${S * 12}]; uniform float uOccAdv[${S}]; uniform vec3 uOccCol[${S}]; uniform float uTimeL;
          ` + noiseChunk)
        .replace('#include <color_fragment>', `#include <color_fragment>
          diffuseColor.rgb *= texelFetch(uProvTex, ivec2(vProv % ${this.TW}, vProv / ${this.TW}), 0).rgb;
          float t = fbmT(vW.xz * 0.9);
          float t2 = vnT(vW.xz * 4.0);
          diffuseColor.rgb *= 0.78 + 0.34 * t + 0.1 * (t2 - 0.5);
          for (int s = 0; s < ${S}; s++) {
            if (uOccProv[s] != vProv || uOccN[s] == 0) continue;
            float md = 1e9;
            for (int i = 0; i < 12; i++) { if (i >= uOccN[s]) break; md = min(md, distance(vW.xz, uOccPts[s * 12 + i])); }
            float adv = uOccAdv[s];
            float edge = adv - md + (vnT(vW.xz * 1.3) - 0.5) * 0.9 * min(1.0, adv);
            if (edge > 0.0) {
              float stripe = step(0.55, fract((vW.x - vW.z) * 2.2));
              diffuseColor.rgb = mix(diffuseColor.rgb, uOccCol[s] * (0.78 + 0.34 * t) * (1.0 - 0.18 * stripe), 0.9);
            }
            float glow = smoothstep(0.32, 0.0, abs(edge)) * step(0.02, adv);
            diffuseColor.rgb += vec3(1.0, 0.42, 0.1) * glow * (0.55 + 0.45 * sin(uTimeL * 9.0 + md * 5.0));
          }
          if (vW.y < ${(LAND_H - 0.01).toFixed(3)}) diffuseColor.rgb *= 0.55;`);
    };
    mat.customProgramCacheKey = () => 'land-world';
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    this.group.add(m);
    this.meshes = [m];
    this.land = m;
    this.buildPickGrid();
  }

  // 클릭 위치 → 지방: 삼각형 15만 개를 광선 판정하는 대신 격자 색인 + 다각형 포함 판정 (폰에서 빠름)
  buildPickGrid() {
    const P = this.world.provinces, cell = 2;
    this.grid = new Map(); this.cell = cell;
    this.bbox = P.map((p) => { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const r of p.rings) for (let k = 0; k < r.length; k += 2) { a = Math.min(a, r[k]); c = Math.max(c, r[k]); b = Math.min(b, r[k + 1]); d = Math.max(d, r[k + 1]); } return [a, b, c, d]; });
    this.bbox.forEach(([a, b, c, d], i) => { for (let gx = Math.floor(a / cell); gx <= Math.floor(c / cell); gx++) for (let gz = Math.floor(b / cell); gz <= Math.floor(d / cell); gz++) { const k = gx + ',' + gz; const l = this.grid.get(k); if (l) l.push(i); else this.grid.set(k, [i]); } });
  }
  pickAt(x, z) {
    const list = this.grid.get(Math.floor(x / this.cell) + ',' + Math.floor(z / this.cell)); if (!list) return null;
    for (const i of list) {
      const [a, b, c, d] = this.bbox[i]; if (x < a || x > c || z < b || z > d) continue;
      let inn = false;
      for (const r of this.world.provinces[i].rings) for (let k = 0, j = r.length - 2; k < r.length; j = k, k += 2) if ((r[k + 1] > z) !== (r[j + 1] > z) && x < ((r[j] - r[k]) * (z - r[k + 1])) / (r[j + 1] - r[k + 1]) + r[k]) inn = !inn;
      if (inn) return i;
    }
    return null;
  }
  provAt(hit) { return Math.round(hit.object.geometry.attributes.prov.getX(hit.face.a)); }
  heightOf() { return LAND_H; }

  buildBorders() {
    // 나라 경계·해안(진하게) + 같은 나라 안 지방 경계(옅게) — 모두 지방 테두리에서 계산하므로 서로 딱 맞음
    const P = this.world.provinces, cpts = [], ppts = [], y = LAND_H + 0.004;
    for (const [e, owners] of this.edgeOwners) {
      const [a, b] = e.split('|'); const [x1, z1] = a.split(',').map(Number), [x2, z2] = b.split(',').map(Number);
      const country = owners.length === 1 || P[owners[0]].c !== P[owners[1]].c;
      (country ? cpts : ppts).push(x1, country ? y : y - 0.001, z1, x2, country ? y : y - 0.001, z2);
    }
    const mk = (pts, color, opacity) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity })); };
    this.provBorders = mk(ppts, 0xf4ead0, 0.7);
    this.borders = mk(cpts, 0x0b0d10, 1);
    this.group.add(this.provBorders, this.borders);
  }

  outline(idx, color = 0xffffff) {
    if (this.highlight) { this.group.remove(this.highlight); this.highlight.geometry.dispose(); this.highlight.material.dispose(); this.highlight = null; }
    if (idx == null) return;
    const p = this.world.provinces[idx]; const y = LAND_H + 0.02;
    const pts = [];
    for (const r of p.rings) for (let k = 0; k < r.length; k += 2) { const j = (k + 2) % r.length; pts.push(r[k], y, r[k + 1], r[j], y, r[j + 1]); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.highlight = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 }));
    this.group.add(this.highlight);
  }

  // ---------- 점령 진행 (세계 전체 동시에 8곳까지) ----------
  slot(pi, create) {
    let s = this.slots.indexOf(pi);
    if (s < 0 && create) { s = this.slots.indexOf(null); if (s < 0) s = this.fade.indexOf(true); if (s < 0) s = 0; this.slots[s] = pi; }
    return s;
  }
  setOcc(pi, pts, color) {
    const s = this.slot(pi, true), u = this.occU;
    const step = Math.max(1, Math.ceil(pts.length / 12));
    let n = 0; for (let i = 0; i < pts.length && n < 12; i += step) u.uOccPts.value[s * 12 + n++].set(pts[i].x, pts[i].z);
    u.uOccN.value[s] = n; u.uOccProv.value[s] = pi; u.uOccCol.value[s].set(color); u.uOccAdv.value[s] = 0; this.fade[s] = false;
  }
  hasOcc(pi) { return this.slot(pi, false) >= 0; }
  setOccAdv(pi, adv) { const s = this.slot(pi, false); if (s >= 0) this.occU.uOccAdv.value[s] = adv; }
  clearOcc(pi) { const s = this.slot(pi, false); if (s < 0) return; const u = this.occU; u.uOccN.value[s] = 0; u.uOccProv.value[s] = -1; u.uOccAdv.value[s] = 0; this.slots[s] = null; this.fade[s] = false; }
  fadeOcc(pi) { const s = this.slot(pi, false); if (s >= 0) this.fade[s] = true; } // 격퇴되면 서서히 되돌림

  writeCol(i, c) {
    // 지방마다 명도를 조금씩 달리해 같은 나라 안에서도 행정구역이 구분되게
    const o = i * 4, h = c.getHex(THREE.SRGBColorSpace), f = 0.86 + ((i * 2654435761) >>> 0) % 1000 / 1000 * 0.2;
    this.colData[o] = Math.min(255, ((h >> 16) & 255) * f); this.colData[o + 1] = Math.min(255, ((h >> 8) & 255) * f); this.colData[o + 2] = Math.min(255, (h & 255) * f);
    this.colDirty = true;
  }
  setColor(pi, color, tween = false) {
    const target = new THREE.Color(color);
    if (!tween) { this.cur[pi].copy(target); this.tweens.delete(pi); this.writeCol(pi, target); return; }
    this.tweens.set(pi, { from: this.cur[pi].clone(), to: target, t: 0 });
  }

  update(dt) {
    this.time.value += dt;
    for (let s = 0; s < this.fade.length; s++) if (this.fade[s]) { this.occU.uOccAdv.value[s] -= dt * 3; if (this.occU.uOccAdv.value[s] <= 0) this.clearOcc(this.slots[s]); }
    for (const [pi, tw] of this.tweens) {
      tw.t = Math.min(1, tw.t + dt / 1.2);
      const f = tw.t < 1 ? (Math.sin(tw.t * 30) > 0 ? 1 : 0.4) * tw.t : 1; // 깜빡이며 전환
      const c = this.cur[pi].copy(tw.from).lerp(tw.to, tw.t).multiplyScalar(0.7 + 0.3 * f + (tw.t < 1 ? 0.3 : 0));
      if (tw.t >= 1) { c.copy(tw.to); this.tweens.delete(pi); }
      this.writeCol(pi, c);
    }
    if (this.colDirty) { this.colDirty = false; this.colTex.needsUpdate = true; } // 색상표는 바뀐 프레임에만 GPU로 (20KB)
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
