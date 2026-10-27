'use strict';
// ============================================================
//  Процедурная графика: блоки поля, корабли, звёздное небо
// ============================================================

const GFX = {
  cache: new Map(),

  canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
    return c;
  },

  // ---------- Формы блоков ----------
  shapePath(ctx, kind, s) {
    const c = s / 2, r = s * 0.44;
    ctx.beginPath();
    const poly = (n, rot, rr = r) => {
      for (let i = 0; i < n; i++) {
        const a = rot + (i / n) * Math.PI * 2;
        const x = c + Math.cos(a) * rr, y = c + Math.sin(a) * rr;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath();
    };
    switch (kind) {
      case 0: GFX.roundRect(ctx, c - r * 0.92, c - r * 0.92, r * 1.84, r * 1.84, r * 0.38); break;
      case 1: poly(8, Math.PI / 8, r * 1.02); break;
      case 2: poly(6, -Math.PI / 2, r * 1.06); break;
      case 3: ctx.arc(c, c, r * 0.98, 0, Math.PI * 2); break;
      case 4: poly(4, -Math.PI / 2, r * 1.14); break;
      case 5: poly(5, -Math.PI / 2, r * 1.07); break;
      default: ctx.arc(c, c, r, 0, Math.PI * 2);
    }
  },
  roundRect(ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  },

  // ---------- Иконки блоков (в системе координат -1..1) ----------
  icon(ctx, t) {
    ctx.beginPath();
    switch (t) {
      case 0: // молния
        ctx.moveTo(0.18, -0.9); ctx.lineTo(-0.5, 0.12); ctx.lineTo(-0.04, 0.12); ctx.lineTo(-0.22, 0.9);
        ctx.lineTo(0.5, -0.16); ctx.lineTo(0.04, -0.16); ctx.lineTo(0.3, -0.9); ctx.closePath(); break;
      case 1: // снаряды
        for (const dx of [-0.42, 0, 0.42]) {
          ctx.moveTo(dx - 0.14, 0.7); ctx.lineTo(dx - 0.14, -0.25);
          ctx.quadraticCurveTo(dx - 0.14, -0.72, dx, -0.82);
          ctx.quadraticCurveTo(dx + 0.14, -0.72, dx + 0.14, -0.25);
          ctx.lineTo(dx + 0.14, 0.7); ctx.closePath();
        }
        break;
      case 2: // щит-герб
        ctx.moveTo(0, -0.85); ctx.lineTo(0.68, -0.58); ctx.quadraticCurveTo(0.68, 0.45, 0, 0.88);
        ctx.quadraticCurveTo(-0.68, 0.45, -0.68, -0.58); ctx.closePath(); break;
      case 3: // крест ремонта
        ctx.moveTo(-0.24, -0.75); ctx.lineTo(0.24, -0.75); ctx.lineTo(0.24, -0.24); ctx.lineTo(0.75, -0.24);
        ctx.lineTo(0.75, 0.24); ctx.lineTo(0.24, 0.24); ctx.lineTo(0.24, 0.75); ctx.lineTo(-0.24, 0.75);
        ctx.lineTo(-0.24, 0.24); ctx.lineTo(-0.75, 0.24); ctx.lineTo(-0.75, -0.24); ctx.lineTo(-0.24, -0.24); ctx.closePath(); break;
      case 4: // шевроны манёвра
        for (const dy of [-0.38, 0.22]) {
          ctx.moveTo(-0.62, dy + 0.34); ctx.lineTo(0, dy - 0.3); ctx.lineTo(0.62, dy + 0.34);
          ctx.lineTo(0.62, dy + 0.62); ctx.lineTo(0, dy); ctx.lineTo(-0.62, dy + 0.62); ctx.closePath();
        }
        break;
      case 5: // глаз-сенсор
        ctx.moveTo(-0.85, 0); ctx.quadraticCurveTo(0, -0.75, 0.85, 0); ctx.quadraticCurveTo(0, 0.75, -0.85, 0); ctx.closePath();
        ctx.moveTo(0.3, 0); ctx.arc(0, 0, 0.3, 0, Math.PI * 2, true);
        break;
    }
  },

  // Спрайт блока
  block(t, size) {
    const key = `b${t}_${size}`;
    if (GFX.cache.has(key)) return GFX.cache.get(key);
    const s = size, cv = GFX.canvas(s, s), ctx = cv.getContext('2d');
    if (t === T_JUNK) GFX.drawJunk(ctx, s);
    else if (t < 6) {
      const B = BLOCKS[t];
      // свечение
      ctx.save();
      ctx.shadowColor = U.rgba(B.color, 0.7); ctx.shadowBlur = s * 0.12;
      GFX.shapePath(ctx, t, s);
      const g = ctx.createRadialGradient(s * 0.36, s * 0.3, s * 0.05, s * 0.5, s * 0.55, s * 0.62);
      g.addColorStop(0, U.shade(B.color, 0.55));
      g.addColorStop(0.45, B.color);
      g.addColorStop(1, U.shade(B.color, -0.6));
      ctx.fillStyle = g; ctx.fill();
      ctx.restore();
      // рамка
      GFX.shapePath(ctx, t, s);
      ctx.lineWidth = Math.max(1, s * 0.035);
      ctx.strokeStyle = U.shade(B.color, -0.55); ctx.stroke();
      // внутренняя грань
      ctx.save();
      GFX.shapePath(ctx, t, s); ctx.clip();
      ctx.lineWidth = s * 0.05; ctx.strokeStyle = U.rgba('#ffffff', 0.18);
      ctx.translate(s * 0.5, s * 0.5); ctx.scale(0.86, 0.86); ctx.translate(-s * 0.5, -s * 0.5);
      GFX.shapePath(ctx, t, s); ctx.stroke();
      ctx.restore();
      // блик
      ctx.save();
      GFX.shapePath(ctx, t, s); ctx.clip();
      const hg = ctx.createLinearGradient(0, 0, 0, s * 0.55);
      hg.addColorStop(0, 'rgba(255,255,255,0.45)'); hg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = hg;
      ctx.beginPath(); ctx.ellipse(s * 0.42, s * 0.2, s * 0.42, s * 0.22, -0.3, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      // иконка
      ctx.save();
      ctx.translate(s / 2, s / 2 + s * 0.01);
      ctx.scale(s * 0.22, s * 0.22);
      GFX.icon(ctx, t);
      ctx.shadowColor = U.shade(B.color, -0.7); ctx.shadowBlur = s * 0.06; ctx.shadowOffsetY = s * 0.02;
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.fill('evenodd');
      ctx.restore();
    }
    GFX.cache.set(key, cv);
    return cv;
  },

  drawJunk(ctx, s) {
    const rnd = U.seeded(77);
    const c = s / 2, pts = [];
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2;
      const r = s * (0.33 + rnd() * 0.1);
      pts.push([c + Math.cos(a) * r, c + Math.sin(a) * r]);
    }
    ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
    const g = ctx.createRadialGradient(s * 0.38, s * 0.35, 1, c, c, s * 0.5);
    g.addColorStop(0, '#8a8f98'); g.addColorStop(0.6, '#4a4e57'); g.addColorStop(1, '#23252b');
    ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = s * 0.03; ctx.strokeStyle = '#15161a'; ctx.stroke();
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(c + (rnd() - 0.5) * s * 0.4, c + (rnd() - 0.5) * s * 0.4, s * (0.04 + rnd() * 0.05), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1; ctx.stroke();
    }
    // ржавые полосы-обломки металла
    ctx.strokeStyle = 'rgba(255,140,60,0.35)'; ctx.lineWidth = s * 0.025;
    ctx.beginPath(); ctx.moveTo(s * 0.3, s * 0.62); ctx.lineTo(s * 0.62, s * 0.42); ctx.stroke();
  },

  // ---------- Корабли ----------
  SIDE_PAL: [
    { base: '#5f7fa8', dark: '#1d2a3d', accent: '#4cc9f0', glow: '#7df9ff', flame: ['#ffffff', '#7df9ff', '#2b6cff'] },
    { base: '#a26a5e', dark: '#3a1e1a', accent: '#ff6b35', glow: '#ffb347', flame: ['#ffffff', '#ffcf6b', '#ff3d00'] },
  ],

  ship(hullId, side, px) {
    const key = `s${hullId}_${side}_${px}`;
    if (GFX.cache.has(key)) return GFX.cache.get(key);
    const hull = HULLS[hullId];
    const cls = hull.cls;
    const rnd = U.seeded(U.hash(hullId) + 13);
    const pal = GFX.SIDE_PAL[side];
    const mk = MAKER[hull.maker];
    const L = px;
    const ratio = { scout: 0.42, fighter: 0.6, corvette: 0.52, raider: 0.62, frigate: 0.5, destroyer: 0.46, cruiser: 0.52, battleship: 0.56, dreadnought: 0.6 }[cls];
    const Hh = L * ratio;
    const pad = L * 0.12;
    const cv = GFX.canvas(L + pad * 2, Hh + pad * 2);
    const ctx = cv.getContext('2d');
    ctx.translate(cv.width / 2, cv.height / 2);
    const base = GFX.mix(pal.base, mk.color, 0.22);
    const meta = { engines: [], mounts: [], w: cv.width, h: cv.height, len: L, ht: Hh };

    // профиль корпуса: полуширина в точках вдоль длины (нос справа)
    const nP = 7;
    const prof = [];
    const maxW = Hh * (cls === 'scout' ? 0.28 : cls === 'fighter' || cls === 'raider' ? 0.24 : 0.36);
    for (let i = 0; i <= nP; i++) {
      const u = i / nP; // 0 корма → 1 нос
      const x = -L / 2 + u * L;
      let w = maxW * (0.55 + 0.45 * Math.sin(Math.PI * Math.pow(u, 0.85))) * (0.8 + rnd() * 0.35);
      if (u > 0.82) w *= (1 - u) / 0.18 * 0.8 + 0.08;
      if (u === 1) w = maxW * 0.06;
      if (u === 0) w = maxW * 0.75;
      prof.push([x, w]);
    }
    const bodyPath = () => {
      ctx.beginPath();
      ctx.moveTo(prof[0][0], -prof[0][1]);
      for (const [x, w] of prof) ctx.lineTo(x, -w);
      ctx.lineTo(L / 2 + L * 0.02, 0);
      for (let i = prof.length - 1; i >= 0; i--) ctx.lineTo(prof[i][0], prof[i][1]);
      ctx.closePath();
    };
    const metal = (y0, y1, col) => {
      const g = ctx.createLinearGradient(0, y0, 0, y1);
      g.addColorStop(0, U.shade(col, 0.42));
      g.addColorStop(0.35, U.shade(col, 0.05));
      g.addColorStop(0.7, U.shade(col, -0.35));
      g.addColorStop(1, U.shade(col, -0.7));
      return g;
    };

    // крылья / спонсоны
    const wingy = (x0, x1, x2, span, back) => {
      for (const sg of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(x0, sg * maxW * 0.6);
        ctx.lineTo(x1, sg * span);
        ctx.lineTo(x2, sg * span * 0.92);
        ctx.lineTo(x2 + back, sg * maxW * 0.7);
        ctx.closePath();
        ctx.fillStyle = metal(sg < 0 ? -span : 0, sg < 0 ? 0 : span, U.shade(base, -0.12));
        ctx.fill();
        ctx.lineWidth = Math.max(1, L * 0.008); ctx.strokeStyle = pal.dark; ctx.stroke();
        // огни на концах крыльев
        ctx.fillStyle = sg < 0 ? '#ff4d4d' : '#4dff88';
        ctx.beginPath(); ctx.arc(x1 - L * 0.01, sg * span * 0.97, Math.max(1, L * 0.008), 0, Math.PI * 2); ctx.fill();
        // полоса-акцент
        ctx.strokeStyle = U.rgba(pal.accent, 0.8); ctx.lineWidth = Math.max(1, L * 0.012);
        ctx.beginPath(); ctx.moveTo(x0 + (x1 - x0) * 0.3, sg * (maxW * 0.6 + (span - maxW * 0.6) * 0.3));
        ctx.lineTo(x0 + (x1 - x0) * 0.75, sg * (maxW * 0.6 + (span - maxW * 0.6) * 0.75)); ctx.stroke();
      }
    };
    const span = Hh * 0.5;
    if (['scout', 'fighter', 'raider', 'corvette'].includes(cls)) {
      const sweep = cls === 'raider' ? 0.25 : cls === 'fighter' ? 0.18 : 0.12;
      wingy(L * (0.05 + rnd() * 0.1), -L * sweep, -L * (sweep + 0.14), span * (cls === 'scout' ? 0.75 : 0.98), L * 0.1);
    } else {
      // крупные корабли: бортовые модули
      const nPods = cls === 'frigate' ? 1 : cls === 'destroyer' ? 1 : 2;
      for (let p = 0; p < nPods; p++) {
        const px0 = -L * 0.38 + p * L * 0.3, pw = L * (0.28 + rnd() * 0.1);
        for (const sg of [-1, 1]) {
          const y0 = sg * maxW * 0.55, y1 = sg * span * (0.78 + p * 0.1);
          ctx.beginPath();
          ctx.moveTo(px0, y0); ctx.lineTo(px0 + pw * 0.1, y1); ctx.lineTo(px0 + pw * 0.85, y1); ctx.lineTo(px0 + pw, y0);
          ctx.closePath();
          ctx.fillStyle = metal(Math.min(y0, y1), Math.max(y0, y1), U.shade(base, -0.18));
          ctx.fill(); ctx.lineWidth = Math.max(1, L * 0.006); ctx.strokeStyle = pal.dark; ctx.stroke();
          ctx.fillStyle = U.rgba(pal.glow, 0.75);
          for (let k = 0; k < 4; k++) ctx.fillRect(px0 + pw * (0.2 + k * 0.17), y1 - sg * L * 0.012 - L * 0.004, L * 0.018, L * 0.008);
        }
      }
    }

    // двигатели
    const nEng = { scout: 1, fighter: 2, corvette: 2, raider: 2, frigate: 2, destroyer: 3, cruiser: 3, battleship: 4, dreadnought: 5 }[cls];
    const engW = L * 0.09, engH = Math.min(maxW * 1.4 / nEng, L * 0.08);
    for (let i = 0; i < nEng; i++) {
      const y = nEng === 1 ? 0 : -maxW * 0.6 + (i / (nEng - 1)) * maxW * 1.2;
      const x = -L / 2 - engW * 0.35;
      ctx.beginPath(); GFX.roundRect(ctx, x, y - engH / 2, engW, engH, engH * 0.25);
      ctx.fillStyle = metal(y - engH / 2, y + engH / 2, '#5a5f6a'); ctx.fill();
      ctx.strokeStyle = '#111'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = U.rgba(pal.glow, 0.9);
      ctx.fillRect(x - L * 0.006, y - engH * 0.36, L * 0.012, engH * 0.72);
      meta.engines.push({ x: x - L * 0.004, y, r: engH * 0.42 });
    }

    // основной корпус
    bodyPath();
    ctx.fillStyle = metal(-maxW, maxW, base);
    ctx.fill();
    ctx.lineWidth = Math.max(1, L * 0.01); ctx.strokeStyle = pal.dark; ctx.stroke();

    // панели и детали
    ctx.save();
    bodyPath(); ctx.clip();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = Math.max(1, L * 0.004);
    for (let i = 0; i < 6 + L / 30; i++) {
      const x = -L / 2 + rnd() * L * 0.9;
      ctx.beginPath(); ctx.moveTo(x, -maxW); ctx.lineTo(x + (rnd() - 0.5) * L * 0.04, maxW); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath(); ctx.moveTo(-L / 2, -maxW * 0.15); ctx.lineTo(L / 2, -maxW * 0.05); ctx.stroke();
    for (let i = 0; i < 10 + L / 15; i++) {
      const x = -L / 2 + rnd() * L * 0.85, y = (rnd() - 0.5) * maxW * 1.5;
      ctx.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.28)' : 'rgba(255,255,255,0.1)';
      ctx.fillRect(x, y, L * (0.02 + rnd() * 0.05), L * (0.01 + rnd() * 0.02));
    }
    // акцентная полоса производителя
    ctx.fillStyle = U.rgba(mk.color, 0.55);
    ctx.fillRect(-L * 0.25, -maxW * 0.08 + maxW * 0.45, L * 0.45, Math.max(1.5, L * 0.012));
    ctx.fillStyle = U.rgba(pal.accent, 0.7);
    ctx.fillRect(-L * 0.25, -maxW * 0.5, L * 0.5, Math.max(1.5, L * 0.012));
    ctx.restore();

    // надстройка / мостик
    const big = ['destroyer', 'cruiser', 'battleship', 'dreadnought'].includes(cls);
    if (big) {
      const bx = -L * 0.12 + rnd() * L * 0.08, bw = L * 0.2, bh = maxW * 0.55;
      ctx.beginPath(); GFX.roundRect(ctx, bx, -bh / 2, bw, bh, bh * 0.2);
      ctx.fillStyle = metal(-bh / 2, bh / 2, U.shade(base, 0.08)); ctx.fill();
      ctx.strokeStyle = pal.dark; ctx.lineWidth = Math.max(1, L * 0.006); ctx.stroke();
      ctx.fillStyle = U.rgba(pal.glow, 0.9);
      for (let k = 0; k < 4; k++) ctx.fillRect(bx + bw * 0.62, -bh * 0.36 + k * bh * 0.22, bw * 0.28, bh * 0.08);
    }
    // кабина
    const cx = L * (big ? 0.28 : 0.2), cw = L * (big ? 0.08 : 0.13), ch = maxW * (big ? 0.35 : 0.55);
    const cg = ctx.createRadialGradient(cx + cw * 0.2, -ch * 0.25, 1, cx, 0, cw);
    cg.addColorStop(0, '#ffffff'); cg.addColorStop(0.3, pal.glow); cg.addColorStop(1, U.shade(pal.accent, -0.5));
    ctx.beginPath(); ctx.ellipse(cx, 0, cw, ch, 0, 0, Math.PI * 2);
    ctx.fillStyle = cg; ctx.fill(); ctx.strokeStyle = pal.dark; ctx.lineWidth = Math.max(1, L * 0.006); ctx.stroke();

    // орудийные башни
    const nM = Math.max(1, hull.slots.weapon);
    for (let i = 0; i < nM; i++) {
      const u = nM === 1 ? 0.15 : -0.3 + (i / (nM - 1)) * 0.55;
      const x = u * L;
      const sg = i % 2 ? 1 : -1;
      const y = nM <= 2 ? 0 : sg * maxW * 0.42;
      const tr = Math.max(2, L * (big ? 0.022 : 0.03));
      ctx.strokeStyle = '#1a1d24'; ctx.lineWidth = Math.max(1.5, tr * 0.55);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + tr * 2.6, y); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, tr, 0, Math.PI * 2);
      ctx.fillStyle = metal(y - tr, y + tr, '#8b93a3'); ctx.fill();
      ctx.strokeStyle = '#111'; ctx.lineWidth = 1; ctx.stroke();
      meta.mounts.push({ x: x + tr * 2.6, y });
    }
    // бортовые огни
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = U.rgba(pal.glow, 0.9);
      ctx.beginPath(); ctx.arc(-L * 0.3 + i * L * 0.18, maxW * 0.75, Math.max(0.8, L * 0.005), 0, Math.PI * 2); ctx.fill();
    }
    const res = { canvas: cv, meta };
    GFX.cache.set(key, res);
    return res;
  },

  mix(a, b, t) {
    const A = U.hexToRgb(a), B = U.hexToRgb(b);
    const c = A.map((v, i) => Math.round(v + (B[i] - v) * t));
    return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
  },

  // Картинка корабля для портретов/карточек (dataURL)
  shipImage(hullId, side, px = 120) {
    const key = `img${hullId}_${side}_${px}`;
    if (GFX.cache.has(key)) return GFX.cache.get(key);
    const sp = GFX.ship(hullId, side, px);
    const url = sp.canvas.toDataURL();
    GFX.cache.set(key, url);
    return url;
  },

  // Слой звёзд и туманностей
  starfield(w, h, seed = 1, opts = {}) {
    const cv = GFX.canvas(w, h), ctx = cv.getContext('2d');
    const rnd = U.seeded(seed);
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#03040b'); g.addColorStop(0.5, '#070a1a'); g.addColorStop(1, '#04030c');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    const neb = opts.nebula || ['#3a0ca3', '#4361ee', '#7209b7', '#f72585', '#0f6e8c'];
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 9; i++) {
      const x = rnd() * w, y = rnd() * h, r = (0.2 + rnd() * 0.45) * Math.max(w, h);
      const col = neb[Math.floor(rnd() * neb.length)];
      const ng = ctx.createRadialGradient(x, y, 0, x, y, r);
      ng.addColorStop(0, U.rgba(col, 0.13 + rnd() * 0.08));
      ng.addColorStop(0.5, U.rgba(col, 0.04));
      ng.addColorStop(1, U.rgba(col, 0));
      ctx.fillStyle = ng; ctx.fillRect(0, 0, w, h);
    }
    // пылевые полосы
    for (let i = 0; i < 60; i++) {
      const x = rnd() * w, y = rnd() * h, r = 20 + rnd() * 120;
      const ng = ctx.createRadialGradient(x, y, 0, x, y, r);
      ng.addColorStop(0, U.rgba(neb[Math.floor(rnd() * neb.length)], 0.04));
      ng.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = ng; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
    const n = Math.floor((w * h) / 1400);
    for (let i = 0; i < n; i++) {
      const x = rnd() * w, y = rnd() * h, s = rnd();
      ctx.fillStyle = `rgba(${200 + rnd() * 55 | 0},${200 + rnd() * 55 | 0},255,${0.2 + s * 0.6})`;
      ctx.fillRect(x, y, s > 0.95 ? 2 : 1, s > 0.95 ? 2 : 1);
    }
    return cv;
  },
};

// ---------- Планеты, станции, ворота (кампания) ----------
Object.assign(GFX, {
  PLANET_LOOK: {
    agri:    { base: ['#2f7d4a', '#3fa35e', '#1f5fa8'], cloud: 0.5, lights: 0.1 },
    mining:  { base: ['#7a5638', '#a0714a', '#5c4030'], crater: true, lights: 0.15 },
    indust:  { base: ['#5d636e', '#7c828c', '#3d4249'], lights: 0.9, cloud: 0.2 },
    tech:    { base: ['#1d4f8a', '#2f7fc8', '#9fd0ff'], lights: 0.7, cloud: 0.4 },
    resort:  { base: ['#1a8a9a', '#2fc4c0', '#f2d7a0'], cloud: 0.6, lights: 0.3 },
    capital: { base: ['#2a4d8f', '#e0b04a', '#3b74c4'], lights: 1, cloud: 0.35, ring: true },
    dead:    { base: ['#6b6670', '#8a8590', '#4a4650'], crater: true },
    gas:     { base: ['#9a6bc4', '#d8a06a', '#6b4a9a'], bands: true, ring: 0.4 },
  },
  planet(p, px) {
    const key = `pl${p.id}_${px}_${p.pop > 0 ? 1 : 0}`;
    if (GFX.cache.has(key)) return GFX.cache.get(key);
    const rnd = U.seeded(p.id * 7919 + 13);
    const look = p.pop > 0 ? GFX.PLANET_LOOK[p.type] : (rnd() < 0.45 ? GFX.PLANET_LOOK.gas : GFX.PLANET_LOOK.dead);
    const R = px / 2, pad = look.ring ? R * 0.9 : R * 0.35;
    const cv = GFX.canvas(px + pad * 2, px + pad * 2), ctx = cv.getContext('2d');
    const cx = cv.width / 2, cy = cv.height / 2;
    const ringTilt = 0.32;
    const drawRing = front => {
      if (!look.ring || (look.ring !== true && rnd() > look.ring && !front)) return;
      ctx.save();
      ctx.beginPath();
      if (front) ctx.rect(0, cy, cv.width, cv.height); else ctx.rect(0, 0, cv.width, cy);
      ctx.clip();
      for (let i = 0; i < 4; i++) {
        ctx.strokeStyle = `rgba(230,210,170,${0.18 + i * 0.06})`;
        ctx.lineWidth = R * 0.07;
        ctx.beginPath(); ctx.ellipse(cx, cy, R * (1.35 + i * 0.12), R * (1.35 + i * 0.12) * ringTilt, -0.25, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    };
    drawRing(false);
    // атмосфера
    const atm = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.3);
    atm.addColorStop(0, U.rgba(look.base[2], 0.5)); atm.addColorStop(1, U.rgba(look.base[2], 0));
    ctx.fillStyle = atm; ctx.beginPath(); ctx.arc(cx, cy, R * 1.3, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
    const g = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.1, cx, cy, R);
    g.addColorStop(0, U.shade(look.base[1], 0.25)); g.addColorStop(0.6, look.base[0]); g.addColorStop(1, U.shade(look.base[0], -0.5));
    ctx.fillStyle = g; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    if (look.bands) {
      for (let i = 0; i < 9; i++) {
        ctx.fillStyle = U.rgba(i % 2 ? look.base[1] : look.base[2], 0.35);
        const y = cy - R + (i + rnd() * 0.5) * R * 0.22;
        ctx.beginPath(); ctx.ellipse(cx, y, R * 1.2, R * (0.05 + rnd() * 0.06), 0, 0, Math.PI * 2); ctx.fill();
      }
    } else {
      // континенты / пятна
      for (let i = 0; i < 14; i++) {
        ctx.fillStyle = U.rgba(rnd() < 0.5 ? look.base[1] : look.base[2], 0.45);
        ctx.beginPath(); ctx.arc(cx + (rnd() - 0.5) * R * 1.8, cy + (rnd() - 0.5) * R * 1.8, R * (0.12 + rnd() * 0.35), 0, Math.PI * 2); ctx.fill();
      }
    }
    if (look.crater) for (let i = 0; i < 12; i++) {
      const x = cx + (rnd() - 0.5) * R * 1.7, y = cy + (rnd() - 0.5) * R * 1.7, r = R * (0.04 + rnd() * 0.1);
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1; ctx.stroke();
    }
    if (look.cloud) for (let i = 0; i < 10; i++) {
      ctx.fillStyle = `rgba(255,255,255,${look.cloud * 0.25})`;
      ctx.beginPath(); ctx.ellipse(cx + (rnd() - 0.5) * R * 1.8, cy + (rnd() - 0.5) * R * 1.8, R * (0.2 + rnd() * 0.3), R * 0.06, rnd() - 0.5, 0, Math.PI * 2); ctx.fill();
    }
    // терминатор: ночная сторона
    const sh = ctx.createLinearGradient(cx - R, cy - R * 0.6, cx + R, cy + R * 0.6);
    sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(0.55, 'rgba(0,0,10,0.15)'); sh.addColorStop(1, 'rgba(0,0,10,0.85)');
    ctx.fillStyle = sh; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    // огни городов на ночной стороне
    if (look.lights && p.pop > 0) {
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 60 * look.lights; i++) {
        const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * R * 0.95;
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
        if ((x - cx) * 0.8 + (y - cy) * 0.5 < R * 0.15) continue;
        ctx.fillStyle = `rgba(255,${200 + rnd() * 55 | 0},120,${0.4 + rnd() * 0.5})`;
        ctx.fillRect(x, y, Math.max(1, R * 0.03), Math.max(1, R * 0.03));
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
    // блик атмосферы
    ctx.strokeStyle = U.rgba(look.base[2], 0.55); ctx.lineWidth = Math.max(1, R * 0.04);
    ctx.beginPath(); ctx.arc(cx, cy, R, Math.PI * 0.9, Math.PI * 1.6); ctx.stroke();
    drawRing(true);
    const res = { canvas: cv, R };
    GFX.cache.set(key, res);
    return res;
  },
  station(px, hostile = true) {
    const key = `st${px}_${hostile}`;
    if (GFX.cache.has(key)) return GFX.cache.get(key);
    const cv = GFX.canvas(px, px), ctx = cv.getContext('2d'), c = px / 2;
    const col = hostile ? '#ff3b3b' : '#4cc9f0';
    ctx.translate(c, c);
    for (let i = 0; i < 8; i++) {
      ctx.save(); ctx.rotate(i * Math.PI / 4);
      ctx.fillStyle = '#2a2d36'; ctx.fillRect(c * 0.25, -c * 0.06, c * 0.68, c * 0.12);
      ctx.fillStyle = col; ctx.fillRect(c * 0.86, -c * 0.04, c * 0.08, c * 0.08);
      ctx.restore();
    }
    const g = ctx.createRadialGradient(-c * 0.1, -c * 0.1, 1, 0, 0, c * 0.42);
    g.addColorStop(0, '#6a6f7c'); g.addColorStop(1, '#16181e');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, c * 0.42, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = U.rgba(col, 0.8); ctx.lineWidth = c * 0.05;
    ctx.beginPath(); ctx.arc(0, 0, c * 0.3, 0, Math.PI * 2); ctx.stroke();
    ctx.font = `${c * 0.36}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = col; ctx.fillText(hostile ? '☠' : '✦', 0, c * 0.02);
    GFX.cache.set(key, cv);
    return cv;
  },
});
