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

  buildLand() {
    const areaRank = [...this.world.countries.keys()].sort((a, b) => this.world.countries[b].area - this.world.countries[a].area);
    const rankOf = new Map(areaRank.map((i, r) => [i, r]));
    this.world.countries.forEach((c, i) => {
      const shapes = c.rings.map((r) => {
        const v = []; for (let k = 0; k < r.length; k += 2) v.push(new THREE.Vector2(r[k], -r[k + 1]));
        return new THREE.Shape(v);
      });
      const g = new THREE.ExtrudeGeometry(shapes, { depth: LAND_H, bevelEnabled: false, curveSegments: 1 });
      g.rotateX(-Math.PI / 2); // (x, -y) 평면 → XZ 평면, 두께는 +Y
      const mat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.92, metalness: 0.0 });
      // 전투 중 점령 진행 표시용 (전선 점들로부터 adv 거리 안쪽을 공격국 색으로)
      mat.userData.u = { uOccN: { value: 0 }, uOccPts: { value: Array.from({ length: 24 }, () => new THREE.Vector2()) }, uOccAdv: { value: 0 }, uOccCol: { value: new THREE.Color() }, uTimeL: this.time };
      mat.onBeforeCompile = (s) => {
        Object.assign(s.uniforms, mat.userData.u);
        s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vW;')
          .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvW = (modelMatrix * vec4(transformed,1.0)).xyz;');
        s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vW;\nuniform int uOccN; uniform vec2 uOccPts[24]; uniform float uOccAdv; uniform vec3 uOccCol; uniform float uTimeL;\n' + noiseChunk)
          .replace('#include <color_fragment>', `#include <color_fragment>
            float t = fbm(vW.xz * 0.9);
            float t2 = fbm(vW.xz * 4.0);
            diffuseColor.rgb *= 0.78 + 0.34 * t + 0.1 * (t2 - 0.5);
            if (uOccN > 0) {
              float md = 1e9;
              for (int i = 0; i < 24; i++) { if (i >= uOccN) break; md = min(md, distance(vW.xz, uOccPts[i])); }
              // 경계를 불규칙하게 (작전 지역처럼)
              float edge = uOccAdv - md + (fbm(vW.xz * 1.3) - 0.5) * 0.9 * min(1.0, uOccAdv);
              if (edge > 0.0) {
                float stripe = step(0.55, fract((vW.x - vW.z) * 2.2));
                vec3 oc = uOccCol * (0.78 + 0.34 * t) * (1.0 - 0.18 * stripe);
                diffuseColor.rgb = mix(diffuseColor.rgb, oc, 0.9);
              }
              float glow = smoothstep(0.32, 0.0, abs(edge)) * step(0.02, uOccAdv);
              diffuseColor.rgb += vec3(1.0, 0.42, 0.1) * glow * (0.55 + 0.45 * sin(uTimeL * 9.0 + md * 5.0));
            }
            if (vW.y < ${(LAND_H - 0.01).toFixed(3)}) diffuseColor.rgb *= 0.55;`);
      };
      mat.customProgramCacheKey = () => 'land';
      const m = new THREE.Mesh(g, mat);
      m.position.y = (rankOf.get(i) / this.world.countries.length) * 0.03; // 작은 나라(엔클레이브)가 위로
      m.receiveShadow = true;
      m.userData.idx = i;
      this.group.add(m);
      this.meshes.push(m);
    });
  }

  buildBorders() {
    const pts = [];
    this.world.countries.forEach((c, i) => {
      const y = LAND_H + this.meshes[i].position.y + 0.004;
      for (const r of c.rings) for (let k = 0; k < r.length; k += 2) {
        const j = (k + 2) % r.length;
        pts.push(r[k], y, r[k + 1], r[j], y, r[j + 1]);
      }
    });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.borders = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x1b1f24, transparent: true, opacity: 0.75 }));
    this.group.add(this.borders);
  }

  outline(idx, color = 0xffffff) {
    if (this.highlight) { this.group.remove(this.highlight); this.highlight.geometry.dispose(); this.highlight = null; }
    if (idx == null) return;
    const c = this.world.countries[idx]; const y = LAND_H + this.meshes[idx].position.y + 0.02;
    const pts = [];
    for (const r of c.rings) for (let k = 0; k < r.length; k += 2) { const j = (k + 2) % r.length; pts.push(r[k], y, r[k + 1], r[j], y, r[j + 1]); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.highlight = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 }));
    this.group.add(this.highlight);
  }

  // ---------- 점령 진행 ----------
  setOcc(idx, pts, color) {
    const u = this.meshes[idx].material.userData.u;
    const step = Math.max(1, Math.ceil(pts.length / 24));
    let n = 0; for (let i = 0; i < pts.length && n < 24; i += step) u.uOccPts.value[n++].set(pts[i].x, pts[i].z);
    u.uOccN.value = n; u.uOccCol.value.set(color); u.uOccAdv.value = 0;
    this.meshes[idx].material.userData.fade = false;
  }
  hasOcc(idx) { return this.meshes[idx].material.userData.u.uOccN.value > 0; }
  setOccAdv(idx, adv) { this.meshes[idx].material.userData.u.uOccAdv.value = adv; }
  clearOcc(idx) { const u = this.meshes[idx].material.userData.u; u.uOccN.value = 0; u.uOccAdv.value = 0; this.meshes[idx].material.userData.fade = false; }
  fadeOcc(idx) { if (this.meshes[idx].material.userData.u.uOccN.value > 0) this.meshes[idx].material.userData.fade = true; } // 격퇴되면 서서히 되돌림

  setColor(idx, color, tween = false) {
    const mat = this.meshes[idx].material;
    const target = new THREE.Color(color);
    if (!tween) { mat.color.copy(target); return; }
    mat.userData.tween = { from: mat.color.clone(), to: target, t: 0 };
  }

  update(dt) {
    this.time.value += dt;
    for (const m of this.meshes) {
      const ud = m.material.userData;
      if (ud.fade) { ud.u.uOccAdv.value -= dt * 3; if (ud.u.uOccAdv.value <= 0) this.clearOcc(m.userData.idx); }
      const tw = m.material.userData.tween;
      if (!tw) continue;
      tw.t = Math.min(1, tw.t + dt / 1.2);
      const f = tw.t < 1 ? (Math.sin(tw.t * 30) > 0 ? 1 : 0.4) * tw.t : 1; // 깜빡이며 전환
      m.material.color.copy(tw.from).lerp(tw.to, tw.t).multiplyScalar(0.7 + 0.3 * f + (tw.t < 1 ? 0.3 : 0));
      if (tw.t >= 1) { m.material.color.copy(tw.to); m.material.userData.tween = null; }
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
