'use strict';
// ============================================================
//  Общие утилиты: случайность, математика, easing, DOM, игровые часы
// ============================================================

const U = (() => {
  let _id = 1;
  const U = {
    uid: () => _id++,
    rf: (a, b) => a + Math.random() * (b - a),
    ri: (a, b) => Math.floor(a + Math.random() * (b - a + 1)),
    pick: arr => arr[Math.floor(Math.random() * arr.length)],
    chance: p => Math.random() < p,
    clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
    lerp: (a, b, t) => a + (b - a) * t,
    dist: (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1),
    angNorm: a => { a %= Math.PI * 2; return a > Math.PI ? a - Math.PI * 2 : a < -Math.PI ? a + Math.PI * 2 : a; },
    angDiff: (a, b) => U.angNorm(a - b),
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    },
    weighted(weights) {
      let sum = 0;
      for (const w of weights) sum += w;
      let r = Math.random() * sum;
      for (let i = 0; i < weights.length; i++) {
        r -= weights[i];
        if (r <= 0) return i;
      }
      return weights.length - 1;
    },
    roman: n => ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII'][n] || String(n),
    r1: v => Math.round(v * 10) / 10,
    pct: v => Math.round(v * 100) + '%',
    sum: (arr, f = x => x) => arr.reduce((s, x) => s + f(x), 0),
    // псевдослучайный генератор с зерном (для процедурной графики)
    seeded(seed) {
      let s = (seed >>> 0) || 1;
      return () => {
        s ^= s << 13; s >>>= 0;
        s ^= s >>> 17;
        s ^= s << 5; s >>>= 0;
        return (s >>> 0) / 4294967296;
      };
    },
    hash(str) {
      let h = 2166136261;
      for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return h >>> 0;
    },
    hexToRgb(hex) {
      const n = parseInt(hex.slice(1), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    },
    rgba(hex, a) {
      const [r, g, b] = U.hexToRgb(hex);
      return `rgba(${r},${g},${b},${a})`;
    },
    shade(hex, k) { // k>0 светлее, k<0 темнее
      let [r, g, b] = U.hexToRgb(hex);
      if (k >= 0) { r += (255 - r) * k; g += (255 - g) * k; b += (255 - b) * k; }
      else { r *= 1 + k; g *= 1 + k; b *= 1 + k; }
      return `rgb(${r | 0},${g | 0},${b | 0})`;
    },
    ease: {
      linear: t => t,
      outQuad: t => 1 - (1 - t) * (1 - t),
      inQuad: t => t * t,
      outCubic: t => 1 - Math.pow(1 - t, 3),
      inCubic: t => t * t * t,
      inOutCubic: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
      outBack: t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
      outElastic: t => (t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI) / 3) + 1),
    },
    // append без «null» в тексте: пустые элементы пропускаются
    add(el, ...kids) { for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k); return el; },
    // DOM-хелпер: h('div', {class:'x', onclick:fn}, 'текст', child)
    h(tag, attrs, ...kids) {
      const el = document.createElement(tag);
      if (attrs) {
        for (const k in attrs) {
          const v = attrs[k];
          if (v == null || v === false) continue;
          if (k === 'class') el.className = v;
          else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
          else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
          else if (k === 'html') el.innerHTML = v;
          else el.setAttribute(k, v === true ? '' : v);
        }
      }
      for (const kid of kids.flat(Infinity)) {
        if (kid == null || kid === false) continue;
        el.appendChild(typeof kid === 'string' || typeof kid === 'number' ? document.createTextNode(String(kid)) : kid);
      }
      return el;
    },
  };
  return U;
})();

// Игровые часы: всё ожидание в бою идёт через них, чтобы работали пауза и скорость
const Clock = {
  speed: 1,
  paused: false,
  timers: [],
  time: 0,
  wait(ms) {
    return new Promise(resolve => {
      if (ms <= 0 || Clock.instant) return resolve();
      Clock.timers.push({ t: ms, resolve });
    });
  },
  // вызывается каждый кадр с реальным dt (мс); возвращает игровое dt (мс)
  tick(dtMs) {
    if (Clock.paused) return 0;
    const g = dtMs * Clock.speed;
    Clock.time += g;
    if (Clock.timers.length) {
      const done = [];
      Clock.timers = Clock.timers.filter(tm => {
        tm.t -= g;
        if (tm.t <= 0) { done.push(tm.resolve); return false; }
        return true;
      });
      done.forEach(r => r());
    }
    return g;
  },
  // для безголового режима (тесты/симуляции): мгновенно
  instant: false,
  clear() { Clock.timers.forEach(t => t.resolve()); Clock.timers = []; },
};
