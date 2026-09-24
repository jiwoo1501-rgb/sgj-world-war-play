// 게임 규칙: 경제, 병력, 원정(지상·상륙·공습·미사일), 전투, AI — 화면과 분리된 순수 로직
export const UNITS = {
  inf:     { name: '보병',   icon: '🪖', cost: 8,  pow: 1,  cls: 'ground' },
  tank:    { name: '전차',   icon: '🛡️', cost: 30, pow: 4,  cls: 'ground' },
  jet:     { name: '전투기', icon: '✈️', cost: 60, pow: 7,  cls: 'air' },
  ship:    { name: '군함',   icon: '🚢', cost: 80, pow: 8,  cls: 'sea' },
  missile: { name: '미사일', icon: '🚀', cost: 50, pow: 12, cls: 'strike' },
};
export const UNIT_KEYS = Object.keys(UNITS);
export const SPEED = { land: 1.6, sea: 3.2, air: 14, missile: 22 };
const AIR_RANGE = 70, MISSILE_RANGE = 130;

export const DEFAULT_BAL = { eco: 1, atk: 1, def: 1, troops: 1, aggr: 1, gold: 0 };

const PALETTE = {
  KR: '#1f6fe5', KP: '#b23a3a', JP: '#e58a2e', CN: '#d24a43', US: '#3f8f5f', RU: '#7b5ea8', TW: '#2fb3a1',
  IN: '#e0a030', GB: '#a33b5c', FR: '#4a78c2', DE: '#6b6b6b', MN: '#c9a14a', VN: '#c7524a', PH: '#5a9bd4',
  AU: '#d9824a', CA: '#c0504d', BR: '#58a55c', IR: '#6aa36f', SA: '#2e8b57', TR: '#c44b4b', PK: '#3f7f3f',
  IL: '#5b8bd6', UA: '#e2c043', ID: '#b85a5a', TH: '#8c6bb1', MX: '#6ba35a', EG: '#c8a86a', IT: '#5aa36a',
};

export function flagOf(a2) {
  if (!/^[A-Z]{2}$/.test(a2) || a2.startsWith('X')) return '🏳️';
  return String.fromCodePoint(...[...a2].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

// 한국어 조사: josa('미국','이가') → '미국이'
export function josa(w, pair) {
  const c = w.charCodeAt(w.length - 1);
  const has = c >= 0xac00 && c <= 0xd7a3 ? (c - 0xac00) % 28 : 0;
  if (pair === '으로') return w + (has && has !== 8 ? '으로' : '로');
  const [a, b] = { 이가: ['이', '가'], 을를: ['을', '를'], 은는: ['은', '는'], 과와: ['과', '와'] }[pair];
  return w + (has ? a : b);
}
const rand = (a, b) => a + Math.random() * (b - a);
const dist = (a, b) => Math.hypot(a.cx - b.cx, a.cy - b.cy);

export class Game {
  constructor(world, opts) {
    this.world = world;
    this.opts = opts; // { player, aggr, balance }
    this.t = 0; this.day = 0;
    this.listeners = {};
    this.expeditions = []; this.nextExpId = 1;
    this.territories = world.countries.map((c, i) => ({ ...c, idx: i }));
    this.nations = new Map();
    this.peace = 40; // 시작 후 AI 공격 금지 시간(초)
    this.wars = new Map(); // 'A|B' → { a, b, since, last }
    this.over = false;
    this.build();
  }
  on(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
  emit(ev, d) { (this.listeners[ev] || []).forEach((f) => f(d)); }
  log(msg, kind = '', at = null) { this.emit('log', { msg, kind, day: this.day, at }); }

  build() {
    const S = this.world.stats;
    let hue = 0;
    for (const t of this.territories) {
      const nid = t.sov || t.a2;
      t.owner = nid; t.home = nid;
      if (t.sov) { t.gdp = 2 + Math.sqrt(t.area) * 0.04; continue; }
      const s = S[t.a2];
      const gdp = s ? s[0] : 4 + Math.sqrt(t.area) * 0.12;
      const pop = s ? s[1] : 0.5 + Math.sqrt(t.area) * 0.008;
      const mil = s ? s[2] : 3 + Math.sqrt(t.area) / 90;
      const tech = s ? s[3] : 0.72;
      t.gdp = gdp;
      hue = (hue + 137.508) % 360;
      const bal = { ...DEFAULT_BAL, ...(this.opts.balance?.[nid] || {}) };
      const color = PALETTE[nid] || `hsl(${hue.toFixed(0)}, ${40 + (hue % 25)}%, ${50 + (hue % 12)}%)`;
      this.nations.set(nid, {
        id: nid, name: t.name, flag: flagOf(nid), color, gdp, pop, mil, tech, bal,
        units: { inf: 0, tank: 0, jet: 0, ship: 0, missile: 0 },
        gold: 50 + gdp * 0.3 + bal.gold, alive: true, capital: t.idx, coastal: t.coastal,
        isPlayer: nid === this.opts.player, hostile: new Map(), busy: 0,
        nextAI: rand(1, 4), nextBuild: rand(0.5, 2), attacked: 0,
      });
    }
    for (const n of this.nations.values()) {
      n.coastal = this.owned(n.id).some((t) => t.coastal);
      const p = this.cap(n) * Math.min(0.85, 0.25 + n.mil / 150);
      const mix = n.coastal ? { inf: 0.36, tank: 0.26, jet: 0.16, ship: 0.14, missile: 0.08 } : { inf: 0.45, tank: 0.3, jet: 0.17, ship: 0, missile: 0.08 };
      if (n.tech < 0.8) { mix.inf += mix.missile; mix.missile = 0; }
      for (const k of UNIT_KEYS) n.units[k] = Math.round((p * mix[k]) / UNITS[k].pow);
      if (n.units.inf < 2) n.units.inf = 2;
    }
    for (const n of this.nations.values()) this.recalcCap(n);
    this.worldGdp = this.territories.reduce((s, t) => s + t.gdp, 0);
  }

  owned(nid) { return this.territories.filter((t) => t.owner === nid); }
  cap(n) { return (n.pop * 0.8 + n.mil * 8 + 10 + (n.terrCap ?? n.gdp * 0.02)) * n.bal.troops; }
  // 영토가 늘면 병력 한도도 는다 (점령지는 GDP 비례 + 기본 15)
  recalcCap(n) { n.terrCap = this.owned(n.id).reduce((s, t) => s + (t.home === n.id ? t.gdp * 0.02 : 15 + t.gdp * 0.04), 0); }
  power(units, filter) {
    let p = 0; for (const k of UNIT_KEYS) if (!filter || filter(UNITS[k])) p += (units[k] || 0) * UNITS[k].pow; return p;
  }
  armyPow(n) { return this.power(n.units); }
  income(n) {
    let g = 0; for (const t of this.territories) if (t.owner === n.id) g += t.gdp;
    return (1 + g * 0.012) * n.bal.eco;
  }
  gdpShare(nid) { let g = 0; for (const t of this.territories) if (t.owner === nid) g += t.gdp; return g / this.worldGdp; }

  buy(nid, key, qty = 1) {
    const n = this.nations.get(nid); const u = UNITS[key];
    let bought = 0;
    while (bought < qty && n.gold >= u.cost && this.armyPow(n) + u.pow <= this.cap(n)) {
      if (key === 'ship' && !n.coastal) break;
      n.gold -= u.cost; n.units[key]++; bought++;
    }
    return bought;
  }

  // 공격 가능 여부와 출발지
  options(nid, tIdx) {
    const n = this.nations.get(nid); const T = this.territories[tIdx];
    const mine = this.owned(nid);
    const res = { land: null, sea: null, air: null, missile: null };
    if (!mine.length || T.owner === nid) return res;
    const landSrc = mine.filter((m) => m.land.includes(tIdx));
    if (landSrc.length && this.power(n.units, (u) => u.cls === 'ground') >= 1) res.land = nearest(landSrc, T);
    if (T.coastal && n.units.ship >= 1) {
      const coast = mine.filter((m) => m.coastal);
      if (coast.length) res.sea = nearest(coast, T);
    }
    const near = nearest(mine, T);
    const d = dist(near, T);
    if (n.units.jet >= 1 && d <= AIR_RANGE) res.air = near;
    if (n.units.missile >= 1 && (d <= MISSILE_RANGE || n.tech >= 1.2)) res.missile = near;
    return res;
  }

  // 원정 출발
  launch(nid, tIdx, kind, frac = 0.6) {
    const n = this.nations.get(nid); const T = this.territories[tIdx];
    const src = this.options(nid, tIdx)[kind];
    if (!src) return null;
    const units = { inf: 0, tank: 0, jet: 0, ship: 0, missile: 0 };
    const take = (k, f) => { const c = Math.max(k === 'missile' ? 1 : 0, Math.floor(n.units[k] * f)); const q = Math.min(c, n.units[k]); units[k] = q; n.units[k] -= q; };
    if (kind === 'land') { take('inf', frac); take('tank', frac); }
    else if (kind === 'sea') {
      take('ship', frac);
      const capacity = units.ship * 12; // 군함 1척당 지상 전력 12까지 수송
      const f = Math.min(frac, capacity / Math.max(1, this.power(n.units, (u) => u.cls === 'ground')));
      take('inf', f); take('tank', f);
    } else if (kind === 'air') take('jet', frac);
    else if (kind === 'missile') take('missile', Math.min(frac, 0.5));
    if (this.power(units) <= 0) { for (const k in units) n.units[k] += units[k]; return null; }
    const e = {
      id: this.nextExpId++, owner: nid, target: tIdx, src: src.idx, kind, units,
      from: { x: src.cx, y: src.cy }, to: { x: T.cx, y: T.cy }, p: 0, state: 'move', battleT: 0, def: 0, defender: T.owner,
    };
    e.len = Math.max(1, Math.hypot(e.to.x - e.from.x, e.to.y - e.from.y));
    this.expeditions.push(e);
    n.busy++;
    const dn = this.nations.get(T.owner);
    this.touchWar(n, dn);
    dn.hostile.set(nid, (dn.hostile.get(nid) || 0) + 1);
    const verb = { land: '지상군을 진격시켰습니다', sea: '상륙 함대를 보냈습니다', air: '공습을 개시했습니다', missile: '미사일을 발사했습니다' }[kind];
    this.log(`${n.flag} ${josa(n.name, '이가')} ${T.name}${T.home !== dn.id || T.owner !== T.a2 ? `(${dn.name})` : ''}에 ${verb}`, dn.isPlayer ? 'danger' : n.isPlayer ? 'mine' : '', { x: T.cx, z: T.cy });
    this.emit('launch', e);
    return e;
  }

  defensePower(dn, T) {
    const terrs = this.owned(dn.id);
    const total = terrs.reduce((s, t) => s + t.gdp, 0) || 1;
    const share = terrs.length === 1 ? 1 : T.idx === dn.capital ? 0.55 : 0.1 + 0.6 * (T.gdp / total);
    const raw = this.power(dn.units, (u) => u.cls !== 'strike') * share;
    return (raw + 2) * dn.tech * dn.bal.def * 1.25;
  }

  killUnits(n, rawLoss, filter) {
    const tot = this.power(n.units, filter);
    if (tot <= 0) return;
    const f = Math.min(1, rawLoss / tot);
    for (const k of UNIT_KEYS) if (filter(UNITS[k])) n.units[k] = Math.max(0, n.units[k] - n.units[k] * f);
  }
  killExp(e, loss) {
    const tot = this.power(e.units);
    if (tot <= 0) return;
    const f = Math.min(1, loss / tot);
    for (const k of UNIT_KEYS) e.units[k] = Math.max(0, e.units[k] * (1 - f));
  }

  step(dt) {
    if (this.over) return;
    this.t += dt; this.day += dt;
    for (const n of this.nations.values()) {
      if (!n.alive) continue;
      n.gold += this.income(n) * dt;
      if (!n.isPlayer) this.ai(n, dt);
    }
    for (const e of this.expeditions) this.stepExp(e, dt);
    if (Math.floor(this.day) !== Math.floor(this.day - dt)) this.checkPeace();
    const done = this.expeditions.filter((e) => e.state === 'done');
    if (done.length) {
      done.forEach((e) => { const n = this.nations.get(e.owner); n.busy = Math.max(0, n.busy - 1); this.emit('end', e); });
      this.expeditions = this.expeditions.filter((e) => e.state !== 'done');
    }
    const me = this.nations.get(this.opts.player);
    if (!me.alive) { this.over = true; this.emit('over', { win: false }); }
    else if (this.gdpShare(me.id) >= 0.6) { this.over = true; this.emit('over', { win: true }); }
  }

  stepExp(e, dt) {
    const A = this.nations.get(e.owner);
    const T = this.territories[e.target];
    if (e.state === 'move') {
      e.p += (SPEED[e.kind] * dt) / e.len;
      if (e.p >= 1) {
        e.p = 1;
        if (!A.alive) { e.state = 'done'; return; }
        if (T.owner === e.owner) { this.returnHome(e); return; }
        const D = this.nations.get(T.owner);
        e.defender = D.id;
        if (e.kind === 'missile') {
          const dmg = e.units.missile * UNITS.missile.pow * A.tech * A.bal.atk;
          this.killUnits(D, dmg / (D.tech * D.bal.def), (u) => u.cls !== 'strike');
          this.emit('impact', { e, x: T.cx, y: T.cy, n: e.units.missile });
          this.log(`💥 ${T.name}에 미사일 ${Math.round(e.units.missile)}발 명중`, D.isPlayer ? 'danger' : '', { x: T.cx, z: T.cy });
          e.state = 'done'; return;
        }
        e.state = 'battle'; e.battleT = 0;
        e.def = this.defensePower(D, T);
        this.emit('battle', e);
      }
      return;
    }
    if (e.state === 'battle') {
      const D = this.nations.get(T.owner);
      if (T.owner === e.owner || !D.alive) { this.returnHome(e); return; }
      e.battleT += dt;
      const aPow = this.power(e.units) * A.tech * A.bal.atk;
      const r = 0.06 * dt;
      const lossA = e.def * r * rand(0.7, 1.3) * (e.kind === 'air' ? 0.35 : 1);
      const lossD = aPow * r * rand(0.7, 1.3);
      this.killExp(e, lossA / (A.tech * A.bal.atk));
      e.def = Math.max(0, e.def - lossD);
      this.killUnits(D, lossD / (D.tech * D.bal.def * 1.25), (u) => u.cls !== 'strike');
      const groundLeft = this.power(e.units, (u) => u.cls === 'ground');
      if (e.kind === 'air') {
        if (e.battleT > 4 || this.power(e.units) < 0.5) this.returnHome(e);
        return;
      }
      if (e.def <= 0.5 && groundLeft >= 0.5) { this.capture(e, T, A, D); return; }
      if (groundLeft < 0.5) {
        this.log(`${A.flag} ${A.name}의 ${T.name} 공격이 격퇴되었습니다`, D.isPlayer ? 'good' : A.isPlayer ? 'danger' : '');
        this.returnHome(e);
      }
    }
    if (e.state === 'return') {
      e.p -= (SPEED[e.kind === 'land' ? 'land' : e.kind] * 1.5 * dt) / e.len;
      if (e.p <= 0) { for (const k of UNIT_KEYS) A.units[k] += e.units[k]; e.state = 'done'; }
    }
  }

  returnHome(e) {
    if (this.power(e.units) < 0.3) { e.state = 'done'; return; }
    e.state = 'return';
    this.emit('return', e);
  }

  capture(e, T, A, D) {
    T.owner = A.id;
    for (const k of UNIT_KEYS) A.units[k] += e.units[k];
    e.units = { inf: 0, tank: 0, jet: 0, ship: 0, missile: 0 };
    e.state = 'done';
    A.coastal = A.coastal || T.coastal;
    this.recalcCap(A); this.recalcCap(D);
    this.touchWar(A, D);
    this.emit('capture', { t: T, from: D, to: A });
    this.log(`🚩 ${A.flag} ${josa(A.name, '이가')} ${josa(T.name, '을를')} 점령했습니다`, A.isPlayer ? 'mine' : D.isPlayer ? 'danger' : '', { x: T.cx, z: T.cy });
    const left = this.owned(D.id);
    if (!left.length) {
      D.alive = false;
      this.log(`☠️ ${D.flag} ${josa(D.name, '이가')} 멸망했습니다`, D.isPlayer ? 'danger' : 'big');
      A.gold += D.gold; D.gold = 0;
      for (const [k, w] of this.wars) if (w.a === D.id || w.b === D.id) { this.wars.delete(k); this.emit('peace', w); }
      this.emit('eliminated', D);
    } else if (T.idx === D.capital) {
      D.capital = left.sort((a, b) => b.gdp - a.gdp)[0].idx;
      const loot = D.gold * 0.5; D.gold -= loot; A.gold += loot;
      this.log(`🏛️ ${D.name} 수도가 함락되어 ${josa(this.territories[D.capital].name, '으로')} 천도`, 'big');
      this.emit('capital', D);
    }
  }

  // ---------- 전쟁 상태 ----------
  warKey(a, b) { return a < b ? a + '|' + b : b + '|' + a; }
  atWar(a, b) { return this.wars.has(this.warKey(a, b)); }
  touchWar(A, D) {
    const k = this.warKey(A.id, D.id);
    const w = this.wars.get(k);
    if (w) { w.last = this.day; return; }
    const nw = { a: A.id, b: D.id, since: this.day, last: this.day };
    this.wars.set(k, nw);
    this.log(`⚔️ ${A.flag} ${josa(A.name, '이가')} ${D.flag} ${D.name}에 선전포고했습니다`, A.isPlayer || D.isPlayer ? 'danger' : 'war', this.warAt(A, D));
    this.emit('war', nw);
  }
  warAt(A, D) { const t = this.territories[D.capital]; return { x: t.cx, z: t.cy }; }
  // 90일 동안 싸움이 없으면 휴전
  checkPeace() {
    for (const [k, w] of this.wars) {
      if (this.day - w.last < 90) continue;
      if (this.expeditions.some((e) => (e.owner === w.a && e.defender === w.b) || (e.owner === w.b && e.defender === w.a))) continue;
      this.wars.delete(k);
      const A = this.nations.get(w.a), B = this.nations.get(w.b);
      this.log(`🕊️ ${A.flag} ${josa(A.name, '과와')} ${B.flag} ${josa(B.name, '이가')} 휴전했습니다`, '');
      this.emit('peace', w);
    }
  }

  // ---------- AI ----------
  ai(n, dt) {
    n.nextBuild -= dt; n.nextAI -= dt;
    if (n.nextBuild <= 0) {
      n.nextBuild = rand(1, 2.5);
      const w = n.coastal ? [['inf', 0.32], ['tank', 0.3], ['jet', 0.16], ['ship', 0.14], ['missile', 0.08]] : [['inf', 0.42], ['tank', 0.34], ['jet', 0.16], ['missile', 0.08]];
      for (let i = 0; i < 6 && n.gold > 8; i++) {
        let r = Math.random(), k = 'inf';
        for (const [kk, p] of w) { if ((r -= p) <= 0) { k = kk; break; } }
        if (k === 'missile' && n.tech < 0.8) k = 'tank';
        if (!this.buy(n.id, k, Math.max(1, Math.floor(n.gold / UNITS[k].cost / 3)))) break;
      }
    }
    if (n.nextAI > 0) return;
    n.nextAI = rand(5, 12);
    if (this.t < this.peace || n.busy > 0) return;
    if (this.expeditions.length > 60) return;
    const aggr = this.opts.aggr * n.bal.aggr;
    const angry = [...n.hostile.entries()].sort((a, b) => b[1] - a[1])[0];
    // 미사일 보복
    if (angry && n.units.missile >= 1 && Math.random() < 0.3 * aggr) {
      const foe = this.nations.get(angry[0]);
      if (foe?.alive) {
        const t = this.territories[foe.capital];
        if (this.options(n.id, t.idx).missile) { this.launch(n.id, t.idx, 'missile', 0.3); return; }
      }
    }
    if (Math.random() > 0.12 * aggr) return;
    const mine = this.owned(n.id);
    const myGround = this.power(n.units, (u) => u.cls === 'ground') * n.tech * n.bal.atk;
    let best = null, bestScore = 0;
    const seen = new Set();
    for (const m of mine) {
      for (const j of [...m.land, ...(n.units.ship >= 1 ? m.sea : [])]) {
        if (seen.has(j)) continue; seen.add(j);
        const t = this.territories[j];
        if (t.owner === n.id) continue;
        const D = this.nations.get(t.owner);
        const kind = m.land.includes(j) ? 'land' : 'sea';
        const send = kind === 'land' ? myGround * 0.7 : Math.min(myGround * 0.6, n.units.ship * 0.6 * 12 + n.units.ship * 0.6 * 8);
        const ratio = send / (this.defensePower(D, t) + 1);
        let score = ratio * (1 + (n.hostile.get(D.id) || 0) * 0.3) * (0.6 + t.gdp / 500) * (this.atWar(n.id, D.id) ? 1.8 : 1);
        if (D.isPlayer) score *= this.opts.playerFocus ?? 1;
        if (ratio > 1.8 / Math.max(0.3, aggr) && score > bestScore) { bestScore = score; best = [j, kind]; }
      }
    }
    if (best) this.launch(n.id, best[0], best[1], 0.7);
    else if (n.units.jet >= 3 && angry && Math.random() < 0.3 * aggr) {
      const foe = this.nations.get(angry[0]);
      if (foe?.alive) { const t = this.territories[foe.capital]; if (this.options(n.id, t.idx).air) this.launch(n.id, t.idx, 'air', 0.5); }
    }
  }
}

function nearest(list, T) {
  let b = list[0], bd = Infinity;
  for (const m of list) { const d = dist(m, T); if (d < bd) { bd = d; b = m; } }
  return b;
}
