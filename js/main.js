import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { Game, UNITS } from './game.js';
import { WorldMap, LAND_H } from './map.js';
import { makeUnit, makeFlag, flagTime, setNationInfo, prewarm, makeInstanced } from './models.js';
import { FX } from './fx.js';
import { makeArrow, computeFront, FrontLine } from './warfx.js';
import { WarMap, precomputeBorders } from './warmap.js';
import { Minimap } from './minimap.js';
import { Garrisons } from './garrison.js';
import { UI } from './ui.js';
import { Sound } from './audio.js';

const U = 0.42; // 유닛 크기 배율(지도 단위)
const world = await fetch('data/world.json').then((r) => r.json());

// ---------- 렌더러·장면 ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.getElementById('view').appendChild(renderer.domElement);
const labels = new CSS2DRenderer();
labels.setSize(innerWidth, innerHeight);
labels.domElement.className = 'labels';
document.getElementById('view').appendChild(labels.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x061019);
scene.fog = new THREE.Fog(0x061019, 160, 460);
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 1200);

const controls = new MapControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.minDistance = 3; controls.maxDistance = 280;
controls.maxPolarAngle = 1.2; controls.zoomToCursor = true;
controls.screenSpacePanning = false;
controls.autoRotate = true; controls.autoRotateSpeed = 0.35; // 시작 화면에선 지도가 천천히 회전

scene.add(new THREE.HemisphereLight(0xd6e8ff, 0x273322, 1.25));
const sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 120 });
sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);

const map = new WorldMap(scene, world);
const fx = new FX(scene);
const ui = new UI(world);
const sound = new Sound();
ui.sound = sound;
// 브라우저 정책상 첫 터치/클릭 때 소리를 켠다
// iOS는 touchend/click에서만 소리를 켤 수 있어 여러 이벤트에 걸어 둠
for (const ev of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) addEventListener(ev, () => sound.unlock(), true);
document.addEventListener('visibilitychange', () => { if (!document.hidden) sound.unlock(); });
addEventListener('click', (e) => { if (e.target.closest?.('button')) sound.click(); }, true);

// 화면 위치 기준 소리 크기·좌우
const tmpS = new THREE.Vector3();
function sfxAt(x, z, always = false) {
  const camD = camera.position.distanceTo(controls.target);
  const d = Math.hypot(x - controls.target.x, z - controls.target.z);
  const range = Math.max(14, camD * 0.9);
  let vol = Math.pow(Math.max(0, 1 - d / range), 1.5) * THREE.MathUtils.clamp(35 / camD, 0.3, 1);
  if (always) vol = Math.max(vol, 0.45);
  tmpS.set(x, 0.2, z).project(camera);
  return [vol, THREE.MathUtils.clamp(tmpS.x, -1, 1) * 0.8];
}
// 화면 흔들림
let shake = 0;
function shakeAt(x, z, amt) { const [v] = sfxAt(x, z); shake = Math.min(1.2, shake + amt * v); }

setNationInfo(new Map(world.countries.map((c) => [c.a2, { lon: c.lon, lat: c.lat }])));
const KR = world.countries.find((c) => c.a2 === 'KR');
// 시작 화면 배경: 나라 색으로 미리 칠해 둠
{ const pv = new Game(world, { player: 'KR', aggr: 1, balance: {} }); for (const t of pv.territories) map.setColor(t.idx, new THREE.Color(pv.nations.get(t.owner).color).lerp(new THREE.Color(0x8c8a70), 0.22)); }
setView(KR.cx, KR.cy, 150, false);

// 화면 크기 변경·폰 회전 대응 (iOS는 회전 직후 크기가 늦게 바뀌어 여러 번 다시 잰다)
let lastW = 0, lastH = 0;
function resize() {
  const w = document.documentElement.clientWidth || innerWidth, h = document.documentElement.clientHeight || innerHeight;
  if (w === lastW && h === lastH) return;
  lastW = w; lastH = h;
  camera.aspect = w / h;
  // 세로로 긴 화면은 세로 시야각을 넓혀 가로로 보이는 범위를 유지
  const hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(20)) * (16 / 9));
  camera.fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hfov / 2) / camera.aspect)), 40, 72);
  camera.updateProjectionMatrix();
  // UI 배율: 화면 크기에 맞춰 패널·버튼·글자 전체를 키우거나 줄임
  const phoneP = w <= 760 || (h > w && w <= 1100), phoneL = h <= 520 && w > 560;
  const ui = phoneP ? THREE.MathUtils.clamp(w / 400, 0.82, w > 760 ? 1.5 : 1.2)
    : phoneL ? THREE.MathUtils.clamp(h / 400, 0.8, 1.1)
    : THREE.MathUtils.clamp(Math.min(w / 1250, h / 860), 0.62, 1.5);
  document.documentElement.style.setProperty('--ui', (ui * (window.__uiMult || 1)).toFixed(3));
  renderer.setSize(w, h); labels.setSize(w, h);
}
resize();
addEventListener('resize', resize);
visualViewport?.addEventListener('resize', resize);
addEventListener('orientationchange', () => { for (const t of [50, 200, 500, 1000]) setTimeout(resize, t); });
// iOS 사파리의 페이지 확대(핀치·더블탭) 막기 — 지도 확대와 충돌
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });

// 카메라 이동 (부드럽게)
let fly = null;
function setView(x, z, d, animate = true) {
  const to = new THREE.Vector3(x, 0, z);
  const off = new THREE.Vector3(0, d * 0.72, d * 0.7);
  if (!animate) { controls.target.copy(to); camera.position.copy(to).add(off); controls.update(); return; }
  fly = { t: 0, fromT: controls.target.clone(), fromP: camera.position.clone(), toT: to, toP: to.clone().add(off) };
}

// ---------- 게임 ----------
let game = null, speed = 1, acc = 0, warMap = null, garrisons = null, minimap = null;
const strikes = []; // 전투기 폭격 연출
const nationVis = new Map();   // 나라별 수도 도시·국기·주둔군·라벨
const expVis = new Map();      // 원정군 3D 그룹
const occFlags = new Map();    // 점령지에 꽂힌 국기

const landColor = (n) => new THREE.Color(n.color).lerp(new THREE.Color(0x8c8a70), 0.22);
const tY = (idx) => map.heightOf(idx);
const citySize = (t) => THREE.MathUtils.clamp(Math.sqrt(world.countries[t.country].area) / 900, 0.22, 0.9);

// ---------- 저장 · 설정 ----------
const SAVE_KEY = 'sgj-save-v1', SET_KEY = 'sgj-settings-v1';
const readSave = () => { try { return JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { return null; } };
function saveGame() {
  if (!game || game.over) return false;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(game.serialize())); return true; } catch { return false; }
}
setInterval(() => { if (game && !game.over && speed > 0) saveGame(); }, 30000); // 자동 저장
let settings = { quality: 'mid', ui: 1 };
try { settings = { ...settings, ...JSON.parse(localStorage.getItem(SET_KEY) || '{}') }; } catch {}
function applySettings(ns) {
  settings = { ...settings, ...ns };
  try { localStorage.setItem(SET_KEY, JSON.stringify(settings)); } catch {}
  const q = settings.quality;
  renderer.setPixelRatio(q === 'low' ? 1 : Math.min(q === 'high' ? 2 : 1.5, devicePixelRatio));
  // 그림자를 켜고 끄면 모든 재질을 다시 컴파일해야 해서 멈춤 → 대신 해상도와 갱신 빈도만 조절
  const sz = q === 'high' ? 2048 : q === 'low' ? 512 : 1024;
  if (sun.shadow.mapSize.x !== sz) { sun.shadow.mapSize.set(sz, sz); sun.shadow.map?.dispose(); sun.shadow.map = null; }
  window.__uiMult = +settings.ui || 1;
  lastW = 0; // UI 배율 다시 계산
}
applySettings({});

// 메인 메뉴 → 새 게임(나라 선택) 또는 이어하기
ui.showMenu({
  save: readSave(),
  onNew: () => ui.showStart(startGame),
  onContinue: () => { const s = readSave(); if (s) startGame(s.opts, s); },
  getSettings: () => settings,
  applySettings,
});
if (location.hash === '#new') { history.replaceState(null, '', location.pathname); ui.showStart(startGame); }

function startGame(opts, saved) {
  controls.autoRotate = false;
  game = new Game(world, opts);
  if (saved) game.restore(saved);
  for (const t of game.territories) map.setColor(t.idx, landColor(game.nations.get(t.owner)));
  for (const n of game.nations.values()) if (n.alive) buildNationVis(n);
  for (const t of game.territories) if (t.owner !== t.home) placeOccFlag(t, game.nations.get(t.owner));
  prewarm([...game.nations.keys()]);
  warMap = new WarMap(scene, world, game, { tY, makeUnit, U, fx, sound, sfxAt });
  garrisons = new Garrisons(scene, world, game, { tY, U, citySize, sharedSegs: (i, j) => warMap.sharedSegs(i, j) });
  game.on('war', () => { warMap.dirty = true; garrisons.dirty = true; });
  game.on('peace', () => { warMap.dirty = true; garrisons.dirty = true; });
  game.on('capture', ({ from, to }) => { warMap.dirty = true; garrisons.dirty = true; warMap.markNames(from.id, to.id); });
  game.on('eliminated', (n) => { warMap.dirty = true; garrisons.dirty = true; warMap.markNames(n.id); });
  game.on('capital', (n) => warMap.markNames(n.id));
  game.on('log', (l) => { ui.log(l); if (l.kind === 'danger' && /진격|상륙|공습|발사/.test(l.msg)) sound.alarm(); });
  game.on('launch', (e) => {
    buildExp(e);
    const mine = e.owner === ui.me.id || e.defender === ui.me.id;
    const [v, p] = sfxAt(e.from.x, e.from.y, e.owner === ui.me.id);
    const vol = mine ? Math.max(v, 0.35) : v;
    ({ land: () => sound.march(vol, p), sea: () => sound.horn(vol, p), air: () => sound.jet(vol, p), missile: () => sound.missile(vol, p) })[e.kind]();
  });
  game.on('end', (e) => removeExp(e));
  game.on('capture', onCapture);
  game.on('capital', (n) => moveNationVis(n));
  game.on('eliminated', (n) => removeNationVis(n));
  game.on('impact', ({ e, x, y, n }) => {
    const mine = e.owner === ui.me.id || e.defender === ui.me.id;
    for (let i = 0; i < Math.min(5, n); i++) setTimeout(() => {
      fx.explosion(x + (Math.random() - 0.5) * 1.2, tY(e.target), y + (Math.random() - 0.5) * 1.2, 1.5);
      const [v, p] = sfxAt(x, y, mine); sound.explosion(v, p, 1.3); shakeAt(x, y, 0.6);
    }, i * 140);
    fx.burn(x, tY(e.target), y, 10, 1.2);
  });
  game.on('over', (o) => { ui.over({ ...o, stats: game.stats, day: game.day }); speed = 0; sound.gameOver(o.win); try { localStorage.removeItem(SAVE_KEY); } catch {} });
  minimap = new Minimap(document.getElementById('minimap'), world, game, (x, z) => setView(x, z, 30));
  game.on('capture', () => { minimap.dirty = true; });
  ui.bind(game, {
    setSpeed: (s) => { speed = s; ui.setSpeed(s); },
    flyHome: () => { const c = game.territories[ui.me.capital]; setView(c.cx, c.cy, 30); },
    select: (i) => select(i),
    flyTo: (at) => setView(at.x, at.z, 16),
    battleCam: () => battleCam(),
    setAuto: (on) => { game.opts.autoPlayer = on; },
    save: () => saveGame(),
    pause: (on) => { if (on) { speedBeforePause = speed || speedBeforePause; speed = 0; } else speed = speedBeforePause || 1; ui.setSpeed(speed); },
    getSettings: () => settings,
    applySettings,
    quit: () => { saveGame(); location.reload(); },
    newGame: () => { location.hash = 'new'; location.reload(); },
  });
  ui.setSpeed(1);
  ui.setThumbs(renderThumbs(game.nations.get(opts.player)));
  const me = game.nations.get(opts.player);
  const c = game.territories[me.capital];
  setView(c.cx, c.cy, 32);
  ui.log(saved ? { msg: `💾 저장된 게임을 불러왔습니다 (${me.flag} ${me.name})`, kind: 'mine', day: game.day }
    : { msg: `${me.flag} ${me.name} 지도자님, 세계 GDP 60%를 장악하면 승리합니다. 40일간 평화가 유지됩니다.`, kind: 'mine', day: 0 });
}
let speedBeforePause = 1;

function buildNationVis(n) {
  const t = game.territories[n.capital];
  const g = new THREE.Group();
  const s = citySize(t);
  const city = makeUnit('city', n.color, n.id); city.scale.setScalar(s); city.receiveShadow = true; g.add(city);
  const flag = makeFlag(n.color); flag.position.set(0, 1.0 * s, 0); flag.scale.setScalar(s * 1.2); g.add(flag);
  const gar = null; // 수도 경비 병력은 garrison.js가 한꺼번에 그림
  const div = document.createElement('div');
  div.className = 'nlabel' + (n.isPlayer ? ' me' : '');
  div.innerHTML = `<span class="fl">${n.flag}</span><span class="nm">${n.name}</span><span class="pw"></span>`;
  div.style.setProperty('--c', n.color);
  div.onclick = () => select(n.capital);
  const lab = new CSS2DObject(div); lab.position.set(0, 1.5 * s + 0.3, 0); g.add(lab);
  g.position.set(t.cx, tY(t.idx), t.cy);
  scene.add(g);
  nationVis.set(n.id, { g, gar, lab, div, pw: div.querySelector('.pw'), s });
}
function moveNationVis(n) { const v = nationVis.get(n.id); const t = game.territories[n.capital]; if (v) v.g.position.set(t.cx, tY(t.idx), t.cy); }
function removeNationVis(n) { const v = nationVis.get(n.id); if (!v) return; v.lab.element.remove(); scene.remove(v.g); nationVis.delete(n.id); }

function onCapture({ t, from, to }) {
  // 점령 진행 중이던 땅은 이미 공격국 색이므로 바로 확정, 아니면 깜빡이며 전환
  map.setColor(t.idx, landColor(to), !map.hasOcc(t.idx));
  map.clearOcc(t.idx);
  const mine = to.id === ui.me.id || from.id === ui.me.id;
  for (let i = 0; i < 4; i++) setTimeout(() => {
    fx.explosion(t.cx + (Math.random() - 0.5) * 1.5, tY(t.idx), t.cy + (Math.random() - 0.5) * 1.5, 1.1);
    const [v, p] = sfxAt(t.cx, t.cy, mine); sound.explosion(v, p, 1); shakeAt(t.cx, t.cy, 0.35);
  }, i * 150);
  fx.burn(t.cx, tY(t.idx), t.cy, 12, 1);
  // 우리가 점령하면 웅장한 팡파르 (수도 함락·멸망시키면 더 크게)
  if (to.id === ui.me.id) sound.conquest(t.cap || game.owned(from.id).length === 0 ? 2 : 1);
  else if (from.id === ui.me.id) sound.defeat();
  placeOccFlag(t, to);
  if (ui.sel === t.idx) ui.renderInfo(true);
}
// 점령지에 정복국 국기
function placeOccFlag(t, to) {
  const old = occFlags.get(t.idx);
  if (old) { scene.remove(old); occFlags.delete(t.idx); }
  if (to.id !== t.home) {
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.9, 6), new THREE.MeshStandardMaterial({ color: 0xdddddd }));
    pole.position.y = 0.45; g.add(pole);
    const f = makeFlag(to.color); f.position.y = 0.75; f.scale.setScalar(0.9); g.add(f);
    const nv = nationVis.get(t.home);
    g.position.set(t.cx + (nv ? -0.35 : 0), tY(t.idx), t.cy);
    scene.add(g); occFlags.set(t.idx, g);
  }
  if (ui.sel === t.idx) ui.renderInfo(true);
}

// ---------- 원정군 ----------
function buildExp(e) {
  const n = game.nations.get(e.owner);
  const g = new THREE.Group();
  const members = [];
  const add = (type, count, spacing) => {
    for (let i = 0; i < count; i++) {
      const m = makeUnit(type, n.color, n.id); m.scale.setScalar(U * (type === 'ship' ? 1.1 : 1));
      const lat = count > 1 ? (i / (count - 1) - 0.5) : 0; // -0.5~0.5: 횡대 위치
      m.userData = { type, lat, back: (type === 'inf' ? 0.55 : 0) + (i % 2) * spacing * 0.5 + Math.random() * 0.25, ph: Math.random() * 6, slot: i / Math.max(1, count - 1) };
      g.add(m); members.push(m);
    }
  };
  const u = e.units;
  if (e.kind === 'land') { add('tank', Math.min(6, Math.max(u.tank > 0 ? 1 : 0, Math.ceil(u.tank / 5))), 0.6); add('inf', Math.min(10, Math.max(1, Math.ceil(u.inf / 10))), 0.3); }
  if (e.kind === 'sea') add('ship', Math.min(4, Math.max(1, Math.ceil(u.ship / 3))), 1.1);
  if (e.kind === 'air') add('jet', Math.min(5, Math.max(1, Math.ceil(u.jet / 3))), 0.8);
  if (e.kind === 'missile') add('missile', Math.min(4, Math.max(1, Math.round(u.missile))), 0.5);
  const div = document.createElement('div'); div.className = 'elabel' + (n.isPlayer ? ' me' : '');
  div.style.setProperty('--c', n.color);
  const lab = new CSS2DObject(div); lab.position.set(0, 1.2, 0); g.add(lab);
  scene.add(g);
  const dx = e.to.x - e.from.x, dz = e.to.y - e.from.y, L = Math.hypot(dx, dz) || 1;
  // 진격 화살표 (우리나라를 노리는 공격은 붉게 깜빡이는 테두리)
  const pw = game.power(u);
  const width = e.kind === 'missile' ? 0.14 : e.kind === 'air' ? 0.25 : 0.3 + Math.log10(pw + 1) * 0.22;
  const arrow = makeArrow({ x: e.from.x, z: e.from.y }, { x: e.to.x, z: e.to.y }, n.color, width, LAND_H + 0.09, e.defender === ui.me.id);
  scene.add(arrow);
  expVis.set(e.id, { g, members, e, div, lab, dir: [dx / L, dz / L], fire: 0, arrow, spread: e.kind === 'land' ? 1.2 + Math.min(2.2, members.length * 0.18) : 1.4 });
  if (e.kind === 'missile') members.forEach((m, i) => { m.userData.delay = i * 0.12; });
}
function clearFront(v) {
  if (v.fl) { v.fl.dispose(); v.fl = null; map.fadeOcc(v.e.target); }
  clearModels(v);
}
function clearModels(v) {
  if (v.defs) { scene.remove(v.defs); v.defs = null; }
  if (v.landers) { v.landers.forEach((m) => v.g.remove(m)); v.landers = null; }
  if (v.arty) { v.arty.forEach((m) => v.g.remove(m)); v.arty = null; }
}
function removeExp(e) {
  const v = expVis.get(e.id); if (!v) return;
  v.lab.element.remove(); scene.remove(v.g); clearFront(v);
  // 화살표는 서서히 사라지게
  v.arrow.userData.fade = true; fadingArrows.push(v.arrow);
  expVis.delete(e.id);
}
const fadingArrows = [];
window.__sgj = { expVis, get game() { return game; }, get warMap() { return warMap; }, get garrisons() { return garrisons; }, get minimap() { return minimap; }, map, sound, renderer, scene, camera, fx, nationVis }; // 디버그용
function updateArrows(dt) {
  for (let i = fadingArrows.length - 1; i >= 0; i--) {
    const a = fadingArrows[i], u = a.material.uniforms;
    u.uTime.value += dt; u.uAlpha.value -= dt * 0.8;
    if (u.uAlpha.value <= 0) { scene.remove(a); a.geometry.dispose(); a.material.dispose(); fadingArrows.splice(i, 1); }
  }
}

// 전투가 시작되면 실제 국경을 따라 전선을 긋고 양측 병력을 전선에 흩어 배치
// (전선과 점령 진행은 모든 전투에, 3D 병력은 카메라 근처 전투에만)
function setupFront(v) {
  const e = v.e;
  const front = computeFront(world, e.src, e.target, e.kind, { x: e.from.x, z: e.from.y });
  v.fl = new FrontLine(scene, front, tY(e.target) + 0.06);
  v.def0 = Math.max(0.01, e.def);
  map.setOcc(e.target, front.pts, landColor(game.nations.get(e.owner)));
}
function setupFrontModels(v) {
  const e = v.e;
  const D = game.nations.get(e.defender);
  v.defs = new THREE.Group();
  const nd = Math.min(9, Math.max(2, Math.ceil(v.def0 / 18)));
  const tankShare = D.units.tank * 4 / Math.max(1, D.units.tank * 4 + D.units.inf);
  for (let i = 0; i < nd; i++) {
    const m = makeUnit(Math.random() < tankShare ? 'tank' : 'inf', D.color, D.id); m.scale.setScalar(U);
    m.userData = { slot: (i + 0.5) / nd, ph: Math.random() * 6 };
    v.defs.add(m);
  }
  scene.add(v.defs);
  const A0 = game.nations.get(e.owner);
  v.arty = [0.25, 0.75].map((slot) => { const m = makeUnit('arty', A0.color, A0.id); m.scale.setScalar(U); m.userData = { slot }; v.g.add(m); return m; });
  if (e.kind === 'sea') { // 상륙군
    const A = game.nations.get(e.owner);
    v.landers = [];
    const nl = Math.min(8, Math.max(2, Math.ceil(game.power(e.units, (u) => u.cls === 'ground') / 12)));
    for (let i = 0; i < nl; i++) { const m = makeUnit(i % 3 === 0 ? 'tank' : 'inf', A.color, A.id); m.scale.setScalar(U); m.userData = { slot: (i + 0.5) / nl, ph: Math.random() * 6, type: 'lander' }; v.g.add(m); v.landers.push(m); }
  }
}

const tmpA = new THREE.Vector3();
function updateExp(v, dt, time) {
  const e = v.e; const [dx, dz] = v.dir;
  const back = e.state === 'return';
  const camD = camera.position.distanceTo(controls.target);
  // 화살표
  const au = v.arrow.material.uniforms; au.uTime.value += dt;
  const aTarget = back ? 0 : (e.owner === ui.me.id || e.defender === ui.me.id ? 0.95 : 0.7);
  au.uAlpha.value += (aTarget - au.uAlpha.value) * Math.min(1, dt * 3);
  let p = Math.min(e.p, 1);
  const cx = e.from.x + (e.to.x - e.from.x) * p, cz = e.from.y + (e.to.y - e.from.y) * p;
  const near = Math.hypot(cx - controls.target.x, cz - controls.target.z) < Math.max(25, camD * 1.3);
  const heading = Math.atan2(-(back ? -dz : dz), back ? -dx : dx);
  const perp = [-dz, dx];
  const pw = game.power(e.units);
  v.div.textContent = `${UNITS[{ land: 'tank', sea: 'ship', air: 'jet', missile: 'missile' }[e.kind]].icon} ${Math.round(pw)}`;
  v.lab.visible = e.kind !== 'missile';
  v.g.visible = near || e.kind === 'missile';
  const alive = Math.max(1, Math.ceil(v.members.length * Math.min(1, pw / (v.pw0 ||= pw || 1)) + 0.001));
  const battle = e.state === 'battle' && (e.kind === 'land' || e.kind === 'sea');
  if (battle && !v.fl) setupFront(v);
  if (!battle && v.fl) clearFront(v);
  if (v.fl && near && !v.defs) setupFrontModels(v);
  if (v.fl && !near && v.defs) clearModels(v);
  if (v.fl) { // 점령 진행: 방어력이 깎인 만큼 전선에서부터 땅이 넘어감
    const prog = THREE.MathUtils.clamp(1 - e.def / v.def0, 0, 1);
    const target = v.fl.front.reach * Math.pow(prog, 0.85);
    v.fl.adv += (target - v.fl.adv) * Math.min(1, dt * 2.5);
    map.setOccAdv(e.target, v.fl.adv);
  }
  const push = v.fl ? THREE.MathUtils.clamp(1 - e.def / v.def0, 0, 1) * 0.9 : 0;
  const pts = v.fl?.front.pts;
  const slotPt = (slot, side, extra = 0) => {
    const i = Math.min(pts.length - 1, Math.floor(slot * (pts.length - 1) + 0.5));
    const [x, z, nx, nz] = v.fl.place(i, push, side);
    return [x - nx * extra, z - nz * extra, nx, nz];
  };
  v.members.forEach((m, i) => {
    m.visible = i < alive;
    const { lat, back: bk, ph, type, slot } = m.userData;
    // 진격할수록 횡대로 넓게 퍼진다
    const spread = e.kind === 'land' ? v.spread * (0.35 + 0.65 * Math.min(1, p * 1.6)) : v.spread;
    const fwd = back ? bk : -bk;
    let x = cx + dx * fwd + perp[0] * lat * spread, z = cz + dz * fwd + perp[1] * lat * spread, y = 0.16;
    let rotY = heading, rotZ = 0, rotX = 0;
    if (v.fl && (type === 'tank' || type === 'inf')) { // 전선 배치: 공격군은 국경 바깥쪽에서 안쪽을 향함
      const [fx2, fz2, nx, nz] = slotPt(slot, -1, type === 'tank' ? 0.35 : 0);
      const surge = Math.sin(time * 1.1 + ph) * 0.12;
      x = fx2 + nx * surge; z = fz2 + nz * surge; rotY = Math.atan2(-nz, nx);
    }
    if (type === 'inf') y += Math.abs(Math.sin(time * 9 + ph)) * 0.04;
    if (type === 'tank') y += Math.sin(time * 20 + ph) * 0.004;
    if (type === 'ship') {
      if (v.fl) { const [fx2, fz2, nx, nz] = slotPt(slot, -1, 1.6); x = fx2; z = fz2; rotY = Math.atan2(-nz, nx) + Math.PI / 2; }
      y = -0.02 + Math.sin(time * 2 + ph) * 0.02; rotZ = Math.sin(time * 1.6 + ph) * 0.05;
      if (!v.fl && Math.random() < 0.5) fx.wake(x - dx * 0.4, z - dz * 0.4);
    }
    if (type === 'jet') {
      y = 2.2 + Math.sin(Math.PI * p) * 2.5 + Math.sin(time * 2 + ph) * 0.1;
      if (e.state === 'battle') { // 목표 상공 선회하며 폭격
        const a = time * 1.4 + i * 1.3; x = e.to.x + Math.cos(a) * 1.5; z = e.to.y + Math.sin(a) * 1.5; y = 2.0 + i * 0.2;
        rotY = -a - Math.PI / 2; rotX = 0.5;
      }
      if (Math.random() < 0.6) fx.trail(x - Math.cos(rotY) * 0.35, y, z + Math.sin(rotY) * 0.35);
    }
    if (type === 'missile') {
      const q = Math.max(0, Math.min(1, e.p - (m.userData.delay || 0) * 0.3));
      const H = THREE.MathUtils.clamp(e.len * 0.25, 3, 30);
      x = e.from.x + (e.to.x - e.from.x) * q + perp[0] * lat * (1 - q);
      z = e.from.y + (e.to.y - e.from.y) * q + perp[1] * lat * (1 - q);
      y = 0.3 + Math.sin(Math.PI * q) * H;
      rotZ = Math.atan(Math.cos(Math.PI * q) * Math.PI * H / e.len);
      fx.trail(x - Math.cos(heading) * 0.3, y, z + Math.sin(heading) * 0.3, true);
    }
    m.position.set(x, y, z);
    m.rotation.set(rotX, rotY, rotZ, 'YZX');
  });
  if (v.landers) v.landers.forEach((m, i) => {
    const [x, z, nx, nz] = slotPt(m.userData.slot, -1, 0.1);
    const s = Math.sin(time * 1.3 + m.userData.ph) * 0.1;
    m.position.set(x + nx * s, 0.16, z + nz * s); m.rotation.set(0, Math.atan2(-nz, nx), 0);
    m.visible = i < Math.ceil(v.landers.length * Math.min(1, game.power(e.units, (u) => u.cls === 'ground') / Math.max(1, v.g0 ||= game.power(e.units, (u) => u.cls === 'ground'))));
  });
  if (v.defs) {
    const nd = v.defs.children.length, vis = Math.ceil(nd * e.def / v.def0);
    v.defs.children.forEach((m, i) => {
      const [x, z, nx, nz] = slotPt(m.userData.slot, 1, 0);
      const s = Math.sin(time * 1.2 + m.userData.ph) * 0.1;
      m.position.set(x + nx * s, 0.16, z + nz * s); m.rotation.set(0, Math.atan2(nz, -nx), 0);
      m.visible = i < vis;
    });
  }
  if (v.fl) v.fl.update(dt, push);
  if (v.arty) v.arty.forEach((m) => { const [x, z, nx, nz] = slotPt(m.userData.slot, -1, e.kind === 'sea' ? 1.2 : 2.6); m.position.set(x, 0.16, z); m.rotation.set(0, Math.atan2(-nz, nx), 0); });
  const center = v.fl ? slotPt(0.5, 0) : [cx, cz];
  v.lab.position.set(center[0] - v.g.position.x, (e.kind === 'air' ? 4 : 1.4), center[1] - v.g.position.z);
  // 전투 연출: 양측 사격, 포격, 전선 폭발
  if (e.state === 'battle' && near) {
    v.fire -= dt;
    if (v.fire <= 0) {
      v.fire = 0.08 + Math.random() * 0.18;
      const ty = tY(e.target);
      const mine = e.owner === ui.me.id || e.defender === ui.me.id;
      const [vol, pan] = sfxAt(center[0], center[1], mine && camD < 60);
      const atk = [...v.members.slice(0, alive), ...(v.landers || [])].filter((m) => m.visible);
      const defs = v.defs ? v.defs.children.filter((m) => m.visible) : [];
      const m = atk[Math.floor(Math.random() * atk.length)];
      const d = defs[Math.floor(Math.random() * defs.length)];
      const tgt = d ? [d.position.x, d.position.y + 0.15, d.position.z] : [e.to.x + (Math.random() - 0.5) * 1.4, ty + 0.2, e.to.y + (Math.random() - 0.5) * 1.4];
      if (m) {
        tmpA.set(Math.cos(m.rotation.y) * 0.45, m.userData.type === 'jet' ? 0 : 0.2, -Math.sin(m.rotation.y) * 0.45).add(m.position);
        fx.muzzle(tmpA.x, tmpA.y, tmpA.z);
        for (let k = 0; k < 3; k++) fx.tracer(tmpA.x, tmpA.y, tmpA.z, tgt[0] + (Math.random() - 0.5) * 0.3, tgt[1], tgt[2] + (Math.random() - 0.5) * 0.3);
        const big = m.userData.type === 'tank' || m.userData.type === 'ship';
        if (big) sound.cannon(vol * 0.8, pan); else sound.gunfire(vol * 0.7, pan);
      }
      if (d && m) { // 방어군 응사
        const dm = [d.position.x - Math.cos(d.rotation.y) * -0.4, d.position.y + 0.2, d.position.z];
        fx.muzzle(dm[0], dm[1], dm[2]);
        for (let k = 0; k < 2; k++) fx.tracer(dm[0], dm[1], dm[2], m.position.x + (Math.random() - 0.5) * 0.3, m.position.y + 0.15, m.position.z + (Math.random() - 0.5) * 0.3);
        if (Math.random() < 0.5) sound.gunfire(vol * 0.5, pan);
      }
      if (Math.random() < 0.5) { // 포탄이 전선 양쪽에 떨어짐
        const sz = 0.4 + Math.random() * 0.55;
        let ex, ez;
        if (v.fl) { const [x, z] = slotPt(Math.random(), Math.random() < 0.65 ? 1.6 : -1.4); ex = x; ez = z; }
        else { ex = e.to.x + (Math.random() - 0.5) * 1.6; ez = e.to.y + (Math.random() - 0.5) * 1.6; }
        fx.explosion(ex, ty, ez, sz);
        sound.explosion(vol * 0.65, pan, sz); if (mine) shakeAt(ex, ez, 0.12);
      }
      if (v.fl && Math.random() < 0.12) { const [x, z] = slotPt(Math.random(), 0.3); fx.burn(x, ty, z, 5, 0.55); }
    }
    // 포병 사격: 후방에서 포탄이 날아가 적진에 떨어짐 (방어군도 반격)
    v.artT = (v.artT ?? 0.5) - dt;
    if (v.fl && v.artT <= 0) {
      v.artT = 0.9 + Math.random() * 1.6;
      const ty = tY(e.target);
      const own = Math.random() < 0.7;
      const gunM = own && v.arty ? v.arty[Math.floor(Math.random() * v.arty.length)] : null;
      const [sx, sz] = gunM ? [gunM.position.x + Math.cos(gunM.rotation.y) * 0.45, gunM.position.z - Math.sin(gunM.rotation.y) * 0.45] : slotPt(Math.random(), own ? -1 : 1, own ? 3.2 : -3.2);
      const [tx, tz] = slotPt(Math.random(), own ? 1.9 + Math.random() : -1.6 - Math.random());
      fx.muzzle(sx, ty + 0.2, sz);
      const [vv, pp] = sfxAt(sx, sz); sound.cannon(vv * 0.6, pp);
      fx.shell(sx, ty + 0.2, sz, tx, ty, tz, 1.1 + Math.random() * 0.4, (x, y, z) => {
        fx.explosion(x, y, z, 0.8); const [v2, p2] = sfxAt(x, z); sound.explosion(v2 * 0.8, p2, 0.9); shakeAt(x, z, 0.15);
      });
      const [v3, p3] = sfxAt(tx, tz); if (v3 > 0.5) setTimeout(() => sound.whistle(v3, p3), 250);
    }
    // 공군 지원: 공격국에 전투기가 있으면 주기적으로 폭격
    v.airT = (v.airT ?? 3 + Math.random() * 4) - dt;
    const A = game.nations.get(e.owner);
    if (v.fl && v.airT <= 0 && A.units.jet >= 1) { v.airT = 7 + Math.random() * 7; airStrike(v, A); }
  }
}

// ---------- 선택 ----------
const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2();
let down = null;
renderer.domElement.addEventListener('pointerdown', (ev) => { down = [ev.clientX, ev.clientY]; });
renderer.domElement.addEventListener('pointerup', (ev) => {
  if (!down || !game) return;
  if (Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) > 6) return;
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(map.meshes, false)[0];
  select(hit ? map.provAt(hit) : null);
});
function select(i) {
  ui.select(i);
  if (i == null) { map.outline(null); return; }
  const t = game.territories[i];
  map.outline(i, t.owner === ui.me.id ? 0x7fd0ff : 0xffd24a);
}
addEventListener('keydown', (e) => {
  if (!game || e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') { speed = speed ? 0 : 1; ui.setSpeed(speed); e.preventDefault(); }
  if (e.key === '1' || e.key === '2' || e.key === '3') { speed = [1, 2, 4][+e.key - 1]; ui.setSpeed(speed); }
  if (e.key === 'Escape') { if (ui.sel != null) select(null); else ui.togglePause(); }
});

// ---------- 루프 ----------
const clock = new THREE.Clock();
let uiT = 0, labT = 0, musT = 0, labFrame = 0, shadowTick = 0;
// 느린 기기 보호: 5초 평균이 25fps 아래면 그래픽 품질을 한 단계 낮춤 (한 번만)
let perfAcc = 0, perfN = 0, perfDone = false;
function watchPerf(rawDt) {
  if (perfDone || !game || document.hidden || rawDt > 0.5) return; // 탭 전환 직후의 긴 간격은 무시
  perfAcc += rawDt; perfN++;
  if (perfAcc < 5) return;
  const fps = perfN / perfAcc; perfAcc = 0; perfN = 0;
  if (fps < 25 && settings.quality !== 'low') {
    const next = settings.quality === 'high' ? 'mid' : 'low';
    applySettings({ quality: next });
    ui.log({ msg: `⚙️ 화면이 느려 그래픽 품질을 '${next === 'low' ? '낮음' : '보통'}'으로 낮췄습니다 (☰ 메뉴 → 설정에서 변경)`, kind: 'info', day: game.day });
    if (next === 'low') perfDone = true;
  }
}
function frame(forceDt) {
  const rawDt = clock.getDelta();
  const dt = forceDt ?? Math.min(0.05, rawDt);
  if (!forceDt) watchPerf(rawDt);
  resize();
  const time = clock.elapsedTime;
  if (game && speed > 0 && !game.over) {
    acc += dt * speed;
    while (acc >= 0.1) { game.step(0.1); acc -= 0.1; }
  }
  if (fly) {
    fly.t = Math.min(1, fly.t + dt / 1.2); const k = 1 - Math.pow(1 - fly.t, 3);
    controls.target.lerpVectors(fly.fromT, fly.toT, k); camera.position.lerpVectors(fly.fromP, fly.toP, k);
    if (fly.t >= 1) fly = null;
  }
  controls.target.x = THREE.MathUtils.clamp(controls.target.x, -200, 200);
  controls.target.z = THREE.MathUtils.clamp(controls.target.z, world.yN, world.yS);
  controls.update();
  const camD = camera.position.distanceTo(controls.target);
  // 멀리서 볼 땐 그림자가 거의 안 보이므로 20프레임에 한 번만 갱신
  const slowShadow = camD > 45 || settings.quality === 'low';
  renderer.shadowMap.autoUpdate = !slowShadow;
  if (slowShadow && (shadowTick = (shadowTick + 1) % (settings.quality === 'low' ? 45 : 20)) === 0) renderer.shadowMap.needsUpdate = true;
  // 그림자 영역을 화면 중심에 맞춤
  const sh = THREE.MathUtils.clamp(camD * 0.55, 8, 60);
  Object.assign(sun.shadow.camera, { left: -sh, right: sh, top: sh, bottom: -sh }); sun.shadow.camera.updateProjectionMatrix();
  sun.position.copy(controls.target).add(new THREE.Vector3(-25, 45, 20)); sun.target.position.copy(controls.target);
  map.update(dt); fx.update(dt); flagTime.value = time;
  if (game) {
    for (const v of expVis.values()) updateExp(v, dt, time);
    updateArrows(dt);
    warMap?.update(dt, camD, controls.target);
    garrisons?.update(dt, camD, controls.target);
    updateStrikes(dt);
    minimap?.update(dt, controls.target, camD, camera.aspect);
    uiT -= dt; if (uiT <= 0) { uiT = 0.25; ui.refresh(); }
    labT -= dt; if (labT <= 0) { labT = 0.3; updateLabels(camD); }
  }
  if (game) { musT -= dt; if (musT <= 0) { musT = 0.5; updateMusic(); } }
  let saved = null;
  if (shake > 0.01) {
    saved = camera.position.clone();
    const a = shake * shake * 0.35 * Math.min(1, camD / 20);
    camera.position.add(new THREE.Vector3((Math.random() - 0.5) * a, (Math.random() - 0.5) * a, (Math.random() - 0.5) * a));
    shake *= Math.pow(0.02, dt);
  }
  renderer.render(scene, camera);
  if ((labFrame = (labFrame + 1) % 2) === 0 || forceDt) labels.render(scene, camera); // 지도 라벨(HTML)은 2프레임에 한 번
  if (saved) camera.position.copy(saved);
}
renderer.setAnimationLoop(() => frame());
window.__sgj.fx = fx; window.__sgj.strikes = strikes;
window.__sgj.view = (x, z, d) => setView(x, z, d, false);
window.__sgj.frame = (n = 1, dt = 1 / 30) => { for (let i = 0; i < n; i++) frame(dt); };

function updateLabels(camD) {
  for (const [id, v] of nationVis) {
    const n = game.nations.get(id);
    const pw = game.armyPow(n) * n.tech;
    v.pw.textContent = pw >= 1000 ? (pw / 1000).toFixed(1) + 'k' : Math.round(pw);
    const big = n.gdp * n.bal.eco;
    const show = n.isPlayer || camD < 45 || (camD < 90 && big > 250) || (camD < 70 && big > 60);
    v.lab.visible = show;
    v.g.visible = camD < 90 || n.isPlayer; // 멀리서는 도시 모형·국기 생략 (라벨만)
  }
}

// 전투 강도에 따라 배경음악이 달라진다: 평시 → 긴장 → 전면전
function updateMusic() {
  let mine = 0, near = 0;
  for (const e of game.expeditions) {
    if (e.owner === ui.me.id || e.defender === ui.me.id) mine += e.state === 'battle' ? 1 : 0.5;
    if (e.state === 'battle' && sfxAt(e.to.x, e.to.y)[0] > 0.2) near++;
  }
  sound.setIntensity(game.over ? 0 : 0.32 + Math.min(3, mine) * 0.2 + Math.min(4, near) * 0.06);
}

// 전투기가 전선을 가로질러 날며 폭탄을 떨어뜨림
function airStrike(v, A) {
  const pts = v.fl.front.pts, e = v.e;
  const i = Math.floor(Math.random() * pts.length), p = pts[i];
  const px = -p.snz, pz = p.snx; // 전선 방향
  const cx = p.x + p.snx * 1.2, cz = p.z + p.snz * 1.2;
  const dir = Math.random() < 0.5 ? 1 : -1;
  const from = new THREE.Vector3(cx - px * 8 * dir - p.snx * 5, 2.4, cz - pz * 8 * dir - p.snz * 5);
  const to = new THREE.Vector3(cx + px * 8 * dir + p.snx * 3, 2.8, cz + pz * 8 * dir + p.snz * 3);
  const m = makeUnit('jet', A.color, A.id); m.scale.setScalar(U);
  scene.add(m);
  const [v0, p0] = sfxAt(cx, cz); sound.jet(Math.max(v0, 0.2), p0);
  strikes.push({ m, from, to, t: 0, dur: 3.2, drops: [0.42, 0.5, 0.58], y: tY(e.target) });
}
function updateStrikes(dt) {
  for (let i = strikes.length - 1; i >= 0; i--) {
    const s = strikes[i]; s.t += dt; const k = s.t / s.dur;
    s.m.position.lerpVectors(s.from, s.to, k);
    const d = s.to.clone().sub(s.from);
    s.m.rotation.set(Math.sin(k * 6) * 0.15, Math.atan2(-d.z, d.x), 0, 'YZX');
    if (Math.random() < 0.7) fx.trail(s.m.position.x, s.m.position.y, s.m.position.z);
    while (s.drops.length && k >= s.drops[0]) {
      s.drops.shift();
      const bx = s.m.position.x, bz = s.m.position.z;
      fx.shell(bx, s.m.position.y - 0.1, bz, bx + d.x * 0.03, s.y, bz + d.z * 0.03, 0.55, (x, y, z) => {
        fx.explosion(x, y, z, 1.1); fx.burn(x, y, z, 6, 0.7);
        const [vv, pp] = sfxAt(x, z); sound.explosion(vv, pp, 1.1); shakeAt(x, z, 0.3);
      });
    }
    if (k >= 1) { scene.remove(s.m); strikes.splice(i, 1); }
  }
}
// 🎥 전장 관전: 진행 중인 전투를 차례로 비춤 (우리나라 전투 우선)
let camIdx = 0;
function battleCam() {
  const list = [...expVis.values()].filter((v) => v.e.state === 'battle' || v.e.state === 'move')
    .sort((a, b) => ((b.e.owner === ui.me.id || b.e.defender === ui.me.id) - (a.e.owner === ui.me.id || a.e.defender === ui.me.id)) || ((b.e.state === 'battle') - (a.e.state === 'battle')));
  if (!list.length) {
    const c = warMap?.counters?.[Math.floor(Math.random() * (warMap.counters.length || 1))];
    if (c) { setView(c.p.x, c.p.z, 14); return ui.toast('전선을 비춥니다'); }
    return ui.toast('지금은 진행 중인 전투가 없습니다');
  }
  const v = list[camIdx++ % list.length];
  const e = v.e, A = game.nations.get(e.owner), D = game.nations.get(e.defender);
  const x = v.fl ? v.fl.front.anchor[0] : e.from.x + (e.to.x - e.from.x) * e.p;
  const z = v.fl ? v.fl.front.anchor[1] : e.from.y + (e.to.y - e.from.y) * e.p;
  setView(x, z, 12);
  ui.toast(`🎥 ${A.flag} ${A.name} → ${D.flag} ${D.name} (${list.length}곳 중 ${((camIdx - 1) % list.length) + 1})`);
}

// 생산 카드용 3D 썸네일: 작은 렌더러로 유닛을 비스듬히 찍어 이미지로
function renderThumbs(nation) {
  const color = nation.color;
  const out = {};
  const W = 384, H = 276; // 2배로 그려서 줄이면 계단 현상이 줄어듦
  const rt = new THREE.WebGLRenderTarget(W, H); rt.texture.colorSpace = THREE.SRGBColorSpace;
  const sc = new THREE.Scene();
  sc.add(new THREE.HemisphereLight(0xdfeaff, 0x3a3020, 1.6));
  const d = new THREE.DirectionalLight(0xfff2da, 2.6); d.position.set(3, 5, 4); sc.add(d);
  const cam = new THREE.PerspectiveCamera(30, W / H, 0.1, 50);
  const buf = new Uint8Array(W * H * 4);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const cx = cv.getContext('2d');
  const small = document.createElement('canvas'); small.width = 192; small.height = 138; const sx = small.getContext('2d');
  const prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
  try {
    const shots = { inf: ['inf', 1.5, 0.55], tank: ['tank', 2.4, 0.3], jet: ['jet', 3.0, 0.1], ship: ['ship', 3.2, 0.25], missile: ['missile', 1.7, 0.05] };
    renderer.setClearColor(0x000000, 0);
    for (const [k, [type, dist, h]] of Object.entries(shots)) {
      const m = makeUnit(type, color, nation.id);
      if (type === 'missile') m.rotation.z = 0.5;
      sc.add(m);
      const box = new THREE.Box3().setFromObject(m), c = box.getCenter(new THREE.Vector3());
      cam.position.set(c.x + dist * 0.75, c.y + dist * 0.45 + h, c.z + dist * 0.8); cam.lookAt(c);
      renderer.setRenderTarget(rt); renderer.clear(); renderer.render(sc, cam);
      renderer.readRenderTargetPixels(rt, 0, 0, W, H, buf);
      const img = cx.createImageData(W, H);
      for (let y = 0; y < H; y++) img.data.set(buf.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4); // 위아래 뒤집기
      cx.putImageData(img, 0, 0);
      sx.clearRect(0, 0, 192, 138); sx.drawImage(cv, 0, 0, 192, 138);
      out[k] = small.toDataURL('image/png');
      sc.remove(m);
    }
  } catch (err) { console.warn('썸네일 생성 실패', err); }
  renderer.setRenderTarget(null); renderer.setClearColor(prevClear, prevAlpha); rt.dispose();
  return out;
}

// 셰이더 미리 컴파일: 화살표·전선·유닛·국기 등을 처음 쓰는 순간 멈추지 않도록 메뉴 화면에서 미리 준비
async function warmupShaders() {
  const g = new THREE.Group(); g.position.set(0, -30, 0);
  const add = (o) => { g.add(o); return o; };
  add(makeArrow({ x: 0, z: 0 }, { x: 5, z: 0 }, '#ffffff', 0.4, 0.2, true));
  for (const t of ['inf', 'tank', 'arty', 'jet', 'ship', 'missile', 'city']) add(makeUnit(t, '#888888', 'KR'));
  add(makeFlag('#888888'));
  for (const lod of [false, true]) { const im = makeInstanced('tank', 1, 'KR', lod); im.count = 1; im.setMatrixAt(0, new THREE.Matrix4()); add(im); }
  const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); tex.needsUpdate = true;
  add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })));
  const pts = [0, 1, 2].map((i) => ({ x: i, z: 0, nx: 0, nz: 1, snx: 0, snz: 1, lim: 5 }));
  const fl = new FrontLine(g, { pts, anchor: [0, 0], maxPush: 1, reach: 2 }, 0.2);
  scene.add(g);
  try { await (renderer.compileAsync ? renderer.compileAsync(scene, camera) : Promise.resolve(renderer.compile(scene, camera))); } catch {}
  fl.dispose(); scene.remove(g);
}
setTimeout(() => warmupShaders(), 300);
setTimeout(() => precomputeBorders(world), 600); // 국경선 미리 계산 (게임 시작 시 멈춤 방지)
