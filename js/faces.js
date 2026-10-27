'use strict';
// ============================================================
//  Генератор лиц: процедурные портреты пилотов.
//  Внешность — набор чисел и цветов (сохраняется вместе с пилотом),
//  портрет рисуется по нему на холсте и кэшируется.
// ============================================================

const RACES = {
  human: { name: 'Человек', skins: ['#f1c7a5', '#e0ac85', '#c98e64', '#a86f48', '#7d4f32', '#5a3826', '#f5d6c0'], hairs: ['#1b1310', '#3b2416', '#6b4423', '#a0652d', '#d9a95b', '#e8d3a0', '#8a8a8a', '#b8401f', '#2c2a4a'] },
  veln:  { name: 'Вельн', skins: ['#8fc3e8', '#6fa8d6', '#a3d1e6', '#5d8fc4', '#b5d9f0'], hairs: ['#e8f4ff', '#c9d6ff', '#1d2a4d', '#6a5acd', '#f5f0d0'] },
  krog:  { name: 'Крог', skins: ['#8a9a6b', '#6f7f55', '#9c8a6a', '#7a6650', '#5f6b4a'], hairs: ['#2a2018', '#3d3326', '#56483a', '#1a1a1a'] },
  sylph: { name: 'Сильф', skins: ['#d9c6f0', '#c4b0e8', '#e8d6f5', '#b8a2dc', '#f0e0ff'], hairs: ['#7c4dff', '#ff7af5', '#4cc9f0', '#ffd166'] },
};
const RACE_LIST = Object.keys(RACES);

const FACE = {
  // случайная внешность (rnd — функция 0..1)
  random(rnd = Math.random, race) {
    const pick = arr => arr[Math.floor(rnd() * arr.length)];
    race = race || (rnd() < 0.55 ? 'human' : pick(['veln', 'krog', 'sylph']));
    const R = RACES[race];
    const fem = race !== 'krog' && rnd() < 0.45;
    return {
      race, fem,
      skin: pick(R.skins), hair: pick(R.hairs),
      style: Math.floor(rnd() * 8),                       // причёска
      eye: pick(['#3a6ea5', '#5a8f3c', '#7a4a1e', '#2b2b2b', '#6aa6a6', '#8a5cc7', '#c47b2a', '#9b1d1d']),
      brow: Math.floor(rnd() * 3), mouth: Math.floor(rnd() * 5), nose: Math.floor(rnd() * 3),
      beard: !fem && race !== 'sylph' && rnd() < 0.5 ? 1 + Math.floor(rnd() * 4) : 0,
      scar: rnd() < 0.18 ? 1 + Math.floor(rnd() * 2) : 0,
      cyber: rnd() < 0.16 ? 1 + Math.floor(rnd() * 2) : 0,
      visor: rnd() < 0.12 ? 1 : 0,
      earring: rnd() < 0.2 ? 1 : 0,
      age: rnd(),
      suit: pick(['#2b3a67', '#3d2b5a', '#2f4f4f', '#5a2b2b', '#3a3a3a', '#1f4e79', '#4a3b1f', '#26453a']),
      bg: Math.floor(rnd() * 360),
      jaw: rnd(),
    };
  },

  // портрет как dataURL (с кэшем)
  url(f, px = 96) {
    if (!f) return '';
    const key = 'face_' + px + '_' + JSON.stringify(f);
    if (GFX.cache.has(key)) return GFX.cache.get(key);
    const url = FACE.draw(f, px).toDataURL();
    GFX.cache.set(key, url);
    return url;
  },

  draw(f, px) {
    const S = 128, cv = GFX.canvas(px, px), ctx = cv.getContext('2d');
    ctx.scale(px / S, px / S);
    const shade = (c, t) => GFX.mix(c, t < 0 ? '#000000' : '#ffffff', Math.abs(t));
    const skin = f.skin, skD = shade(skin, -0.22), skL = shade(skin, 0.18);
    const fem = f.fem, race = f.race;
    // фон: туманность цвета пилота и звёзды
    const bg = ctx.createRadialGradient(64, 50, 10, 64, 64, 90);
    bg.addColorStop(0, `hsl(${f.bg},45%,32%)`); bg.addColorStop(1, `hsl(${(f.bg + 40) % 360},50%,8%)`);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, S, S);
    const rs = U.seeded(f.bg * 7 + 3);
    ctx.fillStyle = 'rgba(255,255,255,.7)';
    for (let i = 0; i < 14; i++) ctx.fillRect(rs() * S, rs() * S * 0.6, 1, 1);

    const hw = (race === 'krog' ? 34 : fem ? 27 : 30) + f.jaw * 3; // полуширина головы
    const cx = 64, cy = 58;
    // волосы сзади (длинные причёски)
    const longHair = fem ? f.style < 5 : f.style === 6;
    if (race !== 'sylph' && race !== 'krog' && longHair) {
      ctx.fillStyle = shade(f.hair, -0.15);
      ctx.beginPath(); ctx.moveTo(cx - hw - 6, cy - 10);
      ctx.quadraticCurveTo(cx - hw - 12, cy + 40, cx - hw + 2, cy + 52); ctx.lineTo(cx + hw - 2, cy + 52);
      ctx.quadraticCurveTo(cx + hw + 12, cy + 40, cx + hw + 6, cy - 10); ctx.closePath(); ctx.fill();
    }
    // скафандр и плечи
    const suit = f.suit;
    ctx.fillStyle = suit;
    ctx.beginPath(); ctx.moveTo(10, S); ctx.quadraticCurveTo(14, 96, 40, 92); ctx.lineTo(88, 92); ctx.quadraticCurveTo(114, 96, 118, S); ctx.closePath(); ctx.fill();
    ctx.fillStyle = shade(suit, 0.18); ctx.fillRect(16, 104, 22, 5); ctx.fillRect(90, 104, 22, 5);
    ctx.fillStyle = shade(suit, -0.3);
    ctx.beginPath(); ctx.moveTo(44, 92); ctx.lineTo(64, 112); ctx.lineTo(84, 92); ctx.closePath(); ctx.fill();
    ctx.fillStyle = `hsl(${f.bg},70%,60%)`; ctx.beginPath(); ctx.arc(96, 114, 3.5, 0, 6.3); ctx.fill();
    // шея
    ctx.fillStyle = skD; ctx.fillRect(cx - (race === 'krog' ? 17 : 11), cy + 26, race === 'krog' ? 34 : 22, 20);
    // уши
    ctx.fillStyle = skD;
    if (race === 'veln') {
      for (const sd of [-1, 1]) { ctx.beginPath(); ctx.moveTo(cx + sd * (hw - 2), cy - 4); ctx.lineTo(cx + sd * (hw + 16), cy - 20); ctx.lineTo(cx + sd * (hw - 1), cy + 10); ctx.closePath(); ctx.fill(); }
    } else if (race !== 'sylph') {
      for (const sd of [-1, 1]) { ctx.beginPath(); ctx.ellipse(cx + sd * hw, cy + 2, 5, 9, 0, 0, 6.3); ctx.fill(); }
    }
    // голова: купол и челюсть
    const jawW = hw * (race === 'krog' ? 0.95 : fem ? 0.62 : 0.72);
    const head = () => {
      ctx.beginPath();
      ctx.moveTo(cx - hw, cy);
      ctx.bezierCurveTo(cx - hw, cy - 46, cx + hw, cy - 46, cx + hw, cy);
      ctx.bezierCurveTo(cx + hw, cy + 22, cx + jawW, cy + 34, cx, cy + 36);
      ctx.bezierCurveTo(cx - jawW, cy + 34, cx - hw, cy + 22, cx - hw, cy);
      ctx.closePath();
    };
    const hg = ctx.createRadialGradient(cx - 10, cy - 12, 6, cx, cy, hw * 1.6);
    hg.addColorStop(0, skL); hg.addColorStop(0.6, skin); hg.addColorStop(1, skD);
    ctx.fillStyle = hg; head(); ctx.fill();
    // румянец и возрастные морщины
    ctx.fillStyle = 'rgba(255,90,90,.12)';
    for (const sd of [-1, 1]) { ctx.beginPath(); ctx.ellipse(cx + sd * 16, cy + 14, 7, 4, 0, 0, 6.3); ctx.fill(); }
    if (f.age > 0.7) {
      ctx.strokeStyle = shade(skin, -0.35); ctx.lineWidth = 1;
      for (const sd of [-1, 1]) { ctx.beginPath(); ctx.moveTo(cx + sd * 10, cy + 16); ctx.quadraticCurveTo(cx + sd * 15, cy + 22, cx + sd * 13, cy + 26); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(cx - 10, cy - 20); ctx.lineTo(cx + 10, cy - 20); ctx.stroke();
    }
    // расовые черты
    if (race === 'krog') {
      ctx.fillStyle = skD;
      ctx.beginPath(); ctx.moveTo(cx - hw + 4, cy - 10); ctx.quadraticCurveTo(cx, cy - 22, cx + hw - 4, cy - 10); ctx.quadraticCurveTo(cx, cy - 14, cx - hw + 4, cy - 10); ctx.fill();
      ctx.fillStyle = '#e8e0c8';
      for (const sd of [-1, 1]) { ctx.beginPath(); ctx.moveTo(cx + sd * 10, cy + 26); ctx.lineTo(cx + sd * 13, cy + 15); ctx.lineTo(cx + sd * 15, cy + 26); ctx.closePath(); ctx.fill(); }
      ctx.fillStyle = '#d8ccb0';
      for (const sd of [-1, 1]) { ctx.beginPath(); ctx.moveTo(cx + sd * (hw - 8), cy - 26); ctx.quadraticCurveTo(cx + sd * (hw + 8), cy - 44, cx + sd * (hw + 2), cy - 52); ctx.quadraticCurveTo(cx + sd * (hw + 2), cy - 38, cx + sd * (hw - 14), cy - 30); ctx.fill(); }
    }
    if (race === 'sylph') {
      ctx.strokeStyle = f.hair; ctx.lineWidth = 2.2; ctx.fillStyle = f.hair;
      for (const sd of [-1, 1]) { ctx.beginPath(); ctx.moveTo(cx + sd * 8, cy - 30); ctx.quadraticCurveTo(cx + sd * 20, cy - 56, cx + sd * 26, cy - 54); ctx.stroke(); ctx.beginPath(); ctx.arc(cx + sd * 26, cy - 54, 3.5, 0, 6.3); ctx.fill(); }
      ctx.fillStyle = shade(skin, 0.3);
      for (const [x, y] of [[-14, -18], [14, -18], [0, -28]]) { ctx.beginPath(); ctx.arc(cx + x, cy + y, 1.6, 0, 6.3); ctx.fill(); }
    }
    // глаза
    const eyeY = cy + (race === 'krog' ? -2 : 0), eyeDX = race === 'sylph' ? 13 : 12;
    for (const sd of [-1, 1]) {
      const ex = cx + sd * eyeDX;
      if (race === 'sylph') {
        ctx.fillStyle = '#120a24'; ctx.beginPath(); ctx.ellipse(ex, eyeY, 8, 10, sd * -0.25, 0, 6.3); ctx.fill();
        ctx.fillStyle = f.eye; ctx.globalAlpha = 0.65; ctx.beginPath(); ctx.ellipse(ex, eyeY + 2, 5, 6, 0, 0, 6.3); ctx.fill(); ctx.globalAlpha = 1;
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex - 2, eyeY - 4, 2.2, 0, 6.3); ctx.fill();
        continue;
      }
      const ew = race === 'krog' ? 5 : 6.5, eh = race === 'krog' ? 3 : fem ? 4.6 : 4;
      ctx.fillStyle = '#f4f1ea'; ctx.beginPath(); ctx.ellipse(ex, eyeY, ew, eh, 0, 0, 6.3); ctx.fill();
      ctx.fillStyle = race === 'veln' ? '#e8f4ff' : f.eye; ctx.beginPath(); ctx.arc(ex, eyeY, eh * 0.85, 0, 6.3); ctx.fill();
      ctx.fillStyle = race === 'veln' ? f.eye : '#111'; ctx.beginPath(); ctx.arc(ex, eyeY, eh * 0.4, 0, 6.3); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex - 1.5, eyeY - 1.4, 1.2, 0, 6.3); ctx.fill();
      ctx.strokeStyle = shade(skin, -0.45); ctx.lineWidth = fem ? 1.8 : 1.2;
      ctx.beginPath(); ctx.ellipse(ex, eyeY, ew, eh, 0, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
    }
    // брови
    if (race !== 'sylph') {
      ctx.strokeStyle = race === 'veln' ? shade(f.hair, -0.1) : shade(f.hair, -0.2); ctx.lineWidth = race === 'krog' ? 4 : fem ? 2 : 3; ctx.lineCap = 'round';
      const tilt = [0, 3, -2][f.brow];
      for (const sd of [-1, 1]) { ctx.beginPath(); ctx.moveTo(cx + sd * 5, eyeY - 8 + (sd < 0 ? tilt : tilt)); ctx.quadraticCurveTo(cx + sd * 12, eyeY - 12, cx + sd * 18, eyeY - 8 - tilt * 0.5); ctx.stroke(); }
    }
    // нос
    ctx.strokeStyle = shade(skin, -0.35); ctx.lineWidth = 1.6; ctx.lineCap = 'round';
    if (race === 'sylph') { ctx.beginPath(); ctx.moveTo(cx - 2, cy + 12); ctx.lineTo(cx - 1, cy + 13); ctx.moveTo(cx + 2, cy + 12); ctx.lineTo(cx + 1, cy + 13); ctx.stroke(); }
    else {
      const nw = race === 'krog' ? 7 : [3, 4, 5][f.nose];
      ctx.beginPath(); ctx.moveTo(cx - 1, cy + 2); ctx.quadraticCurveTo(cx + nw * 0.6, cy + 10, cx + 1, cy + 15); ctx.stroke();
      ctx.fillStyle = shade(skin, -0.3); for (const sd of [-1, 1]) { ctx.beginPath(); ctx.arc(cx + sd * (nw - 1.5), cy + 14.5, 1.3, 0, 6.3); ctx.fill(); }
    }
    // рот
    const my = cy + 23;
    ctx.strokeStyle = fem ? '#9c3a4a' : shade(skin, -0.5); ctx.lineWidth = fem ? 2.6 : 2;
    ctx.beginPath();
    switch (f.mouth) {
      case 0: ctx.moveTo(cx - 7, my); ctx.quadraticCurveTo(cx, my + 4, cx + 7, my); break;           // улыбка
      case 1: ctx.moveTo(cx - 7, my + 1); ctx.lineTo(cx + 7, my + 1); break;                          // сдержанно
      case 2: ctx.moveTo(cx - 7, my + 2); ctx.quadraticCurveTo(cx, my - 2, cx + 7, my + 2); break;    // хмурый
      case 3: ctx.moveTo(cx - 6, my); ctx.quadraticCurveTo(cx + 2, my + 3, cx + 8, my - 2); break;   // ухмылка
      default: ctx.moveTo(cx - 5, my); ctx.quadraticCurveTo(cx, my + 3, cx + 5, my);                   // тонкие губы
    }
    ctx.stroke();
    // борода
    if (f.beard) {
      ctx.fillStyle = shade(f.hair, -0.05);
      if (f.beard === 1) { ctx.globalAlpha = 0.35; head(); ctx.save(); ctx.clip(); ctx.fillRect(cx - hw, cy + 14, hw * 2, 30); ctx.restore(); ctx.globalAlpha = 1; } // щетина
      else if (f.beard === 2) { ctx.beginPath(); ctx.moveTo(cx - jawW - 4, cy + 12); ctx.quadraticCurveTo(cx - jawW, cy + 40, cx, cy + 42); ctx.quadraticCurveTo(cx + jawW, cy + 40, cx + jawW + 4, cy + 12); ctx.quadraticCurveTo(cx + 10, cy + 28, cx, cy + 27); ctx.quadraticCurveTo(cx - 10, cy + 28, cx - jawW - 4, cy + 12); ctx.fill(); } // окладистая
      else if (f.beard === 3) { ctx.beginPath(); ctx.moveTo(cx - 6, cy + 27); ctx.quadraticCurveTo(cx, cy + 44, cx + 6, cy + 27); ctx.fill(); } // эспаньолка
      if (f.beard >= 3) { ctx.beginPath(); ctx.moveTo(cx - 10, my - 1); ctx.quadraticCurveTo(cx, my - 6, cx + 10, my - 1); ctx.quadraticCurveTo(cx, my - 3, cx - 10, my - 1); ctx.fill(); } // усы
    }
    // волосы спереди
    if (race !== 'sylph') {
      const hc = f.hair, st = race === 'krog' ? f.style % 3 : f.style;
      ctx.fillStyle = hc;
      const top = () => { ctx.beginPath(); ctx.moveTo(cx - hw - 2, cy - 6); ctx.bezierCurveTo(cx - hw - 2, cy - 54, cx + hw + 2, cy - 54, cx + hw + 2, cy - 6); };
      if (race === 'krog') {
        if (st === 1) { ctx.fillRect(cx - 4, cy - 46, 8, 20); }          // гребень
      } else if (st === 7 && !fem) {
        // лысый — блик
        ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.beginPath(); ctx.ellipse(cx - 8, cy - 28, 10, 5, -0.3, 0, 6.3); ctx.fill();
      } else if (st === 4 && !fem) {
        // ирокез
        ctx.beginPath(); ctx.moveTo(cx - 6, cy - 22); ctx.lineTo(cx - 3, cy - 52); ctx.lineTo(cx + 3, cy - 52); ctx.lineTo(cx + 6, cy - 22); ctx.closePath(); ctx.fill();
      } else {
        top(); ctx.quadraticCurveTo(cx + hw - 4, cy - 22, cx + (st % 2 ? 6 : 14), cy - 24);
        ctx.quadraticCurveTo(cx - 4, cy - 14 - (st % 3) * 3, cx - hw + 4, cy - 20); ctx.closePath(); ctx.fill();
        if (fem && st === 5) { ctx.beginPath(); ctx.arc(cx, cy - 44, 9, 0, 6.3); ctx.fill(); } // пучок
        ctx.fillStyle = 'rgba(255,255,255,.15)'; ctx.beginPath(); ctx.ellipse(cx - 10, cy - 36, 9, 3.5, -0.4, 0, 6.3); ctx.fill();
      }
    }
    // шрам
    if (f.scar) {
      ctx.strokeStyle = 'rgba(150,40,40,.75)'; ctx.lineWidth = 2;
      ctx.beginPath(); if (f.scar === 1) { ctx.moveTo(cx + 8, eyeY - 14); ctx.lineTo(cx + 18, eyeY + 12); } else { ctx.moveTo(cx - 22, cy + 8); ctx.lineTo(cx - 10, cy + 20); } ctx.stroke();
    }
    // кибер-импланты
    if (f.cyber === 1) {
      ctx.fillStyle = '#5a6476'; ctx.beginPath(); ctx.arc(cx + eyeDX, eyeY, 8, 0, 6.3); ctx.fill();
      GFX.glow(ctx, '#ff3b3b', 8); ctx.fillStyle = '#ff3b3b'; ctx.beginPath(); ctx.arc(cx + eyeDX, eyeY, 3.5, 0, 6.3); ctx.fill(); ctx.shadowBlur = 0;
    } else if (f.cyber === 2) {
      ctx.strokeStyle = '#4cc9f0'; ctx.lineWidth = 1.4; GFX.glow(ctx, '#4cc9f0', 6);
      ctx.beginPath(); ctx.moveTo(cx - hw + 3, cy - 14); ctx.lineTo(cx - hw + 10, cy - 14); ctx.lineTo(cx - hw + 13, cy - 8); ctx.lineTo(cx - hw + 13, cy + 4); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx - hw + 13, cy + 5, 1.8, 0, 6.3); ctx.fillStyle = '#4cc9f0'; ctx.fill(); ctx.shadowBlur = 0;
    }
    // визор
    if (f.visor) {
      const vg = ctx.createLinearGradient(cx - hw, 0, cx + hw, 0);
      vg.addColorStop(0, 'rgba(76,201,240,.25)'); vg.addColorStop(0.5, 'rgba(160,240,255,.55)'); vg.addColorStop(1, 'rgba(76,201,240,.25)');
      ctx.fillStyle = vg; ctx.beginPath(); ctx.ellipse(cx, eyeY, hw - 3, 8, 0, 0, 6.3); ctx.fill();
      ctx.strokeStyle = 'rgba(200,250,255,.7)'; ctx.lineWidth = 1; ctx.stroke();
    }
    // серьга
    if (f.earring && race !== 'sylph') { ctx.fillStyle = '#ffd166'; ctx.beginPath(); ctx.arc(cx - hw - (race === 'veln' ? 1 : 0), cy + 12, 2.5, 0, 6.3); ctx.fill(); }
    return cv;
  },
};
