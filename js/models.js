// 절차적으로 만든 정밀 3D 유닛 (실제 장비 형태를 본뜸)
//  보병(방탄조끼·소총) · 전차(K2 흑표 풍) · 자주포(K9 풍) · 전투기(KF-21 풍) · 구축함(세종대왕급 풍) · 미사일 · 도시
// 부품마다 색/국가색 표시(tint)/위장무늬(camo) 속성을 붙여 하나의 지오메트리로 합친다.
//  - 개별 유닛: 국가색을 구워 넣은 지오메트리 (국가별 캐시)
//  - 국경 주둔군: 하나의 InstancedMesh로 수백 대를 한 번에 그림 (인스턴스 색 = 국가색)
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const C = {
  olive: 0x56613a, olive2: 0x434b2c, tan: 0x8d7f5c, steel: 0x6d747c, gun: 0x3a3f44, dark: 0x25282b, black: 0x141414, rubber: 0x1b1b1b,
  skin: 0xc99a74, glass: 0x7fb6d9, navy: 0x7a838c, navy2: 0x5d666f, deck: 0x4a4f55, red: 0x7a2a22, white: 0xe8e8e8, jet: 0x7f8a94, jet2: 0x6a747d,
  concrete: 0xb9b3a7, glassB: 0x3d5a73, window: 0xffe7a3, road: 0x55524c, green: 0x5d7a3e, gold: 0xd9b24a,
};
const TINT = 'tint', CAMO = 'camo';

function part(geo, color, m, flags = '') {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  if (m) g.applyMatrix4(m);
  const n = g.attributes.position.count, col = new THREE.Color(color);
  const ca = new Float32Array(n * 3), ta = new Float32Array(n), ma = new Float32Array(n);
  const t = flags.includes(TINT) ? 1 : 0, cm = flags.includes(CAMO) ? 1 : 0;
  for (let i = 0; i < n; i++) { ca[i * 3] = col.r; ca[i * 3 + 1] = col.g; ca[i * 3 + 2] = col.b; ta[i] = t; ma[i] = cm; }
  g.setAttribute('color', new THREE.BufferAttribute(ca, 3));
  g.setAttribute('tint', new THREE.BufferAttribute(ta, 1));
  g.setAttribute('camo', new THREE.BufferAttribute(ma, 1));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color', 'tint', 'camo'].includes(k)) g.deleteAttribute(k);
  g.clearGroups();
  return g;
}
const M = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, s = 12) => new THREE.CylinderGeometry(rt, rb, h, s);
const sph = (r, ws = 12, hs = 8, ...a) => new THREE.SphereGeometry(r, ws, hs, ...a);
const PI = Math.PI, H = PI / 2;

// 옆모습(x,y) 윤곽을 z 두께로 (bevel로 모서리를 살짝 깎음)
function side(points, depth, bevel = 0) {
  const s = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, curveSegments: 4 });
  g.translate(0, 0, -depth / 2);
  return g;
}
// 위에서 본 윤곽(x,z)을 y 높이로
function top(points, height, bevel = 0) {
  const s = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ExtrudeGeometry(s, { depth: height, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1 });
  g.rotateX(-H);
  return g;
}
// 회전체 (x축 방향), profile: [[x, r], ...]
function lathe(profile, seg = 16) {
  const g = new THREE.LatheGeometry(profile.map(([x, r]) => new THREE.Vector2(Math.max(0.0001, r), x)), seg);
  g.rotateZ(-H);
  return g;
}

// ---------------------------------------------------------------------------
const builders = {
  // 보병: 전투복·방탄조끼·헬멧·K2 소총 거치 자세 (키 약 0.95)
  inf(S) {
    const g = [];
    const uni = S.base, vest = S.dark;
    for (const z of [-0.055, 0.055]) {
      const step = z > 0 ? 0.05 : -0.03;
      g.push(part(box(0.075, 0.2, 0.08), uni, M(step, 0.34, z, 0, 0, z > 0 ? -0.18 : 0.12), CAMO));      // 허벅지
      g.push(part(box(0.065, 0.2, 0.07), uni, M(step * 1.6, 0.14, z), CAMO));                             // 정강이
      g.push(part(box(0.075, 0.05, 0.08), C.olive2, M(step * 1.3, 0.25, z + (z > 0 ? 0.006 : -0.006))));  // 무릎보호대
      g.push(part(box(0.12, 0.06, 0.08), C.black, M(step * 1.6 + 0.02, 0.03, z)));                        // 군화
    }
    g.push(part(box(0.13, 0.08, 0.2), uni, M(0, 0.46, 0), CAMO));                                         // 골반
    g.push(part(box(0.15, 0.24, 0.22), uni, M(0.005, 0.6, 0), CAMO));                                     // 상체
    g.push(part(box(0.17, 0.2, 0.23), vest, M(0.012, 0.61, 0)));                                          // 방탄조끼
    for (const z of [-0.06, 0, 0.06]) g.push(part(box(0.04, 0.06, 0.045), C.tan, M(0.1, 0.56, z)));       // 탄창 파우치
    g.push(part(box(0.1, 0.2, 0.18), S.dark, M(-0.13, 0.62, 0)));                                        // 배낭
    g.push(part(cyl(0.03, 0.03, 0.18, 8), S.base, M(-0.13, 0.75, 0, H)));                                // 침낭
    g.push(part(box(0.04, 0.05, 0.12), 0xffffff, M(-0.02, 0.66, 0.117), TINT));                           // 어깨 국기 패치
    g.push(part(box(0.1, 0.012, 0.17), 0xffffff, M(-0.13, 0.725, 0), TINT));                              // 배낭 위 식별 천
    g.push(part(cyl(0.079, 0.079, 0.02, 14), 0xffffff, M(0.0, 0.83, 0), TINT));                             // 헬멧 띠
    // 팔: 소총을 든 자세
    g.push(part(box(0.06, 0.16, 0.06), uni, M(0.02, 0.62, -0.13, 0.25, 0, -0.5), CAMO));
    g.push(part(box(0.055, 0.15, 0.055), uni, M(0.12, 0.57, -0.1, 0.5, 0, -1.3), CAMO));
    g.push(part(box(0.06, 0.16, 0.06), uni, M(0.02, 0.62, 0.13, -0.3, 0, -0.35), CAMO));
    g.push(part(box(0.055, 0.15, 0.055), uni, M(0.15, 0.59, 0.07, -0.6, 0, -1.4), CAMO));
    g.push(part(sph(0.028, 6, 5), C.black, M(0.2, 0.58, -0.05)));                                         // 장갑
    g.push(part(sph(0.028, 6, 5), C.black, M(0.25, 0.6, 0.04)));
    // 머리·헬멧
    g.push(part(cyl(0.035, 0.04, 0.05, 8), C.skin, M(0.01, 0.745, 0)));
    g.push(part(sph(0.058, 12, 10), C.skin, M(0.015, 0.8, 0)));
    g.push(part(sph(0.075, 14, 8, 0, PI * 2, 0, H * 1.08), S.base, M(0, 0.815, 0, 0, 0, 0.08, 1.05, 0.9, 1.0), CAMO));
    g.push(part(cyl(0.078, 0.08, 0.012, 14), S.base, M(0.003, 0.81, 0)));                                // 헬멧 테
    g.push(part(box(0.03, 0.03, 0.05), C.dark, M(0.075, 0.855, 0)));                                     // 야시경 마운트
    g.push(part(box(0.02, 0.018, 0.1), C.black, M(0.066, 0.8, 0)));                                      // 고글
    // K2 소총
    g.push(part(box(0.32, 0.035, 0.028), C.gun, M(0.2, 0.585, 0.02, 0, 0, 0.08)));                       // 총몸
    g.push(part(cyl(0.008, 0.008, 0.18, 6), C.gun, M(0.43, 0.605, 0.02, 0, 0, H - 0.08)));              // 총열
    g.push(part(box(0.1, 0.04, 0.035), C.dark, M(0.3, 0.595, 0.02, 0, 0, 0.08)));                        // 총열덮개
    g.push(part(box(0.03, 0.08, 0.022), C.gun, M(0.2, 0.54, 0.02, 0, 0, 0.25)));                         // 탄창
    g.push(part(box(0.09, 0.045, 0.024), C.gun, M(0.04, 0.575, 0.02, 0, 0, 0.1)));                      // 개머리판
    g.push(part(box(0.06, 0.025, 0.02), C.black, M(0.19, 0.62, 0.02, 0, 0, 0.08)));                     // 조준경
    return mergeGeometries(g).scale(1.25, 1.25, 1.25);
  },

  // 전차: K2 흑표 (길이 약 1.3)
  k2(S) {
    const g = [];
    const body = S.base;
    // 하부 차체 (앞 경사 장갑)
    g.push(part(side([[-0.62, 0.1], [0.5, 0.1], [0.66, 0.2], [0.66, 0.25], [-0.64, 0.25]], 0.46), S.dark, null, CAMO));
    // 상부 차체
    g.push(part(side([[-0.64, 0.25], [0.66, 0.25], [0.46, 0.33], [-0.62, 0.34]], 0.6), body, null, CAMO));
    // 궤도·바퀴
    for (const z of [-0.265, 0.265]) {
      const sz = Math.sign(z);
      g.push(part(box(1.22, 0.035, 0.14), C.rubber, M(-0.02, 0.02, z)));                                  // 궤도 바닥
      g.push(part(box(1.12, 0.03, 0.14), C.rubber, M(-0.02, 0.215, z)));                                  // 궤도 위
      g.push(part(cyl(0.085, 0.085, 0.14, 14), C.rubber, M(0.6, 0.13, z, H)));                            // 구동륜 쪽 궤도
      g.push(part(cyl(0.075, 0.075, 0.14, 14), C.rubber, M(-0.62, 0.12, z, H)));
      for (let i = 0; i < 6; i++) {
        const x = -0.47 + i * 0.19;
        g.push(part(cyl(0.075, 0.075, 0.12, 16), C.dark, M(x, 0.1, z, H)));                              // 보기륜
        g.push(part(cyl(0.035, 0.035, 0.125, 10), C.steel, M(x, 0.1, z + sz * 0.002, H)));               // 허브
      }
      g.push(part(cyl(0.09, 0.09, 0.1, 12), C.gun, M(0.6, 0.14, z, H)));                                 // 구동륜
      for (let k = 0; k < 8; k++) g.push(part(box(0.03, 0.03, 0.105), C.gun, M(0.6 + Math.cos(k * PI / 4) * 0.09, 0.14 + Math.sin(k * PI / 4) * 0.09, z)));
      g.push(part(box(1.2, 0.13, 0.02), body, M(0.0, 0.2, z + sz * 0.075), CAMO));                       // 사이드 스커트
      for (let i = 0; i < 6; i++) g.push(part(box(0.005, 0.12, 0.022), C.olive2, M(-0.5 + i * 0.2, 0.2, z + sz * 0.076)));
    }
    // 포탑 (각진 모듈식 장갑 + 뒤쪽 바슬)
    g.push(part(top([[0.36, -0.1], [0.24, -0.27], [-0.3, -0.27], [-0.5, -0.22], [-0.5, 0.22], [-0.3, 0.27], [0.24, 0.27], [0.36, 0.1]], 0.15, 0.015), body, M(-0.02, 0.35, 0), CAMO));
    g.push(part(top([[0.3, -0.09], [0.18, -0.24], [-0.28, -0.24], [-0.44, -0.2], [-0.44, 0.2], [-0.28, 0.24], [0.18, 0.24], [0.3, 0.09]], 0.04), C.olive2, M(-0.02, 0.51, 0), CAMO));
    g.push(part(box(0.16, 0.12, 0.2), C.olive2, M(0.34, 0.43, 0), CAMO));                                 // 포방패
    // 주포 (120mm 55구경, 열차폐 슬리브)
    g.push(part(cyl(0.032, 0.036, 0.55, 12), body, M(0.68, 0.44, 0, 0, 0, H), CAMO));
    g.push(part(cyl(0.026, 0.028, 0.45, 12), C.gun, M(1.17, 0.44, 0, 0, 0, H)));
    g.push(part(cyl(0.04, 0.04, 0.12, 12), C.olive2, M(0.83, 0.44, 0, 0, 0, H)));                         // 배연기
    g.push(part(cyl(0.03, 0.03, 0.03, 12), C.black, M(1.405, 0.44, 0, 0, 0, H)));
    // 전차장 조준경·해치·원격무장
    g.push(part(cyl(0.055, 0.06, 0.06, 12), C.olive2, M(-0.08, 0.57, 0.12)));
    g.push(part(box(0.08, 0.05, 0.07), C.gun, M(0.02, 0.6, -0.14)));
    g.push(part(cyl(0.035, 0.035, 0.06, 10), C.glass, M(0.06, 0.61, -0.14, 0, 0, H)));
    g.push(part(box(0.1, 0.06, 0.08), C.gun, M(-0.1, 0.62, 0.12)));
    g.push(part(cyl(0.008, 0.008, 0.2, 6), C.black, M(0.02, 0.645, 0.12, 0, 0, H)));                     // 기관총
    // 연막탄 발사기
    for (const z of [-0.2, 0.2]) for (let i = 0; i < 4; i++) g.push(part(cyl(0.014, 0.014, 0.07, 6), C.gun, M(0.2 - i * 0.035, 0.5, z + Math.sign(z) * 0.03, Math.sign(z) * 0.6, 0, 0.5)));
    // 안테나·바슬 적재함·후방 배기구
    g.push(part(cyl(0.004, 0.004, 0.45, 4), C.black, M(-0.42, 0.75, -0.18)));
    g.push(part(cyl(0.004, 0.004, 0.35, 4), C.black, M(-0.42, 0.7, 0.18)));
    g.push(part(box(0.1, 0.08, 0.46), C.olive2, M(-0.55, 0.43, 0)));
    g.push(part(box(0.04, 0.06, 0.4), C.black, M(-0.66, 0.29, 0)));
    for (const z of [-0.22, 0.22]) g.push(part(box(0.03, 0.04, 0.05), C.white, M(0.67, 0.28, z)));       // 전조등
    g.push(part(box(0.3, 0.008, 0.3), 0xffffff, M(-0.14, 0.555, 0), TINT));                              // 포탑 위 대공 식별판 (국가색)
    g.push(part(box(0.12, 0.08, 0.005), 0xffffff, M(-0.2, 0.43, 0.272), TINT));                           // 국가 표식
    g.push(part(box(0.12, 0.08, 0.005), 0xffffff, M(-0.2, 0.43, -0.272), TINT));
    return mergeGeometries(g);
  },

  // 자주포: K9 천둥 풍 (포탑이 크고 포신이 김, 포신이 들린 사격 자세)
  arty(S) {
    const g = [];
    const body = S.base;
    g.push(part(side([[-0.62, 0.1], [0.52, 0.1], [0.62, 0.22], [0.5, 0.3], [-0.62, 0.3]], 0.54), body, null, CAMO));
    for (const z of [-0.265, 0.265]) {
      g.push(part(box(1.2, 0.035, 0.12), C.rubber, M(0, 0.02, z)));
      for (let i = 0; i < 6; i++) g.push(part(cyl(0.07, 0.07, 0.11, 14), C.dark, M(-0.45 + i * 0.18, 0.09, z, H)));
      g.push(part(box(1.15, 0.1, 0.02), body, M(0, 0.2, z + Math.sign(z) * 0.065), CAMO));
    }
    g.push(part(top([[0.2, -0.28], [-0.55, -0.28], [-0.62, -0.2], [-0.62, 0.2], [-0.55, 0.28], [0.2, 0.28], [0.3, 0.15], [0.3, -0.15]], 0.28, 0.015), body, M(-0.05, 0.3, 0), CAMO));
    g.push(part(cyl(0.035, 0.04, 1.1, 12), body, M(0.55, 0.78, 0, 0, 0, H - 0.55), CAMO));               // 155mm 포신 (앙각)
    g.push(part(box(0.1, 0.06, 0.08), C.olive2, M(1.02, 1.07, 0, 0, 0, 0.55)));                           // 포구 제퇴기
    g.push(part(box(0.2, 0.15, 0.2), C.olive2, M(0.26, 0.5, 0), CAMO));
    g.push(part(cyl(0.05, 0.05, 0.06, 10), C.gun, M(-0.3, 0.63, 0.15)));
    g.push(part(box(0.14, 0.08, 0.005), 0xffffff, M(-0.2, 0.44, 0.283), TINT));
    g.push(part(box(0.14, 0.08, 0.005), 0xffffff, M(-0.2, 0.44, -0.283), TINT));
    g.push(part(box(0.3, 0.008, 0.34), 0xffffff, M(-0.3, 0.585, 0), TINT));
    return mergeGeometries(g);
  },

  // 전투기: KF-21 보라매 (길이 약 1.6)
  kf21() {
    const g = [];
    const skin = C.jet;
    g.push(part(lathe([[-0.72, 0.07], [-0.55, 0.1], [-0.1, 0.11], [0.25, 0.1], [0.5, 0.07], [0.7, 0.035], [0.82, 0.0]], 18), skin, M(0, 0, 0, 0, 0, 0, 1, 0.75, 1.25)));
    g.push(part(sph(0.075, 16, 10), C.glassB, M(0.38, 0.065, 0, 0, 0, 0, 2.6, 0.9, 0.8)));               // 캐노피
    g.push(part(box(0.3, 0.02, 0.1), C.jet2, M(0.15, 0.08, 0)));                                          // 척추
    for (const z of [-0.1, 0.1]) {                                                                        // 공기흡입구
      g.push(part(side([[0.25, -0.06], [0.05, -0.08], [-0.25, -0.07], [-0.25, 0.03], [0.1, 0.03], [0.28, 0.0]], 0.07), C.jet2, M(0, 0, z)));
      g.push(part(box(0.02, 0.07, 0.065), C.black, M(0.26, -0.03, z)));
    }
    // 주익·수평꼬리날개 (좌우를 각각 만들어 면 방향이 뒤집히지 않게)
    const plate = (pts, t, sgn) => {
      const g2 = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, z * sgn))), { depth: t, bevelEnabled: true, bevelSize: t * 0.3, bevelThickness: t * 0.3, bevelSegments: 1 });
      g2.rotateX(H); g2.translate(0, t / 2, 0);
      return g2;
    };
    for (const sg of [1, -1]) {
      g.push(part(plate([[0.3, 0.08], [-0.28, 0.72], [-0.44, 0.72], [-0.46, 0.1]], 0.018, sg), skin, M(0, -0.01, 0)));
      g.push(part(plate([[-0.5, 0.08], [-0.68, 0.36], [-0.78, 0.36], [-0.76, 0.08]], 0.012, sg), skin, M(0, -0.02, 0)));
    }
    // 쌍수직꼬리 (바깥으로 기울어짐)
    const fin = side([[-0.45, 0.0], [-0.66, 0.3], [-0.76, 0.3], [-0.72, 0.0]], 0.012);
    g.push(part(fin.clone(), skin, M(0, 0.03, 0.09, -0.35)));
    g.push(part(fin.clone(), skin, M(0, 0.03, -0.09, 0.35)));
    // 쌍발 노즐
    for (const z of [-0.055, 0.055]) {
      g.push(part(cyl(0.05, 0.045, 0.1, 14), C.gun, M(-0.76, -0.01, z, 0, 0, H)));
      g.push(part(cyl(0.035, 0.035, 0.02, 12), C.black, M(-0.81, -0.01, z, 0, 0, H)));
    }
    // 무장: 날개 아래 미사일
    for (const z of [-0.42, 0.42, -0.26, 0.26]) {
      g.push(part(cyl(0.014, 0.014, 0.28, 8), C.white, M(-0.12, -0.05, z, 0, 0, H)));
      g.push(part(new THREE.ConeGeometry(0.014, 0.05, 8), C.white, M(0.045, -0.05, z, 0, 0, -H)));
    }
    g.push(part(box(0.12, 0.004, 0.12), 0xffffff, M(-0.2, 0.006, 0.52), TINT));                          // 날개 표식
    g.push(part(box(0.12, 0.004, 0.12), 0xffffff, M(-0.2, 0.006, -0.52), TINT));
    return mergeGeometries(g).scale(1.25, 1.25, 1.25);
  },

  // 구축함: 세종대왕급 (길이 약 2.2)
  sejong() {
    const g = [];
    // 선체: 위에서 본 윤곽을 뽑고 아래쪽을 좁혀 V자 단면
    const hull = top([[1.12, 0], [0.8, -0.14], [0.2, -0.19], [-0.9, -0.18], [-1.02, -0.14], [-1.02, 0.14], [-0.9, 0.18], [0.2, 0.19], [0.8, 0.14]], 0.26);
    const p = hull.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y < 0.01) p.setZ(i, p.getZ(i) * 0.45); if (p.getX(i) > 0.7 && y > 0.2) p.setY(i, y + (p.getX(i) - 0.7) * 0.12); }
    hull.computeVertexNormals();
    g.push(part(hull, C.navy, M(0, -0.08, 0)));
    g.push(part(box(2.0, 0.03, 0.34), C.red, M(-0.03, -0.05, 0)));                                          // 흘수선
    g.push(part(box(1.9, 0.015, 0.34), C.deck, M(-0.05, 0.185, 0)));                                       // 갑판
    // 함교·상부구조 (스텔스 경사벽)
    g.push(part(top([[0.42, -0.12], [0.1, -0.15], [-0.25, -0.15], [-0.25, 0.15], [0.1, 0.15], [0.42, 0.12]], 0.2, 0.01), C.navy, M(0, 0.19, 0)));
    g.push(part(top([[0.3, -0.1], [0.05, -0.12], [-0.12, -0.12], [-0.12, 0.12], [0.05, 0.12], [0.3, 0.1]], 0.14, 0.01), C.navy, M(0, 0.4, 0)));
    g.push(part(box(0.02, 0.035, 0.22), C.glassB, M(0.31, 0.5, 0, 0, 0, -0.3)));                           // 함교 창
    // SPY-1D 위상배열 레이더 (팔각 판)
    for (const [x, z, ry] of [[0.22, 0.12, 0.6], [0.22, -0.12, -0.6], [-0.1, 0.13, 2.5], [-0.1, -0.13, -2.5]]) g.push(part(cyl(0.07, 0.07, 0.012, 8), C.navy2, M(x, 0.45, z, H, ry, 0)));
    // 마스트 (피라미드형) + 레이더
    g.push(part(cyl(0.02, 0.07, 0.3, 4), C.navy, M(-0.05, 0.68, 0, 0, PI / 4, 0)));
    g.push(part(box(0.16, 0.025, 0.03), C.dark, M(-0.05, 0.8, 0)));
    g.push(part(cyl(0.004, 0.004, 0.18, 4), C.dark, M(-0.05, 0.92, 0)));
    // 연돌
    for (const x of [-0.38, -0.55]) g.push(part(top([[0.06, -0.07], [-0.06, -0.07], [-0.06, 0.07], [0.06, 0.07]], 0.18), C.navy2, M(x, 0.19, 0)));
    // 5인치 함포 (스텔스 포탑)
    g.push(part(top([[0.1, -0.06], [-0.08, -0.08], [-0.08, 0.08], [0.1, 0.06]], 0.07, 0.01), C.navy, M(0.78, 0.19, 0)));
    g.push(part(cyl(0.012, 0.014, 0.28, 8), C.gun, M(0.98, 0.235, 0, 0, 0, H)));
    // 수직발사대(VLS) 격자
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) g.push(part(box(0.045, 0.012, 0.045), C.dark, M(0.5 + i * 0.05, 0.198, -0.05 + j * 0.05)));
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) g.push(part(box(0.045, 0.012, 0.045), C.dark, M(-0.72 + i * 0.05, 0.198, -0.05 + j * 0.05)));
    // CIWS·어뢰·구명정
    g.push(part(cyl(0.03, 0.035, 0.06, 10), C.white, M(0.45, 0.43, 0)));
    g.push(part(sph(0.03, 10, 8, 0, PI * 2, 0, H), C.white, M(0.45, 0.46, 0)));
    for (const z of [-0.16, 0.16]) g.push(part(cyl(0.02, 0.02, 0.12, 8), C.white, M(-0.2, 0.25, z, 0, 0, H)));
    // 헬기 갑판·격납고
    g.push(part(box(0.24, 0.1, 0.24), C.navy, M(-0.75, 0.24, 0)));
    g.push(part(cyl(0.09, 0.09, 0.004, 20), C.white, M(-0.93, 0.194, 0)));
    g.push(part(box(0.2, 0.1, 0.005), 0xffffff, M(-0.05, 0.93, 0.02), TINT));                              // 함기
    return mergeGeometries(g).scale(0.95, 0.95, 0.95);
  },

  // 탄도미사일: 오지브 탄두 + 2단 추진체 + 날개
  missile() {
    const g = [];
    g.push(part(lathe([[-0.45, 0.045], [0.2, 0.045], [0.3, 0.04], [0.45, 0.02], [0.52, 0.0]], 14), C.white, null));
    g.push(part(cyl(0.047, 0.047, 0.04, 14), 0xffffff, M(0.12, 0, 0, 0, 0, H), TINT));
    g.push(part(cyl(0.047, 0.047, 0.03, 14), C.dark, M(-0.1, 0, 0, 0, 0, H)));
    for (let i = 0; i < 4; i++) g.push(part(side([[-0.45, 0], [-0.3, 0], [-0.42, 0.09], [-0.47, 0.09]], 0.008), C.dark, M(0, 0, 0, i * H)));
    g.push(part(cyl(0.03, 0.04, 0.05, 12), C.gun, M(-0.47, 0, 0, 0, 0, H)));
    return mergeGeometries(g);
  },

  // 수도: 고층 빌딩 군과 도로
  city() {
    const g = [];
    const rnd = mulberry(7);
    g.push(part(cyl(0.72, 0.76, 0.03, 24), C.road, M(0, 0.015, 0)));
    for (let i = 0; i < 24; i++) {
      const a = rnd() * PI * 2, r = 0.08 + rnd() * 0.6;
      const h = 0.1 + rnd() * rnd() * 0.95 * (1 - r * 0.9);
      const w = 0.07 + rnd() * 0.09, d = 0.07 + rnd() * 0.09;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const tall = h > 0.4;
      g.push(part(box(w, h, d), tall ? C.glassB : rnd() > 0.5 ? C.concrete : 0x9aa3ad, M(x, h / 2 + 0.03, z)));
      for (let k = 0.12; k < h - 0.03; k += 0.08) g.push(part(box(w * 1.01, 0.012, d * 1.01), C.window, M(x, k + 0.03, z)));
      if (tall) g.push(part(cyl(0.004, 0.004, 0.08, 4), C.white, M(x, h + 0.07, z)));
    }
    g.push(part(cyl(0.012, 0.012, 1.1, 6), C.white, M(0, 0.55, 0)));                                       // 깃대
    return mergeGeometries(g);
  },

  // 지방 도시 (작은 건물들)
  town() {
    const g = [];
    const rnd = mulberry(11);
    g.push(part(cyl(0.4, 0.42, 0.02, 16), C.road, M(0, 0.01, 0)));
    for (let i = 0; i < 12; i++) {
      const a = rnd() * PI * 2, r = 0.05 + rnd() * 0.32, h = 0.05 + rnd() * 0.28 * (1 - r);
      const w = 0.05 + rnd() * 0.06, x = Math.cos(a) * r, z = Math.sin(a) * r;
      g.push(part(box(w, h, w), rnd() > 0.4 ? C.concrete : 0xb07a5a, M(x, h / 2 + 0.02, z)));
      g.push(part(box(w * 1.01, 0.01, w * 1.01), C.window, M(x, h * 0.65 + 0.02, z)));
    }
    return mergeGeometries(g);
  },
};


// ============================================================================
// 나라별 실제 장비 (전차 · 전투기 · 군함) — 실루엣의 핵심 특징을 살린 절차적 모델
// ============================================================================
// 공통 하부: 궤도와 보기륜 (n개, 반지름 r), 사이드스커트 여부
function running(g, S, { n = 6, r = 0.075, len = 1.2, gap = false, skirt = true, z0 = 0.265, sprocketFront = true } = {}) {
  for (const z of [-z0, z0]) {
    const sz = Math.sign(z);
    g.push(part(box(len, 0.035, 0.14), C.rubber, M(-0.02, 0.02, z)));
    g.push(part(box(len * 0.92, 0.03, 0.14), C.rubber, M(-0.02, 0.215, z)));
    const span = len * 0.8, step = span / (n - 1);
    for (let i = 0; i < n; i++) {
      const x = -span / 2 + i * step;
      g.push(part(cyl(r, r, 0.12, 16), C.dark, M(x, r + 0.025, z, H)));
      g.push(part(cyl(r * 0.45, r * 0.45, 0.125, 10), C.steel, M(x, r + 0.025, z + sz * 0.002, H)));
    }
    const sx = sprocketFront ? len / 2 - 0.08 : -len / 2 + 0.08;
    g.push(part(cyl(0.085, 0.085, 0.1, 12), C.gun, M(sx, 0.14, z, H)));
    if (gap) for (let i = 0; i < 3; i++) g.push(part(cyl(0.025, 0.025, 0.1, 8), C.dark, M(-0.3 + i * 0.3, 0.2, z, H))); // 상부 지지륜
    if (skirt) g.push(part(box(len, 0.12, 0.02), S.base, M(0, 0.2, z + sz * 0.075), CAMO));
  }
}
const idPlate = (g, x, y, z0, w = 0.12) => { g.push(part(box(w, 0.08, 0.005), 0xffffff, M(x, y, z0), TINT)); g.push(part(box(w, 0.08, 0.005), 0xffffff, M(x, y, -z0), TINT)); };
const roofMark = (g, x, y, w = 0.28, d = 0.28) => g.push(part(box(w, 0.008, d), 0xffffff, M(x, y, 0), TINT));

Object.assign(builders, {
  // 미국 M1A2 에이브럼스: 넓고 납작한 판형 포탑, 긴 바슬 적재함, 보기륜 7개, 사막색
  abrams(S) {
    const g = [];
    running(g, S, { n: 7, r: 0.07, len: 1.3 });
    g.push(part(side([[-0.66, 0.1], [0.52, 0.1], [0.7, 0.22], [0.66, 0.27], [-0.66, 0.27]], 0.5), S.dark, null, CAMO));
    g.push(part(side([[-0.66, 0.27], [0.68, 0.27], [0.5, 0.33], [-0.66, 0.33]], 0.62), S.base, null, CAMO));
    g.push(part(top([[0.34, -0.14], [0.2, -0.3], [-0.36, -0.3], [-0.36, 0.3], [0.2, 0.3], [0.34, 0.14]], 0.13, 0.012), S.base, M(0, 0.33, 0), CAMO));
    g.push(part(box(0.3, 0.1, 0.56), S.dark, M(-0.52, 0.4, 0), CAMO));                                       // 바슬 적재함
    for (let i = 0; i < 5; i++) g.push(part(box(0.005, 0.1, 0.56), C.gun, M(-0.4 - i * 0.06, 0.4, 0)));
    g.push(part(box(0.1, 0.1, 0.2), S.dark, M(0.36, 0.4, 0), CAMO));
    g.push(part(cyl(0.03, 0.034, 0.95, 12), S.base, M(0.86, 0.41, 0, 0, 0, H), CAMO));
    g.push(part(cyl(0.028, 0.028, 0.03, 12), C.black, M(1.34, 0.41, 0, 0, 0, H)));
    g.push(part(box(0.12, 0.08, 0.1), C.gun, M(-0.05, 0.5, 0.14)));                                        // CROWS 원격무장
    g.push(part(cyl(0.007, 0.007, 0.22, 6), C.black, M(0.08, 0.53, 0.14, 0, 0, H)));
    g.push(part(box(0.08, 0.06, 0.08), C.gun, M(0.05, 0.49, -0.15)));
    g.push(part(box(0.06, 0.05, 0.62), C.black, M(-0.67, 0.3, 0)));                                        // 가스터빈 배기구
    roofMark(g, -0.05, 0.465); idPlate(g, -0.1, 0.4, 0.302);
    return mergeGeometries(g);
  },
  // 독일 레오파르트 2A7: 화살촉 모양 쐐기형 증가장갑 포탑, 수직 측면, 보기륜 7개
  leo2(S) {
    const g = [];
    running(g, S, { n: 7, r: 0.072, len: 1.28 });
    g.push(part(side([[-0.64, 0.1], [0.52, 0.1], [0.68, 0.22], [0.66, 0.27], [-0.64, 0.27]], 0.5), S.dark, null, CAMO));
    g.push(part(side([[-0.64, 0.27], [0.66, 0.27], [0.46, 0.34], [-0.64, 0.34]], 0.6), S.base, null, CAMO));
    g.push(part(top([[0.48, 0], [0.22, -0.27], [-0.38, -0.27], [-0.38, 0.27], [0.22, 0.27]], 0.17, 0.01), S.base, M(0, 0.34, 0), CAMO)); // 쐐기 포탑
    g.push(part(box(0.2, 0.12, 0.46), S.dark, M(-0.46, 0.42, 0), CAMO));
    g.push(part(cyl(0.03, 0.034, 0.95, 12), S.base, M(0.84, 0.43, 0, 0, 0, H), CAMO));
    g.push(part(cyl(0.04, 0.04, 0.1, 12), S.dark, M(0.62, 0.43, 0, 0, 0, H)));
    g.push(part(cyl(0.05, 0.05, 0.08, 10), C.gun, M(0.02, 0.55, -0.14)));                                  // 조준경(PERI)
    g.push(part(box(0.06, 0.08, 0.06), C.glass, M(0.08, 0.57, -0.14)));
    roofMark(g, -0.1, 0.515); idPlate(g, -0.15, 0.42, 0.272);
    return mergeGeometries(g);
  },
  // 러시아 T-90M: 낮은 차체, 둥근 주조 포탑 + 반응장갑(ERA) 블록, 보기륜 6개 간격 넓음, 적외선 탐조등, 연료드럼
  t90(S) {
    const g = [];
    running(g, S, { n: 6, r: 0.085, len: 1.18, gap: true, skirt: false });
    g.push(part(box(1.14, 0.03, 0.02), S.base, M(0, 0.25, 0.34), CAMO)); g.push(part(box(1.14, 0.03, 0.02), S.base, M(0, 0.25, -0.34), CAMO)); // 흙받이
    g.push(part(side([[-0.6, 0.1], [0.45, 0.1], [0.64, 0.2], [0.62, 0.25], [-0.6, 0.25]], 0.5), S.dark, null, CAMO));
    g.push(part(side([[-0.6, 0.25], [0.62, 0.25], [0.42, 0.3], [-0.6, 0.3]], 0.66), S.base, null, CAMO));
    for (let i = 0; i < 5; i++) for (const z of [-0.12, 0.12]) g.push(part(box(0.1, 0.02, 0.1), S.dark, M(0.5 - i * 0.02, 0.23 + i * 0.012, z + (i % 2) * 0.02, 0, 0, 0.45)));  // 전면 ERA
    g.push(part(sph(0.28, 18, 10, 0, PI * 2, 0, H), S.base, M(-0.05, 0.3, 0, 0, 0, 0, 1.05, 0.55, 1), CAMO));   // 둥근 포탑
    for (const z of [-1, 1]) for (let i = 0; i < 3; i++) g.push(part(box(0.1, 0.06, 0.08), S.dark, M(0.18 - i * 0.02, 0.36 + i * 0.03, z * (0.1 + i * 0.05), 0, z * 0.5, 0)));  // 포탑 ERA
    g.push(part(cyl(0.028, 0.032, 0.95, 12), S.base, M(0.72, 0.4, 0, 0, 0, H), CAMO));
    for (const z of [-0.13, 0.13]) { g.push(part(box(0.08, 0.07, 0.06), C.dark, M(0.17, 0.42, z))); g.push(part(box(0.005, 0.05, 0.045), 0xa32020, M(0.21, 0.42, z))); } // 적외선 탐조등
    g.push(part(box(0.06, 0.08, 0.06), C.gun, M(-0.12, 0.47, 0.12)));
    g.push(part(cyl(0.006, 0.006, 0.2, 6), C.black, M(0.0, 0.52, 0.12, 0, 0, H)));
    for (const z of [-0.13, 0.13]) g.push(part(cyl(0.06, 0.06, 0.2, 10), S.dark, M(-0.72, 0.28, z, H)));   // 후방 연료드럼
    roofMark(g, -0.08, 0.455, 0.22, 0.22); idPlate(g, -0.3, 0.29, 0.332);
    return mergeGeometries(g);
  },
  // 중국 99식: T-72 계열 차체, 뾰족한 화살촉 ERA 포탑 전면, 레이저 방어장치
  type99(S) {
    const g = [];
    running(g, S, { n: 6, r: 0.08, len: 1.22, gap: true, skirt: true });
    g.push(part(side([[-0.62, 0.1], [0.48, 0.1], [0.66, 0.21], [0.64, 0.26], [-0.62, 0.26]], 0.5), S.dark, null, CAMO));
    g.push(part(side([[-0.62, 0.26], [0.64, 0.26], [0.44, 0.31], [-0.62, 0.31]], 0.62), S.base, null, CAMO));
    g.push(part(top([[0.2, -0.24], [-0.34, -0.24], [-0.4, -0.18], [-0.4, 0.18], [-0.34, 0.24], [0.2, 0.24]], 0.15, 0.01), S.base, M(0, 0.31, 0), CAMO));
    g.push(part(top([[0.52, 0], [0.2, -0.26], [0.16, -0.24], [0.16, 0.24], [0.2, 0.26]], 0.14), S.dark, M(0, 0.31, 0), CAMO));    // 화살촉 ERA
    g.push(part(cyl(0.028, 0.032, 0.95, 12), S.base, M(0.84, 0.39, 0, 0, 0, H), CAMO));
    g.push(part(box(0.1, 0.08, 0.08), C.gun, M(-0.05, 0.5, -0.14))); g.push(part(cyl(0.03, 0.03, 0.02, 10), 0x3a8a5a, M(0.0, 0.5, -0.14, 0, 0, H))); // 레이저 경보기
    g.push(part(cyl(0.006, 0.006, 0.2, 6), C.black, M(0.02, 0.5, 0.12, 0, 0, H)));
    roofMark(g, -0.1, 0.465); idPlate(g, -0.2, 0.38, 0.242);
    return mergeGeometries(g);
  },
  // 일본 10식: 작고 각진 포탑, 보기륜 5개, 짧은 차체
  type10(S) {
    const g = [];
    running(g, S, { n: 5, r: 0.08, len: 1.1 });
    g.push(part(side([[-0.56, 0.1], [0.44, 0.1], [0.58, 0.22], [0.56, 0.27], [-0.56, 0.27]], 0.48), S.dark, null, CAMO));
    g.push(part(side([[-0.56, 0.27], [0.58, 0.27], [0.4, 0.32], [-0.56, 0.32]], 0.58), S.base, null, CAMO));
    g.push(part(top([[0.3, -0.2], [0.26, -0.26], [-0.44, -0.26], [-0.44, 0.26], [0.26, 0.26], [0.3, 0.2]], 0.16, 0.01), S.base, M(0, 0.32, 0), CAMO));
    for (const z of [-0.27, 0.27]) g.push(part(box(0.5, 0.12, 0.02), S.dark, M(-0.05, 0.4, z), CAMO));    // 모듈 장갑
    g.push(part(cyl(0.028, 0.032, 0.78, 12), S.base, M(0.7, 0.41, 0, 0, 0, H), CAMO));
    g.push(part(box(0.08, 0.07, 0.07), C.gun, M(0.02, 0.52, 0.14)));
    roofMark(g, -0.08, 0.485); idPlate(g, -0.25, 0.4, 0.282);
    return mergeGeometries(g);
  },
  // 이스라엘 메르카바 Mk4: 엔진이 앞, 포탑이 뒤로 치우친 긴 쐐기, 포탑 뒤 체인볼
  merkava(S) {
    const g = [];
    running(g, S, { n: 6, r: 0.078, len: 1.3, sprocketFront: true });
    g.push(part(side([[-0.66, 0.1], [0.5, 0.1], [0.72, 0.24], [0.5, 0.33], [-0.66, 0.33]], 0.6), S.base, null, CAMO));
    g.push(part(top([[0.4, 0], [0.1, -0.28], [-0.5, -0.28], [-0.5, 0.28], [0.1, 0.28]], 0.16, 0.01), S.base, M(-0.12, 0.33, 0), CAMO));
    for (let i = 0; i < 9; i++) g.push(part(sph(0.025, 6, 5), C.gun, M(-0.63, 0.37 - (i % 3) * 0.04, -0.2 + Math.floor(i / 3) * 0.2)));  // 체인볼
    g.push(part(cyl(0.03, 0.034, 0.9, 12), S.base, M(0.72, 0.42, 0, 0, 0, H), CAMO));
    g.push(part(box(0.1, 0.07, 0.08), C.gun, M(-0.1, 0.52, 0.14)));
    roofMark(g, -0.2, 0.495); idPlate(g, -0.2, 0.42, 0.302);
    return mergeGeometries(g);
  },
  // 북한 천마호 (T-62 계열): 작은 반구형 포탑, 보기륜 5개, 포신 중간 배연기
  t62(S) {
    const g = [];
    running(g, S, { n: 5, r: 0.09, len: 1.12, gap: false, skirt: false });
    g.push(part(box(1.1, 0.03, 0.02), S.base, M(0, 0.24, 0.33), CAMO)); g.push(part(box(1.1, 0.03, 0.02), S.base, M(0, 0.24, -0.33), CAMO));
    g.push(part(side([[-0.58, 0.1], [0.42, 0.1], [0.6, 0.2], [0.58, 0.25], [-0.58, 0.25]], 0.5), S.dark, null, CAMO));
    g.push(part(side([[-0.58, 0.25], [0.58, 0.25], [0.4, 0.29], [-0.58, 0.29]], 0.64), S.base, null, CAMO));
    g.push(part(sph(0.24, 16, 10, 0, PI * 2, 0, H), S.base, M(-0.02, 0.29, 0, 0, 0, 0, 1, 0.62, 1), CAMO));
    g.push(part(cyl(0.024, 0.026, 0.8, 10), S.base, M(0.62, 0.38, 0, 0, 0, H), CAMO));
    g.push(part(cyl(0.035, 0.035, 0.08, 10), S.dark, M(0.72, 0.38, 0, 0, 0, H)));
    g.push(part(box(0.06, 0.06, 0.06), C.dark, M(0.14, 0.4, 0.12))); g.push(part(box(0.004, 0.04, 0.04), 0xa32020, M(0.172, 0.4, 0.12)));
    for (const z of [-0.14, 0.14]) g.push(part(cyl(0.055, 0.055, 0.18, 10), S.dark, M(-0.68, 0.27, z, H)));
    roofMark(g, -0.02, 0.44, 0.2, 0.2); idPlate(g, -0.2, 0.26, 0.322);
    return mergeGeometries(g);
  },

  // ---------------- 전투기 ----------------
  // 미국 F-35: 뭉툭한 단발 동체, 기울어진 쌍꼬리, 사다리꼴 날개
  f35() { return jetBody({ fat: 1.25, twin: false, fins: 'canted', wing: [[0.2, 0.1], [-0.32, 0.62], [-0.46, 0.62], [-0.5, 0.12]], canard: false, intake: 'side' }); },
  // F-16: 가는 동체, 턱 밑 흡입구, 단일 수직꼬리, 잘린 델타 날개
  f16() { return jetBody({ fat: 0.9, twin: false, fins: 'single', wing: [[0.15, 0.08], [-0.3, 0.58], [-0.42, 0.58], [-0.42, 0.1]], canard: false, intake: 'chin' }); },
  // 러시아 Su-35: 긴 동체, 넓게 벌어진 쌍발 엔진, 수직 쌍꼬리, 꼬리 스팅어
  su35() { return jetBody({ fat: 1.0, twin: 'wide', fins: 'upright', wing: [[0.2, 0.18], [-0.4, 0.78], [-0.55, 0.78], [-0.55, 0.2]], canard: false, intake: 'under', long: 1.15, stinger: true }); },
  // MiG-29: 중형, 벌어진 쌍발, 바깥으로 기운 쌍꼬리, 큰 날개 뿌리 연장
  mig29() { return jetBody({ fat: 0.95, twin: 'wide', fins: 'canted', wing: [[0.3, 0.14], [-0.3, 0.62], [-0.44, 0.62], [-0.46, 0.18]], canard: false, intake: 'under' }); },
  // 중국 J-20: 긴 동체, 앞쪽 카나드, 델타 날개, 작은 기운 꼬리와 배지느러미
  j20() { return jetBody({ fat: 1.05, twin: true, fins: 'small', wing: [[0.05, 0.1], [-0.52, 0.66], [-0.6, 0.66], [-0.6, 0.12]], canard: true, intake: 'side', long: 1.2, ventral: true }); },
  // 유로파이터·라팔: 델타 날개 + 카나드, 단일 수직꼬리
  euro() { return jetBody({ fat: 0.95, twin: true, fins: 'single', wing: [[0.1, 0.08], [-0.5, 0.58], [-0.56, 0.58], [-0.56, 0.1]], canard: true, intake: 'chin' }); },

  // ---------------- 군함 ----------------
  // 미국 알레이 버크급: 경사 마스트, 연돌 2개, SPY-1 판
  burke() { return shipBody({ mast: 'lattice', stacks: 2, panels: 'spy', guns: 1 }); },
  // 중국 055형: 대형 선체, 일체형 탑 마스트에 대형 레이더판, 넓은 연돌 1개, 수직발사대 다수
  type055() { return shipBody({ mast: 'tower', stacks: 1, panels: 'big', guns: 1, len: 1.12, vls: 3 }); },
  // 러시아 슬라바급: 갑판 양옆의 대형 대함미사일 발사관, 높은 구조물
  slava() { return shipBody({ mast: 'lattice', stacks: 2, panels: 'dome', guns: 1, tubes: true }); },
  // 영국 45형: 높은 피라미드 마스트 꼭대기의 구형 레이더
  type45() { return shipBody({ mast: 'sphere', stacks: 1, panels: 'none', guns: 1 }); },
  // 일반 호위함: 작은 선체, 함포 1문, 마스트 1개
  frigate() { return shipBody({ mast: 'lattice', stacks: 1, panels: 'none', guns: 1, len: 0.8, vls: 1 }); },
});

function jetBody(o) {
  const g = [], skin = C.jet, L = o.long || 1;
  g.push(part(lathe([[-0.72, 0.07], [-0.55, 0.1], [-0.1, 0.11], [0.25, 0.1], [0.5, 0.07], [0.7, 0.035], [0.84, 0.0]], 18), skin, M(0, 0, 0, 0, 0, 0, L, 0.75 * o.fat, 1.2 * o.fat)));
  g.push(part(sph(0.075, 16, 10), C.glassB, M(0.4 * L, 0.065 * o.fat, 0, 0, 0, 0, 2.4, 0.9, 0.8)));
  if (o.intake === 'chin') g.push(part(box(0.3, 0.07, 0.11), C.jet2, M(0.1, -0.09, 0)));
  if (o.intake === 'side') for (const z of [-0.1, 0.1]) g.push(part(side([[0.25, -0.06], [0.05, -0.08], [-0.25, -0.07], [-0.25, 0.03], [0.1, 0.03], [0.28, 0.0]], 0.07), C.jet2, M(0, 0, z * o.fat)));
  if (o.intake === 'under') for (const z of [-0.09, 0.09]) g.push(part(box(0.35, 0.07, 0.08), C.jet2, M(-0.05, -0.09, z)));
  const plate = (pts, t, sgn) => { const g2 = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, z * sgn))), { depth: t, bevelEnabled: true, bevelSize: t * 0.3, bevelThickness: t * 0.3, bevelSegments: 1 }); g2.rotateX(H); g2.translate(0, t / 2, 0); return g2; };
  for (const sg of [1, -1]) {
    g.push(part(plate(o.wing, 0.018, sg), skin, M(0, -0.01, 0)));
    if (o.canard) g.push(part(plate([[0.45, 0.06], [0.32, 0.24], [0.26, 0.24], [0.3, 0.06]], 0.01, sg), skin, M(0, 0.01, 0)));
    else g.push(part(plate([[-0.52, 0.08], [-0.7, 0.34], [-0.8, 0.34], [-0.78, 0.08]], 0.012, sg), skin, M(0, -0.02, 0)));
  }
  const fin = side([[-0.45, 0.0], [-0.66, 0.3], [-0.76, 0.3], [-0.72, 0.0]], 0.012);
  if (o.fins === 'single') g.push(part(fin.clone(), skin, M(0, 0.04, 0, 0, 0, 0, 1, 1.2, 1)));
  if (o.fins === 'canted') { g.push(part(fin.clone(), skin, M(0, 0.03, 0.09, -0.35))); g.push(part(fin.clone(), skin, M(0, 0.03, -0.09, 0.35))); }
  if (o.fins === 'upright') { g.push(part(fin.clone(), skin, M(0, 0.03, 0.14))); g.push(part(fin.clone(), skin, M(0, 0.03, -0.14))); }
  if (o.fins === 'small') { g.push(part(fin.clone(), skin, M(0.02, 0.03, 0.08, -0.4, 0, 0, 0.8, 0.7, 1))); g.push(part(fin.clone(), skin, M(0.02, 0.03, -0.08, 0.4, 0, 0, 0.8, 0.7, 1))); }
  if (o.ventral) for (const z of [-0.06, 0.06]) g.push(part(side([[-0.5, 0], [-0.7, -0.12], [-0.76, -0.12], [-0.72, 0]], 0.01), skin, M(0, -0.03, z)));
  if (o.twin === 'wide') for (const z of [-0.1, 0.1]) { g.push(part(cyl(0.06, 0.055, 0.6, 14), C.jet2, M(-0.45, -0.02, z, 0, 0, H))); g.push(part(cyl(0.05, 0.045, 0.1, 14), C.gun, M(-0.78, -0.02, z, 0, 0, H))); }
  else if (o.twin) for (const z of [-0.05, 0.05]) g.push(part(cyl(0.048, 0.043, 0.1, 14), C.gun, M(-0.78, -0.01, z, 0, 0, H)));
  else g.push(part(cyl(0.06, 0.05, 0.12, 14), C.gun, M(-0.78, -0.01, 0, 0, 0, H)));
  if (o.stinger) g.push(part(cyl(0.02, 0.035, 0.2, 10), skin, M(-0.86, 0.0, 0, 0, 0, H)));
  for (const z of [-0.4, 0.4, -0.25, 0.25]) g.push(part(cyl(0.014, 0.014, 0.28, 8), C.white, M(-0.12, -0.05, z, 0, 0, H)));
  g.push(part(box(0.12, 0.004, 0.12), 0xffffff, M(-0.2, 0.006, 0.45), TINT)); g.push(part(box(0.12, 0.004, 0.12), 0xffffff, M(-0.2, 0.006, -0.45), TINT));
  return mergeGeometries(g).scale(1.25, 1.25, 1.25);
}

function shipBody(o) {
  const g = [], L = o.len || 1;
  const hull = top([[1.12, 0], [0.8, -0.14], [0.2, -0.19], [-0.9, -0.18], [-1.02, -0.14], [-1.02, 0.14], [-0.9, 0.18], [0.2, 0.19], [0.8, 0.14]], 0.26);
  const p = hull.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y < 0.01) p.setZ(i, p.getZ(i) * 0.45); if (p.getX(i) > 0.7 && y > 0.2) p.setY(i, y + (p.getX(i) - 0.7) * 0.12); }
  hull.computeVertexNormals();
  g.push(part(hull, C.navy, M(0, -0.08, 0)));
  g.push(part(box(2.0, 0.03, 0.34), C.red, M(-0.03, -0.05, 0)));
  g.push(part(box(1.9, 0.015, 0.34), C.deck, M(-0.05, 0.185, 0)));
  g.push(part(top([[0.42, -0.12], [0.1, -0.15], [-0.3, -0.15], [-0.3, 0.15], [0.1, 0.15], [0.42, 0.12]], 0.2, 0.01), C.navy, M(0, 0.19, 0)));
  g.push(part(top([[0.3, -0.1], [0.05, -0.12], [-0.14, -0.12], [-0.14, 0.12], [0.05, 0.12], [0.3, 0.1]], 0.14, 0.01), C.navy, M(0, 0.4, 0)));
  g.push(part(box(0.02, 0.035, 0.22), C.glassB, M(0.31, 0.5, 0, 0, 0, -0.3)));
  if (o.panels === 'spy') for (const [x, z, ry] of [[0.22, 0.12, 0.6], [0.22, -0.12, -0.6], [-0.1, 0.13, 2.5], [-0.1, -0.13, -2.5]]) g.push(part(cyl(0.07, 0.07, 0.012, 8), C.navy2, M(x, 0.45, z, H, ry, 0)));
  if (o.panels === 'dome') for (const x of [0.1, -0.2]) g.push(part(sph(0.07, 12, 8), C.white, M(x, 0.58, 0)));
  if (o.mast === 'lattice') { g.push(part(cyl(0.02, 0.06, 0.34, 4), C.navy, M(-0.05, 0.7, 0, 0, PI / 4, -0.12))); g.push(part(box(0.18, 0.025, 0.03), C.dark, M(-0.08, 0.82, 0))); }
  if (o.mast === 'tower') {
    g.push(part(top([[0.12, -0.1], [-0.12, -0.1], [-0.12, 0.1], [0.12, 0.1]], 0.36, 0.01), C.navy, M(0, 0.54, 0)));
    for (const [z, ry] of [[0.105, 0], [-0.105, PI]]) g.push(part(box(0.2, 0.22, 0.01), C.navy2, M(0, 0.72, z, 0, ry, 0)));
    g.push(part(box(0.01, 0.22, 0.18), C.navy2, M(0.125, 0.72, 0)));
  }
  if (o.mast === 'sphere') { g.push(part(cyl(0.02, 0.08, 0.42, 4), C.navy, M(0.02, 0.75, 0, 0, PI / 4, 0))); g.push(part(sph(0.07, 14, 10), C.white, M(0.02, 1.0, 0))); }
  for (let k = 0; k < o.stacks; k++) g.push(part(top([[0.06, -0.08], [-0.06, -0.08], [-0.06, 0.08], [0.06, 0.08]], 0.18), C.navy2, M(-0.4 - k * 0.17, 0.19, 0, 0, 0, o.stacks > 1 ? 0 : 0, o.panels === 'big' ? 1.5 : 1, 1, o.panels === 'big' ? 1.3 : 1)));
  g.push(part(top([[0.1, -0.06], [-0.08, -0.08], [-0.08, 0.08], [0.1, 0.06]], 0.07, 0.01), C.navy, M(0.78, 0.19, 0)));
  g.push(part(cyl(0.012, 0.014, 0.28, 8), C.gun, M(0.98, 0.235, 0, 0, 0, H)));
  const vls = o.vls ?? 2;
  for (let b = 0; b < vls; b++) for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) g.push(part(box(0.045, 0.012, 0.045), C.dark, M((b === 1 ? -0.72 : 0.5 - b * 0.16) + i * 0.05, 0.198, -0.05 + j * 0.05)));
  if (o.tubes) for (const z of [-0.2, 0.2]) for (let i = 0; i < 4; i++) g.push(part(cyl(0.035, 0.035, 0.32, 10), C.navy2, M(0.3 - i * 0.02, 0.28, z * (1 + i * 0.02), 0, 0, H + 0.3 * Math.sign(z) * 0 - 0.25)));
  g.push(part(box(0.24, 0.1, 0.24), C.navy, M(-0.75, 0.24, 0)));
  g.push(part(cyl(0.09, 0.09, 0.004, 20), C.white, M(-0.93, 0.194, 0)));
  g.push(part(box(0.2, 0.1, 0.005), 0xffffff, M(-0.05, o.mast === 'sphere' ? 1.12 : 0.93, 0.02), TINT));
  return mergeGeometries(g).scale(0.95 * L, 0.95 * Math.max(0.9, L), 0.95 * L);
}

// ---------------- 나라별 편제 ----------------
// camo: 위장색 체계 (base 주색, dark 보조색, pat 1=얼룩 2=디지털)
const SCHEMES = {
  kr: { base: 0x56613a, dark: 0x434b2c, pat: 1 }, us: { base: 0xa99468, dark: 0x8a7650, pat: 1 }, ru: { base: 0x4c5a36, dark: 0x3a4529, pat: 1 },
  cn: { base: 0x5a6443, dark: 0x464f33, pat: 2 }, jp: { base: 0x5b5a3b, dark: 0x4a3f2c, pat: 1 }, eu: { base: 0x4c563a, dark: 0x3b3326, pat: 1 },
  il: { base: 0x817d62, dark: 0x6c6951, pat: 0 }, desert: { base: 0xb09a6c, dark: 0x927e56, pat: 1 }, kp: { base: 0x4e5a3a, dark: 0x3f4a2f, pat: 0 },
  arctic: { base: 0x8a9096, dark: 0x6b7178, pat: 1 }, jungle: { base: 0x445536, dark: 0x2f3c26, pat: 1 },
};
const LOAD = {
  KR: ['k2', 'kf21', 'sejong', 'kr'], US: ['abrams', 'f35', 'burke', 'us'], CN: ['type99', 'j20', 'type055', 'cn'], RU: ['t90', 'su35', 'slava', 'ru'],
  JP: ['type10', 'f35', 'burke', 'jp'], KP: ['t62', 'mig29', 'frigate', 'kp'], TW: ['abrams', 'f16', 'frigate', 'kr'], IL: ['merkava', 'f35', 'frigate', 'il'],
  GB: ['leo2', 'euro', 'type45', 'eu'], FR: ['leo2', 'euro', 'frigate', 'eu'], DE: ['leo2', 'euro', 'frigate', 'eu'], IT: ['leo2', 'euro', 'frigate', 'eu'], ES: ['leo2', 'euro', 'frigate', 'eu'],
  AU: ['abrams', 'f35', 'frigate', 'desert'], SA: ['abrams', 'f16', 'frigate', 'desert'], AE: ['leo2', 'f16', 'frigate', 'desert'], EG: ['abrams', 'f16', 'frigate', 'desert'],
  IQ: ['abrams', 'f16', 'frigate', 'desert'], JO: ['t62', 'f16', 'frigate', 'desert'], KW: ['abrams', 'f16', 'frigate', 'desert'], QA: ['leo2', 'euro', 'frigate', 'desert'],
  TR: ['leo2', 'f16', 'frigate', 'eu'], PL: ['abrams', 'f35', 'frigate', 'eu'], IN: ['t90', 'su35', 'frigate', 'jungle'], PK: ['type99', 'f16', 'frigate', 'desert'],
  IR: ['t62', 'mig29', 'frigate', 'desert'], SY: ['t62', 'mig29', 'frigate', 'desert'], VN: ['t90', 'su35', 'frigate', 'jungle'], BY: ['t90', 'mig29', 'frigate', 'ru'],
  UA: ['t90', 'mig29', 'frigate', 'ru'], KZ: ['t90', 'mig29', 'frigate', 'ru'], DZ: ['t90', 'su35', 'frigate', 'desert'], MM: ['type99', 'mig29', 'frigate', 'jungle'],
  TH: ['type99', 'f16', 'frigate', 'jungle'], PH: ['leo2', 'f16', 'frigate', 'jungle'], ID: ['leo2', 'f16', 'frigate', 'jungle'], MY: ['leo2', 'mig29', 'frigate', 'jungle'],
  SG: ['leo2', 'f16', 'frigate', 'jungle'], CA: ['leo2', 'f35', 'frigate', 'arctic'], NO: ['leo2', 'f35', 'frigate', 'arctic'], SE: ['leo2', 'euro', 'frigate', 'arctic'],
  FI: ['leo2', 'f16', 'frigate', 'arctic'], MN: ['t62', 'mig29', 'frigate', 'ru'], CU: ['t62', 'mig29', 'frigate', 'jungle'], VE: ['t90', 'su35', 'frigate', 'jungle'],
  BR: ['leo2', 'euro', 'frigate', 'jungle'], MX: ['leo2', 'f16', 'frigate', 'desert'], AR: ['leo2', 'f16', 'frigate', 'eu'], CL: ['leo2', 'f16', 'frigate', 'eu'],
};
let NATION_POS = new Map();
export function setNationInfo(info) { NATION_POS = info; }
export function loadout(nid) {
  const l = LOAD[nid];
  if (l) return { tank: l[0], jet: l[1], ship: l[2], camo: l[3] };
  const pos = NATION_POS.get(nid) || { lon: 100, lat: 20 };
  const west = pos.lon < -30 || (pos.lon > -25 && pos.lon < 40 && pos.lat > 36); // 아메리카·유럽: 서방제, 그 외: 구소련제 수출형
  const hot = Math.abs(pos.lat) < 32 && !(pos.lon > 90 && pos.lon < 130);
  const camo = pos.lat > 55 ? 'arctic' : west ? (hot ? 'desert' : 'eu') : (hot ? (pos.lon > 20 && pos.lon < 75 ? 'desert' : 'jungle') : 'ru');
  return west ? { tank: 'leo2', jet: 'f16', ship: 'frigate', camo } : { tank: 't90', jet: 'mig29', ship: 'frigate', camo };
}

function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---------- 재질: 국가색(tint)과 위장무늬(camo) ----------
function patch(mat) {
  mat.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float tint;\nattribute float camo;\nvarying float vCamo;\nvarying vec3 vObj;')
      .replace('#include <color_vertex>', `
        #if defined( USE_COLOR )
          vColor = vec3(1.0) * color.xyz;
        #endif
        #ifdef USE_INSTANCING_COLOR
          vColor.xyz = mix(vColor.xyz, instanceColor.xyz, tint);
        #endif
        vCamo = camo; vObj = position;`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vCamo; varying vec3 vObj;
        float h3(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
        float vn(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(mix(h3(i), h3(i+vec3(1,0,0)), f.x), mix(h3(i+vec3(0,1,0)), h3(i+vec3(1,1,0)), f.x), f.y),
                     mix(mix(h3(i+vec3(0,0,1)), h3(i+vec3(1,0,1)), f.x), mix(h3(i+vec3(0,1,1)), h3(i+vec3(1,1,1)), f.x), f.y), f.z); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        if (vCamo > 0.5) { // 위장무늬 (1: 얼룩, 2: 디지털 픽셀)
          vec3 q = vCamo > 1.5 ? floor(vObj * 38.0) / 4.0 : vObj * 9.0;
          float n = vn(q) * 0.65 + vn(q * 2.3) * 0.35;
          vec3 base = diffuseColor.rgb;
          diffuseColor.rgb = n < 0.42 ? base : (n < 0.6 ? base * vec3(0.62, 0.6, 0.5) : base * vec3(1.25, 1.12, 0.82));
        }`);
  };
  mat.customProgramCacheKey = () => 'unit-camo';
  return mat;
}
export const unitMaterial = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.28 }));

const cache = new Map();
// 유닛 종류 + 나라 → 실제 모델 이름과 위장색
function variantOf(type, nid) {
  const L = loadout(nid);
  const model = type === 'tank' ? L.tank : type === 'jet' ? L.jet : type === 'ship' ? L.ship : type;
  return { model, camo: ['inf', 'tank', 'arty'].includes(type) ? L.camo : '-' };
}
export function baseGeometry(type, nid) {
  const { model, camo } = variantOf(type, nid);
  const key = model + '|' + camo;
  if (!cache.has(key)) {
    const S = SCHEMES[camo] || SCHEMES.kr;
    const g = builders[model](S);
    if (S.pat !== 1) { const c = g.attributes.camo; for (let i = 0; i < c.count; i++) if (c.getX(i) > 0.5) c.setX(i, S.pat === 2 ? 2 : 0); }
    cache.set(key, g);
  }
  return cache.get(key);
}
// 국가색을 구워 넣은 지오메트리 (개별 유닛용)
export function geometry(type, nationColor, nid) {
  const { model, camo } = variantOf(type, nid);
  const key = model + '|' + camo + '|' + nationColor;
  if (!cache.has(key)) {
    const g = baseGeometry(type, nid).clone();
    const col = new THREE.Color(nationColor), c = g.attributes.color, t = g.attributes.tint;
    for (let i = 0; i < t.count; i++) if (t.getX(i) > 0.5) { c.setXYZ(i, col.r, col.g, col.b); t.setX(i, 0); }
    cache.set(key, g);
  }
  return cache.get(key);
}
// 쉬는 틈에 미리 만들어 두기 (처음 등장할 때 끊기지 않게)
export function prewarm(nids, color = '#888888') {
  const jobs = [];
  for (const nid of nids) for (const type of ['inf', 'tank', 'arty', 'jet', 'ship']) jobs.push([type, nid]);
  const idle = window.requestIdleCallback || ((f) => setTimeout(() => f({ timeRemaining: () => 8 }), 30));
  const run = (dl) => { while (jobs.length && dl.timeRemaining() > 3) { const [t, n] = jobs.shift(); baseGeometry(t, n); } if (jobs.length) idle(run); };
  idle(run);
}
export function variantKey(type, nid) { const v = variantOf(type, nid); return v.model + '|' + v.camo; }

export function makeUnit(type, nationColor, nid) {
  const m = new THREE.Mesh(geometry(type, nationColor, nid), unitMaterial);
  m.castShadow = true;
  return m;
}

// 대량 배치용 (인스턴스마다 국가색)
export function makeInstanced(type, max, nid) {
  const m = new THREE.InstancedMesh(baseGeometry(type, nid), unitMaterial, max);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
  m.count = 0; m.castShadow = true; m.frustumCulled = false;
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
