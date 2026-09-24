// 배경음악·효과음: 파일 없이 Web Audio로 실시간 합성
// 음악은 D단조 전쟁 테마(현악 오스티나토 + 패드 + 타이코 + 스네어 + 금관), 전투 강도에 따라 층이 쌓인다.
const PREF_KEY = 'sgj-audio-v1';
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function loadPref() {
  try { return { music: 0.55, sfx: 0.8, muted: false, ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') }; }
  catch { return { music: 0.55, sfx: 0.8, muted: false }; }
}

// 코드 진행 (근음 midi, 구성음 midi)
const SECTIONS = {
  A: [[38, [50, 53, 57]], [34, [46, 50, 53]], [41, [53, 57, 60]], [36, [48, 52, 55]]],      // Dm Bb F C
  B: [[43, [55, 58, 62]], [38, [50, 53, 57]], [45, [57, 61, 64]], [38, [50, 53, 57]]],      // Gm Dm A Dm
};
const FORM = ['A', 'A', 'B', 'A'];
// 금관 선율: [16분음표 위치, 길이(16분), midi]  — 2마디 단위
const MOTIF_A = [[0, 6, 62], [6, 2, 69], [8, 4, 65], [12, 4, 67], [16, 12, 69], [28, 4, 65]];
const MOTIF_B = [[0, 4, 67], [4, 4, 70], [8, 8, 69], [16, 4, 64], [20, 4, 65], [24, 8, 62]];

export class Sound {
  constructor() {
    this.pref = loadPref();
    this.ctx = null;
    this.intensity = 0.15; this.target = 0.15;
    this.last = {};
  }

  // 사용자 첫 조작 때 호출 (브라우저 자동재생 정책)
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain();
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.25;
    this.master.connect(comp).connect(c.destination);
    this.musicBus = c.createGain(); this.musicBus.connect(this.master);
    this.sfxBus = c.createGain(); this.sfxBus.connect(this.master);
    this.reverb = c.createConvolver(); this.reverb.buffer = this.impulse(2.8);
    this.revGain = c.createGain(); this.revGain.gain.value = 0.35;
    this.reverb.connect(this.revGain).connect(this.master);
    this.noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.ensureBuffers();
    this.applyPref();
    this.step = 0; this.nextT = c.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 25);
  }

  impulse(sec) {
    const c = this.ctx, n = c.sampleRate * sec, b = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.6); }
    return b;
  }

  applyPref() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, p = this.pref;
    this.master.gain.setTargetAtTime(p.muted ? 0 : 1, t, 0.05);
    this.musicBus.gain.setTargetAtTime(p.music * 0.6, t, 0.1);
    this.sfxBus.gain.setTargetAtTime(p.sfx, t, 0.05);
  }
  setPref(k, v) { this.pref[k] = v; try { localStorage.setItem(PREF_KEY, JSON.stringify(this.pref)); } catch {} this.applyPref(); }
  setIntensity(v) { this.target = clamp(v, 0, 1); }

  // ---------- 공통 부품 ----------
  env(g, t, a, peak, dec, sus = 0.0001) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, sus), t + a + dec);
  }
  noise(t, dur) { const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true; s.start(t, Math.random()); s.stop(t + dur); return s; }
  out(bus, pan = 0, rev = 0.2) {
    const c = this.ctx, g = c.createGain(), p = c.createStereoPanner ? c.createStereoPanner() : null;
    if (p) { p.pan.value = clamp(pan, -1, 1); g.connect(p).connect(bus); } else g.connect(bus);
    if (rev > 0) { const s = c.createGain(); s.gain.value = rev; g.connect(s).connect(this.reverb); }
    return g;
  }
  ok(key, gap) { // 같은 소리가 너무 자주 겹치지 않게
    if (!this.ctx || this.pref.muted) return false;
    const now = this.ctx.currentTime;
    if (now - (this.last[key] || 0) < gap) return false;
    this.last[key] = now; return true;
  }

  // ---------- 효과음 (사실감: 거리 필터 + 지연 + 야외 메아리 + 여러 층) ----------
  // vol이 작을수록 멀리 있는 소리 → 고음이 깎이고 늦게 들리며 울림이 커진다
  voice(vol, pan, rev = 0.25, echo = 0.2) {
    const c = this.ctx, far = clamp(1 - vol, 0, 1);
    const g = c.createGain();
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900 + 17000 * Math.pow(1 - far, 2.2); lp.Q.value = 0.3;
    const p = c.createStereoPanner ? c.createStereoPanner() : null;
    g.connect(lp);
    let tail = lp; if (p) { p.pan.value = clamp(pan, -1, 1); lp.connect(p); tail = p; }
    tail.connect(this.sfxBus);
    const rs = c.createGain(); rs.gain.value = rev + far * 0.5; tail.connect(rs).connect(this.reverb);
    if (echo > 0) { const es = c.createGain(); es.gain.value = echo * (0.5 + far); tail.connect(es).connect(this.echoIn); }
    return { g, t: c.currentTime + far * 0.22 + 0.005 }; // 먼 곳은 소리가 늦게 도착
  }
  buf(type, t, dur, rate = 1) { const s = this.ctx.createBufferSource(); s.buffer = type === 'brown' ? this.brownBuf : type === 'pink' ? this.pinkBuf : this.noiseBuf; s.loop = true; s.playbackRate.value = rate; s.start(t, Math.random() * 1.5); s.stop(t + dur); return s; }
  filt(type, f, q = 0.7) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
  gainEnv(t, a, peak, dec) { const g = this.ctx.createGain(); this.env(g, t, a, peak, dec); return g; }
  ensureBuffers() {
    if (this.brownBuf) return;
    const c = this.ctx, n = c.sampleRate * 2;
    this.brownBuf = c.createBuffer(1, n, c.sampleRate); this.pinkBuf = c.createBuffer(1, n, c.sampleRate);
    const br = this.brownBuf.getChannelData(0), pk = this.pinkBuf.getChannelData(0);
    let last = 0, b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02; br[i] = last * 3.5;
      b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526; pk[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    }
    // 야외 메아리(산·건물 반사): 지연 + 피드백 + 고음 감쇠
    this.echoIn = c.createGain();
    const d = c.createDelay(1); d.delayTime.value = 0.29;
    const fb = c.createGain(); fb.gain.value = 0.32;
    const lp = this.filt('lowpass', 1600);
    this.echoIn.connect(d); d.connect(lp).connect(fb).connect(d); lp.connect(this.master);
    // 저음 펀치용 포화
    const cv = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; cv[i] = Math.tanh(x * 2.5); }
    this.shaperCurve = cv;
  }

  explosion(vol = 1, pan = 0, size = 1) {
    if (vol < 0.03 || !this.ok('exp', 0.06 / size)) return;
    this.ensureBuffers();
    const c = this.ctx, { g: o, t } = this.voice(vol, pan, 0.3, 0.35);
    // 1) 순간 파열음
    if (vol > 0.35) { const cr = this.buf('white', t, 0.03); const g = this.gainEnv(t, 0.001, 0.9 * vol, 0.025); cr.connect(this.filt('highpass', 1200)).connect(g).connect(o); }
    // 2) 폭발 몸통: 갈색 잡음이 닫히는 필터
    const body = this.buf('brown', t, 3); const bf = this.filt('lowpass', 3500 * size);
    bf.frequency.setValueAtTime(3500 * size, t); bf.frequency.exponentialRampToValueAtTime(160, t + 0.9 * size);
    body.connect(bf).connect(this.gainEnv(t, 0.004, 1.3 * vol, 1.8 * size)).connect(o);
    // 3) 초저음 충격 (포화로 펀치감)
    const sub = c.createOscillator(); sub.frequency.setValueAtTime(62, t); sub.frequency.exponentialRampToValueAtTime(24, t + 0.9);
    const sg = this.gainEnv(t, 0.003, 1.2 * vol * Math.min(1.3, size), 1.1 * size);
    const ws = c.createWaveShaper(); ws.curve = this.shaperCurve;
    const sh = c.createGain(); sh.gain.value = 0.7;
    sub.connect(sg).connect(ws).connect(sh).connect(o); sub.start(t); sub.stop(t + 1.6);
    // 4) 긴 우르릉 여운
    const rum = this.buf('brown', t + 0.1, 4); rum.connect(this.filt('lowpass', 140)).connect(this.gainEnv(t + 0.1, 0.25, 0.7 * vol * size, 3 * size)).connect(o);
    // 5) 파편·흙 떨어지는 소리
    if (size > 0.7 && vol > 0.25) for (let i = 0; i < 7; i++) {
      const tt = t + 0.25 + Math.random() * 1.1; const d = this.buf('white', tt, 0.04);
      d.connect(this.filt('bandpass', 2000 + Math.random() * 4000, 2)).connect(this.gainEnv(tt, 0.001, 0.12 * vol * Math.random(), 0.03)).connect(o);
    }
  }
  shot(o, t, vol, heavy = false) { // 총성 한 발
    const cr = this.buf('white', t, 0.02); cr.connect(this.filt('highpass', 2500)).connect(this.gainEnv(t, 0.0005, 0.8 * vol, 0.012)).connect(o);
    const bd = this.buf('white', t, 0.15); bd.connect(this.filt('bandpass', heavy ? 700 : 1300 + Math.random() * 300, 1.1)).connect(this.gainEnv(t, 0.001, 0.55 * vol, heavy ? 0.14 : 0.08)).connect(o);
    const th = this.ctx.createOscillator(); th.frequency.setValueAtTime(heavy ? 120 : 190, t); th.frequency.exponentialRampToValueAtTime(60, t + 0.05);
    th.connect(this.gainEnv(t, 0.001, 0.35 * vol, 0.05)).connect(o); th.start(t); th.stop(t + 0.1);
  }
  gunfire(vol = 1, pan = 0) {
    if (vol < 0.05 || !this.ok('gun', 0.22)) return;
    this.ensureBuffers();
    const { g: o, t } = this.voice(vol, pan, 0.2, 0.45);
    const auto = Math.random() < 0.6; // 기관총 연사 또는 소총 산발
    const k = auto ? 5 + Math.floor(Math.random() * 9) : 1 + Math.floor(Math.random() * 3);
    let tt = t;
    for (let i = 0; i < k; i++) { this.shot(o, tt, vol * (0.8 + Math.random() * 0.2), auto && Math.random() < 0.3); tt += auto ? 0.075 + Math.random() * 0.012 : 0.15 + Math.random() * 0.35; }
  }
  cannon(vol = 1, pan = 0) {
    if (vol < 0.05 || !this.ok('can', 0.12)) return;
    this.ensureBuffers();
    const c = this.ctx, { g: o, t } = this.voice(vol, pan, 0.3, 0.6);
    const cr = this.buf('white', t, 0.04); cr.connect(this.filt('highpass', 800)).connect(this.gainEnv(t, 0.0005, 1.0 * vol, 0.03)).connect(o);
    const bm = this.buf('brown', t, 1.2); const f = this.filt('lowpass', 1400); f.frequency.exponentialRampToValueAtTime(200, t + 0.5);
    bm.connect(f).connect(this.gainEnv(t, 0.002, 1.2 * vol, 0.7)).connect(o);
    const s = c.createOscillator(); s.frequency.setValueAtTime(90, t); s.frequency.exponentialRampToValueAtTime(32, t + 0.4);
    s.connect(this.gainEnv(t, 0.002, 1.0 * vol, 0.45)).connect(o); s.start(t); s.stop(t + 0.6);
  }
  jet(vol = 1, pan = 0) {
    if (vol < 0.05 || !this.ok('jet', 0.9)) return;
    this.ensureBuffers();
    const c = this.ctx, { g: o, t } = this.voice(vol, pan, 0.3, 0.2);
    const dur = 3.4, mid = t + 1.3;
    // 제트 굉음 (도플러: 다가올 땐 높고 지나가면 낮게)
    const roar = this.buf('pink', t, dur); const bp = this.filt('bandpass', 900, 0.6);
    bp.frequency.setValueAtTime(700, t); bp.frequency.exponentialRampToValueAtTime(1600, mid); bp.frequency.exponentialRampToValueAtTime(380, t + dur);
    const rg = c.createGain(); rg.gain.setValueAtTime(0.0001, t); rg.gain.exponentialRampToValueAtTime(0.9 * vol, mid); rg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    roar.connect(bp).connect(rg).connect(o);
    const low = this.buf('brown', t, dur); const lg = c.createGain(); lg.gain.setValueAtTime(0.0001, t); lg.gain.exponentialRampToValueAtTime(0.8 * vol, mid + 0.15); lg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    low.connect(this.filt('lowpass', 260)).connect(lg).connect(o);
    // 터빈 휘파람
    for (const det of [-10, 12]) {
      const w = c.createOscillator(); w.type = 'sawtooth'; w.detune.value = det;
      w.frequency.setValueAtTime(3300, t); w.frequency.exponentialRampToValueAtTime(2900, mid); w.frequency.exponentialRampToValueAtTime(1700, t + dur);
      const wg = c.createGain(); wg.gain.setValueAtTime(0.0001, t); wg.gain.exponentialRampToValueAtTime(0.03 * vol, mid - 0.2); wg.gain.exponentialRampToValueAtTime(0.0001, mid + 0.8);
      w.connect(this.filt('bandpass', 3000, 4)).connect(wg).connect(o); w.start(t); w.stop(t + dur);
    }
  }
  missile(vol = 1, pan = 0) {
    if (vol < 0.05 || !this.ok('mis', 0.35)) return;
    this.ensureBuffers();
    const c = this.ctx, { g: o, t } = this.voice(vol, pan, 0.35, 0.5);
    // 점화 폭음
    const ig = this.buf('brown', t, 0.6); ig.connect(this.filt('lowpass', 900)).connect(this.gainEnv(t, 0.002, 1.1 * vol, 0.4)).connect(o);
    // 로켓 분사: 거친 굉음 + 지글거림
    const roar = this.buf('white', t, 3); const bp = this.filt('bandpass', 700, 0.5);
    bp.frequency.setValueAtTime(500, t); bp.frequency.exponentialRampToValueAtTime(1400, t + 0.6); bp.frequency.exponentialRampToValueAtTime(500, t + 3);
    const am = c.createGain(); am.gain.value = 0.6;
    const lfo = c.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 23; const lg = c.createGain(); lg.gain.value = 0.35; lfo.connect(lg).connect(am.gain); lfo.start(t); lfo.stop(t + 3);
    roar.connect(bp).connect(am).connect(this.gainEnv(t, 0.05, 0.8 * vol, 2.8)).connect(o);
    const rb = this.buf('brown', t, 3); rb.connect(this.filt('lowpass', 200)).connect(this.gainEnv(t, 0.1, 0.9 * vol, 2.6)).connect(o);
  }
  horn(vol = 1, pan = 0) {
    if (vol < 0.05 || !this.ok('horn', 2)) return;
    this.ensureBuffers();
    const c = this.ctx, { g: o, t } = this.voice(vol, pan, 0.5, 0.7);
    const f = this.filt('lowpass', 900, 0.8); const formant = this.filt('peaking', 320, 2); formant.gain.value = 8;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5 * vol, t + 0.25);
    g.gain.setValueAtTime(0.5 * vol, t + 1.6); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.3);
    formant.connect(f).connect(g).connect(o);
    const vib = c.createOscillator(); vib.frequency.value = 4; const vg = c.createGain(); vg.gain.value = 5; vib.connect(vg); vib.start(t); vib.stop(t + 2.4);
    for (const [fr, type] of [[73, 'sawtooth'], [146.5, 'sawtooth'], [110, 'square']]) {
      const s = c.createOscillator(); s.type = type; s.frequency.value = fr; vg.connect(s.detune);
      const sg = c.createGain(); sg.gain.value = type === 'square' ? 0.15 : 0.4; s.connect(sg).connect(formant); s.start(t); s.stop(t + 2.4);
    }
  }
  march(vol = 1, pan = 0) { // 전차 엔진 + 궤도 삐걱임 + 군화 발소리
    if (vol < 0.05 || !this.ok('march', 1)) return;
    this.ensureBuffers();
    const c = this.ctx, { g: o, t } = this.voice(vol, pan, 0.15, 0.2);
    const eng = c.createOscillator(); eng.type = 'sawtooth'; eng.frequency.setValueAtTime(34, t); eng.frequency.linearRampToValueAtTime(46, t + 0.8);
    const am = c.createGain(); am.gain.value = 0.6; const lfo = c.createOscillator(); lfo.frequency.value = 11; const lg = c.createGain(); lg.gain.value = 0.35; lfo.connect(lg).connect(am.gain);
    eng.connect(this.filt('lowpass', 260)).connect(am).connect(this.gainEnv(t, 0.3, 0.6 * vol, 2)).connect(o);
    eng.start(t); eng.stop(t + 2.4); lfo.start(t); lfo.stop(t + 2.4);
    const rattle = this.buf('brown', t, 2.2, 1.5); rattle.connect(this.filt('bandpass', 180, 1)).connect(this.gainEnv(t, 0.3, 0.5 * vol, 1.8)).connect(o);
    for (let i = 0; i < 10; i++) { // 궤도 금속음
      const tt = t + 0.2 + i * 0.17 + Math.random() * 0.03; const n = this.buf('white', tt, 0.05);
      n.connect(this.filt('bandpass', 2600 + Math.random() * 800, 8)).connect(this.gainEnv(tt, 0.002, 0.2 * vol, 0.04)).connect(o);
    }
    for (let i = 0; i < 12; i++) { // 군화
      const tt = t + i * 0.14 + Math.random() * 0.02; const n = this.buf('pink', tt, 0.06);
      n.connect(this.filt('bandpass', 420, 1.5)).connect(this.gainEnv(tt, 0.002, 0.22 * vol, 0.05)).connect(o);
    }
  }
  // 전투 중 멀리서 들리는 포성·총성 (분위기)
  ambience(I) {
    if (!this.ctx || this.pref.muted || I < 0.35) return;
    if (Math.random() < 0.06 * I) this.explosion(0.12 + Math.random() * 0.15, Math.random() * 1.6 - 0.8, 1.2);
    else if (Math.random() < 0.05 * I) this.gunfire(0.1 + Math.random() * 0.12, Math.random() * 1.6 - 0.8);
  }
  alarm() {
    if (!this.ok('alarm', 6)) return;
    const c = this.ctx, t = c.currentTime, o = this.out(this.sfxBus, 0, 0.3);
    const s = c.createOscillator(); s.type = 'square';
    for (let i = 0; i < 3; i++) { s.frequency.setValueAtTime(620, t + i * 0.5); s.frequency.linearRampToValueAtTime(900, t + i * 0.5 + 0.4); }
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1800;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.05); g.gain.setValueAtTime(0.12, t + 1.3); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
    s.connect(f).connect(g).connect(o); s.start(t); s.stop(t + 1.6);
  }
  brassChord(notes, t, dur, vol, bus = this.sfxBus) {
    const c = this.ctx, o = this.out(bus, 0, 0.45);
    for (const m of notes) {
      for (const det of [-6, 6]) {
        const s = c.createOscillator(); s.type = 'sawtooth'; s.frequency.value = mtof(m); s.detune.value = det;
        const f = c.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 1.5;
        f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(2600, t + 0.08); f.frequency.exponentialRampToValueAtTime(1300, t + dur);
        const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol / notes.length, t + 0.05);
        g.gain.setValueAtTime(vol / notes.length, t + dur * 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.3);
        s.connect(f).connect(g).connect(o); s.start(t); s.stop(t + dur + 0.4);
      }
    }
  }
  victory() { // 우리 점령: 짧은 승리 팡파르
    if (!this.ok('fan', 2)) return;
    const t = this.ctx.currentTime + 0.05;
    this.brassChord([62, 66, 69], t, 0.18, 0.5); this.brassChord([62, 66, 69], t + 0.22, 0.12, 0.45);
    this.brassChord([64, 67, 71], t + 0.38, 0.18, 0.5); this.brassChord([66, 69, 74], t + 0.6, 1.1, 0.6);
    this.timpani(t + 0.6, 0.8);
  }
  defeat() { // 우리 영토 상실
    if (!this.ok('def', 2)) return;
    const t = this.ctx.currentTime + 0.05;
    this.brassChord([57, 60, 64], t, 0.5, 0.45); this.brassChord([56, 59, 62], t + 0.55, 1.4, 0.45);
    this.timpani(t, 0.9);
  }
  timpani(t, vol, bus = this.sfxBus) {
    const c = this.ctx, o = this.out(bus, 0, 0.4);
    const s = c.createOscillator(); s.frequency.setValueAtTime(110, t); s.frequency.exponentialRampToValueAtTime(70, t + 0.5);
    const g = c.createGain(); this.env(g, t, 0.004, vol, 1.2); s.connect(g).connect(o); s.start(t); s.stop(t + 1.4);
    const n = this.noise(t, 0.2); const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600;
    const ng = c.createGain(); this.env(ng, t, 0.002, vol * 0.4, 0.15); n.connect(f).connect(ng).connect(o);
  }
  gameOver(win) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.1;
    if (win) { [[62, 66, 69], [67, 71, 74], [69, 73, 76], [74, 78, 81]].forEach((ch, i) => this.brassChord(ch, t + i * 0.45, i === 3 ? 2.5 : 0.4, 0.6)); }
    else { [[62, 65, 69], [58, 62, 65], [57, 61, 64], [50, 53, 57]].forEach((ch, i) => this.brassChord(ch, t + i * 0.8, i === 3 ? 3 : 0.75, 0.45)); }
    this.target = 0;
  }
  click() {
    if (!this.ok('click', 0.03)) return;
    const c = this.ctx, t = c.currentTime, o = this.out(this.sfxBus, 0, 0);
    const s = c.createOscillator(); s.type = 'triangle'; s.frequency.setValueAtTime(900, t); s.frequency.exponentialRampToValueAtTime(500, t + 0.05);
    const g = c.createGain(); this.env(g, t, 0.002, 0.12, 0.06); s.connect(g).connect(o); s.start(t); s.stop(t + 0.1);
  }
  buy() {
    if (!this.ok('buy', 0.05)) return;
    const c = this.ctx, t = c.currentTime, o = this.out(this.sfxBus, 0, 0.1);
    // 장전·철컥 소리 + 짧은 확인음
    const n = this.noise(t, 0.12); const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2500; f.Q.value = 3;
    const g = c.createGain(); this.env(g, t, 0.002, 0.3, 0.07); n.connect(f).connect(g).connect(o);
    for (const [fr, dt] of [[880, 0.04], [1320, 0.09]]) {
      const s = c.createOscillator(); s.type = 'sine'; s.frequency.value = fr;
      const sg = c.createGain(); this.env(sg, t + dt, 0.003, 0.1, 0.12); s.connect(sg).connect(o); s.start(t + dt); s.stop(t + dt + 0.2);
    }
  }
  error() {
    if (!this.ok('err', 0.2)) return;
    const c = this.ctx, t = c.currentTime, o = this.out(this.sfxBus, 0, 0);
    const s = c.createOscillator(); s.type = 'square'; s.frequency.value = 140;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 800;
    const g = c.createGain(); this.env(g, t, 0.005, 0.12, 0.2); s.connect(f).connect(g).connect(o); s.start(t); s.stop(t + 0.25);
  }

  // ---------- 배경음악 ----------
  schedule() {
    const c = this.ctx; if (!c) return;
    this.intensity += (this.target - this.intensity) * 0.02;
    const spb = 60 / 84 / 4; // 16분음표 길이
    if (Math.random() < 0.25) this.ambience(this.intensity);
    while (this.nextT < c.currentTime + 0.12) { this.playStep(this.step, this.nextT, spb); this.nextT += spb; this.step++; }
  }

  playStep(step, t, spb) {
    const I = this.intensity;
    const bar = Math.floor(step / 16), s = step % 16;
    const sec = FORM[Math.floor(bar / 8) % FORM.length];
    const chordIdx = Math.floor((bar % 8) / 2);
    const [root, tones] = SECTIONS[sec][chordIdx];
    const bus = this.musicBus;
    // 패드: 2마디마다 코드 전환
    if (s === 0 && bar % 2 === 0) this.pad([root, root + 12, ...tones], t, spb * 32, 0.05 + I * 0.03, 500 + I * 1200);
    // 현악 오스티나토 (8분음표, 강도 오르면 16분)
    const pat = [0, 2, 1, 2, 0, 2, 1, 2, 0, 2, 1, 2, 0, 2, 1, 2];
    const dense = I > 0.55;
    if (dense || s % 2 === 0) {
      const note = [tones[0], tones[2], tones[1]][pat[s]] + (s >= 8 && I > 0.35 ? 12 : 0) - 12;
      this.pluck(note, t, spb * 1.6, (0.035 + I * 0.05) * (s % 4 === 0 ? 1.3 : 1));
    }
    // 저음 베이스 (1·3박)
    if (s === 0 || (s === 8 && I > 0.3)) this.bass(root, t, spb * 7, 0.09 + I * 0.08);
    // 타이코 (전투 시)
    if (I > 0.3) {
      const taiko = [1, 0, 0, 0.5, 0, 0, 0.7, 0, 1, 0, 0.4, 0, 0.8, 0, 0.5, 0.5];
      if (taiko[s]) this.drum(t, taiko[s] * (0.25 + I * 0.45));
    } else if (s === 0 && bar % 2 === 0) this.drum(t, 0.18);
    // 스네어 행진 리듬
    if (I > 0.5) {
      const sn = [0, 0, 0, 0, 1, 0, 0, 0.3, 0, 0, 0, 0, 1, 0, 0.4, 0.6];
      if (sn[s]) this.snare(t, sn[s] * (I - 0.3) * 0.35);
    }
    // 금관 주제 (강도 높을 때, 2마디 동기)
    if (I > 0.45 && bar % 4 === 0 && s === 0) {
      const motif = sec === 'B' ? MOTIF_B : MOTIF_A;
      for (const [pos, len, m] of motif) this.brassNote(m - (sec === 'B' ? 0 : 0), t + pos * spb, len * spb, 0.07 + (I - 0.45) * 0.12);
    }
    // 섹션 시작 심벌 스웰
    if (I > 0.6 && bar % 8 === 7 && s === 0) this.swell(t, spb * 16, 0.08 * I);
  }

  pad(notes, t, dur, vol, cutoff) {
    const c = this.ctx, o = this.out(this.musicBus, 0, 0.6);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff; f.Q.value = 0.5;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 1.5);
    g.gain.setValueAtTime(vol, t + dur - 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 1.2);
    f.connect(g).connect(o);
    for (const m of notes) for (const det of [-8, 8]) {
      const s = c.createOscillator(); s.type = 'sawtooth'; s.frequency.value = mtof(m); s.detune.value = det;
      const sg = c.createGain(); sg.gain.value = 1 / notes.length; s.connect(sg).connect(f); s.start(t); s.stop(t + dur + 1.3);
    }
  }
  pluck(m, t, dur, vol) {
    const c = this.ctx, o = this.out(this.musicBus, (Math.random() - 0.5) * 0.4, 0.3);
    const s = c.createOscillator(); s.type = 'sawtooth'; s.frequency.value = mtof(m);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 2;
    f.frequency.setValueAtTime(2400, t); f.frequency.exponentialRampToValueAtTime(500, t + dur);
    const g = c.createGain(); this.env(g, t, 0.004, vol, dur);
    s.connect(f).connect(g).connect(o); s.start(t); s.stop(t + dur + 0.05);
  }
  bass(m, t, dur, vol) {
    const c = this.ctx, o = this.out(this.musicBus, 0, 0.1);
    const s = c.createOscillator(); s.type = 'triangle'; s.frequency.value = mtof(m);
    const s2 = c.createOscillator(); s2.type = 'sawtooth'; s2.frequency.value = mtof(m);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 220;
    const g = c.createGain(); this.env(g, t, 0.02, vol, dur);
    s.connect(g); s2.connect(f).connect(g); g.connect(o);
    s.start(t); s2.start(t); s.stop(t + dur + 0.1); s2.stop(t + dur + 0.1);
  }
  drum(t, vol) {
    const c = this.ctx, o = this.out(this.musicBus, 0, 0.45);
    const s = c.createOscillator(); s.frequency.setValueAtTime(95, t); s.frequency.exponentialRampToValueAtTime(42, t + 0.35);
    const g = c.createGain(); this.env(g, t, 0.003, vol, 0.55); s.connect(g).connect(o); s.start(t); s.stop(t + 0.7);
    const n = this.noise(t, 0.15); const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400;
    const ng = c.createGain(); this.env(ng, t, 0.002, vol * 0.5, 0.1); n.connect(f).connect(ng).connect(o);
  }
  snare(t, vol) {
    const c = this.ctx, o = this.out(this.musicBus, 0.15, 0.3);
    const n = this.noise(t, 0.2); const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1800;
    const g = c.createGain(); this.env(g, t, 0.002, vol, 0.13); n.connect(f).connect(g).connect(o);
    const s = c.createOscillator(); s.type = 'triangle'; s.frequency.value = 190;
    const sg = c.createGain(); this.env(sg, t, 0.002, vol * 0.6, 0.06); s.connect(sg).connect(o); s.start(t); s.stop(t + 0.1);
  }
  brassNote(m, t, dur, vol) {
    const c = this.ctx, o = this.out(this.musicBus, -0.1, 0.5);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(2200, t + 0.12); f.frequency.exponentialRampToValueAtTime(1100, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.06);
    g.gain.setValueAtTime(vol * 0.85, t + dur * 0.85); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.25);
    const vib = c.createOscillator(); vib.frequency.value = 5.2; const vg = c.createGain(); vg.gain.value = 6; vib.connect(vg);
    f.connect(g).connect(o);
    for (const [type, det, m2] of [['sawtooth', -5, m], ['sawtooth', 5, m], ['square', 0, m - 12]]) {
      const s = c.createOscillator(); s.type = type; s.frequency.value = mtof(m2); s.detune.value = det; vg.connect(s.detune);
      const sg = c.createGain(); sg.gain.value = type === 'square' ? 0.25 : 0.5; s.connect(sg).connect(f); s.start(t); s.stop(t + dur + 0.3);
    }
    vib.start(t); vib.stop(t + dur + 0.3);
  }
  swell(t, dur, vol) {
    const c = this.ctx, o = this.out(this.musicBus, 0, 0.5);
    const n = this.noise(t, dur + 0.5); const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 5000;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + dur); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.4);
    n.connect(f).connect(g).connect(o);
  }
}
