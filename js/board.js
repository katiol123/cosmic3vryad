'use strict';
// ============================================================
//  Игровое поле «3 в ряд» конкретного корабля.
//  Клетка: { id, t (0..5 цвет | 6 обломки | 7 сверхновая), sp ('h'|'v'|'bomb'),
//            mod ('x2'|'crit'), frozen, virus, mine (таймер) }
// ============================================================

class Board {
  constructor(ship, w = 8, h = 8) {
    this.ship = ship;
    this.w = w; this.h = h;
    this.g = Array.from({ length: h }, () => new Array(w).fill(null));
    this.onEvent = null;
    this.fillInitial();
  }

  emit(ev) { if (this.onEvent) this.onEvent(ev); }
  inb(r, c) { return r >= 0 && c >= 0 && r < this.h && c < this.w; }
  at(r, c) { return this.inb(r, c) ? this.g[r][c] : null; }
  key(r, c) { return r * this.w + c; }
  rc(k) { return [Math.floor(k / this.w), k % this.w]; }
  static matchable(x) { return !!x && x.t < 6; }
  static normal(x) { return !!x && x.t < 6 && !x.sp && !x.frozen && !x.virus && !x.mine; }
  swappable(x) { return !!x && x.t !== T_JUNK && !x.frozen; }

  cell(t) { return { id: U.uid(), t, sp: null, mod: null, frozen: 0, virus: false, mine: 0 }; }
  randType() { return U.weighted(this.ship ? this.ship.s.bias : [1, 1, 1, 1, 1, 1]); }
  spawn() {
    const c = this.cell(this.randType());
    const s = this.ship && this.ship.s;
    if (s) {
      if (Math.random() < s.over) c.mod = 'x2';
      else if (Math.random() < s.critStar) c.mod = 'crit';
    }
    return c;
  }

  fillInitial() {
    for (let tries = 0; tries < 50; tries++) {
      for (let r = 0; r < this.h; r++) {
        for (let c = 0; c < this.w; c++) {
          let x, n = 0;
          do { x = this.spawn(); this.g[r][c] = x; } while (this.matchAt(r, c) && n++ < 30);
        }
      }
      if (this.hasMoves()) return;
    }
  }

  runLen(r, c) {
    const x = this.g[r][c];
    if (!Board.matchable(x)) return [0, 0];
    let h = 1, v = 1;
    for (let cc = c - 1; cc >= 0 && Board.matchable(this.g[r][cc]) && this.g[r][cc].t === x.t; cc--) h++;
    for (let cc = c + 1; cc < this.w && Board.matchable(this.g[r][cc]) && this.g[r][cc].t === x.t; cc++) h++;
    for (let rr = r - 1; rr >= 0 && Board.matchable(this.g[rr][c]) && this.g[rr][c].t === x.t; rr--) v++;
    for (let rr = r + 1; rr < this.h && Board.matchable(this.g[rr][c]) && this.g[rr][c].t === x.t; rr++) v++;
    return [h, v];
  }
  matchAt(r, c) { const [h, v] = this.runLen(r, c); return h >= 3 || v >= 3; }

  canSwap(r1, c1, r2, c2) {
    if (Math.abs(r1 - r2) + Math.abs(c1 - c2) !== 1) return false;
    const A = this.at(r1, c1), B = this.at(r2, c2);
    if (!this.swappable(A) || !this.swappable(B)) return false;
    if (A.t === T_NOVA || B.t === T_NOVA) return true;
    if (A.sp && B.sp) return true;
    this.g[r1][c1] = B; this.g[r2][c2] = A;
    const ok = this.matchAt(r1, c1) || this.matchAt(r2, c2);
    this.g[r1][c1] = A; this.g[r2][c2] = B;
    return ok;
  }

  listMoves() {
    const out = [];
    for (let r = 0; r < this.h; r++) {
      for (let c = 0; c < this.w; c++) {
        if (c + 1 < this.w && this.canSwap(r, c, r, c + 1)) out.push([r, c, r, c + 1]);
        if (r + 1 < this.h && this.canSwap(r, c, r + 1, c)) out.push([r, c, r + 1, c]);
      }
    }
    return out;
  }
  hasMoves() {
    for (let r = 0; r < this.h; r++) for (let c = 0; c < this.w; c++) {
      if (c + 1 < this.w && this.canSwap(r, c, r, c + 1)) return true;
      if (r + 1 < this.h && this.canSwap(r, c, r + 1, c)) return true;
    }
    return false;
  }

  swap(r1, c1, r2, c2) {
    const A = this.g[r1][c1], B = this.g[r2][c2];
    this.g[r1][c1] = B; this.g[r2][c2] = A;
    this.emit({ k: 'swap', a: [r1, c1], b: [r2, c2] });
  }

  findRuns() {
    const runs = [];
    for (let r = 0; r < this.h; r++) {
      let c = 0;
      while (c < this.w) {
        const x = this.g[r][c];
        if (!Board.matchable(x)) { c++; continue; }
        let e = c + 1;
        while (e < this.w && Board.matchable(this.g[r][e]) && this.g[r][e].t === x.t) e++;
        if (e - c >= 3) runs.push({ dir: 'h', t: x.t, cells: Array.from({ length: e - c }, (_, i) => [r, c + i]) });
        c = e;
      }
    }
    for (let c = 0; c < this.w; c++) {
      let r = 0;
      while (r < this.h) {
        const x = this.g[r][c];
        if (!Board.matchable(x)) { r++; continue; }
        let e = r + 1;
        while (e < this.h && Board.matchable(this.g[e][c]) && this.g[e][c].t === x.t) e++;
        if (e - r >= 3) runs.push({ dir: 'v', t: x.t, cells: Array.from({ length: e - r }, (_, i) => [r + i, c]) });
        r = e;
      }
    }
    return runs;
  }

  mostCommonType() {
    const cnt = [0, 0, 0, 0, 0, 0];
    this.forEach(x => { if (x.t < 6) cnt[x.t]++; });
    return cnt.indexOf(Math.max(...cnt));
  }
  forEach(fn) {
    for (let r = 0; r < this.h; r++) for (let c = 0; c < this.w; c++) if (this.g[r][c]) fn(this.g[r][c], r, c);
  }

  // Срабатывание спецблоков внутри набора удаления (цепные реакции)
  _expand(rem, events, triggered) {
    const queue = [...rem.keys()];
    while (queue.length) {
      const k = queue.pop();
      const [r, c] = this.rc(k);
      const x = this.g[r][c];
      if (!x || triggered.has(x.id)) continue;
      if (!x.sp && x.t !== T_NOVA) continue;
      triggered.add(x.id);
      const area = [];
      if (x.sp === 'h') {
        for (let cc = 0; cc < this.w; cc++) area.push([r, cc]);
        events.push({ k: 'line', r, c, dir: 'h', t: x.t });
      } else if (x.sp === 'v') {
        for (let rr = 0; rr < this.h; rr++) area.push([rr, c]);
        events.push({ k: 'line', r, c, dir: 'v', t: x.t });
      } else if (x.sp === 'bomb') {
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (this.inb(r + dr, c + dc)) area.push([r + dr, c + dc]);
        events.push({ k: 'bomb', r, c, rad: 1, t: x.t });
      } else if (x.t === T_NOVA) {
        const t = this.mostCommonType();
        this.forEach((y, rr, cc) => { if (y.t === t) area.push([rr, cc]); });
        events.push({ k: 'nova', r, c, t, targets: area.slice() });
      }
      for (const [rr, cc] of area) {
        const kk = this.key(rr, cc);
        if (!rem.has(kk) && this.g[rr][cc]) { rem.set(kk, this.g[rr][cc]); queue.push(kk); }
      }
    }
  }

  // Общая часть: каскад спецблоков, подсчёт ресурсов, удаление, создание новых спецблоков
  _resolve(rem, events, triggered, created, bonus) {
    this._expand(rem, events, triggered);
    created = created.filter(cr => !rem.has(this.key(cr.r, cr.c)));
    const res = { counts: [0, 0, 0, 0, 0, 0], crit: 0, defused: 0, cleansed: 0, junk: 0, removed: 0, specials: created.length,
      nova: created.some(c => c.sp === 'nova'), maxRun: 0 };
    const popped = [];
    for (const [k, x] of rem) {
      const [r, c] = this.rc(k);
      if (x.t < 6) {
        if (x.virus) res.cleansed++;
        else if (x.frozen) res.cleansed++;
        else res.counts[x.t] += x.mod === 'x2' ? 2 : 1;
        if (x.mod === 'crit') res.crit++;
        if (x.mine) res.defused++;
      } else if (x.t === T_JUNK) res.junk++;
      popped.push({ r, c, t: x.t, id: x.id, mod: x.mod, sp: x.sp, frozen: x.frozen, virus: x.virus, mine: x.mine });
      this.g[r][c] = null;
      res.removed++;
    }
    if (bonus) bonus.forEach((v, i) => { if (v && res.counts[i] > 0) res.counts[i] += v; });
    for (const cr of created) {
      const x = this.g[cr.r][cr.c];
      if (!x) continue;
      if (cr.sp === 'nova') { x.t = T_NOVA; x.sp = null; x.mod = null; }
      else x.sp = cr.sp;
      x.frozen = 0; x.virus = false;
      events.push({ k: 'make', r: cr.r, c: cr.c, sp: cr.sp, t: x.t, id: x.id });
    }
    for (const ev of events) this.emit(ev);
    this.emit({ k: 'pop', cells: popped });
    return res;
  }

  // Один шаг поиска совпадений. swapPos — позиции обмена (для размещения спецблока)
  step(swapPos) {
    const runs = this.findRuns();
    if (!runs.length) return null;
    // объединяем пересекающиеся линии одного цвета в группы (L/T-фигуры)
    const cellGroup = new Map();
    const groups = [];
    for (const run of runs) {
      let g = null;
      for (const [r, c] of run.cells) {
        const gg = cellGroup.get(this.key(r, c));
        if (gg && gg.t === run.t) {
          if (g && g !== gg) { // слияние
            for (const rr of gg.runs) g.runs.push(rr);
            for (const kk of gg.keys) { g.keys.add(kk); cellGroup.set(kk, g); }
            groups.splice(groups.indexOf(gg), 1);
          } else g = gg;
        }
      }
      if (!g) { g = { t: run.t, runs: [], keys: new Set() }; groups.push(g); }
      g.runs.push(run);
      for (const [r, c] of run.cells) { const k = this.key(r, c); g.keys.add(k); cellGroup.set(k, g); }
    }
    const rem = new Map(), created = [], bonus = [0, 0, 0, 0, 0, 0];
    let maxRun = 0;
    for (const g of groups) {
      const maxLen = Math.max(...g.runs.map(r => r.cells.length));
      maxRun = Math.max(maxRun, maxLen);
      const hasH = g.runs.some(r => r.dir === 'h'), hasV = g.runs.some(r => r.dir === 'v');
      let sp = null;
      if (maxLen >= 5) sp = 'nova';
      else if (hasH && hasV) sp = 'bomb';
      else if (maxLen === 4) sp = g.runs[0].dir === 'h' ? 'v' : 'h';
      bonus[g.t] += maxLen >= 5 ? 2 : maxLen === 4 ? 1 : 0;
      if (hasH && hasV) bonus[g.t] += 1;
      for (const k of g.keys) rem.set(k, this.g[Math.floor(k / this.w)][k % this.w]);
      if (sp) {
        let pos = null;
        if (swapPos) for (const p of swapPos) if (g.keys.has(this.key(p[0], p[1]))) pos = this.key(p[0], p[1]);
        if (pos == null && sp === 'bomb') {
          const counts = new Map();
          for (const run of g.runs) for (const [r, c] of run.cells) { const k = this.key(r, c); counts.set(k, (counts.get(k) || 0) + 1); }
          for (const [k, n] of counts) if (n > 1) pos = k;
        }
        if (pos == null) {
          const longest = g.runs.reduce((a, b) => (b.cells.length > a.cells.length ? b : a));
          const mid = longest.cells[Math.floor(longest.cells.length / 2)];
          pos = this.key(mid[0], mid[1]);
        }
        const [pr, pc] = this.rc(pos);
        const x = this.g[pr][pc];
        if (x && !x.sp) { rem.delete(pos); created.push({ r: pr, c: pc, sp }); }
      }
      // соседние обломки разрушаются
      for (const k of g.keys) {
        const [r, c] = this.rc(k);
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const y = this.at(r + dr, c + dc);
          if (y && y.t === T_JUNK) rem.set(this.key(r + dr, c + dc), y);
        }
      }
    }
    const res = this._resolve(rem, [], new Set(), created, bonus);
    res.maxRun = maxRun;
    return res;
  }

  // Особые обмены: сверхновая или два спецблока
  activateSwap(p1, p2) {
    const A = this.at(p1[0], p1[1]), B = this.at(p2[0], p2[1]);
    if (!A || !B) return null;
    const rem = new Map(), events = [], triggered = new Set();
    const add = (r, c) => { if (this.inb(r, c) && this.g[r][c]) rem.set(this.key(r, c), this.g[r][c]); };
    if (A.t === T_NOVA || B.t === T_NOVA) {
      const [N, O] = A.t === T_NOVA ? [p1, p2] : [p2, p1];
      const nova = this.at(N[0], N[1]), other = this.at(O[0], O[1]);
      triggered.add(nova.id);
      add(N[0], N[1]);
      if (other.t === T_NOVA) {
        triggered.add(other.id);
        const all = [];
        this.forEach((y, r, c) => { add(r, c); all.push([r, c]); });
        events.push({ k: 'nova', r: N[0], c: N[1], t: -1, targets: all, big: true });
      } else {
        const t = other.t, targets = [];
        this.forEach((y, r, c) => {
          if (y.t === t) {
            if (other.sp && !y.sp) y.sp = other.sp === 'bomb' ? 'bomb' : U.pick(['h', 'v']);
            add(r, c); targets.push([r, c]);
          }
        });
        events.push({ k: 'nova', r: N[0], c: N[1], t, targets });
      }
    } else if (A.sp && B.sp) {
      const [r, c] = p2;
      triggered.add(A.id); triggered.add(B.id);
      add(p1[0], p1[1]); add(r, c);
      const lines = A.sp !== 'bomb' && B.sp !== 'bomb', bombs = A.sp === 'bomb' && B.sp === 'bomb';
      if (lines) {
        for (let i = 0; i < this.w; i++) add(r, i);
        for (let i = 0; i < this.h; i++) add(i, c);
        events.push({ k: 'line', r, c, dir: 'h', t: B.t }, { k: 'line', r, c, dir: 'v', t: B.t });
      } else if (bombs) {
        for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) add(r + dr, c + dc);
        events.push({ k: 'bomb', r, c, rad: 2, t: B.t });
      } else {
        for (let d = -1; d <= 1; d++) {
          for (let i = 0; i < this.w; i++) add(r + d, i);
          for (let i = 0; i < this.h; i++) add(i, c + d);
        }
        events.push({ k: 'line', r, c, dir: 'h', t: B.t, wide: true }, { k: 'line', r, c, dir: 'v', t: B.t, wide: true });
      }
    } else return null;
    const res = this._resolve(rem, events, triggered, [], null);
    res.combo = true;
    return res;
  }

  // Гравитация и досыпка новых блоков
  collapse() {
    for (let c = 0; c < this.w; c++) {
      let write = this.h - 1;
      for (let r = this.h - 1; r >= 0; r--) {
        if (this.g[r][c]) {
          if (write !== r) { this.g[write][c] = this.g[r][c]; this.g[r][c] = null; }
          write--;
        }
      }
      const n = write + 1;
      for (let r = write; r >= 0; r--) {
        const x = this.spawn();
        x.spawnY = r - n - 0.3;
        this.g[r][c] = x;
      }
    }
    this.emit({ k: 'fall' });
  }

  shuffle() {
    const pos = [], cells = [];
    this.forEach((x, r, c) => { if (x.t !== T_JUNK && !x.frozen) { pos.push([r, c]); cells.push(x); } });
    for (let tries = 0; tries < 80; tries++) {
      U.shuffle(cells);
      pos.forEach(([r, c], i) => { this.g[r][c] = cells[i]; });
      if (tries > 40) cells.forEach(x => { if (x.t < 6 && !x.sp) x.t = this.randType(); });
      if (!this.findRuns().length && this.hasMoves()) break;
    }
    // если совсем тупик — пересоздаём обычные блоки
    if (!this.hasMoves()) {
      this.forEach((x, r, c) => { if (x.t === T_JUNK) this.g[r][c] = this.spawn(); });
      for (let k = 0; k < 30 && (!this.hasMoves() || this.findRuns().length); k++) {
        this.forEach((x, r, c) => { if (x.t < 6 && !x.sp) { do { x.t = this.randType(); } while (this.matchAt(r, c)); } });
      }
    }
    this.emit({ k: 'shuffle' });
  }

  // Вредоносные блоки от врага
  inject(kind, n, resist = 0) {
    if (kind === 'scramble') { this.shuffle(); return { applied: 1, blocked: 0 }; }
    const cand = [];
    this.forEach((x, r, c) => { if (Board.normal(x)) cand.push([r, c]); });
    // поле не может быть заражено больше чем на ~40%
    n = Math.min(n, Math.max(0, 26 - this.debuffs()));
    U.shuffle(cand);
    const applied = [];
    let blocked = 0;
    for (let i = 0; i < cand.length && applied.length + blocked < n; i++) {
      if (Math.random() < resist) { blocked++; continue; }
      const [r, c] = cand[i];
      const x = this.g[r][c];
      if (kind === 'jam') { x.t = T_JUNK; x.mod = null; }
      else if (kind === 'freeze') x.frozen = 3;
      else if (kind === 'virus') x.virus = true;
      else if (kind === 'mine') x.mine = 3;
      applied.push([r, c]);
    }
    if (applied.length || blocked) this.emit({ k: 'inject', kind, cells: applied, blocked });
    return { applied: applied.length, blocked };
  }

  // лёд тает: заморозка держится несколько ходов владельца
  thawTick() {
    const th = [];
    this.forEach((x, r, c) => { if (x.frozen) { x.frozen--; if (!x.frozen) th.push([r, c]); } });
    if (th.length) this.emit({ k: 'cleanse', cells: th });
  }

  virusTick() {
    const vs = [];
    this.forEach((x, r, c) => { if (x.virus) vs.push([r, c]); });
    const spread = [];
    for (const [r, c] of vs) {
      if (Math.random() > 0.35) continue;
      const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dr, dc]) => [r + dr, c + dc]).filter(([rr, cc]) => Board.normal(this.at(rr, cc)));
      if (nb.length) { const [rr, cc] = U.pick(nb); this.g[rr][cc].virus = true; spread.push([rr, cc]); }
    }
    if (spread.length) this.emit({ k: 'inject', kind: 'virus', cells: spread, blocked: 0 });
    return vs.length + spread.length;
  }

  mineTick() {
    const ex = [];
    this.forEach((x, r, c) => {
      if (x.mine > 0) { x.mine--; if (x.mine === 0) ex.push([r, c]); }
    });
    for (const [r, c] of ex) {
      const x = this.g[r][c];
      x.t = T_JUNK; x.mod = null; x.sp = null; x.virus = false; x.frozen = 0;
      const conv = [];
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const y = this.at(r + dr, c + dc);
        if (y && Board.normal(y)) { y.t = T_JUNK; y.mod = null; conv.push([r + dr, c + dc]); }
      }
      this.emit({ k: 'mine', r, c, cells: conv });
    }
    if (ex.length && !this.hasMoves()) this.shuffle();
    return ex.length;
  }

  // Очистка вредоносных блоков ремонтными дроидами
  cleanse(n) {
    const order = [];
    this.forEach((x, r, c) => {
      const p = x.mine ? 0 : x.virus ? 1 : x.frozen ? 2 : x.t === T_JUNK ? 3 : -1;
      if (p >= 0) order.push({ p, r, c, x });
    });
    order.sort((a, b) => a.p - b.p || Math.random() - 0.5);
    const done = [];
    for (const o of order.slice(0, n)) {
      const x = o.x;
      x.mine = 0; x.virus = false; x.frozen = 0;
      if (x.t === T_JUNK) {
        let k = 0;
        do { x.t = this.randType(); } while (this.matchAt(o.r, o.c) && k++ < 20);
        if (this.matchAt(o.r, o.c)) x.t = T_JUNK;
      }
      done.push([o.r, o.c]);
    }
    if (done.length) this.emit({ k: 'cleanse', cells: done });
    return done.length;
  }

  debuffs() {
    let n = 0;
    this.forEach(x => { if (x.mine || x.virus || x.frozen || x.t === T_JUNK) n++; });
    return n;
  }
}
