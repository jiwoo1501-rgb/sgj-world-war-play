// 절차적으로 만든 저폴리 3D 유닛: 보병, 전차, 전투기, 군함, 미사일, 수도 도시
// 부품마다 색을 입혀 하나의 지오메트리로 합쳐(드로우콜 1개) 국가별로 캐시한다.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const C = {
  olive: 0x5d6b3a, olive2: 0x4a5530, steel: 0x6f7780, dark: 0x2a2d31, black: 0x151515,
  skin: 0xd7a57a, glass: 0x9fd8ff, hull: 0x7c858f, deck: 0x9aa3ab, white: 0xeeeeee, red: 0xd33, flame: 0xffb030,
  concrete: 0xb8b2a6, window: 0xffe9a8, gold: 0xe0b040,
};

function part(geo, color, m) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (m) g.applyMatrix4(m);
  const col = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
  return g;
}
const M = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, s = 10) => new THREE.CylinderGeometry(rt, rb, h, s);
const sph = (r, ws = 10, hs = 8, ...a) => new THREE.SphereGeometry(r, ws, hs, ...a);

function extrudeXZ(points, depth) { // 옆에서 본 윤곽(x,y)을 z 방향 두께로
  const s = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
  g.translate(0, 0, -depth / 2);
  return g;
}

// 모든 모델은 +X 방향이 앞, 바닥이 y=0, 길이 약 1
const builders = {
  inf(nc) {
    const g = [];
    const uni = new THREE.Color(C.olive).lerp(new THREE.Color(nc), 0.25);
    g.push(part(box(0.09, 0.28, 0.08), C.olive2, M(0, 0.14, -0.06)));   // 다리
    g.push(part(box(0.09, 0.28, 0.08), C.olive2, M(0, 0.14, 0.06)));
    g.push(part(box(0.11, 0.05, 0.1), C.black, M(0.02, 0.025, -0.06)));  // 군화
    g.push(part(box(0.11, 0.05, 0.1), C.black, M(0.02, 0.025, 0.06)));
    g.push(part(box(0.16, 0.3, 0.24), uni, M(0, 0.43, 0)));             // 상체
    g.push(part(box(0.12, 0.22, 0.2), C.olive2, M(-0.13, 0.45, 0)));    // 배낭
    g.push(part(box(0.06, 0.24, 0.06), uni, M(0.05, 0.42, -0.15, 0, 0, -0.6))); // 팔
    g.push(part(box(0.06, 0.24, 0.06), uni, M(0.05, 0.42, 0.15, 0, 0, -0.6)));
    g.push(part(sph(0.075), C.skin, M(0.01, 0.66, 0)));                  // 얼굴
    g.push(part(sph(0.1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), C.olive, M(0, 0.68, 0))); // 헬멧
    g.push(part(box(0.44, 0.04, 0.04), C.dark, M(0.16, 0.5, 0.05, 0, 0, 0.12)));     // 소총
    g.push(part(box(0.08, 0.08, 0.04), C.dark, M(0.02, 0.46, 0.05)));
    g.push(part(box(0.12, 0.08, 0.005), nc, M(0, 0.5, 0.122)));          // 국기 패치
    return mergeGeometries(g).scale(1.3, 1.3, 1.3);
  },
  tank(nc) {
    const g = [];
    const body = new THREE.Color(C.olive).lerp(new THREE.Color(nc), 0.35);
    // 궤도와 바퀴
    for (const z of [-0.26, 0.26]) {
      g.push(part(extrudeXZ([[-0.55, 0.02], [0.55, 0.02], [0.66, 0.16], [0.6, 0.24], [-0.6, 0.24], [-0.66, 0.14]], 0.16), C.dark, M(0, 0, z)));
      for (let i = 0; i < 6; i++) g.push(part(cyl(0.075, 0.075, 0.17, 12), C.black, M(-0.45 + i * 0.18, 0.1, z, Math.PI / 2)));
      g.push(part(box(1.2, 0.03, 0.2), body, M(0, 0.26, z)));             // 펜더
    }
    // 차체(경사 장갑)
    g.push(part(extrudeXZ([[-0.6, 0.18], [0.45, 0.18], [0.66, 0.3], [0.5, 0.4], [-0.62, 0.4]], 0.52), body));
    // 포탑
    g.push(part(extrudeXZ([[-0.28, 0], [0.22, 0], [0.34, 0.08], [0.22, 0.18], [-0.3, 0.18]], 0.44), body, M(-0.05, 0.4, 0)));
    g.push(part(cyl(0.035, 0.045, 0.85, 10), C.steel, M(0.68, 0.5, 0, 0, 0, Math.PI / 2)));  // 포신
    g.push(part(cyl(0.055, 0.055, 0.12, 10), C.dark, M(1.07, 0.5, 0, 0, 0, Math.PI / 2)));  // 포구 제퇴기
    g.push(part(cyl(0.07, 0.07, 0.05, 10), C.dark, M(-0.12, 0.6, 0.1)));                  // 해치
    g.push(part(box(0.02, 0.02, 0.3), C.dark, M(-0.2, 0.62, -0.1, 0.3)));                  // 안테나 받침
    g.push(part(cyl(0.006, 0.006, 0.5, 4), C.black, M(-0.3, 0.83, -0.16)));                // 안테나
    g.push(part(box(0.18, 0.1, 0.005), nc, M(-0.05, 0.49, 0.225)));                        // 국기 표식
    g.push(part(box(0.18, 0.1, 0.005), nc, M(-0.05, 0.49, -0.225)));
    return mergeGeometries(g);
  },
  jet(nc) {
    const g = [];
    const skin = new THREE.Color(0x8a939c).lerp(new THREE.Color(nc), 0.15);
    g.push(part(cyl(0.07, 0.09, 0.9, 12), skin, M(0, 0, 0, 0, 0, Math.PI / 2)));           // 동체
    g.push(part(new THREE.ConeGeometry(0.07, 0.35, 12), skin, M(0.62, 0, 0, 0, 0, -Math.PI / 2))); // 기수
    g.push(part(sph(0.07, 12, 8), C.glass, M(0.3, 0.07, 0, 0, 0, 0, 2.2, 0.8, 0.8)));        // 캐노피
    const wing = extrudeXZ([[0.15, 0], [-0.3, 0.55], [-0.42, 0.55], [-0.3, 0]], 0.02);
    g.push(part(wing.clone(), skin, M(0, 0, 0.05, Math.PI / 2)));                          // 주익
    g.push(part(wing.clone(), skin, M(0, 0, -0.05, -Math.PI / 2)));
    const tail = extrudeXZ([[0, 0], [-0.2, 0.28], [-0.28, 0.28], [-0.2, 0]], 0.015);
    g.push(part(tail.clone(), skin, M(-0.25, 0.05, 0.06, 0.3)));                           // 수직 꼬리날개 2개
    g.push(part(tail.clone(), skin, M(-0.25, 0.05, -0.06, -0.3)));
    const hs = extrudeXZ([[0, 0], [-0.1, 0.2], [-0.16, 0.2], [-0.12, 0]], 0.015);
    g.push(part(hs.clone(), skin, M(-0.33, 0, 0.06, Math.PI / 2)));
    g.push(part(hs.clone(), skin, M(-0.33, 0, -0.06, -Math.PI / 2)));
    g.push(part(cyl(0.075, 0.06, 0.08, 12), C.dark, M(-0.49, 0, 0, 0, 0, Math.PI / 2)));   // 노즐
    g.push(part(box(0.12, 0.005, 0.1), nc, M(-0.25, 0.015, 0.4)));                         // 날개 표식
    g.push(part(box(0.12, 0.005, 0.1), nc, M(-0.25, 0.015, -0.4)));
    g.push(part(cyl(0.02, 0.02, 0.3, 6), C.white, M(-0.05, -0.05, 0.25, 0, 0, Math.PI / 2))); // 무장
    g.push(part(cyl(0.02, 0.02, 0.3, 6), C.white, M(-0.05, -0.05, -0.25, 0, 0, Math.PI / 2)));
    return mergeGeometries(g).scale(1.6, 1.6, 1.6);
  },
  ship(nc) {
    const g = [];
    // 선체: 위에서 본 윤곽을 세로로 뽑기
    const hs = new THREE.Shape([[-1, -0.18], [0.7, -0.18], [1.15, 0], [0.7, 0.18], [-1, 0.18]].map(([x, y]) => new THREE.Vector2(x, y)));
    const hull = new THREE.ExtrudeGeometry(hs, { depth: 0.22, bevelEnabled: false }); hull.rotateX(Math.PI / 2); hull.translate(0, 0.22, 0);
    g.push(part(hull, C.hull));
    g.push(part(box(2.1, 0.02, 0.34), C.deck, M(0.05, 0.225, 0)));
    g.push(part(box(0.2, 0.2, 0.32), C.red, M(-0.98, 0.08, 0)));                            // 흘수선 느낌
    g.push(part(box(0.5, 0.22, 0.26), C.hull, M(-0.15, 0.34, 0)));                         // 상부 구조물
    g.push(part(box(0.28, 0.18, 0.2), C.hull, M(-0.12, 0.54, 0)));                         // 함교
    g.push(part(box(0.29, 0.04, 0.21), C.glass, M(-0.02, 0.58, 0)));
    g.push(part(cyl(0.012, 0.012, 0.45, 5), C.dark, M(-0.15, 0.86, 0)));                   // 마스트
    g.push(part(box(0.16, 0.06, 0.02), C.dark, M(-0.15, 0.95, 0)));                        // 레이더
    g.push(part(cyl(0.06, 0.07, 0.2, 10), C.dark, M(-0.45, 0.4, 0)));                      // 연돌
    for (const [x, r] of [[0.55, 0], [0.3, 0], [-0.7, Math.PI]]) {                          // 포탑
      g.push(part(cyl(0.08, 0.09, 0.08, 10), C.hull, M(x, 0.27, 0)));
      g.push(part(cyl(0.012, 0.012, 0.28, 6), C.dark, M(x + (r ? -0.14 : 0.14), 0.29, 0, 0, 0, Math.PI / 2)));
    }
    g.push(part(box(0.18, 0.1, 0.005), nc, M(-0.15, 0.95, 0.03)));                         // 함기
    return mergeGeometries(g).scale(0.9, 0.9, 0.9);
  },
  missile(nc) {
    const g = [];
    g.push(part(cyl(0.05, 0.05, 0.8, 10), C.white, M(0, 0, 0, 0, 0, Math.PI / 2)));
    g.push(part(new THREE.ConeGeometry(0.05, 0.22, 10), nc, M(0.51, 0, 0, 0, 0, -Math.PI / 2)));
    for (let i = 0; i < 4; i++) g.push(part(box(0.14, 0.005, 0.16), C.dark, M(-0.33, 0, 0, i * Math.PI / 2)));
    g.push(part(box(0.1, 0.101, 0.101), nc, M(0.1, 0, 0)));
    return mergeGeometries(g).scale(0.9, 0.9, 0.9);
  },
  city(nc) {
    const g = [];
    const rnd = mulberry(7);
    for (let i = 0; i < 16; i++) {
      const a = rnd() * Math.PI * 2, r = 0.15 + rnd() * 0.55;
      const h = 0.15 + rnd() * rnd() * 0.9 * (1 - r * 0.8);
      const w = 0.1 + rnd() * 0.1;
      g.push(part(box(w, h, w), rnd() > 0.5 ? C.concrete : 0x8e99a6, M(Math.cos(a) * r, h / 2, Math.sin(a) * r)));
      g.push(part(box(w * 1.01, 0.02, w * 1.01), C.window, M(Math.cos(a) * r, h * 0.7, Math.sin(a) * r)));
    }
    g.push(part(cyl(0.012, 0.012, 1.1, 6), C.white, M(0, 0.55, 0)));                       // 깃대
    g.push(part(cyl(0.7, 0.75, 0.04, 24), 0x7a7466, M(0, 0.02, 0)));                        // 도시 바닥
    return mergeGeometries(g);
  },
};

function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const cache = new Map();
export const unitMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65, metalness: 0.25 });

export function geometry(type, nationColor) {
  const key = type + nationColor;
  if (!cache.has(key)) cache.set(key, builders[type](new THREE.Color(nationColor)));
  return cache.get(key);
}

export function makeUnit(type, nationColor) {
  const m = new THREE.Mesh(geometry(type, nationColor), unitMaterial);
  m.castShadow = true;
  return m;
}

// 펄럭이는 국기 (정점 셰이더)
const flagMats = new Map();
export const flagTime = { value: 0 };
export function makeFlag(color) {
  if (!flagMats.has(color)) {
    const mat = new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: 0.8 });
    mat.onBeforeCompile = (s) => {
      s.uniforms.uTime = flagTime;
      s.vertexShader = 'uniform float uTime;\n' + s.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\nfloat k = (position.x + 0.25);\ntransformed.z += sin(position.x * 12.0 - uTime * 6.0) * 0.04 * k;');
    };
    flagMats.set(color, mat);
  }
  const g = new THREE.PlaneGeometry(0.5, 0.3, 10, 1);
  g.translate(0.25, 0, 0);
  const m = new THREE.Mesh(g, flagMats.get(color));
  m.castShadow = true;
  return m;
}
