// 미니맵: 세계 전체를 소유국 색으로 그리고, 현재 카메라가 보는 영역을 사각형으로 표시. 누르면 그 곳으로 이동.
export class Minimap {
  constructor(canvas, world, game, onPick) {
    this.cv = canvas; this.ctx = canvas.getContext('2d'); this.world = world; this.game = game;
    this.base = document.createElement('canvas'); this.base.width = canvas.width; this.base.height = canvas.height;
    this.dirty = true; this.t = 0;
    const W = canvas.width, H = canvas.height, x0 = -200, x1 = 200, z0 = world.yN, z1 = Math.min(world.yS, 60);
    this.sx = (x) => ((x - x0) / (x1 - x0)) * W;
    this.sz = (z) => ((z - z0) / (z1 - z0)) * H;
    this.inv = (px, py) => [x0 + (px / W) * (x1 - x0), z0 + (py / H) * (z1 - z0)];
    canvas.addEventListener('pointerdown', (e) => {
      const r = canvas.getBoundingClientRect();
      const [x, z] = this.inv(((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H);
      onPick(x, z);
      e.stopPropagation();
    });
  }
  redraw() {
    const g = this.base.getContext('2d'), P = this.world.provinces, T = this.game.territories;
    g.fillStyle = '#0b2033'; g.fillRect(0, 0, this.base.width, this.base.height);
    for (let i = 0; i < P.length; i++) {
      const n = this.game.nations.get(T[i].owner);
      g.fillStyle = n ? n.color : '#777';
      g.beginPath();
      for (const r of P[i].rings) {
        const step = r.length > 200 ? 6 : 2;
        g.moveTo(this.sx(r[0]), this.sz(r[1]));
        for (let k = step; k < r.length; k += step) g.lineTo(this.sx(r[k]), this.sz(r[k + 1]));
        g.closePath();
      }
      g.fill();
    }
    // 우리 영토는 밝은 테두리
    const me = this.game.opts.player;
    g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 1.2;
    for (let i = 0; i < P.length; i++) {
      if (T[i].owner !== me) continue;
      g.beginPath();
      for (const r of P[i].rings) { g.moveTo(this.sx(r[0]), this.sz(r[1])); for (let k = 4; k < r.length; k += 4) g.lineTo(this.sx(r[k]), this.sz(r[k + 1])); g.closePath(); }
      g.stroke();
    }
  }
  update(dt, target, camD, aspect) {
    if (!this.cv.offsetParent) return; // 폰처럼 미니맵이 숨겨진 화면에서는 그리지 않음
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.25;
    this.cool = (this.cool ?? 0) - 0.25;
    if (this.dirty && this.cool <= 0) { this.dirty = false; this.cool = 2; this.redraw(); } // 다시 그리기는 2초에 한 번까지
    const c = this.ctx; c.drawImage(this.base, 0, 0);
    // 카메라가 보는 대략의 영역
    const hw = camD * 0.55 * Math.max(1, aspect), hh = camD * 0.45;
    c.strokeStyle = '#f2d88f'; c.lineWidth = 2;
    c.strokeRect(this.sx(target.x - hw), this.sz(target.z - hh), this.sx(target.x + hw) - this.sx(target.x - hw), this.sz(target.z + hh) - this.sz(target.z - hh));
    // 진행 중인 전투 지점
    c.fillStyle = '#ff5b4a';
    for (const e of this.game.expeditions) if (e.state === 'battle') { c.beginPath(); c.arc(this.sx(e.to.x), this.sz(e.to.y), 3, 0, 6.3); c.fill(); }
  }
}
