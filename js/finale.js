// 세계 정복 피날레: 승리한 지도자 대관식 → 업적 → 각국 지도자 복종 의식 → 불꽃놀이
import { leaderOf, leaderPhoto } from './leaders.js?v=202609281745';

const wait = (ms, skip) => new Promise((r) => { const t = setTimeout(r, ms); skip.list.push(() => { clearTimeout(t); r(); }); });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const CROWN = `<svg class="fn-crown" viewBox="0 0 120 70"><path d="M8,62 L4,16 L32,38 L60,6 L88,38 L116,16 L112,62Z" fill="#f2d88f" stroke="#7a5a1e" stroke-width="4" stroke-linejoin="round"/><rect x="8" y="56" width="104" height="10" rx="3" fill="#c9a45c" stroke="#7a5a1e" stroke-width="3"/><circle cx="60" cy="40" r="7" fill="#e0403a" stroke="#7a5a1e" stroke-width="2"/><circle cx="30" cy="48" r="5" fill="#3d8bff" stroke="#7a5a1e" stroke-width="2"/><circle cx="90" cy="48" r="5" fill="#3d8bff" stroke="#7a5a1e" stroke-width="2"/><circle cx="4" cy="16" r="5" fill="#f2d88f" stroke="#7a5a1e" stroke-width="2"/><circle cx="60" cy="6" r="5" fill="#f2d88f" stroke="#7a5a1e" stroke-width="2"/><circle cx="116" cy="16" r="5" fill="#f2d88f" stroke="#7a5a1e" stroke-width="2"/></svg>`;

// 초상: 사진이 있으면 사진, 없으면 국기
const face = (n, cls) => leaderPhoto(n.id, cls) || `<span class="${cls} fn-flagface">${n.flag}</span>`;

export function playFinale({ game, me, stats, day, sound, mobile }) {
  return new Promise((done) => {
    const skip = { on: false, list: [] };
    const L = leaderOf(me.id);
    const title = L ? `황제 ${L[1]}` : `${me.name} 황제`;
    const who = L ? L[1] : me.name;

    // 업적 계산
    const T = game.territories;
    const others = [...game.nations.values()].filter((n) => n.id !== me.id);
    const capCaught = others.filter((n) => T.some((t) => t.cap && t.home === n.id && t.owner === me.id));
    const biggest = [...capCaught].sort((a, b) => b.gdp - a.gdp).slice(0, 3);
    const owned = game.owned(me.id).length;
    const share = (game.gdpShare(me.id) * 100).toFixed(1);
    const deeds = [
      ['🌏', `${Math.floor(day)}일 만에 세계 통일`, `세계 경제의 ${share}%를 손에 넣었습니다`],
      ['🏰', `${owned.toLocaleString()}개 지방 통치`, `전쟁으로 ${stats.captured.toLocaleString()}개 지방을 점령했습니다`],
      ['👑', `${capCaught.length}개국 수도 함락`, biggest.length ? `${biggest.map((n) => n.name).join(' · ')} 정복` : '적의 심장부를 무너뜨렸습니다'],
      ['⚔️', `출정 ${stats.battles.toLocaleString()}회`, `방어 성공 ${stats.repelled.toLocaleString()}회 · 멸망시킨 나라 ${stats.eliminated}개`],
      ['🎖️', `병력 ${Math.round(stats.built).toLocaleString()} 양성`, '역사상 가장 강한 군대를 길렀습니다'],
    ];

    // 복종하는 지도자: 경제 규모 순 (사진 있는 지도자 우선)
    const vassals = others.filter((n) => leaderOf(n.id)).sort((a, b) => (!!leaderPhoto(b.id) - !!leaderPhoto(a.id)) || b.gdp - a.gdp).slice(0, mobile ? 12 : 18);

    const el = document.createElement('div');
    el.id = 'finale';
    el.innerHTML = `
      <canvas class="fn-sky"></canvas>
      <div class="fn-rays"></div>
      <button class="fn-skip ghost">건너뛰기 ›</button>
      <div class="fn-stage">
        <div class="fn-kicker">${Math.floor(day)}일간의 대장정 끝에</div>
        <h1 class="fn-title">세계 통일</h1>
        <div class="fn-hero">
          ${CROWN}
          <div class="fn-portrait">${face(me, 'fn-face')}</div>
          <div class="fn-name">${esc(title)}</div>
          <div class="fn-sub">${me.flag} ${esc(me.name)} · 세계 정복 군주</div>
        </div>
        <ul class="fn-deeds">${deeds.map(([i, h, s]) => `<li><i>${i}</i><div><b>${esc(h)}</b><small>${esc(s)}</small></div></li>`).join('')}</ul>
        <div class="fn-court">
          <div class="fn-oath"></div>
          <div class="fn-vassals">${vassals.map((n) => { const l = leaderOf(n.id); return `<div class="fn-v"><div class="fn-body">${face(n, 'fn-vface')}<span class="fn-knee"></span></div><b>${n.flag} ${esc(l[1])}</b><small>${esc(n.name)} ${esc(l[0])}</small></div>`; }).join('')}</div>
        </div>
        <div class="fn-end"><button class="primary fn-go">전쟁 기록 보기</button></div>
      </div>`;
    document.body.appendChild(el);
    const $ = (s) => el.querySelector(s);
    const finish = () => { skip.on = true; skip.list.forEach((f) => f()); stopSky(); el.classList.add('out'); setTimeout(() => el.remove(), 600); done(); };
    $('.fn-skip').onclick = () => { if (!skip.on) finish(); };
    $('.fn-go').onclick = finish;

    // 불꽃놀이 캔버스
    const cv = $('.fn-sky'), ctx = cv.getContext('2d'), dpr = Math.min(2, devicePixelRatio || 1);
    const fit = () => { cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    fit(); addEventListener('resize', fit);
    let parts = [], raf = 0, fireOn = false, lastBurst = 0;
    const COLS = ['#f2d88f', '#ffd24a', '#ff6b5a', '#6fb8ff', '#b88bff', '#7df0b0', '#ffffff'];
    const burst = (x, y) => {
      const c = COLS[Math.random() * COLS.length | 0], n = mobile ? 40 : 70;
      for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, v = 1.5 + Math.random() * 4; parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, c }); }
      sound?.firework?.();
    };
    const loop = (t) => {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      if (fireOn && t - lastBurst > 520) { lastBurst = t; burst(innerWidth * (0.12 + Math.random() * 0.76), innerHeight * (0.1 + Math.random() * 0.35)); }
      ctx.globalCompositeOperation = 'lighter';
      parts = parts.filter((p) => (p.life -= 0.012) > 0);
      for (const p of parts) {
        p.vy += 0.045; p.vx *= 0.985; p.vy *= 0.985; p.x += p.vx; p.y += p.vy;
        ctx.globalAlpha = p.life; ctx.fillStyle = p.c; ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const stopSky = () => { cancelAnimationFrame(raf); removeEventListener('resize', fit); };

    // 연출 순서
    (async () => {
      const step = (cls) => { if (!skip.on) el.classList.add(cls); };
      await wait(80, skip); step('s1'); sound?.finaleIntro?.();
      await wait(2600, skip); step('s2'); sound?.coronation?.();
      await wait(1900, skip); step('s3');
      const lis = el.querySelectorAll('.fn-deeds li');
      for (const li of lis) { if (skip.on) return; li.classList.add('on'); li.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); sound?.medal?.(); await wait(650, skip); }
      await wait(1400, skip); step('s4');
      $('.fn-oath').textContent = `세계 각국 지도자들이 ${who} 황제 앞에 무릎을 꿇습니다`;
      await wait(1200, skip);
      const vs = el.querySelectorAll('.fn-v');
      for (let i = 0; i < vs.length; i++) {
        if (skip.on) return;
        vs[i].classList.add('in'); if (i % 4 === 0) vs[i].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        await wait(260, skip);
        vs[i].classList.add('bow'); sound?.bow?.(i);
        await wait(mobile ? 280 : 330, skip);
      }
      await wait(700, skip);
      $('.fn-oath').textContent = `“${who} 황제 폐하께 영원한 충성을 맹세합니다!”`;
      step('s5'); fireOn = true; sound?.anthem?.();
      await wait(2200, skip); step('s6');
      $('.fn-end').scrollIntoView({ behavior: 'smooth', block: 'end' });
    })();
  });
}
