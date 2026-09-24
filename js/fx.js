// 파티클 효과: 폭발 불꽃, 연기, 비행운, 총구 섬광, 항적
import * as THREE from 'three';

const N = 6000;
export class FX {
  constructor(scene) {
    this.pos = new Float32Array(N * 3); this.col = new Float32Array(N * 4); this.size = new Float32Array(N);
    this.vel = new Float32Array(N * 3); this.life = new Float32Array(N); this.max = new Float32Array(N); this.kind = new Uint8Array(N);
    this.grow = new Float32Array(N);
    this.i = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    const vs = `attribute float size; attribute vec4 color; varying vec4 vC;
      void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * (1000.0 / -mv.z); gl_Position = projectionMatrix * mv; }`;
    const fs = `varying vec4 vC; void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d); if (r > 0.5) discard;
      float a = smoothstep(0.5, 0.0, r); gl_FragColor = vec4(vC.rgb, vC.a * a); }`;
    // 연기(일반 블렌딩)와 불꽃(가산 블렌딩)을 따로 그린다
    this.smoke = new THREE.Points(g, new THREE.ShaderMaterial({ vertexShader: vs, fragmentShader: fs, transparent: true, depthWrite: false }));
    this.fireGeo = new THREE.BufferGeometry();
    this.fpos = new Float32Array(N * 3); this.fcol = new Float32Array(N * 4); this.fsize = new Float32Array(N);
    this.fireGeo.setAttribute('position', new THREE.BufferAttribute(this.fpos, 3).setUsage(THREE.DynamicDrawUsage));
    this.fireGeo.setAttribute('color', new THREE.BufferAttribute(this.fcol, 4).setUsage(THREE.DynamicDrawUsage));
    this.fireGeo.setAttribute('size', new THREE.BufferAttribute(this.fsize, 1).setUsage(THREE.DynamicDrawUsage));
    this.fire = new THREE.Points(this.fireGeo, new THREE.ShaderMaterial({ vertexShader: vs, fragmentShader: fs, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.smoke.frustumCulled = false; this.fire.frustumCulled = false;
    this.smoke.renderOrder = 2; this.fire.renderOrder = 3;
    scene.add(this.smoke, this.fire);
    // 조명 개수가 바뀌면 셰이더가 다시 컴파일되므로 고정 풀을 돌려쓴다
    this.lights = Array.from({ length: 4 }, () => { const L = new THREE.PointLight(0xffa040, 0, 6, 2); scene.add(L); return { L, t: 0, max: 1, I: 0 }; });
    this.li = 0;
    // 충격파 고리
    this.rings = Array.from({ length: 14 }, () => {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 48), new THREE.MeshBasicMaterial({ color: 0xffc27a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      m.rotation.x = -Math.PI / 2; m.visible = false; m.renderOrder = 4; scene.add(m);
      return { m, t: 0, max: 1, s: 1 };
    });
    this.ri = 0;
    // 예광탄
    this.TR = 300; this.tri = 0;
    this.trPos = new Float32Array(this.TR * 6); this.trCol = new Float32Array(this.TR * 6); this.trLife = new Float32Array(this.TR);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(this.trPos, 3).setUsage(THREE.DynamicDrawUsage));
    tg.setAttribute('color', new THREE.BufferAttribute(this.trCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.tracers = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.tracers.frustumCulled = false; this.tracers.renderOrder = 5; scene.add(this.tracers);
    this.burns = [];
  }

  shockwave(x, y, z, s = 1) {
    const r = this.rings[this.ri]; this.ri = (this.ri + 1) % this.rings.length;
    r.m.position.set(x, y + 0.05, z); r.t = 0; r.max = 0.7; r.s = s; r.m.visible = true;
  }
  tracer(x1, y1, z1, x2, y2, z2) {
    const i = this.tri; this.tri = (this.tri + 1) % this.TR;
    // 목표까지 선 전체가 아니라 날아가는 짧은 탄 궤적
    const k = 0.25 + Math.random() * 0.5;
    const ax = x1 + (x2 - x1) * k, ay = y1 + (y2 - y1) * k, az = z1 + (z2 - z1) * k;
    const bx = x1 + (x2 - x1) * (k + 0.18), by = y1 + (y2 - y1) * (k + 0.18), bz = z1 + (z2 - z1) * (k + 0.18);
    this.trPos.set([ax, ay, az, bx, by, bz], i * 6);
    this.trLife[i] = 0.12;
  }
  burn(x, y, z, dur = 8, s = 1) { this.burns.push({ x, y, z, t: dur, s }); if (this.burns.length > 40) this.burns.shift(); }

  emit(kind, x, y, z, vx, vy, vz, life, size, grow = 0) {
    const i = this.i; this.i = (this.i + 1) % N;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.max[i] = life; this.size[i] = size; this.kind[i] = kind; this.grow[i] = grow;
  }

  explosion(x, y, z, s = 1) {
    for (let k = 0; k < 26 * s; k++) {
      const a = Math.random() * 6.283, e = Math.random() * 1.2, v = (0.6 + Math.random() * 1.6) * s;
      this.emit(1, x, y + 0.1, z, Math.cos(a) * Math.cos(e) * v, Math.sin(e) * v * 1.4, Math.sin(a) * Math.cos(e) * v, 0.35 + Math.random() * 0.35, 0.35 * s);
    }
    for (let k = 0; k < 18 * s; k++) {
      const a = Math.random() * 6.283, v = (0.2 + Math.random() * 0.6) * s;
      this.emit(2, x + (Math.random() - 0.5) * 0.4 * s, y + 0.1, z + (Math.random() - 0.5) * 0.4 * s, Math.cos(a) * v, 0.5 + Math.random() * 0.9, Math.sin(a) * v, 1.6 + Math.random() * 1.4, 0.35 * s, 0.9 * s);
    }
    for (let k = 0; k < 8 * s; k++) { // 파편
      const a = Math.random() * 6.283; const v = 2 + Math.random() * 2;
      this.emit(3, x, y + 0.1, z, Math.cos(a) * v, 2 + Math.random() * 2, Math.sin(a) * v, 0.8, 0.08);
    }
    this.emit(1, x, y + 0.2, z, 0, 0.4, 0, 0.14, 1.6 * s); // 섬광 코어
    if (s >= 0.8) this.shockwave(x, y, z, s);
    const fl = this.lights[this.li]; this.li = (this.li + 1) % this.lights.length;
    fl.L.position.set(x, y + 0.6, z); fl.L.distance = 6 * s; fl.t = fl.max = 0.35; fl.I = 30 * s;
  }
  muzzle(x, y, z) { this.emit(1, x, y, z, 0, 0.3, 0, 0.08, 0.25); }
  trail(x, y, z, big = false) {
    this.emit(2, x, y, z, (Math.random() - 0.5) * 0.1, 0.05, (Math.random() - 0.5) * 0.1, big ? 2.2 : 1.1, big ? 0.22 : 0.12, big ? 0.35 : 0.15);
    if (big) this.emit(1, x, y, z, 0, 0, 0, 0.12, 0.3);
  }
  wake(x, z) { this.emit(4, x, 0.02, z, (Math.random() - 0.5) * 0.15, 0, (Math.random() - 0.5) * 0.15, 1.4, 0.15, 0.3); }

  update(dt) {
    for (let i = 0; i < N; i++) {
      const l = this.life[i];
      const smoke = this.kind[i] === 2 || this.kind[i] === 4;
      if (l <= 0) { this.size[i] = 0; this.fsize[i] = 0; continue; }
      this.life[i] = l - dt;
      const t = 1 - this.life[i] / this.max[i];
      const p = i * 3;
      this.pos[p] += this.vel[p] * dt; this.pos[p + 1] += this.vel[p + 1] * dt; this.pos[p + 2] += this.vel[p + 2] * dt;
      const k = this.kind[i];
      if (k === 1) { this.vel[p] *= 0.9; this.vel[p + 1] = this.vel[p + 1] * 0.9 + 0.3 * dt; this.vel[p + 2] *= 0.9; }
      else if (k === 3) { this.vel[p + 1] -= 9 * dt; if (this.pos[p + 1] < 0.12) { this.pos[p + 1] = 0.12; this.vel[p] = this.vel[p + 2] = 0; } }
      else { this.vel[p] *= 0.97; this.vel[p + 2] *= 0.97; this.vel[p + 1] *= 0.96; this.size[i] += this.grow[i] * dt; }
      const c = i * 4;
      if (smoke) {
        const g = k === 4 ? 0.9 : 0.25 + t * 0.35;
        this.col[c] = g; this.col[c + 1] = g; this.col[c + 2] = k === 4 ? 0.95 : g; this.col[c + 3] = (1 - t) * (k === 4 ? 0.35 : 0.7);
        this.fsize[i] = 0;
      } else {
        this.fpos[p] = this.pos[p]; this.fpos[p + 1] = this.pos[p + 1]; this.fpos[p + 2] = this.pos[p + 2];
        this.fcol[c] = 1; this.fcol[c + 1] = 0.85 - t * 0.6; this.fcol[c + 2] = 0.4 - t * 0.4; this.fcol[c + 3] = 1 - t;
        this.fsize[i] = k === 3 ? 0.08 : this.size[i] * (1 + t);
      }
    }
    // 연기 배열의 불꽃 자리는 크기 0 처리
    for (let i = 0; i < N; i++) if (this.kind[i] === 1 || this.kind[i] === 3) this.col[i * 4 + 3] = 0;
    this.geo.attributes.position.needsUpdate = this.geo.attributes.color.needsUpdate = this.geo.attributes.size.needsUpdate = true;
    const f = this.fireGeo.attributes; f.position.needsUpdate = f.color.needsUpdate = f.size.needsUpdate = true;
    for (const r of this.rings) {
      if (!r.m.visible) continue;
      r.t += dt; const k = r.t / r.max;
      if (k >= 1) { r.m.visible = false; continue; }
      r.m.scale.setScalar(0.2 + k * 3.2 * r.s); r.m.material.opacity = (1 - k) * 0.8;
    }
    for (let i = 0; i < this.TR; i++) {
      const l = this.trLife[i] = Math.max(0, this.trLife[i] - dt);
      const b = l / 0.12;
      this.trCol[i * 6] = this.trCol[i * 6 + 3] = b; this.trCol[i * 6 + 1] = this.trCol[i * 6 + 4] = b * 0.85; this.trCol[i * 6 + 2] = this.trCol[i * 6 + 5] = b * 0.4;
    }
    this.tracers.geometry.attributes.position.needsUpdate = this.tracers.geometry.attributes.color.needsUpdate = true;
    this.burns = this.burns.filter((b) => {
      b.t -= dt;
      if (Math.random() < 0.5) this.emit(2, b.x + (Math.random() - 0.5) * 0.3 * b.s, b.y + 0.1, b.z + (Math.random() - 0.5) * 0.3 * b.s, 0.05, 0.6 + Math.random() * 0.4, 0, 2.5, 0.25 * b.s, 0.5 * b.s);
      if (Math.random() < 0.4) this.emit(1, b.x + (Math.random() - 0.5) * 0.25 * b.s, b.y + 0.1, b.z + (Math.random() - 0.5) * 0.25 * b.s, 0, 0.5, 0, 0.3, 0.3 * b.s);
      return b.t > 0;
    });
    for (const fl of this.lights) { fl.t = Math.max(0, fl.t - dt); fl.L.intensity = (fl.t / fl.max) * fl.I; }
  }
}
