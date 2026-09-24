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
  inf() {
    const g = [];
    const uni = C.olive, vest = C.olive2;
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
    g.push(part(box(0.1, 0.2, 0.18), C.olive2, M(-0.13, 0.62, 0)));                                      // 배낭
    g.push(part(cyl(0.03, 0.03, 0.18, 8), C.olive, M(-0.13, 0.75, 0, H)));                                // 침낭
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
    g.push(part(sph(0.075, 14, 8, 0, PI * 2, 0, H * 1.08), C.olive, M(0, 0.815, 0, 0, 0, 0.08, 1.05, 0.9, 1.0)));
    g.push(part(cyl(0.078, 0.08, 0.012, 14), C.olive, M(0.003, 0.81, 0)));                                // 헬멧 테
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

  // 전차: K2 흑표 풍 (길이 약 1.3)
  tank() {
    const g = [];
    const body = C.olive;
    // 하부 차체 (앞 경사 장갑)
    g.push(part(side([[-0.62, 0.1], [0.5, 0.1], [0.66, 0.2], [0.66, 0.25], [-0.64, 0.25]], 0.46), C.olive2, null, CAMO));
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
  arty() {
    const g = [];
    const body = C.olive;
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

  // 전투기: KF-21 보라매 풍 (길이 약 1.6)
  jet() {
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

  // 구축함: 세종대왕급 풍 (길이 약 2.2)
  ship() {
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
        if (vCamo > 0.5) { // 3색 위장무늬
          float n = vn(vObj * 9.0) * 0.65 + vn(vObj * 21.0) * 0.35;
          vec3 base = diffuseColor.rgb;
          diffuseColor.rgb = n < 0.42 ? base : (n < 0.6 ? base * vec3(0.62, 0.6, 0.5) : base * vec3(1.25, 1.12, 0.82));
        }`);
  };
  mat.customProgramCacheKey = () => 'unit-camo';
  return mat;
}
export const unitMaterial = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.28 }));

const cache = new Map();
export function baseGeometry(type) {
  if (!cache.has(type)) cache.set(type, builders[type]());
  return cache.get(type);
}
// 국가색을 구워 넣은 지오메트리 (개별 유닛용)
export function geometry(type, nationColor) {
  const key = type + '|' + nationColor;
  if (!cache.has(key)) {
    const g = baseGeometry(type).clone();
    const col = new THREE.Color(nationColor), c = g.attributes.color, t = g.attributes.tint;
    for (let i = 0; i < t.count; i++) if (t.getX(i) > 0.5) c.setXYZ(i, col.r, col.g, col.b);
    const t2 = g.attributes.tint; for (let i = 0; i < t2.count; i++) t2.setX(i, 0);
    cache.set(key, g);
  }
  return cache.get(key);
}

export function makeUnit(type, nationColor) {
  const m = new THREE.Mesh(geometry(type, nationColor), unitMaterial);
  m.castShadow = true;
  return m;
}

// 대량 배치용 (인스턴스마다 국가색)
export function makeInstanced(type, max) {
  const m = new THREE.InstancedMesh(baseGeometry(type), unitMaterial, max);
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
