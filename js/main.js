import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { Game, UNITS } from './game.js';
import { WorldMap, LAND_H } from './map.js';
import { makeUnit, makeFlag, flagTime } from './models.js';
import { FX } from './fx.js';
import { UI } from './ui.js';

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

const KR = world.countries.find((c) => c.a2 === 'KR');
setView(KR.cx, KR.cy, 150, false);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); labels.setSize(innerWidth, innerHeight);
});

// 카메라 이동 (부드럽게)
let fly = null;
function setView(x, z, d, animate = true) {
  const to = new THREE.Vector3(x, 0, z);
  const off = new THREE.Vector3(0, d * 0.72, d * 0.7);
  if (!animate) { controls.target.copy(to); camera.position.copy(to).add(off); controls.update(); return; }
  fly = { t: 0, fromT: controls.target.clone(), fromP: camera.position.clone(), toT: to, toP: to.clone().add(off) };
}

// ---------- 게임 ----------
let game = null, speed = 1, acc = 0;
const nationVis = new Map();   // 나라별 수도 도시·국기·주둔군·라벨
const expVis = new Map();      // 원정군 3D 그룹
const occFlags = new Map();    // 점령지에 꽂힌 국기

const landColor = (n) => new THREE.Color(n.color).lerp(new THREE.Color(0x8c8a70), 0.22);
const tY = (idx) => LAND_H + map.meshes[idx].position.y;
const citySize = (t) => THREE.MathUtils.clamp(Math.sqrt(t.area) / 900, 0.22, 0.9);

ui.showStart((opts) => {
  game = new Game(world, opts);
  for (const t of game.territories) map.setColor(t.idx, landColor(game.nations.get(t.owner)));
  for (const n of game.nations.values()) buildNationVis(n);
  game.on('log', (l) => ui.log(l));
  game.on('launch', (e) => buildExp(e));
  game.on('end', (e) => removeExp(e));
  game.on('capture', onCapture);
  game.on('capital', (n) => moveNationVis(n));
  game.on('eliminated', (n) => removeNationVis(n));
  game.on('impact', ({ e, x, y, n }) => { for (let i = 0; i < Math.min(5, n); i++) setTimeout(() => fx.explosion(x + (Math.random() - 0.5) * 1.2, tY(e.target), y + (Math.random() - 0.5) * 1.2, 1.4), i * 120); });
  game.on('over', (o) => { ui.over(o); speed = 0; });
  ui.bind(game, {
    setSpeed: (s) => { speed = s; ui.setSpeed(s); },
    flyHome: () => { const c = game.territories[ui.me.capital]; setView(c.cx, c.cy, 30); },
    select: (i) => select(i),
  });
  ui.setSpeed(1);
  const me = game.nations.get(opts.player);
  const c = game.territories[me.capital];
  setView(c.cx, c.cy, 32);
  ui.log({ msg: `${me.flag} ${me.name} 지도자님, 세계 GDP 60%를 장악하면 승리합니다. 40일간 평화가 유지됩니다.`, kind: 'mine', day: 0 });
});

function buildNationVis(n) {
  const t = game.territories[n.capital];
  const g = new THREE.Group();
  const s = citySize(t);
  const city = makeUnit('city', n.color); city.scale.setScalar(s); city.receiveShadow = true; g.add(city);
  const flag = makeFlag(n.color); flag.position.set(0, 1.0 * s, 0); flag.scale.setScalar(s * 1.2); g.add(flag);
  const gar = new THREE.Group();
  const tank = makeUnit('tank', n.color); tank.scale.setScalar(U); tank.position.set(0.9 * s + 0.3, 0, 0.3); tank.rotation.y = 0.6; gar.add(tank);
  for (let i = 0; i < 3; i++) { const inf = makeUnit('inf', n.color); inf.scale.setScalar(U); inf.position.set(0.7 * s + 0.2 + i * 0.18, 0, 0.75 + (i % 2) * 0.12); inf.rotation.y = 0.6; gar.add(inf); }
  g.add(gar);
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

function onCapture({ t, to }) {
  map.setColor(t.idx, landColor(to), true);
  for (let i = 0; i < 4; i++) setTimeout(() => fx.explosion(t.cx + (Math.random() - 0.5) * 1.5, tY(t.idx), t.cy + (Math.random() - 0.5) * 1.5, 1.1), i * 150);
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
      const m = makeUnit(type, n.color); m.scale.setScalar(U * (type === 'ship' ? 1.1 : 1));
      const row = Math.floor(i / 3), col = (i % 3) - 1;
      m.userData = { type, off: [-row * spacing - (type === 'inf' ? 0.7 : 0), col * spacing * 0.8], ph: Math.random() * 6 };
      g.add(m); members.push(m);
    }
  };
  const u = e.units;
  if (e.kind === 'land') { add('tank', Math.min(4, Math.max(u.tank > 0 ? 1 : 0, Math.ceil(u.tank / 6))), 0.6); add('inf', Math.min(6, Math.max(1, Math.ceil(u.inf / 15))), 0.25); }
  if (e.kind === 'sea') add('ship', Math.min(3, Math.max(1, Math.ceil(u.ship / 3))), 1.1);
  if (e.kind === 'air') add('jet', Math.min(4, Math.max(1, Math.ceil(u.jet / 3))), 0.8);
  if (e.kind === 'missile') add('missile', Math.min(4, Math.max(1, Math.round(u.missile))), 0.5);
  const div = document.createElement('div'); div.className = 'elabel' + (n.isPlayer ? ' me' : '');
  div.style.setProperty('--c', n.color);
  const lab = new CSS2DObject(div); lab.position.set(0, 1.2, 0); g.add(lab);
  scene.add(g);
  const dx = e.to.x - e.from.x, dz = e.to.y - e.from.y, L = Math.hypot(dx, dz) || 1;
  expVis.set(e.id, { g, members, e, div, lab, dir: [dx / L, dz / L], fire: 0 });
  if (e.kind === 'missile') members.forEach((m, i) => { m.userData.delay = i * 0.12; });
}
function removeExp(e) {
  const v = expVis.get(e.id); if (!v) return;
  v.lab.element.remove(); scene.remove(v.g); expVis.delete(e.id);
}

const tmpA = new THREE.Vector3();
function updateExp(v, dt, time) {
  const e = v.e; const [dx, dz] = v.dir;
  const back = e.state === 'return';
  let p = e.p;
  const hold = e.state === 'battle' ? Math.max(0, 1 - 0.9 / e.len) : 1;
  if (e.state === 'battle' || p > hold) p = Math.min(p, hold);
  const cx = e.from.x + (e.to.x - e.from.x) * p, cz = e.from.y + (e.to.y - e.from.y) * p;
  const heading = Math.atan2(-(back ? -dz : dz), back ? -dx : dx);
  const perp = [-dz, dx];
  const pw = game.power(e.units);
  v.div.textContent = `${UNITS[{ land: 'tank', sea: 'ship', air: 'jet', missile: 'missile' }[e.kind]].icon} ${Math.round(pw)}`;
  v.lab.visible = e.kind !== 'missile';
  const alive = Math.max(1, Math.ceil(v.members.length * Math.min(1, pw / (v.pw0 ||= pw || 1)) + 0.001));
  v.members.forEach((m, i) => {
    m.visible = i < alive;
    const { off, ph, type } = m.userData;
    const fwd = back ? -off[0] : off[0];
    let x = cx + dx * fwd + perp[0] * off[1], z = cz + dz * fwd + perp[1] * off[1], y = 0.16;
    let rotY = heading, rotZ = 0, rotX = 0;
    if (type === 'inf') y += Math.abs(Math.sin(time * 9 + ph)) * 0.04;
    if (type === 'tank') y += Math.sin(time * 20 + ph) * 0.004;
    if (type === 'ship') { y = -0.02 + Math.sin(time * 2 + ph) * 0.02; rotZ = Math.sin(time * 1.6 + ph) * 0.05; if (Math.random() < 0.5) fx.wake(x - dx * 0.4, z - dz * 0.4); }
    if (type === 'jet') {
      y = 2.2 + Math.sin(Math.PI * p) * 2.5 + Math.sin(time * 2 + ph) * 0.1;
      if (e.state === 'battle') { // 목표 상공 선회
        const a = time * 1.4 + i * 1.6; x = e.to.x + Math.cos(a) * 1.4; z = e.to.y + Math.sin(a) * 1.4; y = 2.0 + i * 0.2;
        rotY = -a - Math.PI / 2; rotX = 0.5;
      }
      if (Math.random() < 0.6) fx.trail(x - Math.cos(rotY) * 0.35, y, z + Math.sin(rotY) * 0.35);
    }
    if (type === 'missile') {
      const q = Math.max(0, Math.min(1, e.p - (m.userData.delay || 0) * 0.3));
      const H = THREE.MathUtils.clamp(e.len * 0.25, 3, 30);
      x = e.from.x + (e.to.x - e.from.x) * q + perp[0] * off[1] * (1 - q);
      z = e.from.y + (e.to.y - e.from.y) * q + perp[1] * off[1] * (1 - q);
      y = 0.3 + Math.sin(Math.PI * q) * H;
      const slope = Math.cos(Math.PI * q) * Math.PI * H / e.len;
      rotZ = Math.atan(slope);
      fx.trail(x - Math.cos(heading) * 0.3, y, z + Math.sin(heading) * 0.3, true);
    }
    m.position.set(x, y, z);
    m.rotation.set(rotX, rotY, rotZ, 'YZX');
  });
  v.lab.position.set(cx - v.g.position.x, (e.kind === 'air' ? 4 : 1.3), cz - v.g.position.z);
  // 전투 연출
  if (e.state === 'battle') {
    v.fire -= dt;
    if (v.fire <= 0) {
      v.fire = 0.12 + Math.random() * 0.25;
      const m = v.members[Math.floor(Math.random() * alive)];
      if (m) { tmpA.set(Math.cos(m.rotation.y) * 0.5, 0.25, -Math.sin(m.rotation.y) * 0.5).add(m.position); fx.muzzle(tmpA.x, tmpA.y, tmpA.z); }
      const ty = tY(e.target);
      if (Math.random() < 0.55) fx.explosion(e.to.x + (Math.random() - 0.5) * 1.6, ty, e.to.y + (Math.random() - 0.5) * 1.6, 0.45 + Math.random() * 0.4);
      if (Math.random() < 0.3) fx.explosion(cx + (Math.random() - 0.5) * 1.2, 0.12, cz + (Math.random() - 0.5) * 1.2, 0.35);
    }
  }
}

// ---------- 선택 ----------
const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2();
let down = null;
renderer.domElement.addEventListener('pointerdown', (ev) => { down = [ev.clientX, ev.clientY]; });
renderer.domElement.addEventListener('pointerup', (ev) => {
  if (!down || !game) return;
  if (Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) > 6) return;
  ndc.set((ev.clientX / innerWidth) * 2 - 1, -(ev.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(map.meshes, false)[0];
  select(hit ? hit.object.userData.idx : null);
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
  if (e.key === 'Escape') select(null);
});

// ---------- 루프 ----------
const clock = new THREE.Clock();
let uiT = 0, labT = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(0.05, clock.getDelta());
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
  // 그림자 영역을 화면 중심에 맞춤
  const sh = THREE.MathUtils.clamp(camD * 0.55, 8, 60);
  Object.assign(sun.shadow.camera, { left: -sh, right: sh, top: sh, bottom: -sh }); sun.shadow.camera.updateProjectionMatrix();
  sun.position.copy(controls.target).add(new THREE.Vector3(-25, 45, 20)); sun.target.position.copy(controls.target);
  map.update(dt); fx.update(dt); flagTime.value = time;
  if (game) {
    for (const v of expVis.values()) updateExp(v, dt, time);
    uiT -= dt; if (uiT <= 0) { uiT = 0.25; ui.refresh(); }
    labT -= dt; if (labT <= 0) { labT = 0.3; updateLabels(camD); }
  }
  renderer.render(scene, camera);
  labels.render(scene, camera);
});

function updateLabels(camD) {
  for (const [id, v] of nationVis) {
    const n = game.nations.get(id);
    const pw = game.armyPow(n) * n.tech;
    v.pw.textContent = pw >= 1000 ? (pw / 1000).toFixed(1) + 'k' : Math.round(pw);
    const big = n.gdp * n.bal.eco;
    const show = n.isPlayer || camD < 45 || (camD < 110 && big > 250) || big > 1500 || (camD < 70 && big > 60);
    v.lab.visible = show;
    v.gar.scale.setScalar(THREE.MathUtils.clamp(0.6 + Math.log10(pw + 1) * 0.28, 0.6, 1.8));
  }
}
