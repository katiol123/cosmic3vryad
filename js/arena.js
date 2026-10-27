'use strict';
// ============================================================
//  Окно сражения: корабли, снаряды, лучи, щиты, взрывы
// ============================================================

class Arena {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.b = null;
    this.vis = new Map();
    this.proj = [];
    this.parts = [];
    this.texts = [];
    this.rings = [];
    this.time = 0;
    this.shake = 0;
    this.dpr = 1;
    this.viewed = null;
    this.onShipClick = null;
    this.bgLayer = null;
    this.stars = [];
    this.hexPat = null;
    this.flashA = 0;
    canvas.addEventListener('pointerdown', e => {
      const s = this.pick(e);
      if (s && this.onShipClick) this.onShipClick(s);
    });
    canvas.addEventListener('pointermove', e => {
      canvas.style.cursor = this.pick(e) ? 'pointer' : 'default';
    });
  }

  pick(e) {
    const b = this.cv.getBoundingClientRect();
    const x = (e.clientX - b.left) * this.dpr, y = (e.clientY - b.top) * this.dpr;
    for (const V of this.vis.values()) {
      if (!V.ship.alive) continue;
      if (Math.hypot(x - V.x, y - V.y) < Math.max(V.len * 0.55, 26 * this.dpr)) return V.ship;
    }
    return null;
  }

  setBattle(b) {
    this.b = b;
    this.vis.clear();
    this.proj = []; this.parts = []; this.texts = []; this.rings = [];
    this.resize(true);
    for (const V of this.vis.values()) { V.x = this.sx(V.ship.x) + (V.ship.side ? 1 : -1) * this.cv.width * 0.5; V.ang = V.ship.heading; }
  }

  resize(force) {
    const r = this.cv.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.max(100, Math.floor(r.width * this.dpr)), H = Math.max(100, Math.floor(r.height * this.dpr));
    const changed = this.cv.width !== W || this.cv.height !== H;
    if (changed) { this.cv.width = W; this.cv.height = H; }
    if (changed || force || !this.bgLayer) {
      this.bgLayer = GFX.starfield(W, H, 4242, { nebula: ['#3a0ca3', '#4361ee', '#7209b7', '#b5179e', '#0f6e8c'] });
      this.addPlanet(this.bgLayer);
      this.stars = Array.from({ length: Math.floor(W * H / 9000) }, () => ({
        x: Math.random() * W, y: Math.random() * H, z: 0.3 + Math.random() * 0.7, tw: Math.random() * 6,
      }));
      this.layout();
    }
  }

  addPlanet(cv) {
    const ctx = cv.getContext('2d'), W = cv.width, H = cv.height;
    const R = Math.min(W, H) * 0.32, x = W * 0.83, y = H * 1.08;
    const atm = ctx.createRadialGradient(x, y, R * 0.9, x, y, R * 1.35);
    atm.addColorStop(0, 'rgba(90,160,255,0.35)'); atm.addColorStop(1, 'rgba(90,160,255,0)');
    ctx.fillStyle = atm; ctx.beginPath(); ctx.arc(x, y, R * 1.35, 0, Math.PI * 2); ctx.fill();
    const g = ctx.createRadialGradient(x - R * 0.4, y - R * 0.5, R * 0.1, x, y, R);
    g.addColorStop(0, '#5b7fd1'); g.addColorStop(0.5, '#243b7a'); g.addColorStop(1, '#070b1e');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.clip();
    for (let i = 0; i < 9; i++) {
      ctx.strokeStyle = `rgba(160,200,255,${0.04 + Math.random() * 0.05})`;
      ctx.lineWidth = R * (0.02 + Math.random() * 0.05);
      ctx.beginPath(); ctx.ellipse(x, y + (i - 4) * R * 0.18, R * 1.1, R * 0.08, -0.15, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
    // далёкая луна
    const mx = W * 0.12, my = H * 0.16, mr = Math.min(W, H) * 0.035;
    const mg = ctx.createRadialGradient(mx - mr * 0.4, my - mr * 0.4, 1, mx, my, mr);
    mg.addColorStop(0, '#d8d2c4'); mg.addColorStop(1, '#2b2723');
    ctx.fillStyle = mg; ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2); ctx.fill();
  }

  layout() {
    if (!this.b) return;
    const W = this.cv.width, H = this.cv.height, m = 26 * this.dpr;
    this.sc = this.sc0 = Math.min((W - m * 2) / FIELD_W, (H - m * 2) / FIELD_H);
    this.ox = (W - FIELD_W * this.sc) / 2;
    this.oy = (H - FIELD_H * this.sc) / 2;
    for (const s of this.b.ships) {
      let V = this.vis.get(s.id);
      const len = Math.max(24, Math.round(this.sc * 2.25 * s.hull.size / 4) * 4);
      const sprite = GFX.ship(s.hull.id, s.side, len);
      if (!V) {
        V = { ship: s, x: this.sx(s.x), y: this.sy(s.y), ang: s.heading, flash: 0, shieldFlash: 0, sfx: 0, sfy: 0, dying: -1, alpha: 1,
          phase: Math.random() * 6, hpShown: s.hp, shShown: s.shield, moving: 0 };
        this.vis.set(s.id, V);
      }
      V.len = len; V.sprite = sprite; V.ht = sprite.meta.ht;
    }
  }
  sx(x) { return this.ox + x * this.sc; }
  sy(y) { return this.oy + y * this.sc; }

  // перевод точки из системы координат спрайта (нос вправо) в экранную
  local(V, lx, ly) {
    const c = Math.cos(V.ang), s = Math.sin(V.ang), f = c < 0 ? -1 : 1;
    const y2 = ly * f;
    return [V.x + lx * c - y2 * s, V.y + lx * s + y2 * c];
  }
  muzzle(V, wi) {
    const mts = V.sprite.meta.mounts;
    const m = mts.length ? mts[wi % mts.length] : { x: V.len * 0.3, y: 0 };
    return this.local(V, m.x, m.y);
  }

  // ---------- API для боя ----------
  shoot(att, tgt, w, shot) {
    return new Promise(resolve => {
      const A = this.vis.get(att.id), T = this.vis.get(tgt.id);
      if (!A || !T) return resolve();
      const wi = att.weapons.indexOf(w);
      const [x0, y0] = this.muzzle(A, Math.max(0, wi));
      const ang = Math.atan2(T.y - A.y, T.x - A.x);
      const dir = Math.cos(ang) >= 0 ? 1 : -1;
      let x1, y1;
      const shieldUp = tgt.shield > 0;
      if (shot.hit) {
        if (shieldUp) {
          const a = ang + Math.PI + U.rf(-0.6, 0.6);
          x1 = T.x + Math.cos(a) * T.len * 0.55; y1 = T.y + Math.sin(a) * T.len * 0.55;
        } else {
          x1 = T.x + U.rf(-0.22, 0.22) * T.len; y1 = T.y + U.rf(-0.22, 0.22) * T.len;
        }
      } else {
        const side = Math.random() < 0.5 ? -1 : 1, over = T.len * U.rf(0.6, 1.4), off = T.len * U.rf(0.6, 1.1) * side;
        x1 = T.x + Math.cos(ang) * over - Math.sin(ang) * off;
        y1 = T.y + Math.sin(ang) * over + Math.cos(ang) * off;
      }
      const L = Math.hypot(x1 - x0, y1 - y0);
      const d = this.dpr;
      const col = DMG[w.dt].color;
      const speed = { bolt: 1600, tracer: 2300, plasma: 900, slug: 1800, torpedo: 560, missile: 780, swarm: 820, grav: 640, nano: 700, flak: 1900, quake: 1000, wave: 1100 }[w.fx];
      let impactAt, dur;
      if (speed) { impactAt = L / (speed * d); dur = impactAt + (shot.hit ? 0 : 0.25); }
      else {
        const inst = { beam: [0.06, 0.32], bigbeam: [0.32, 0.8], rail: [0.05, 0.55], anti: [0.42, 0.95], drain: [0.12, 0.6], arc: [0.06, 0.38], flame: [0.22, 0.5] }[w.fx] || [0.1, 0.3];
        [impactAt, dur] = inst;
      }
      const p = {
        kind: w.fx, x0, y0, x1, y1, t: 0, impactAt, dur, col, resolve, shot, done: false, tgt, att, T, A,
        seed: Math.random() * 1000, bend: U.rf(-1, 1), dir,
      };
      this.proj.push(p);
      // вспышка у дула
      this.muzzleFlash(x0, y0, col, ang, w.fx);
      if (window.Sound) Sound.shot(w.fx);
    });
  }

  muzzleFlash(x, y, col, ang, kind) {
    const n = kind === 'rail' || kind === 'anti' ? 14 : 6;
    for (let i = 0; i < n; i++) {
      const a = ang + U.rf(-0.5, 0.5);
      const s = U.rf(80, 260) * this.dpr;
      this.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0, max: U.rf(0.08, 0.22), size: U.rf(1, 2.5) * this.dpr, col, add: true, drag: 0.05 });
    }
    this.parts.push({ x, y, vx: 0, vy: 0, life: 0, max: 0.12, size: 9 * this.dpr, col: '#ffffff', add: true, glow: true });
  }

  // визуализация попадания (вызывается боем сразу после удара)
  hit(tgt, r, shot, w) {
    const T = this.vis.get(tgt.id);
    if (!T) return;
    const d = this.dpr;
    const ip = shot.ix != null ? [shot.ix, shot.iy] : [T.x + U.rf(-0.2, 0.2) * T.len, T.y];
    if (!shot.hit && !shot.mine && !shot.reflect) {
      Sound.hit('miss');
      this.text(T.x, T.y - T.ht * 0.6, shot.phased ? 'ФАЗА' : 'ПРОМАХ', '#9aa7c7', 0.8, 0.8);
      return;
    }
    if (!r) return;
    const total = r.shieldDmg + r.hullDmg;
    if (r.hullDmg > 0.5) Sound.hit('hull', r.hullDmg > 25 || shot.mine); else if (r.shieldDmg > 0.5) Sound.hit('shield');
    if (shot.crit) Sound.hit('crit');
    if (r.shieldDmg > 0.5) {
      T.shieldFlash = 1; T.sfx = ip[0] - T.x; T.sfy = ip[1] - T.y;
      this.rings.push({ x: ip[0], y: ip[1], t: 0, d: 0.4, r: 26 * d, col: '#7ab8ff' });
      for (let i = 0; i < 10; i++) {
        const a = Math.random() * Math.PI * 2, s = U.rf(40, 180) * d;
        this.parts.push({ x: ip[0], y: ip[1], vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0, max: U.rf(0.2, 0.45), size: U.rf(1, 2.5) * d, col: '#9cc3ff', add: true, drag: 0.1 });
      }
    }
    if (r.hullDmg > 0.5) {
      T.flash = Math.min(1, 0.4 + r.hullDmg / 40);
      const big = r.hullDmg > 25 || shot.crit;
      this.explosion(ip[0], ip[1], big ? 1.3 : 0.6 + r.hullDmg / 40, w ? DMG[w.dt].color : '#ffb347');
    }
    const cr = shot.crit;
    if (shot.asp && shot.asp !== 'front' && total > 0.5) this.text(ip[0], ip[1] + 14 * d, `${FLANK[shot.asp].name} ×${FLANK[shot.asp].k}`, shot.asp === 'rear' ? '#ff6b6b' : '#ffe066', 1, 0.7);
    const txt = (cr ? 'КРИТ −' : '−') + Math.round(total);
    const col = cr ? '#ffe066' : r.hullDmg > 0.5 ? '#ff6b6b' : '#7ab8ff';
    this.text(ip[0], ip[1] - 10 * d, txt, col, 1.1, cr ? 1.35 : 0.9 + Math.min(0.4, total / 80));
    if (cr || total > 35) this.shake = Math.max(this.shake, cr ? 9 : 5);
  }

  explosion(x, y, s = 1, col = '#ffb347') {
    const d = this.dpr;
    this.parts.push({ x, y, vx: 0, vy: 0, life: 0, max: 0.35 * s + 0.1, size: 28 * s * d, col: '#fff3c4', add: true, glow: true });
    this.parts.push({ x, y, vx: 0, vy: 0, life: 0, max: 0.5 * s + 0.15, size: 18 * s * d, col, add: true, glow: true });
    for (let i = 0; i < 16 * s + 4; i++) {
      const a = Math.random() * Math.PI * 2, sp = U.rf(60, 300) * d * s;
      this.parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: U.rf(0.25, 0.7), size: U.rf(1, 3) * d, col: Math.random() < 0.5 ? '#ffd166' : col, add: true, drag: 0.08, spark: true });
    }
    for (let i = 0; i < 4 * s; i++) {
      const a = Math.random() * Math.PI * 2, sp = U.rf(10, 50) * d;
      this.parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: U.rf(0.8, 1.6), size: U.rf(6, 14) * d * s, col: 'rgba(70,60,60,0.5)', smoke: true, drag: 0.3 });
    }
    this.rings.push({ x, y, t: 0, d: 0.45, r: 40 * s * d, col: '#ffcf8a' });
  }

  death(ship) {
    return new Promise(resolve => {
      const V = this.vis.get(ship.id);
      if (!V) return resolve();
      V.dying = 0;
      V.dieResolve = resolve;
    });
  }

  moved(ship) {
    const V = this.vis.get(ship.id);
    if (!V) return Promise.resolve();
    V.moving = 1;
    Sound.move();
    return Clock.wait(380);
  }

  ew(att, tgt, kind) {
    return new Promise(resolve => {
      const A = this.vis.get(att.id), T = this.vis.get(tgt.id);
      if (!A || !T) return resolve();
      const col = { jam: '#c0c6d0', freeze: '#9be7ff', virus: '#b6ff3b', mine: '#ff4d4d', siphon: '#00f0d0' }[kind] || '#00f0d0';
      this.proj.push({ kind: 'ew', x0: A.x, y0: A.y, x1: T.x, y1: T.y, t: 0, impactAt: 0.55, dur: 0.75, col, resolve, done: false, T, A, shot: { hit: true }, seed: Math.random() * 99 });
      this.text(A.x, A.y - A.len * 0.7, '⌁ ВЗЛОМ', col, 1, 0.9);
      Sound.hack();
    });
  }

  effect(tgt, e) {
    const T = this.vis.get(tgt.id);
    if (!T) return;
    const E = EFFECTS[e.k];
    Sound.effect();
    const col = { burn: '#ff9f1c', emp: '#4cc9f0', freeze: '#9be7ff', jam: '#c0c6d0', virus: '#b6ff3b', mine: '#ff4d4d', corrode: '#80ffdb',
      pull: '#b388ff', push: '#e9eef5', stun: '#ffe066', slow: '#b388ff', scramble: '#ffffff', drain: '#00f0d0' }[e.k] || '#fff';
    this.text(T.x + U.rf(-20, 20) * this.dpr, T.y + T.ht * 0.65, `${E.icon} ${E.name}`, col, 1.3, 0.75);
    if (e.k === 'emp' || e.k === 'stun') this.rings.push({ x: T.x, y: T.y, t: 0, d: 0.6, r: T.len * 0.9, col: '#4cc9f0' });
  }
  heal(ship, n) {
    const V = this.vis.get(ship.id);
    if (V) this.text(V.x, V.y - V.ht * 0.5, '+' + Math.round(n), '#2ee66b', 1, 0.8);
  }
  dot(ship, dmg) {
    const V = this.vis.get(ship.id);
    if (!V) return;
    for (let i = 0; i < 12; i++) {
      this.parts.push({ x: V.x + U.rf(-0.3, 0.3) * V.len, y: V.y + U.rf(-0.2, 0.2) * V.ht, vx: U.rf(-20, 20), vy: -U.rf(30, 90) * this.dpr, life: 0, max: U.rf(0.4, 0.8), size: U.rf(2, 5) * this.dpr, col: '#ff9f1c', add: true, drag: 0.2 });
    }
    this.text(V.x, V.y - V.ht * 0.5, '🔥 −' + Math.round(dmg), '#ff9f1c', 1, 0.85);
  }
  banner(ship, txt, cls) {
    const V = this.vis.get(ship.id);
    if (!V) return;
    const col = cls === 'bad' ? '#ff6b6b' : cls === 'combo' ? '#ffe066' : '#7df9ff';
    this.text(V.x, V.y - V.len * 0.75 - 20 * this.dpr, txt, col, 1.4, 1.1);
  }

  text(x, y, s, col, life = 1, scale = 1) {
    // свежие числа рядом не налезают друг на друга — выстраиваются столбиком
    const near = this.texts.filter(t => t.t < 0.8 && Math.abs(t.x - x) < 90 * this.dpr && Math.abs(t.y0 - y) < 40 * this.dpr).length;
    // шаг — полная высота строки с учётом увеличения, чтобы числа не слипались
    this.texts.push({ x, y: y - near * 22 * scale * this.dpr, y0: y, s, col, t: 0, d: life, scale });
    if (this.texts.length > 60) this.texts.shift();
  }

  // ---------- Обновление ----------
  // камера: плавно кадрирует живые корабли, чтобы они не жались к краю и не обрезались
  frameCamera(dt) {
    const alive = this.b.ships.filter(s => s.alive);
    if (!alive.length || !this.sc0) return;
    const W = this.cv.width, H = this.cv.height, m = 70 * this.dpr;
    let x0 = Math.min(...alive.map(s => s.x)), x1 = Math.max(...alive.map(s => s.x));
    let y0 = Math.min(...alive.map(s => s.y)), y1 = Math.max(...alive.map(s => s.y));
    const pad = 3.5;
    x0 -= pad; x1 += pad; y0 -= pad; y1 += pad;
    const minW = FIELD_W * 0.5, minH = FIELD_H * 0.5;
    if (x1 - x0 < minW) { const c = (x0 + x1) / 2; x0 = c - minW / 2; x1 = c + minW / 2; }
    if (y1 - y0 < minH) { const c = (y0 + y1) / 2; y0 = c - minH / 2; y1 = c + minH / 2; }
    const sc = U.clamp(Math.min((W - m * 2) / (x1 - x0), (H - m * 2) / (y1 - y0)), this.sc0 * 0.85, this.sc0 * 1.8);
    const ox = W / 2 - (x0 + x1) / 2 * sc, oy = H / 2 - (y0 + y1) / 2 * sc;
    const k = Math.min(1, dt * 1.4);
    this.sc += (sc - this.sc) * k; this.ox += (ox - this.ox) * k; this.oy += (oy - this.oy) * k;
  }

  update(dt) {
    this.time += dt;
    if (!this.b) return;
    this.frameCamera(dt);
    const d = this.dpr;
    for (const V of this.vis.values()) {
      const s = V.ship;
      const dx = this.sx(s.x) - V.x, dy = this.sy(s.y) - V.y;
      const k = Math.min(1, dt * 3.2);
      V.x += dx * k; V.y += dy * k;
      const da = U.angDiff(s.heading, V.ang);
      V.ang = U.angNorm(V.ang + da * Math.min(1, dt * 4));
      V.moving = Math.max(V.moving - dt * 1.2, Math.min(1, (Math.hypot(dx, dy) + Math.abs(da) * V.len) / (40 * d)));
      if (V.moving > 0.3 && Math.random() < 0.6) {
        const c = Math.cos(V.ang), sn = Math.sin(V.ang);
        for (const e of V.sprite.meta.engines) {
          const [ex, ey] = this.local(V, e.x, e.y);
          const sp = U.rf(60, 160) * d;
          this.parts.push({ x: ex, y: ey, vx: -c * sp + U.rf(-10, 10), vy: -sn * sp + U.rf(-10, 10), life: 0, max: U.rf(0.2, 0.5), size: U.rf(1.5, 3) * d, col: GFX.SIDE_PAL[s.side].glow, add: true, drag: 0.1 });
        }
      }
      V.flash = Math.max(0, V.flash - dt * 3);
      V.shieldFlash = Math.max(0, V.shieldFlash - dt * 2.2);
      V.hpShown += (s.hp - V.hpShown) * Math.min(1, dt * 5);
      V.shShown += (s.shield - V.shShown) * Math.min(1, dt * 5);
      if (V.dying >= 0) {
        V.dying += dt;
        if (V.dying < 1.0 && Math.random() < dt * 22) {
          this.explosion(V.x + U.rf(-0.4, 0.4) * V.len, V.y + U.rf(-0.3, 0.3) * V.ht, U.rf(0.4, 0.9), '#ff9f1c');
          this.shake = Math.max(this.shake, 4);
        }
        if (V.dying >= 1.0 && !V.boom) {
          V.boom = true;
          Sound.boom(true);
          this.explosion(V.x, V.y, 2.4, '#ffffff');
          this.rings.push({ x: V.x, y: V.y, t: 0, d: 0.9, r: V.len * 2.2, col: '#ffffff' });
          this.rings.push({ x: V.x, y: V.y, t: 0, d: 1.2, r: V.len * 3.2, col: GFX.SIDE_PAL[s.side].accent });
          this.flashA = 0.5;
          this.shake = 18;
          // обломки корпуса
          for (let i = 0; i < 18; i++) {
            const a = Math.random() * Math.PI * 2, sp = U.rf(40, 200) * d;
            this.parts.push({ x: V.x, y: V.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: U.rf(1.5, 3), size: U.rf(3, 9) * d * s.hull.size,
              col: GFX.SIDE_PAL[s.side].base, debris: true, rot: Math.random() * 6, vr: U.rf(-6, 6), drag: 0.6 });
          }
        }
        if (V.dying >= 1.0) V.alpha = Math.max(0, V.alpha - dt * 5);
        if (V.dying >= 1.5 && V.dieResolve) { V.dieResolve(); V.dieResolve = null; }
      }
    }
    // снаряды
    for (const p of this.proj) {
      p.t += dt;
      if (p.kind === 'missile' || p.kind === 'swarm' || p.kind === 'torpedo') {
        const [x, y] = this.projPos(p, Math.min(1, p.t / p.impactAt));
        if (Math.random() < 0.9) this.parts.push({ x, y, vx: U.rf(-8, 8), vy: U.rf(-8, 8), life: 0, max: p.kind === 'swarm' ? 0.35 : 0.8, size: (p.kind === 'torpedo' ? 6 : p.kind === 'swarm' ? 2.5 : 4) * d, col: 'rgba(170,170,190,0.35)', smoke: true, drag: 0.5 });
      } else if (p.kind === 'flame' && p.t < p.dur * 0.8) {
        for (let i = 0; i < 4; i++) {
          const u = Math.random();
          const sp = U.rf(0.8, 1.2);
          this.parts.push({ x: p.x0, y: p.y0, vx: (p.x1 - p.x0) / p.impactAt * sp * 0.9 + U.rf(-40, 40) * d, vy: (p.y1 - p.y0) / p.impactAt * sp * 0.9 + U.rf(-50, 50) * d,
            life: 0, max: p.impactAt * 1.15, size: U.rf(4, 9) * d * (0.5 + u), col: Math.random() < 0.5 ? '#ff9f1c' : '#ffd166', add: true, glow: true, drag: 0.02, grow: true });
        }
      } else if (p.kind === 'nano' && p.t < p.impactAt) {
        const [x, y] = this.projPos(p, p.t / p.impactAt);
        for (let i = 0; i < 3; i++) this.parts.push({ x: x + U.rf(-8, 8) * d, y: y + U.rf(-8, 8) * d, vx: U.rf(-30, 30), vy: U.rf(-30, 30), life: 0, max: 0.4, size: 1.6 * d, col: '#80ffdb', add: true, drag: 0.2 });
      }
      if (!p.done && p.t >= p.impactAt) {
        p.done = true;
        if (p.shot) { p.shot.ix = p.x1; p.shot.iy = p.y1; }
        if (p.shot && p.shot.hit) this.impactFx(p);
        p.resolve();
      }
    }
    this.proj = this.proj.filter(p => p.t < p.dur);
    for (const q of this.parts) {
      q.life += dt;
      q.x += q.vx * dt; q.y += q.vy * dt;
      if (q.drag != null) { const k = Math.pow(q.drag, dt); q.vx *= k; q.vy *= k; }
      if (q.rot != null) q.rot += q.vr * dt;
    }
    this.parts = this.parts.filter(q => q.life < q.max);
    if (this.parts.length > 2000) this.parts.splice(0, this.parts.length - 2000);
    this.texts = this.texts.filter(t => (t.t += dt) < t.d);
    this.rings = this.rings.filter(r => (r.t += dt) < r.d);
    this.shake = Math.max(0, this.shake - dt * 30);
    this.flashA = Math.max(0, this.flashA - dt * 1.5);
    for (const s of this.stars) s.x -= s.z * 6 * dt * d;
    for (const s of this.stars) if (s.x < 0) s.x += this.cv.width;
  }

  impactFx(p) {
    const d = this.dpr;
    const k = p.kind;
    if (k === 'grav' || k === 'quake') this.rings.push({ x: p.x1, y: p.y1, t: 0, d: 0.6, r: 50 * d, col: '#b388ff' });
    if (k === 'arc' || k === 'wave') this.rings.push({ x: p.x1, y: p.y1, t: 0, d: 0.4, r: 35 * d, col: '#4cc9f0' });
    if (k === 'torpedo') this.explosion(p.x1, p.y1, 1.6, '#ff6b35');
    if (k === 'plasma' || k === 'anti') this.explosion(p.x1, p.y1, k === 'anti' ? 1.5 : 0.9, p.col);
  }

  projPos(p, u) {
    if (p.kind === 'missile' || p.kind === 'swarm' || p.kind === 'torpedo') {
      // кривая Безье: ракеты уходят дугой
      const mx = (p.x0 + p.x1) / 2, my = (p.y0 + p.y1) / 2;
      const off = (p.kind === 'swarm' ? 120 : 70) * this.dpr * p.bend;
      const cx = mx, cy = my - off + (p.kind === 'swarm' ? Math.sin(u * 12 + p.seed) * 6 * this.dpr : 0);
      const a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, c = u * u;
      return [a * p.x0 + b * cx + c * p.x1, a * p.y0 + b * cy + c * p.y1];
    }
    return [U.lerp(p.x0, p.x1, u), U.lerp(p.y0, p.y1, u)];
  }

  // ---------- Отрисовка ----------
  render() {
    const ctx = this.ctx, W = this.cv.width, H = this.cv.height, d = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.bgLayer) ctx.drawImage(this.bgLayer, 0, 0);
    // мерцающие звёзды
    for (const s of this.stars) {
      const a = 0.35 + 0.35 * Math.sin(this.time * 2 + s.tw);
      ctx.fillStyle = `rgba(220,230,255,${a * s.z})`;
      ctx.fillRect(s.x, s.y, s.z * 1.6 * d, s.z * 1.6 * d);
    }
    if (!this.b) return;
    const sx = (Math.random() - 0.5) * this.shake * d, sy = (Math.random() - 0.5) * this.shake * d;
    ctx.translate(sx, sy);

    // тактическая сетка поля (клетка = 2 единицы дистанции)
    ctx.save();
    ctx.strokeStyle = 'rgba(120,170,255,0.06)'; ctx.lineWidth = 1;
    for (let i = 0; i <= FIELD_W; i += 2) { const x = this.sx(i); ctx.beginPath(); ctx.moveTo(x, this.sy(0)); ctx.lineTo(x, this.sy(FIELD_H)); ctx.stroke(); }
    for (let j = 0; j <= FIELD_H; j += 2) { const y = this.sy(j); ctx.beginPath(); ctx.moveTo(this.sx(0), y); ctx.lineTo(this.sx(FIELD_W), y); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(120,170,255,0.16)';
    ctx.strokeRect(this.sx(0), this.sy(0), FIELD_W * this.sc, FIELD_H * this.sc);
    ctx.restore();
    if (this.viewed && this.viewed.alive) this.drawArcs(ctx, this.vis.get(this.viewed.id));

    const active = this.b.active;
    // линия прицеливания активного корабля
    if (active && active.alive && active.target && active.target.alive) {
      const A = this.vis.get(active.id), T = this.vis.get(active.target.id);
      if (A && T) {
        ctx.save();
        ctx.setLineDash([6 * d, 8 * d]);
        ctx.lineDashOffset = -this.time * 30 * d;
        ctx.strokeStyle = active.side ? 'rgba(255,120,80,0.45)' : 'rgba(80,200,255,0.45)';
        ctx.lineWidth = 1.5 * d;
        ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(T.x, T.y); ctx.stroke();
        ctx.setLineDash([]);
        const dist = this.b.dist(active, active.target);
        const mx = (A.x + T.x) / 2, my = (A.y + T.y) / 2;
        ctx.font = `700 ${11 * d}px "Exo 2", sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(5,8,20,0.75)';
        ctx.fillRect(mx - 34 * d, my - 9 * d, 68 * d, 18 * d);
        ctx.fillStyle = '#cfe3ff';
        ctx.fillText(`дист. ${U.r1(dist)}`, mx, my);
        ctx.restore();
      }
    }

    for (const V of this.vis.values()) this.drawShip(ctx, V, V.ship === active);

    // снаряды и лучи (аддитивно)
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.proj) this.drawProj(ctx, p);
    ctx.restore();

    // частицы
    for (const q of this.parts) {
      const a = 1 - q.life / q.max;
      if (q.smoke) {
        ctx.globalAlpha = a * 0.6;
        ctx.fillStyle = q.col;
        ctx.beginPath(); ctx.arc(q.x, q.y, q.size * (1.5 - a * 0.5), 0, Math.PI * 2); ctx.fill();
      } else if (q.debris) {
        ctx.globalAlpha = Math.min(1, a * 2);
        ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.rot);
        ctx.fillStyle = q.col; ctx.fillRect(-q.size / 2, -q.size / 3, q.size, q.size * 0.66);
        ctx.fillStyle = 'rgba(255,150,60,0.8)'; ctx.fillRect(-q.size / 2, -q.size / 3, q.size * 0.25, q.size * 0.66);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const q of this.parts) {
      if (q.smoke || q.debris) continue;
      const a = 1 - q.life / q.max;
      if (q.glow) {
        const r = q.size * (q.grow ? 1.5 - a : 0.6 + 0.4 * (1 - a) + 0.4);
        const g = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, r);
        g.addColorStop(0, U.rgba(q.col.startsWith('#') ? q.col : '#ffffff', a));
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.globalAlpha = a;
        ctx.fillStyle = q.col;
        if (q.spark) {
          ctx.strokeStyle = q.col; ctx.lineWidth = q.size;
          ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x - q.vx * 0.03, q.y - q.vy * 0.03); ctx.stroke();
        } else { ctx.beginPath(); ctx.arc(q.x, q.y, q.size, 0, Math.PI * 2); ctx.fill(); }
        ctx.globalAlpha = 1;
      }
    }
    for (const r of this.rings) {
      const k = r.t / r.d;
      ctx.strokeStyle = U.rgba(r.col, (1 - k) * 0.8);
      ctx.lineWidth = (1 - k) * 6 * d + 1;
      ctx.beginPath(); ctx.arc(r.x, r.y, r.r * U.ease.outCubic(k), 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();

    // интерфейс над кораблями
    this._lab = [];
    for (const V of this.vis.values()) this.drawHud(ctx, V, V.ship === active);

    // тексты
    for (const t of this.texts) {
      const k = t.t / t.d;
      const s = (0.6 + 0.4 * U.ease.outBack(Math.min(1, k * 5))) * t.scale;
      ctx.save();
      ctx.globalAlpha = k > 0.65 ? (1 - k) / 0.35 : 1;
      ctx.translate(t.x, t.y - k * 34 * d);
      ctx.scale(s, s);
      ctx.font = `800 ${17 * d}px "Russo One", "Exo 2", sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 4 * d; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.strokeText(t.s, 0, 0);
      ctx.shadowColor = t.col; ctx.shadowBlur = 10 * d;
      ctx.fillStyle = t.col; ctx.fillText(t.s, 0, 0);
      ctx.restore();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.flashA > 0) { ctx.fillStyle = `rgba(255,245,230,${this.flashA})`; ctx.fillRect(0, 0, W, H); }
    // виньетка
    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  }

  drawShip(ctx, V, isActive) {
    const s = V.ship, d = this.dpr;
    if (V.alpha <= 0) return;
    const bob = Math.sin(this.time * 1.3 + V.phase) * 3 * d;
    const x = V.x, y = V.y + bob;
    const sp = V.sprite, cw = sp.canvas.width, ch = sp.canvas.height;
    const pal = GFX.SIDE_PAL[s.side];
    // кольцо активного корабля
    if (isActive && s.alive) {
      const p = 0.5 + 0.5 * Math.sin(this.time * 5);
      ctx.save();
      ctx.strokeStyle = U.rgba(pal.accent, 0.35 + p * 0.4);
      ctx.lineWidth = 2 * d;
      ctx.shadowColor = pal.accent; ctx.shadowBlur = 14 * d;
      ctx.beginPath(); ctx.arc(x, y, V.len * 0.62, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    ctx.globalAlpha = V.alpha;
    ctx.translate(x, y);
    ctx.rotate(V.ang + (V.dying >= 0 ? V.dying * 0.15 : 0));
    if (Math.cos(V.ang) < 0) ctx.scale(1, -1); // свет всегда сверху
    // пламя двигателей
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const e of sp.meta.engines) {
      const fl = e.r * (2.6 + V.moving * 4 + Math.sin(this.time * 40 + e.y) * 0.4 + Math.random() * 0.4);
      const g = ctx.createLinearGradient(e.x, 0, e.x - fl, 0);
      g.addColorStop(0, U.rgba(pal.flame[0], 0.95)); g.addColorStop(0.25, U.rgba(pal.flame[1], 0.8)); g.addColorStop(1, U.rgba(pal.flame[2], 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(e.x - fl / 2, e.y, fl / 2, e.r * 0.9, 0, 0, Math.PI * 2); ctx.fill();
      const gg = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, e.r * 2.2);
      gg.addColorStop(0, U.rgba(pal.flame[1], 0.6)); gg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(e.x, e.y, e.r * 2.2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    ctx.drawImage(sp.canvas, -cw / 2, -ch / 2);
    if (V.flash > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = V.flash * 0.8 * V.alpha;
      ctx.drawImage(sp.canvas, -cw / 2, -ch / 2);
      ctx.globalCompositeOperation = 'source-over';
    }
    if (!s.alive && V.dying < 0) { ctx.restore(); return; }
    ctx.restore();

    // щит
    if (s.alive && (s.shield > 0 || V.shieldFlash > 0) && s.s.maxShield > 0) {
      const rx = V.len * 0.62, ry = Math.max(V.ht * 0.62, V.len * 0.32);
      const frac = Math.min(1.5, s.shield / s.s.maxShield);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = frac > 1 ? `rgba(200,230,255,${0.3 + 0.15 * Math.sin(this.time * 6)})` : `rgba(120,180,255,${0.06 + 0.12 * frac + 0.04 * Math.sin(this.time * 2 + V.phase)})`;
      ctx.lineWidth = (frac > 1 ? 2.5 : 1.5) * d;
      ctx.beginPath(); ctx.ellipse(x, y, rx, ry, V.ang, 0, Math.PI * 2); ctx.stroke();
      if (V.shieldFlash > 0) {
        ctx.beginPath(); ctx.ellipse(x, y, rx, ry, V.ang, 0, Math.PI * 2); ctx.clip();
        const hx = x + V.sfx, hy = y + V.sfy;
        const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, rx * 1.4);
        g.addColorStop(0, `rgba(170,210,255,${V.shieldFlash * 0.75})`);
        g.addColorStop(0.4, `rgba(80,140,255,${V.shieldFlash * 0.25})`);
        g.addColorStop(1, 'rgba(40,80,255,0)');
        ctx.fillStyle = g; ctx.fillRect(x - rx, y - rx, rx * 2, rx * 2);
        ctx.globalAlpha = V.shieldFlash * 0.7;
        ctx.drawImage(this.hexPattern(), x - rx, y - rx, rx * 2, rx * 2);
      }
      ctx.restore();
    }
  }

  // Секторы обстрела и фланги выбранного корабля
  drawArcs(ctx, V) {
    if (!V) return;
    const s = V.ship, d = this.dpr, sc = this.sc;
    ctx.save();
    const seen = new Set();
    const ws = s.weapons.slice().sort((a, b) => b.range - a.range);
    for (const w of ws) {
      const key = w.range + '_' + w.arc;
      if (seen.has(key) || seen.size >= 3) continue;
      seen.add(key);
      const R = w.range * sc, a = w.arc >= 180 ? Math.PI : w.arc * Math.PI / 180;
      const col = DMG[w.dt].color;
      ctx.beginPath();
      if (a >= Math.PI) ctx.arc(V.x, V.y, R, 0, Math.PI * 2);
      else { ctx.moveTo(V.x, V.y); ctx.arc(V.x, V.y, R, V.ang - a, V.ang + a); ctx.closePath(); }
      ctx.fillStyle = U.rgba(col, 0.035);
      ctx.fill();
      ctx.setLineDash([4 * d, 6 * d]);
      ctx.strokeStyle = U.rgba(col, 0.3);
      ctx.lineWidth = 1 * d;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // кольцо флангов: нос / борт / корма
    const r = V.len * 0.78;
    const seg = (from, to, col) => {
      ctx.strokeStyle = col; ctx.lineWidth = 3 * d;
      ctx.beginPath(); ctx.arc(V.x, V.y, r, V.ang + from, V.ang + to); ctx.stroke();
    };
    const P = Math.PI;
    seg(-P / 3, P / 3, 'rgba(46,230,107,0.55)');
    seg(P / 3, 2 * P / 3, 'rgba(255,224,102,0.55)'); seg(-2 * P / 3, -P / 3, 'rgba(255,224,102,0.55)');
    seg(2 * P / 3, 4 * P / 3, 'rgba(255,77,77,0.6)');
    ctx.restore();
  }

  hexPattern() {
    if (this.hexPat) return this.hexPat;
    const cv = GFX.canvas(256, 160), c = cv.getContext('2d');
    c.strokeStyle = 'rgba(170,215,255,0.9)'; c.lineWidth = 1.2;
    const r = 10, h = r * Math.sqrt(3);
    for (let yy = -1; yy < 12; yy++) for (let xx = -1; xx < 18; xx++) {
      const cx = xx * r * 1.5, cy = yy * h + (xx % 2 ? h / 2 : 0);
      c.beginPath();
      for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; i ? c.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r) : c.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
      c.closePath(); c.stroke();
    }
    this.hexPat = cv;
    return cv;
  }

  drawHud(ctx, V, isActive) {
    const s = V.ship, d = this.dpr;
    if (!s.alive) return;
    const bw = Math.max(64 * d, V.len * 0.8), bh = 5 * d;
    const x = V.x - bw / 2, y = V.y - V.len * 0.62 - 12 * d;
    ctx.save();
    // имя
    ctx.font = `600 ${10.5 * d}px "Exo 2", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    // на узкой карте имена слипаются — подписываем только того, кто сейчас ходит
    if (this.cv.width / d >= 500 || isActive) {
      // подписи соседних кораблей не налезают друг на друга
      const tw = ctx.measureText(s.name).width, th = 13 * d;
      let ly = y - 6 * d;
      const lab = this._lab || (this._lab = []);
      for (let k = 0; k < 4 && lab.some(r => Math.abs(r.x - V.x) < (r.w + tw) / 2 + 4 * d && Math.abs(r.y - ly) < th); k++) ly -= th;
      lab.push({ x: V.x, y: ly, w: tw });
      ctx.lineWidth = 3 * d; ctx.strokeStyle = 'rgba(2,4,12,0.8)'; ctx.lineJoin = 'round';
      ctx.strokeText(s.name, V.x, ly);
      ctx.fillStyle = isActive ? '#ffffff' : 'rgba(210,225,255,0.85)';
      ctx.fillText(s.name, V.x, ly);
    }
    // щит
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x - 1, y - 5 * d - 1, bw + 2, bh * 0.7 + 2);
    ctx.fillRect(x - 1, y - 1, bw + 2, bh + 2);
    if (s.s.maxShield > 0) {
      ctx.fillStyle = '#3a86ff';
      ctx.fillRect(x, y - 5 * d, bw * U.clamp(V.shShown / s.s.maxShield, 0, 1), bh * 0.7);
    }
    const f = U.clamp(V.hpShown / s.s.maxHp, 0, 1);
    const g = ctx.createLinearGradient(x, 0, x + bw, 0);
    g.addColorStop(0, f < 0.3 ? '#ff3b3b' : f < 0.6 ? '#ffb347' : '#2ee66b');
    g.addColorStop(1, f < 0.3 ? '#ff7b7b' : f < 0.6 ? '#ffe066' : '#a6ffc4');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, bw * f, bh);
    // статусы
    const icons = s.statuses.map(st => EFFECTS[st.k] && EFFECTS[st.k].icon).filter(Boolean);
    if (icons.length) {
      ctx.font = `${11 * d}px sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(icons.join(' '), x, y + bh + 3 * d);
    }
    // рамка просматриваемого корабля
    if (this.viewed === s) {
      const p = 0.6 + 0.4 * Math.sin(this.time * 4);
      const hw = V.len * 0.62, hh = V.len * 0.62, k = 10 * d;
      ctx.strokeStyle = `rgba(255,255,255,${p})`; ctx.lineWidth = 2 * d;
      const cx = V.x, cy = V.y;
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        ctx.beginPath();
        ctx.moveTo(cx + sx * hw, cy + sy * hh - sy * k); ctx.lineTo(cx + sx * hw, cy + sy * hh); ctx.lineTo(cx + sx * hw - sx * k, cy + sy * hh);
        ctx.stroke();
      }
    }
    // прицел на цели активного корабля
    const act = this.b.active;
    if (act && act.alive && act.target === s) {
      const r = Math.max(V.len * 0.5, 22 * d);
      ctx.translate(V.x, V.y);
      ctx.rotate(this.time * 0.8);
      ctx.strokeStyle = 'rgba(255,70,70,0.8)'; ctx.lineWidth = 2 * d;
      for (let i = 0; i < 4; i++) {
        ctx.rotate(Math.PI / 2);
        ctx.beginPath(); ctx.arc(0, 0, r, -0.35, 0.35); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(r - 6 * d, 0); ctx.lineTo(r + 6 * d, 0); ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawProj(ctx, p) {
    const d = this.dpr;
    const k = p.kind;
    const col = p.col;
    const u = Math.min(1, p.t / p.impactAt);
    const fade = p.t > p.impactAt ? 1 - (p.t - p.impactAt) / Math.max(0.01, p.dur - p.impactAt) : 1;
    const beam = (w, a, c2) => {
      ctx.strokeStyle = U.rgba(col, a * 0.5); ctx.lineWidth = w * 3;
      ctx.beginPath(); ctx.moveTo(p.x0, p.y0); ctx.lineTo(p.x1, p.y1); ctx.stroke();
      ctx.strokeStyle = U.rgba(col, a); ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(p.x0, p.y0); ctx.lineTo(p.x1, p.y1); ctx.stroke();
      ctx.strokeStyle = U.rgba(c2 || '#ffffff', a); ctx.lineWidth = Math.max(1, w * 0.3);
      ctx.beginPath(); ctx.moveTo(p.x0, p.y0); ctx.lineTo(p.x1, p.y1); ctx.stroke();
    };
    const glowDot = (x, y, r, c, a = 1) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(0.3, U.rgba(c, a * 0.9)); g.addColorStop(1, U.rgba(c, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    };
    switch (k) {
      case 'beam': if (p.t >= 0) beam(3 * d * fade, fade); break;
      case 'bigbeam': case 'anti': {
        const big = k === 'anti';
        if (p.t < p.impactAt) { // зарядка
          const c = p.t / p.impactAt;
          glowDot(p.x0, p.y0, (8 + c * (big ? 26 : 16)) * d, col, 0.5 + c * 0.5);
        } else {
          const w = (big ? 12 : 7) * d * fade * (0.8 + 0.2 * Math.sin(p.t * 80));
          beam(w, fade, big ? '#f0e6ff' : '#ffffff');
          glowDot(p.x1, p.y1, w * 3, col, fade);
          glowDot(p.x0, p.y0, w * 2.5, col, fade);
        }
        break;
      }
      case 'rail': {
        beam(2.5 * d * fade, fade, '#ffffff');
        // спиральный след
        ctx.strokeStyle = U.rgba('#9ad1ff', fade * 0.6); ctx.lineWidth = 1.2 * d;
        ctx.beginPath();
        const n = 40;
        for (let i = 0; i <= n; i++) {
          const t = i / n;
          const x = U.lerp(p.x0, p.x1, t), y = U.lerp(p.y0, p.y1, t) + Math.sin(t * 40 + p.t * 20) * 4 * d * (1 + p.t * 3);
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.stroke();
        break;
      }
      case 'drain': {
        beam(3 * d * fade, fade, '#ffb3c1');
        for (let i = 0; i < 4; i++) {
          const t = (1 - ((p.t * 2 + i / 4) % 1));
          glowDot(U.lerp(p.x0, p.x1, t), U.lerp(p.y0, p.y1, t), 6 * d, '#ff4d6d', fade);
        }
        break;
      }
      case 'arc': {
        ctx.strokeStyle = U.rgba(col, fade); ctx.lineWidth = 2.2 * d;
        ctx.shadowColor = col; ctx.shadowBlur = 12 * d;
        for (let b = 0; b < 2; b++) {
          ctx.beginPath(); ctx.moveTo(p.x0, p.y0);
          const segs = 12;
          for (let i = 1; i <= segs; i++) {
            const t = i / segs, j = i === segs ? 0 : 16 * d;
            ctx.lineTo(U.lerp(p.x0, p.x1, t) + (Math.random() - 0.5) * j, U.lerp(p.y0, p.y1, t) + (Math.random() - 0.5) * j);
          }
          ctx.stroke();
        }
        ctx.shadowBlur = 0;
        break;
      }
      case 'wave': case 'quake': {
        for (let i = 0; i < 3; i++) {
          const t = U.clamp(u - i * 0.12, 0, 1);
          const [x, y] = this.projPos(p, t);
          const ang = Math.atan2(p.y1 - p.y0, p.x1 - p.x0);
          ctx.strokeStyle = U.rgba(k === 'quake' ? '#b388ff' : col, (1 - i * 0.3) * fade);
          ctx.lineWidth = 3 * d;
          ctx.beginPath(); ctx.arc(x, y, (10 + i * 5) * d, ang - 0.9, ang + 0.9); ctx.stroke();
        }
        break;
      }
      case 'grav': {
        const [x, y] = this.projPos(p, u);
        ctx.save();
        ctx.translate(x, y);
        for (let i = 0; i < 3; i++) {
          ctx.rotate(p.t * 6 + i * 2);
          ctx.strokeStyle = U.rgba('#b388ff', 0.7 * fade); ctx.lineWidth = 2 * d;
          ctx.beginPath(); ctx.ellipse(0, 0, 14 * d, 6 * d, 0, 0, Math.PI * 1.4); ctx.stroke();
        }
        ctx.restore();
        glowDot(x, y, 10 * d, '#7c4dff', fade);
        break;
      }
      case 'flame': break; // частицы
      case 'nano': {
        const [x, y] = this.projPos(p, u);
        glowDot(x, y, 9 * d, '#80ffdb', 0.8 * fade);
        break;
      }
      case 'ew': {
        for (let i = 0; i < 6; i++) {
          const t = U.clamp(u * 1.2 - i * 0.05, 0, 1);
          const x = U.lerp(p.x0, p.x1, t), y = U.lerp(p.y0, p.y1, t) + Math.sin(t * 20 + i) * 10 * d;
          ctx.fillStyle = U.rgba(col, 0.85 * fade);
          ctx.font = `700 ${11 * d}px monospace`;
          ctx.fillText(Math.random() < 0.5 ? '1' : '0', x, y);
        }
        if (p.t > p.impactAt) {
          const T = p.T;
          for (let i = 0; i < 6; i++) {
            ctx.fillStyle = U.rgba(col, 0.35 * fade);
            ctx.fillRect(T.x + U.rf(-0.5, 0.5) * T.len, T.y + U.rf(-0.4, 0.4) * T.ht, U.rf(8, 30) * d, U.rf(2, 5) * d);
          }
        }
        break;
      }
      default: { // летящие снаряды
        if (u >= 1 && p.shot && p.shot.hit) break;
        const tt = p.shot && !p.shot.hit ? p.t / p.dur : u;
        const [x, y] = this.projPos(p, Math.min(1.2, tt * (p.shot && !p.shot.hit ? 1 : 1)));
        const [px, py] = this.projPos(p, Math.max(0, tt - (k === 'tracer' || k === 'flak' ? 0.08 : 0.05)));
        if (k === 'plasma') { glowDot(x, y, 14 * d, col); glowDot(px, py, 8 * d, col, 0.5); }
        else if (k === 'torpedo') { glowDot(x, y, 12 * d * (0.8 + 0.2 * Math.sin(p.t * 30)), '#ff3d00'); }
        else if (k === 'missile' || k === 'swarm') {
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = (k === 'swarm' ? 2 : 3) * d;
          ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x, y); ctx.stroke();
          glowDot(px, py, (k === 'swarm' ? 4 : 7) * d, '#ffb347');
        } else {
          const w = (k === 'slug' ? 4 : k === 'bolt' ? 3.5 : 2) * d;
          ctx.strokeStyle = U.rgba(col, 0.9); ctx.lineWidth = w; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x, y); ctx.stroke();
          ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = w * 0.4;
          ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x, y); ctx.stroke();
          if (k === 'bolt' || k === 'slug') glowDot(x, y, w * 2.5, col, 0.8);
        }
      }
    }
  }
}
