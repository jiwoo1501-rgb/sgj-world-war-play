// 화면 UI: 시작 화면, 상단 정보, 생산, 선택 국가·공격, 뉴스, 밸런스 편집기
import { UNITS, UNIT_KEYS, DEFAULT_BAL, flagOf, josa } from './game.js';

const $ = (s, r = document) => r.querySelector(s);
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const fmt = (v) => v >= 1e4 ? (v / 1e3).toFixed(0) + 'k' : v >= 1000 ? (v / 1e3).toFixed(1) + 'k' : Math.round(v).toString();
const BAL_KEY = 'sgj-balance-v1';

export function loadBalance() {
  try { return JSON.parse(localStorage.getItem(BAL_KEY)) || { nations: {}, aggr: 1, playerFocus: 1 }; } catch { return { nations: {}, aggr: 1, playerFocus: 1 }; }
}
function saveBalance(b) { try { localStorage.setItem(BAL_KEY, JSON.stringify(b)); } catch {} }

export class UI {
  constructor(world) {
    this.world = world;
    this.bal = loadBalance();
    this.nationList = world.countries.filter((c) => !c.sov).map((c) => ({
      id: c.a2, name: c.name, flag: flagOf(c.a2), gdp: world.stats[c.a2]?.[0] ?? Math.round(4 + Math.sqrt(c.area) * 0.12),
    })).sort((a, b) => b.gdp - a.gdp);
    this.frac = 0.6;
  }

  // ---------- 메인 메뉴 ----------
  showMenu(o) {
    this.menuOpts = o;
    const el = $('#menu'); el.hidden = false; $('#start').hidden = true;
    const cont = $('#m-continue');
    if (o.save) {
      const n = this.nationList.find((x) => x.id === o.save.opts.player);
      const d = new Date(2026, 0, 1); d.setDate(d.getDate() + Math.floor(o.save.day));
      $('#m-save-info').textContent = `${n ? n.flag + ' ' + n.name : ''} · ${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} · 지방 ${o.save.owners.filter((x) => x === o.save.opts.player).length}곳`;
      cont.disabled = false; cont.classList.add('primary-item'); $('#m-new').classList.remove('primary-item');
    } else cont.disabled = true;
    cont.onclick = () => { el.hidden = true; o.onContinue(); };
    $('#m-new').onclick = () => { el.hidden = true; o.onNew(); };
    $('#m-settings').onclick = () => this.openSettings(o);
    $('#m-help').onclick = () => { $('#help').hidden = false; };
  }

  openSettings(o) {
    const el = $('#settings'); el.hidden = false;
    const st = o.getSettings();
    $('#set-quality').value = st.quality; $('#set-ui').value = String(st.ui);
    $('#set-quality').onchange = (e) => o.applySettings({ quality: e.target.value });
    $('#set-ui').onchange = (e) => o.applySettings({ ui: +e.target.value });
    const sd = this.sound;
    if (sd) {
      $('#set-mute').checked = !sd.pref.muted; $('#set-music').value = sd.pref.music; $('#set-sfx').value = sd.pref.sfx;
      $('#set-mute').onchange = (e) => sd.setPref('muted', !e.target.checked);
      $('#set-music').oninput = (e) => sd.setPref('music', +e.target.value);
      $('#set-sfx').oninput = (e) => sd.setPref('sfx', +e.target.value);
    }
    $('#set-close').onclick = () => { el.hidden = true; };
  }

  togglePause(force) {
    const el = $('#pause'); if (!this.game || this.game.over) return;
    const open = force ?? el.hidden;
    el.hidden = !open; this.api.pause(open);
    if (!open) return;
    $('#p-resume').onclick = () => this.togglePause(false);
    $('#p-save').onclick = () => { const ok = this.api.save(); $('#p-save-info').textContent = ok ? '저장했습니다 ✓ (' + new Date().toLocaleTimeString('ko-KR') + ')' : '저장하지 못했습니다 (브라우저 저장 공간 확인)'; };
    $('#p-settings').onclick = () => this.openSettings(this.api);
    $('#p-help').onclick = () => { $('#help').hidden = false; };
    $('#p-quit').onclick = () => this.api.quit();
  }

  // ---------- 시작 화면 ----------
  showStart(onStart) {
    const el = $('#start'); el.hidden = false;
    $('#start-back').onclick = () => { el.hidden = true; $('#menu').hidden = false; };
    let pick = 'KR';
    const list = $('#nation-list', el);
    const render = (q = '') => {
      list.innerHTML = '';
      this.nationList.filter((n) => !q || n.name.includes(q)).sort((a, b) => (b.id === pick) - (a.id === pick)).forEach((n) => {
        const b = h(`<button class="nation-opt ${n.id === pick ? 'on' : ''}"><span class="fl">${n.flag}</span>${n.name}<small>GDP ${n.gdp >= 1000 ? (n.gdp / 1000).toFixed(1) + '조' : Math.round(n.gdp * 10) + '억'}$</small></button>`);
        b.onclick = () => { pick = n.id; render(q); };
        list.appendChild(b);
      });
    };
    render();
    $('#nation-search', el).oninput = (e) => render(e.target.value.trim());
    $('#aggr', el).value = String(this.bal.aggr ?? 1);
    $('#auto-start', el).checked = !!this.bal.autoPlayer;
    $('#start-btn', el).onclick = () => {
      this.bal.aggr = +$('#aggr', el).value; saveBalance(this.bal);
      el.hidden = true;
      this.bal.autoPlayer = $('#auto-start', el).checked; saveBalance(this.bal);
      onStart({ player: pick, aggr: this.bal.aggr, playerFocus: this.bal.playerFocus ?? 1, balance: this.bal.nations, autoPlayer: this.bal.autoPlayer });
    };
    $('#start-bal', el).onclick = () => this.openBalance();
  }

  // ---------- 게임 연결 ----------
  bind(game, api) {
    this.game = game; this.api = api;
    this.me = game.nations.get(game.opts.player);
    $('#hud').hidden = false;
    $('#me-flag').textContent = this.me.flag; $('#me-name').textContent = this.me.name;
    // 생산 패널
    const bp = $('#build-list'); bp.innerHTML = '';
    for (const k of UNIT_KEYS) {
      const u = UNITS[k];
      const row = h(`<div class="unit-row" data-k="${k}" title="${u.name} — 비용 ${u.cost}, 전력 ${u.pow}">
        <img class="u-img" alt="">
        <div class="u-info"><b>${u.name}</b><small>💰${u.cost} · ⚔${u.pow}</small></div>
        <div class="u-cnt">0</div>
        <button class="b1">+1</button><button class="b10">+10</button></div>`);
      row.querySelector('.b1').onclick = () => this.buy(k, 1);
      row.querySelector('.b10').onclick = () => this.buy(k, 10);
      bp.appendChild(row);
    }
    document.querySelectorAll('[data-speed]').forEach((b) => { b.onclick = () => api.setSpeed(+b.dataset.speed); });
    $('#bal-btn').onclick = () => this.openBalance();
    $('#home-btn').onclick = () => api.flyHome();
    $('#cam-btn').onclick = () => api.battleCam();
    const autoBtn = $('#auto-btn');
    const setAuto = (on, quiet) => { autoBtn.classList.toggle('on', on); api.setAuto(on); this.bal.autoPlayer = on; saveBalance(this.bal); if (!quiet) this.toast(on ? '🤖 자동 운영: AI가 우리나라를 대신 운영합니다' : '🤖 자동 운영 해제: 직접 지휘합니다'); };
    autoBtn.onclick = () => setAuto(!autoBtn.classList.contains('on'));
    setAuto(!!game.opts.autoPlayer, true);
    $('#log-toggle').onclick = () => $('#log').classList.toggle('open');
    this.bindSound();
    $('#menu-btn').onclick = () => this.togglePause(true);
    $('#help-btn').onclick = () => { $('#help').hidden = !$('#help').hidden; };
    $('#help').onclick = () => { $('#help').hidden = true; };
    $('#info-close').onclick = () => api.select(null);
    this.refresh();
  }

  bindSound() {
    const sd = this.sound, pop = $('#snd-pop'), btn = $('#snd-btn');
    const icon = () => { btn.textContent = sd.pref.muted ? '🔇' : '🔊'; };
    icon();
    btn.onclick = (e) => { e.stopPropagation(); pop.hidden = !pop.hidden; };
    $('#snd-music').value = sd.pref.music; $('#snd-sfx').value = sd.pref.sfx; $('#snd-mute').checked = !sd.pref.muted;
    $('#snd-music').oninput = (e) => sd.setPref('music', +e.target.value);
    $('#snd-sfx').oninput = (e) => sd.setPref('sfx', +e.target.value);
    $('#snd-mute').onchange = (e) => { sd.setPref('muted', !e.target.checked); icon(); };
    document.addEventListener('pointerdown', (e) => { if (!pop.hidden && !pop.contains(e.target) && e.target !== btn) pop.hidden = true; });
  }

  // 3D 모델 썸네일을 생산 카드에
  setThumbs(map) { document.querySelectorAll('.unit-row').forEach((r) => { const src = map[r.dataset.k]; if (src) r.querySelector('.u-img').src = src; }); }

  buy(k, q) {
    const n = this.game.buy(this.me.id, k, q);
    if (n) this.sound?.buy(); else this.sound?.error();
    if (!n) {
      const u = UNITS[k];
      const why = k === 'ship' && !this.me.coastal ? '바다가 없어 군함을 만들 수 없습니다' : this.me.gold < u.cost ? '자금이 부족합니다' : '병력 한도에 도달했습니다 (영토를 늘리거나 밸런스에서 병력 배율을 올리세요)';
      this.toast(why);
    }
    this.refresh();
  }

  setSpeed(s) { document.querySelectorAll('[data-speed]').forEach((b) => b.classList.toggle('on', +b.dataset.speed === s)); }

  refresh() {
    const g = this.game, me = this.me;
    if (!g) return;
    $('#gold').textContent = fmt(me.gold);
    $('#income').textContent = '+' + g.income(me).toFixed(1);
    $('#power').textContent = fmt(g.armyPow(me));
    $('#cap').textContent = fmt(g.cap(me));
    $('#terr').textContent = g.owned(me.id).length;
    $('#share').textContent = (g.gdpShare(me.id) * 100).toFixed(1) + '%';
    $('#share-bar').style.width = Math.min(100, (g.gdpShare(me.id) / 0.6) * 100) + '%';
    const d = new Date(2026, 0, 1); d.setDate(d.getDate() + Math.floor(g.day));
    $('#date').textContent = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
    $('#alive').textContent = [...g.nations.values()].filter((n) => n.alive).length;
    document.querySelectorAll('.unit-row').forEach((r) => {
      const k = r.dataset.k, u = UNITS[k];
      r.querySelector('.u-cnt').textContent = Math.floor(me.units[k]);
      const can = me.gold >= u.cost && g.armyPow(me) + u.pow <= g.cap(me) && (k !== 'ship' || me.coastal);
      r.classList.toggle('dis', !can);
    });
    if (this.sel != null) this.renderInfo();
  }

  // ---------- 선택 국가 ----------
  select(idx) {
    this.sel = idx;
    $('#info').hidden = idx == null;
    if (idx != null) this.renderInfo(true);
  }

  renderInfo(full = false) {
    const g = this.game, T = g.territories[this.sel], O = g.nations.get(T.owner), me = this.me;
    const occupied = T.owner !== T.home;
    const homeN = g.nations.get(T.home);
    const pow = g.armyPow(O) * O.tech;
    const key = `${this.sel}|${T.owner}`;
    if (full || this.infoKey !== key) {
      this.infoKey = key;
      $('#info').style.setProperty('--c', O.color);
      $('#info-flag').textContent = O.flag;
      $('#info-title').textContent = T.name;
      const role = T.idx === O.capital ? ' · 수도' : '';
      $('#info-sub').textContent = occupied ? `${O.name} 점령지 · 원래 ${homeN.name}${role}` : `${T.cname}${T.sov ? ` (${O.name} 속령)` : ''}${role}${O.id === me.id ? ' · 우리 영토' : ''}`;
      const atk = $('#attack'); atk.hidden = O.id === me.id || !me.alive;
      $('#info-bal').onclick = () => this.openBalance(O.id);
      if (!atk.hidden) this.renderAttack();
    }
    $('#info-stats').innerHTML = `
      <div><span>소속 국가</span><b style="font-family:var(--body);font-size:14px">${O.flag} ${O.name}</b></div>
      <div><span>이 지방 방어력</span><b>${fmt(g.defensePower(O, T))}</b></div>
      <div><span>국가 전투력</span><b>${fmt(pow)}</b></div>
      <div><span>기술 수준</span><b>${O.tech.toFixed(2)}</b></div>
      <div><span>국가 수입</span><b>+${g.income(O).toFixed(1)}<small style="color:var(--muted)"> /일</small></b></div>
      <div><span>보유 지방</span><b>${g.owned(O.id).length}</b></div>
      <div><span>이 지방 경제</span><b>${T.gdp.toFixed(0)}</b></div>
      <div><span>면적</span><b>${fmt(T.area)}<small style="color:var(--muted)"> km²</small></b></div>
      <div class="units-mini">${UNIT_KEYS.map((k) => `<span>${UNITS[k].icon}${Math.floor(O.units[k])}</span>`).join('')}</div>`;
    if (!$('#attack').hidden) this.updateAttack();
  }

  renderAttack() {
    const a = $('#attack');
    a.innerHTML = `
      <div class="sec-title">작전 명령</div>
      <div class="frac"><span>투입 병력</span><input type="range" min="0.2" max="1" step="0.05" value="${this.frac}" id="frac"><b id="frac-v">${Math.round(this.frac * 100)}%</b></div>
      <div class="atk-grid">
        <button data-kind="land"><i>🛡️</i>지상 진격<small></small></button>
        <button data-kind="sea"><i>🚢</i>상륙 작전<small></small></button>
        <button data-kind="air"><i>✈️</i>공습<small></small></button>
        <button data-kind="missile"><i>🚀</i>미사일<small></small></button>
      </div>
      <div id="odds"></div>`;
    $('#frac').oninput = (e) => { this.frac = +e.target.value; $('#frac-v').textContent = Math.round(this.frac * 100) + '%'; this.updateAttack(); };
    a.querySelectorAll('[data-kind]').forEach((b) => {
      b.onclick = () => {
        const e = this.game.launch(this.me.id, this.sel, b.dataset.kind, this.frac);
        if (!e) { this.toast('출동할 수 없습니다'); this.sound?.error(); } else this.refresh();
      };
    });
  }

  updateAttack() {
    const g = this.game, me = this.me, T = g.territories[this.sel], O = g.nations.get(T.owner);
    const opt = g.options(me.id, this.sel);
    const why = {
      land: opt.land ? `지상 전력 ${fmt(g.power(me.units, (u) => u.cls === 'ground') * this.frac)}` : '맞닿은 국경 없음',
      sea: opt.sea ? `군함 ${Math.floor(me.units.ship * this.frac)}척` : !T.coastal ? '내륙국' : me.units.ship < 1 ? '군함 없음' : '출항할 항구 없음',
      air: opt.air ? `전투기 ${Math.floor(me.units.jet * this.frac)}대 (점령 불가)` : me.units.jet < 1 ? '전투기 없음' : '작전 반경 밖',
      missile: opt.missile ? `${Math.max(1, Math.floor(me.units.missile * Math.min(this.frac, 0.5)))}발 (점령 불가)` : me.units.missile < 1 ? '미사일 없음' : '사거리 밖',
    };
    document.querySelectorAll('#attack [data-kind]').forEach((b) => {
      const k = b.dataset.kind; b.disabled = !opt[k]; b.querySelector('small').textContent = why[k];
    });
    const my = g.power(me.units, (u) => u.cls === 'ground') * this.frac * me.tech * me.bal.atk;
    const def = g.defensePower(O, T);
    const r = my / (def + 0.01);
    const [txt, cls] = r > 2 ? ['압도적 우세', 'good'] : r > 1.3 ? ['우세', 'good'] : r > 0.9 ? ['박빙', 'mid'] : ['열세 — 병력을 늘리세요', 'bad'];
    const pos = Math.max(3, Math.min(97, 50 + Math.log2(Math.max(0.01, r)) * 22));
    $('#odds').innerHTML = `지상 공격 예상 <b class="${cls}">${txt}</b> <small>우리 ${fmt(my)} : 방어 ${fmt(def)}</small><div class="gauge"><i style="left:${pos}%"></i></div>`;
  }

  // ---------- 뉴스 ----------
  log({ msg, kind, day, at }) {
    const d = new Date(2026, 0, 1); d.setDate(d.getDate() + Math.floor(day));
    const li = h(`<li class="${kind}"><time>${d.getMonth() + 1}/${d.getDate()}</time></li>`);
    li.append(msg);
    if (at && this.api) { li.classList.add('go'); li.title = '눌러서 이동'; li.onclick = () => this.api.flyTo(at); }
    const ul = $('#log-list'); ul.prepend(li);
    while (ul.children.length > 80) ul.lastChild.remove();
    // 새 소식이 오면 전황 보고 버튼이 잠깐 반짝임 (화면 중앙 팝업은 쓰지 않음)
    const tg = $('#log-toggle'); if (tg) { tg.classList.remove('new'); void tg.offsetWidth; tg.classList.add('new'); }
  }
  // 안내·경고도 전황 보고에만 기록
  toast(msg, kind = '') {
    if (!this.game) return;
    this.log({ msg: '› ' + msg, kind: kind || 'info', day: this.game.day });
  }
  over({ win, stats, day }) {
    const el = $('#over'); el.hidden = false;
    $('#over-title').textContent = win ? '세계 정복 성공' : '패배';
    $('#over-sub').textContent = win ? `${josa(this.me.name, '이가')} 세계 GDP의 60%를 장악했습니다.` : `${josa(this.me.name, '이가')} 멸망했습니다.`;
    const items = [['경과 일수', Math.floor(day)], ['지방 점령', stats.captured], ['지방 상실', stats.lost], ['출정 횟수', stats.battles], ['방어 성공', stats.repelled], ['멸망시킨 나라', stats.eliminated], ['생산한 병력', stats.built], ['최대 장악률', (stats.peak * 100).toFixed(1) + '%'], ['남은 지방', this.game.owned(this.me.id).length]];
    $('#over-stats').innerHTML = items.map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('');
    $('#over-btn').onclick = () => this.api.newGame();
    $('#over-menu').onclick = () => location.reload();
  }


  // ---------- 밸런스 편집기 ----------
  openBalance(focusId) {
    const el = $('#balance'); el.hidden = false;
    const b = this.bal;
    const fields = [['eco', '경제력', 0.1, 10, 0.1], ['atk', '공격력', 0.1, 10, 0.1], ['def', '방어력', 0.1, 10, 0.1], ['troops', '병력', 0.1, 10, 0.1], ['aggr', 'AI 호전성', 0, 5, 0.1], ['gold', '추가 자금', 0, 100000, 100]];
    $('#g-aggr').value = b.aggr ?? 1; $('#g-focus').value = b.playerFocus ?? 1;
    $('#g-aggr').oninput = (e) => { b.aggr = +e.target.value; if (this.game) this.game.opts.aggr = b.aggr; saveBalance(b); };
    $('#g-focus').oninput = (e) => { b.playerFocus = +e.target.value; if (this.game) this.game.opts.playerFocus = b.playerFocus; saveBalance(b); };
    const tbody = $('#bal-rows');
    const render = (q = '') => {
      tbody.innerHTML = '';
      const list = this.nationList.filter((n) => !q || n.name.includes(q));
      list.sort((x, y) => (y.id === focusId) - (x.id === focusId) || (!!b.nations[y.id]) - (!!b.nations[x.id]) || y.gdp - x.gdp);
      list.slice(0, q ? 250 : 60).forEach((n) => {
        const cur = { ...DEFAULT_BAL, ...(b.nations[n.id] || {}) };
        const tr = h(`<tr class="${b.nations[n.id] ? 'mod' : ''} ${n.id === focusId ? 'focus' : ''}"><td class="nm"><span class="fl">${n.flag}</span>${n.name}</td></tr>`);
        for (const [k, , min, max, step] of fields) {
          const td = h(`<td><input type="number" min="${min}" max="${max}" step="${step}" value="${cur[k]}"></td>`);
          td.firstChild.onchange = (e) => { this.setBal(n.id, k, +e.target.value); tr.classList.add('mod'); };
          tr.appendChild(td);
        }
        const act = h(`<td class="act"><button class="x2">×2</button><button class="rs">↺</button></td>`);
        act.querySelector('.x2').onclick = () => { for (const k of ['eco', 'atk', 'def', 'troops']) this.setBal(n.id, k, +((b.nations[n.id]?.[k] ?? 1) * 2).toFixed(2)); render(q); };
        act.querySelector('.rs').onclick = () => { delete b.nations[n.id]; saveBalance(b); this.applyBal(n.id); render(q); };
        tr.appendChild(act);
        tbody.appendChild(tr);
      });
    };
    render();
    $('#bal-search').value = ''; $('#bal-search').oninput = (e) => render(e.target.value.trim());
    $('#bal-close').onclick = () => { el.hidden = true; this.refresh(); };
    el.querySelectorAll('[data-preset]').forEach((btn) => { btn.onclick = () => { this.preset(btn.dataset.preset); render(); }; });
    $('#bal-export').onclick = () => {
      const blob = new Blob([JSON.stringify(b, null, 2)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = '세계정복-밸런스.json'; a.click();
    };
    $('#bal-import').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { const j = JSON.parse(await f.text()); Object.assign(b, j); b.nations ||= {}; saveBalance(b); Object.keys(b.nations).forEach((id) => this.applyBal(id)); render(); this.toast('밸런스를 불러왔습니다'); } catch { this.toast('파일을 읽을 수 없습니다'); }
    };
  }

  setBal(id, k, v) {
    const b = this.bal; b.nations[id] = { ...(b.nations[id] || {}), [k]: v };
    saveBalance(b); this.applyBal(id);
  }

  // 게임 중이면 즉시 반영 (병력 배율을 올리면 그만큼 병력도 늘려준다)
  applyBal(id) {
    const n = this.game?.nations.get(id);
    if (!n) return;
    const nb = { ...DEFAULT_BAL, ...(this.bal.nations[id] || {}) };
    const ratio = nb.troops / n.bal.troops;
    if (ratio > 1) for (const k of UNIT_KEYS) n.units[k] *= ratio;
    if (nb.gold > n.bal.gold) n.gold += nb.gold - n.bal.gold;
    n.bal = nb;
  }

  preset(p) {
    const b = this.bal;
    if (p === 'reset') { b.nations = {}; b.aggr = 1; b.playerFocus = 1; }
    if (p === 'korea') b.nations.KR = { eco: 3, atk: 2, def: 2, troops: 3, aggr: 1, gold: 5000 };
    if (p === 'eastasia') for (const id of ['CN', 'JP', 'KP', 'RU', 'US', 'TW']) b.nations[id] = { ...(b.nations[id] || {}), aggr: 2.5 };
    if (p === 'underdog') for (const n of this.nationList) if (n.gdp < 150) b.nations[n.id] = { ...(b.nations[n.id] || {}), troops: 2, def: 1.8 };
    if (p === 'nerf') for (const id of ['US', 'CN', 'RU']) b.nations[id] = { ...(b.nations[id] || {}), eco: 0.5, troops: 0.6 };
    saveBalance(b);
    if (this.game) { for (const n of this.game.nations.values()) this.applyBal(n.id); this.game.opts.aggr = b.aggr; }
    $('#g-aggr').value = b.aggr; $('#g-focus').value = b.playerFocus;
    this.toast('프리셋을 적용했습니다');
  }
}
