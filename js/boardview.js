'use strict';
// ============================================================
//  Отрисовка игрового поля и анимации «3 в ряд»
// ============================================================

class BoardView {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.board = null;
    this.vis = new Map();
    this.dying = [];
    this.parts = [];
    this.fx = [];
    this.texts = [];
    this.cs = 40; this.ox = 0; this.oy = 0; this.dpr = 1;
    this.onMove = null;     // если задано — поле принимает ввод игрока
    this.sel = null;
    this.drag = null;
    this.hint = null;
    this.idle = 0;
    this.preview = null;
    this.shake = 0;
    this.time = 0;
    this.intro = 0;
    this.side = 0;
    this.bindInput();
  }

  resize() {
    const r = this.cv.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.max(50, Math.floor(r.width * this.dpr)), H = Math.max(50, Math.floor(r.height * this.dpr));
    if (this.cv.width !== W || this.cv.height !== H) { this.cv.width = W; this.cv.height = H; }
    const n = this.board ? this.board.w : 8;
    this.cs = Math.floor(Math.min(W, H) * 0.96 / n);
    this.ox = Math.floor((W - this.cs * n) / 2);
    this.oy = Math.floor((H - this.cs * n) / 2);
  }

  setBoard(board, side) {
    if (this.board === board) return;
    this.board = board;
    this.side = side || 0;
    this.vis.clear();
    this.dying = []; this.parts = []; this.fx = []; this.texts = [];
    this.sel = null; this.hint = null; this.preview = null; this.idle = 0;
    this.intro = 1;
    board.forEach((x, r, c) => {
      delete x.spawnY;
      this.vis.set(x.id, { x: c, y: r, vy: 0, scale: 0, delay: (r + c) * 0.025, bounce: 0, pulse: 0, wig: 0 });
    });
    this.resize();
  }

  // экранные координаты центра клетки (для летящих сфер)
  cellScreen(r, c) {
    const b = this.cv.getBoundingClientRect();
    return [b.left + (this.ox + (c + 0.5) * this.cs) / this.dpr, b.top + (this.oy + (r + 0.5) * this.cs) / this.dpr];
  }

  // ---------- События логики поля ----------
  event(ev) {
    const cs = this.cs;
    const px = c => this.ox + (c + 0.5) * cs, py = r => this.oy + (r + 0.5) * cs;
    switch (ev.k) {
      case 'swap': {
        for (const [p, q] of [[ev.a, ev.b], [ev.b, ev.a]]) {
          const x = this.board.at(p[0], p[1]);
          const v = x && this.vis.get(x.id);
          if (v) { v.mode = 'swap'; v.sx = q[1]; v.sy = q[0]; v.tt = 0; v.td = 0.2; }
        }
        this.sel = null; this.hint = null; this.preview = null;
        break;
      }
      case 'pop': {
        let orbs = 0;
        for (const p of ev.cells) {
          const v = this.vis.get(p.id);
          const x = v ? v.x : p.c, y = v ? v.y : p.r;
          this.vis.delete(p.id);
          this.dying.push({ x, y, t: 0, d: 0.3, cell: p });
          const col = p.t < 6 ? BLOCKS[p.t].color : p.t === T_JUNK ? '#9aa0aa' : '#ffffff';
          this.burst(this.ox + (x + 0.5) * cs, this.oy + (y + 0.5) * cs, col, p.t === T_JUNK ? 8 : 12);
          if (p.t < 6 && !p.frozen && !p.virus && orbs < 24 && window.Overlay) {
            orbs++;
            const [sx, sy] = this.cellScreen(y, x);
            Overlay.orb(sx, sy, p.t, p.mod === 'x2' ? 2 : 1);
          }
          if (p.mine) this.text(px(x), py(y), 'обезврежено', '#00f0d0', 0.7);
        }
        break;
      }
      case 'line': {
        this.fx.push({ k: 'line', r: ev.r, c: ev.c, dir: ev.dir, t: 0, d: 0.5, col: ev.t < 6 ? BLOCKS[ev.t].glow : '#fff', wide: ev.wide });
        this.shake = Math.max(this.shake, 6);
        break;
      }
      case 'bomb': {
        this.fx.push({ k: 'ring', x: px(ev.c), y: py(ev.r), t: 0, d: 0.55, rad: (ev.rad + 0.8) * cs * 1.2, col: ev.t < 6 ? BLOCKS[ev.t].glow : '#fff' });
        this.fx.push({ k: 'flash', x: px(ev.c), y: py(ev.r), t: 0, d: 0.3, rad: (ev.rad + 1) * cs });
        this.shake = Math.max(this.shake, 10 + ev.rad * 4);
        break;
      }
      case 'nova': {
        this.fx.push({ k: 'nova', x: px(ev.c), y: py(ev.r), t: 0, d: 0.6, targets: ev.targets.map(([r, c]) => [px(c), py(r)]),
          col: ev.t >= 0 && ev.t < 6 ? BLOCKS[ev.t].glow : '#ffffff' });
        this.fx.push({ k: 'ring', x: px(ev.c), y: py(ev.r), t: 0, d: 0.7, rad: cs * 5, col: '#ffffff' });
        this.shake = Math.max(this.shake, 14);
        break;
      }
      case 'make': {
        const x = this.board.at(ev.r, ev.c);
        const v = x && this.vis.get(x.id);
        if (v) v.pulse = 1;
        this.fx.push({ k: 'ring', x: px(ev.c), y: py(ev.r), t: 0, d: 0.45, rad: cs * 1.1, col: '#fff6c2' });
        const names = { h: 'ЛИНИЯ', v: 'ЛИНИЯ', bomb: 'БОМБА', nova: 'СВЕРХНОВАЯ' };
        this.text(px(ev.c), py(ev.r) - cs * 0.3, names[ev.sp], ev.sp === 'nova' ? '#ffffff' : '#ffe066', 0.9, 1.1);
        break;
      }
      case 'inject': {
        const col = { jam: '#a0a6b0', freeze: '#9be7ff', virus: '#b6ff3b', mine: '#ff4d4d' }[ev.kind] || '#fff';
        for (const [r, c] of ev.cells) {
          this.fx.push({ k: 'inject', x: px(c), y: py(r), t: 0, d: 0.6, col });
          this.burst(px(c), py(r), col, 8, 0.6);
          const x = this.board.at(r, c);
          const v = x && this.vis.get(x.id);
          if (v) v.wig = 1;
        }
        const label = { jam: 'ПОМЕХИ', freeze: 'ЗАМОРОЗКА', virus: 'ВИРУС', mine: 'МИНА!' }[ev.kind];
        if (label && ev.cells.length) this.text(this.ox + cs * 4, this.oy + cs * 3.5, label, col, 1.1, 1.3);
        if (ev.blocked) this.text(this.ox + cs * 4, this.oy + cs * 4.3, `отражено ${ev.blocked}`, '#7df9ff', 1, 0.9);
        break;
      }
      case 'mine': {
        this.fx.push({ k: 'ring', x: px(ev.c), y: py(ev.r), t: 0, d: 0.5, rad: cs * 2, col: '#ff6b35' });
        this.fx.push({ k: 'flash', x: px(ev.c), y: py(ev.r), t: 0, d: 0.35, rad: cs * 2 });
        this.burst(px(ev.c), py(ev.r), '#ffb347', 30, 1.6);
        this.text(px(ev.c), py(ev.r), 'ВЗРЫВ МИНЫ', '#ff6b35', 1.1, 1.2);
        this.shake = Math.max(this.shake, 16);
        break;
      }
      case 'cleanse': {
        for (const [r, c] of ev.cells) {
          this.burst(px(c), py(r), '#a6ffc4', 8, 0.7);
          this.fx.push({ k: 'ring', x: px(c), y: py(r), t: 0, d: 0.4, rad: cs * 0.7, col: '#a6ffc4' });
        }
        break;
      }
      case 'shuffle': {
        for (const [, v] of this.vis) {
          v.x += U.rf(-3, 3); v.y += U.rf(-3, 3); v.vy = 0; v.mode = null; v.spin = U.rf(-6, 6);
        }
        this.text(this.ox + cs * 4, this.oy + cs * 4, 'ПЕРЕТАСОВКА', '#ffffff', 1.1, 1.2);
        break;
      }
    }
  }

  burst(x, y, col, n, spd = 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = (60 + Math.random() * 220) * spd * (this.cs / 50);
      this.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0, max: 0.35 + Math.random() * 0.45,
        size: (1.5 + Math.random() * 3.5) * (this.cs / 50), col, star: Math.random() < 0.3 });
    }
    if (this.parts.length > 900) this.parts.splice(0, this.parts.length - 900);
  }
  text(x, y, s, col, life = 1, scale = 1) {
    this.texts.push({ x, y, s, col, t: 0, d: life, scale });
  }

  settled() {
    if (!this.board) return true;
    if (this.dying.length) return false;
    let ok = true;
    this.board.forEach((x, r, c) => {
      const v = this.vis.get(x.id);
      if (!v || Math.abs(v.x - c) > 0.02 || Math.abs(v.y - r) > 0.02 || v.mode) ok = false;
    });
    return ok;
  }

  // ---------- Ввод ----------
  bindInput() {
    const cellAt = e => {
      const b = this.cv.getBoundingClientRect();
      const x = (e.clientX - b.left) * this.dpr, y = (e.clientY - b.top) * this.dpr;
      const c = Math.floor((x - this.ox) / this.cs), r = Math.floor((y - this.oy) / this.cs);
      return this.board && this.board.inb(r, c) ? [r, c, x, y] : null;
    };
    this.cv.addEventListener('pointerdown', e => {
      if (!this.onMove || !this.board) return;
      const p = cellAt(e);
      if (!p) return;
      this.idle = 0; this.hint = null;
      if (this.sel && Math.abs(this.sel[0] - p[0]) + Math.abs(this.sel[1] - p[1]) === 1) {
        this.trySwap(this.sel[0], this.sel[1], p[0], p[1]);
        return;
      }
      this.sel = [p[0], p[1]];
      this.drag = { r: p[0], c: p[1], x: p[2], y: p[3] };
      this.cv.setPointerCapture(e.pointerId);
    });
    this.cv.addEventListener('pointermove', e => {
      if (!this.drag || !this.onMove) return;
      const b = this.cv.getBoundingClientRect();
      const x = (e.clientX - b.left) * this.dpr, y = (e.clientY - b.top) * this.dpr;
      const dx = x - this.drag.x, dy = y - this.drag.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) > this.cs * 0.42) {
        const { r, c } = this.drag;
        this.drag = null;
        if (Math.abs(dx) > Math.abs(dy)) this.trySwap(r, c, r, c + Math.sign(dx));
        else this.trySwap(r, c, r + Math.sign(dy), c);
      }
    });
    const up = () => { this.drag = null; };
    this.cv.addEventListener('pointerup', up);
    this.cv.addEventListener('pointercancel', up);
  }

  trySwap(r1, c1, r2, c2) {
    const b = this.board;
    this.sel = null;
    if (!b.inb(r2, c2)) return;
    if (b.canSwap(r1, c1, r2, c2)) {
      const f = this.onMove;
      this.onMove = null;
      f([r1, c1, r2, c2]);
    } else {
      for (const [r, c] of [[r1, c1], [r2, c2]]) {
        const x = b.at(r, c), v = x && this.vis.get(x.id);
        if (v) v.wig = 1;
      }
      const x1 = b.at(r1, c1), x2 = b.at(r2, c2);
      if ((x1 && x1.frozen) || (x2 && x2.frozen)) this.text(this.ox + (c1 + 0.5) * this.cs, this.oy + (r1 + 0.5) * this.cs, 'ЗАМОРОЖЕНО', '#9be7ff', 0.8, 0.8);
      else if ((x1 && x1.t === T_JUNK) || (x2 && x2.t === T_JUNK)) this.text(this.ox + (c1 + 0.5) * this.cs, this.oy + (r1 + 0.5) * this.cs, 'ОБЛОМКИ', '#a0a6b0', 0.8, 0.8);
    }
  }

  // ---------- Обновление ----------
  update(dt) {
    this.time += dt;
    if (!this.board) return;
    const b = this.board;
    if (this.intro > 0) this.intro = Math.max(0, this.intro - dt * 1.2);
    if (this.onMove) {
      this.idle += dt;
      if (this.idle > 6 && !this.hint && b.ship) this.hint = AI.chooseMove(b.ship, null);
    }
    const seen = new Set();
    for (let r = 0; r < b.h; r++) {
      for (let c = 0; c < b.w; c++) {
        const x = b.g[r][c];
        if (!x) continue;
        let v = this.vis.get(x.id);
        if (!v) {
          const sy = x.spawnY != null ? x.spawnY : r;
          delete x.spawnY;
          v = { x: c, y: sy, vy: 0, scale: 1, delay: 0, bounce: 0, pulse: 0, wig: 0 };
          this.vis.set(x.id, v);
        }
        seen.add(x.id);
        if (v.delay > 0) { v.delay -= dt; continue; }
        if (v.scale < 1) v.scale = Math.min(1, v.scale + dt * 4);
        if (v.mode === 'swap') {
          v.tt += dt;
          const k = U.ease.inOutCubic(Math.min(1, v.tt / v.td));
          v.x = U.lerp(v.sx, c, k); v.y = U.lerp(v.sy, r, k);
          if (v.tt >= v.td) { v.mode = null; v.x = c; v.y = r; }
        } else {
          v.x += (c - v.x) * Math.min(1, dt * 13);
          if (Math.abs(c - v.x) < 0.005) v.x = c;
          if (v.y < r - 0.001) {
            v.vy += 60 * dt;
            v.y += v.vy * dt;
            if (v.y >= r) { v.y = r; if (v.vy > 5) v.bounce = Math.min(1, v.vy / 16); v.vy = 0; }
          } else if (v.y > r) {
            v.y += (r - v.y) * Math.min(1, dt * 13);
            if (Math.abs(r - v.y) < 0.005) v.y = r;
            v.vy = 0;
          }
        }
        if (v.spin) { v.spin *= Math.pow(0.02, dt); if (Math.abs(v.spin) < 0.05) v.spin = 0; }
        v.bounce = Math.max(0, v.bounce - dt * 5);
        v.pulse = Math.max(0, v.pulse - dt * 1.5);
        v.wig = Math.max(0, v.wig - dt * 2.5);
      }
    }
    for (const id of this.vis.keys()) if (!seen.has(id)) this.vis.delete(id);
    this.dying = this.dying.filter(d => (d.t += dt) < d.d);
    for (const p of this.parts) {
      p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= Math.pow(0.12, dt); p.vy *= Math.pow(0.12, dt);
    }
    this.parts = this.parts.filter(p => p.life < p.max);
    this.fx = this.fx.filter(f => (f.t += dt) < f.d);
    this.texts = this.texts.filter(t => (t.t += dt) < t.d);
    this.shake = Math.max(0, this.shake - dt * 40);
  }

  // ---------- Отрисовка ----------
  render() {
    const ctx = this.ctx, W = this.cv.width, H = this.cv.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!this.board) return;
    const b = this.board, cs = this.cs, n = b.w;
    const sx = (Math.random() - 0.5) * this.shake, sy = (Math.random() - 0.5) * this.shake;
    ctx.translate(sx, sy);
    const ox = this.ox, oy = this.oy, size = cs * n;
    const sideCol = this.side === 0 ? '#4cc9f0' : '#ff6b35';

    // подложка
    ctx.save();
    ctx.beginPath(); GFX.roundRect(ctx, ox - cs * 0.12, oy - cs * 0.12, size + cs * 0.24, size + cs * 0.24, cs * 0.3);
    const bg = ctx.createLinearGradient(0, oy, 0, oy + size);
    bg.addColorStop(0, 'rgba(12,18,40,0.88)'); bg.addColorStop(1, 'rgba(5,7,18,0.92)');
    ctx.fillStyle = bg; ctx.fill();
    const glow = this.onMove ? 0.55 + 0.35 * Math.sin(this.time * 4) : 0.35;
    ctx.shadowColor = sideCol; ctx.shadowBlur = cs * 0.35 * glow;
    ctx.strokeStyle = U.rgba(sideCol, glow); ctx.lineWidth = Math.max(1.5, cs * 0.04); ctx.stroke();
    ctx.restore();
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      ctx.fillStyle = (r + c) % 2 ? 'rgba(255,255,255,0.025)' : 'rgba(120,160,255,0.045)';
      ctx.fillRect(ox + c * cs + 1, oy + r * cs + 1, cs - 2, cs - 2);
    }

    // клип по полю (падающие блоки появляются сверху)
    ctx.save();
    ctx.beginPath(); ctx.rect(ox - cs * 0.1, oy - cs * 0.1, size + cs * 0.2, size + cs * 0.2); ctx.clip();

    // подсказка / превью ИИ
    const hl = (r, c, col, a) => {
      ctx.save();
      ctx.shadowColor = col; ctx.shadowBlur = cs * 0.4;
      ctx.strokeStyle = U.rgba(col, a); ctx.lineWidth = cs * 0.07;
      ctx.beginPath(); GFX.roundRect(ctx, ox + c * cs + cs * 0.06, oy + r * cs + cs * 0.06, cs * 0.88, cs * 0.88, cs * 0.2); ctx.stroke();
      ctx.restore();
    };
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 7);
    if (this.hint) { hl(this.hint[0], this.hint[1], '#ffffff', 0.3 + 0.5 * pulse); hl(this.hint[2], this.hint[3], '#ffffff', 0.3 + 0.5 * pulse); }
    if (this.preview) {
      const [r1, c1, r2, c2] = this.preview;
      hl(r1, c1, '#ffe066', 0.9); hl(r2, c2, '#ffe066', 0.9);
      ctx.save();
      ctx.strokeStyle = 'rgba(255,224,102,0.9)'; ctx.lineWidth = cs * 0.08; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(ox + (c1 + 0.5) * cs, oy + (r1 + 0.5) * cs); ctx.lineTo(ox + (c2 + 0.5) * cs, oy + (r2 + 0.5) * cs); ctx.stroke();
      ctx.restore();
    }

    // блоки
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const x = b.g[r][c];
      if (!x) continue;
      const v = this.vis.get(x.id);
      if (!v || v.delay > 0) continue;
      this.drawCell(ctx, x, ox + v.x * cs, oy + v.y * cs, cs, v);
    }
    if (this.sel) hl(this.sel[0], this.sel[1], '#ffffff', 0.95);

    // исчезающие блоки
    for (const d of this.dying) {
      const k = d.t / d.d;
      const s = 1 + 0.35 * U.ease.outCubic(k);
      ctx.save();
      ctx.globalAlpha = 1 - k;
      const x = ox + d.x * cs, y = oy + d.y * cs;
      ctx.translate(x + cs / 2, y + cs / 2); ctx.scale(s, s); ctx.translate(-cs / 2, -cs / 2);
      const t = d.cell.t === T_NOVA ? 0 : d.cell.t;
      ctx.drawImage(GFX.block(t, cs), 0, 0);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = (1 - k) * 0.8;
      ctx.drawImage(GFX.block(t, cs), 0, 0);
      ctx.restore();
    }
    ctx.restore();

    // эффекты (аддитивно)
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const f of this.fx) this.drawFx(ctx, f);
    for (const p of this.parts) {
      const a = 1 - p.life / p.max;
      ctx.globalAlpha = a;
      ctx.fillStyle = p.col;
      if (p.star) {
        ctx.fillRect(p.x - p.size * 1.5, p.y - 0.6, p.size * 3, 1.2);
        ctx.fillRect(p.x - 0.6, p.y - p.size * 1.5, 1.2, p.size * 3);
      } else {
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.5 + a * 0.5), 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();

    // тексты
    for (const t of this.texts) {
      const k = t.t / t.d;
      const s = (0.7 + 0.3 * U.ease.outBack(Math.min(1, k * 4))) * t.scale;
      ctx.save();
      ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
      ctx.translate(t.x, t.y - k * cs * 0.8);
      ctx.scale(s, s);
      ctx.font = `800 ${Math.round(cs * 0.42)}px "Russo One", "Exo 2", sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = cs * 0.09; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.strokeText(t.s, 0, 0);
      ctx.shadowColor = t.col; ctx.shadowBlur = cs * 0.3;
      ctx.fillStyle = t.col; ctx.fillText(t.s, 0, 0);
      ctx.restore();
    }
    // вступительная вспышка при переключении поля
    if (this.intro > 0) {
      ctx.fillStyle = U.rgba(sideCol, this.intro * 0.18);
      ctx.fillRect(ox, oy, size, size);
    }
  }

  drawCell(ctx, x, X, Y, cs, v) {
    const t = this.time;
    ctx.save();
    const wig = v.wig ? Math.sin(v.wig * 30) * v.wig * cs * 0.08 : 0;
    ctx.translate(X + cs / 2 + wig, Y + cs / 2);
    if (v.spin) ctx.rotate(v.spin * 0.15);
    const sq = v.bounce;
    const sc = v.scale * (1 + v.pulse * 0.25 * Math.sin(v.pulse * 12));
    ctx.scale(sc * (1 + sq * 0.1), sc * (1 - sq * 0.14));
    ctx.translate(-cs / 2, -cs / 2 + sq * cs * 0.06);
    if (x.t === T_NOVA) this.drawNova(ctx, cs);
    else ctx.drawImage(GFX.block(x.t, cs), 0, 0);

    // спецблоки
    if (x.sp === 'h' || x.sp === 'v') {
      ctx.save();
      ctx.translate(cs / 2, cs / 2);
      if (x.sp === 'v') ctx.rotate(Math.PI / 2);
      ctx.globalCompositeOperation = 'lighter';
      const shimmer = (t * 2) % 1;
      const g = ctx.createLinearGradient(-cs / 2, 0, cs / 2, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(Math.max(0, shimmer - 0.15), 'rgba(255,255,255,0.15)');
      g.addColorStop(shimmer, 'rgba(255,255,255,0.95)');
      g.addColorStop(Math.min(1, shimmer + 0.15), 'rgba(255,255,255,0.15)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(-cs * 0.46, -cs * 0.2, cs * 0.92, cs * 0.08);
      ctx.fillRect(-cs * 0.46, cs * 0.12, cs * 0.92, cs * 0.08);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      for (const s of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(s * cs * 0.49, 0); ctx.lineTo(s * cs * 0.36, -cs * 0.1); ctx.lineTo(s * cs * 0.36, cs * 0.1); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    } else if (x.sp === 'bomb') {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const p = 0.5 + 0.5 * Math.sin(t * 6);
      ctx.strokeStyle = `rgba(255,240,180,${0.5 + p * 0.5})`;
      ctx.lineWidth = cs * 0.06;
      ctx.shadowColor = '#ffd166'; ctx.shadowBlur = cs * 0.3;
      ctx.beginPath(); ctx.arc(cs / 2, cs / 2, cs * (0.4 + p * 0.04), 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([cs * 0.08, cs * 0.08]);
      ctx.lineDashOffset = -t * cs * 0.5;
      ctx.beginPath(); ctx.arc(cs / 2, cs / 2, cs * 0.32, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    // модификаторы
    if (x.mod === 'x2') {
      ctx.save();
      const bx = cs * 0.72, by = cs * 0.76;
      ctx.fillStyle = 'rgba(20,10,0,0.75)';
      ctx.beginPath(); GFX.roundRect(ctx, bx - cs * 0.2, by - cs * 0.12, cs * 0.4, cs * 0.24, cs * 0.08); ctx.fill();
      ctx.font = `800 ${Math.round(cs * 0.2)}px "Russo One", sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowColor = '#ffd166'; ctx.shadowBlur = cs * 0.15;
      ctx.fillStyle = '#ffe066'; ctx.fillText('×2', bx, by + 1);
      ctx.restore();
    } else if (x.mod === 'crit') {
      ctx.save();
      ctx.translate(cs * 0.76, cs * 0.24);
      ctx.rotate(t * 1.5);
      const s = cs * (0.13 + 0.02 * Math.sin(t * 8));
      ctx.shadowColor = '#fff3a0'; ctx.shadowBlur = cs * 0.25;
      ctx.fillStyle = '#ffe066';
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2, rr = i % 2 ? s * 0.45 : s;
        i ? ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    // вредоносные состояния
    if (x.frozen) {
      ctx.save();
      ctx.beginPath(); GFX.roundRect(ctx, cs * 0.05, cs * 0.05, cs * 0.9, cs * 0.9, cs * 0.18);
      const ig = ctx.createLinearGradient(0, 0, cs, cs);
      ig.addColorStop(0, 'rgba(220,250,255,0.65)'); ig.addColorStop(0.5, 'rgba(140,210,255,0.35)'); ig.addColorStop(1, 'rgba(200,240,255,0.6)');
      ctx.fillStyle = ig; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = cs * 0.035; ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = cs * 0.02;
      ctx.beginPath(); ctx.moveTo(cs * 0.2, cs * 0.3); ctx.lineTo(cs * 0.45, cs * 0.5); ctx.lineTo(cs * 0.4, cs * 0.75);
      ctx.moveTo(cs * 0.45, cs * 0.5); ctx.lineTo(cs * 0.78, cs * 0.42); ctx.stroke();
      ctx.font = `700 ${Math.round(cs * 0.2)}px "Exo 2", sans-serif`;
      ctx.fillStyle = '#e8fbff'; ctx.textAlign = 'right'; ctx.fillText(String(x.frozen), cs * 0.88, cs * 0.26);
      ctx.restore();
    }
    if (x.virus) {
      ctx.save();
      const p = 0.5 + 0.5 * Math.sin(t * 5 + x.id);
      ctx.fillStyle = `rgba(90,255,40,${0.18 + p * 0.15})`;
      ctx.beginPath(); GFX.roundRect(ctx, cs * 0.05, cs * 0.05, cs * 0.9, cs * 0.9, cs * 0.18); ctx.fill();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 5; i++) {
        const a = t * 1.8 + i * 1.26 + x.id;
        const rr = cs * (0.28 + 0.08 * Math.sin(t * 3 + i));
        ctx.fillStyle = i % 2 ? 'rgba(182,255,59,0.85)' : 'rgba(200,80,255,0.8)';
        ctx.beginPath(); ctx.arc(cs / 2 + Math.cos(a) * rr, cs / 2 + Math.sin(a) * rr, cs * 0.06, 0, Math.PI * 2); ctx.fill();
      }
      ctx.font = `800 ${Math.round(cs * 0.36)}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(200,255,120,0.9)'; ctx.fillText('☣', cs / 2, cs / 2);
      ctx.restore();
    }
    if (x.mine) {
      ctx.save();
      const p = 0.5 + 0.5 * Math.sin(t * (x.mine === 1 ? 14 : 6));
      ctx.translate(cs / 2, cs / 2);
      ctx.shadowColor = '#ff2d2d'; ctx.shadowBlur = cs * 0.4 * p;
      ctx.fillStyle = '#2a0b0b';
      ctx.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2 + t * 0.5, rr = i % 2 ? cs * 0.25 : cs * 0.36;
        i ? ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = `rgba(255,60,60,${0.6 + 0.4 * p})`; ctx.lineWidth = cs * 0.04; ctx.stroke();
      ctx.font = `800 ${Math.round(cs * 0.3)}px "Russo One", sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffdddd'; ctx.fillText(String(x.mine), 0, 1);
      ctx.restore();
    }
    ctx.restore();
  }

  drawNova(ctx, cs) {
    const t = this.time;
    const c = cs / 2;
    ctx.save();
    const g = ctx.createRadialGradient(c, c, 0, c, c, cs * 0.46);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.25, '#e0d0ff'); g.addColorStop(0.6, '#3b1a6b'); g.addColorStop(1, 'rgba(10,0,30,0.9)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(c, c, cs * 0.44, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 6; i++) {
      const a = t * 2 + (i / 6) * Math.PI * 2;
      ctx.strokeStyle = U.rgba(BLOCKS[i].color, 0.9);
      ctx.lineWidth = cs * 0.06;
      ctx.beginPath(); ctx.arc(c, c, cs * 0.38, a, a + 0.8); ctx.stroke();
    }
    ctx.fillStyle = `rgba(255,255,255,${0.6 + 0.4 * Math.sin(t * 9)})`;
    ctx.beginPath(); ctx.arc(c, c, cs * 0.1, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < 4; i++) {
      const a = -t * 3 + i * Math.PI / 2;
      ctx.fillRect(c + Math.cos(a) * cs * 0.22 - 1, c + Math.sin(a) * cs * 0.22 - 1, 2.5, 2.5);
    }
    ctx.restore();
  }

  drawFx(ctx, f) {
    const cs = this.cs, k = f.t / f.d;
    if (f.k === 'line') {
      const a = 1 - k;
      const wd = cs * (f.wide ? 2.6 : 0.9) * (0.4 + U.ease.outCubic(Math.min(1, k * 3)) * 0.6);
      const cx = this.ox + (f.c + 0.5) * cs, cy = this.oy + (f.r + 0.5) * cs;
      const len = cs * 8 * U.ease.outCubic(Math.min(1, k * 2.5));
      ctx.save();
      ctx.translate(cx, cy);
      if (f.dir === 'v') ctx.rotate(Math.PI / 2);
      const g = ctx.createLinearGradient(0, -wd / 2, 0, wd / 2);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, U.rgba(f.col.startsWith('#') ? f.col : '#ffffff', a)); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(-len, -wd / 2, len * 2, wd);
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      ctx.fillRect(-len, -wd * 0.06, len * 2, wd * 0.12);
      ctx.restore();
    } else if (f.k === 'ring') {
      const r = f.rad * U.ease.outCubic(k);
      ctx.strokeStyle = U.rgba(f.col, (1 - k) * 0.9);
      ctx.lineWidth = cs * 0.14 * (1 - k) + 1;
      ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, Math.PI * 2); ctx.stroke();
    } else if (f.k === 'flash') {
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.rad);
      g.addColorStop(0, `rgba(255,255,240,${(1 - k) * 0.9})`); g.addColorStop(1, 'rgba(255,200,120,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(f.x, f.y, f.rad, 0, Math.PI * 2); ctx.fill();
    } else if (f.k === 'nova') {
      ctx.strokeStyle = U.rgba(f.col, 1 - k);
      ctx.lineWidth = cs * 0.05;
      ctx.shadowColor = f.col; ctx.shadowBlur = cs * 0.2;
      for (const [tx, ty] of f.targets) {
        ctx.beginPath(); ctx.moveTo(f.x, f.y);
        const segs = 5;
        for (let i = 1; i <= segs; i++) {
          const u = i / segs;
          const j = i === segs ? 0 : cs * 0.25;
          ctx.lineTo(U.lerp(f.x, tx, u) + (Math.random() - 0.5) * j, U.lerp(f.y, ty, u) + (Math.random() - 0.5) * j);
        }
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
    } else if (f.k === 'inject') {
      const a = Math.sin(k * Math.PI);
      ctx.strokeStyle = U.rgba(f.col, a);
      ctx.lineWidth = cs * 0.08;
      const s = cs * (0.9 - k * 0.4);
      ctx.strokeRect(f.x - s / 2, f.y - s / 2, s, s);
      ctx.fillStyle = U.rgba(f.col, a * 0.25);
      ctx.fillRect(f.x - s / 2, f.y - s / 2, s, s);
    }
  }
}
