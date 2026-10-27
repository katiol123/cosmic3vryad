'use strict';
// ============================================================
//  ИИ: оценка ходов на поле, выбор цели, тактика дистанции
// ============================================================

const AI = {
  // Веса ценности каждого типа блока для корабля прямо сейчас
  needs(ship, battle) {
    const s = ship.s;
    const deficit = res => {
      const ws = ship.weapons.filter(w => w.res === res);
      if (!ws.length) return -1;
      const cap = U.sum(ws, w => w.cap);
      const have = U.sum(ws, w => w.charge) + ship[res];
      return U.clamp(1 - have / cap, 0, 1);
    };
    const dE = deficit('energy'), dA = deficit('ammo'), dD = deficit('data');
    const W = [0, 0, 0, 0, 0, 0];
    W[0] = dE < 0 ? 0.1 : 0.7 + 1.8 * dE;
    W[1] = dA < 0 ? 0.1 : 0.7 + 1.8 * dA;
    W[2] = s.maxShield > 0 ? 0.25 + 2.2 * (1 - ship.shield / s.maxShield) : 0.03;
    const hpLost = 1 - ship.hpFrac;
    W[3] = 0.1 + 3.2 * Math.pow(hpLost, 1.2) * Math.min(1.6, s.rPer / 6);
    // манёвр ценен, если оружие не достаёт цель
    let outOfRange = 0;
    const tgt = ship.target;
    if (tgt && battle) {
      const d = battle.dist(ship, tgt);
      const want = battle.desiredDistance(ship, tgt);
      outOfRange = U.clamp(Math.abs(d - want) - ship.move, 0, 8) / 8;
    }
    W[4] = 0.35 + 1.6 * outOfRange + (ship.evadeBuff < 10 ? 0.15 : 0);
    W[5] = 0.3 + (s.ew ? 0.7 : 0) + (dD >= 0 ? 0.6 + 1.4 * dD : 0) + (ship.data < 15 ? 0.2 : 0);
    return W;
  },

  // Быстрая симуляция хода без досыпки новых блоков
  simulate(board, m, W) {
    const w = board.w, h = board.h, n = w * h;
    const T = new Int8Array(n), S = new Int8Array(n), Z = new Uint8Array(n), M = new Uint8Array(n), X = new Uint8Array(n);
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
      const x = board.g[r][c], k = r * w + c;
      if (!x) { T[k] = -1; continue; }
      T[k] = x.t; S[k] = x.sp === 'h' ? 1 : x.sp === 'v' ? 2 : x.sp === 'bomb' ? 3 : 0;
      Z[k] = x.frozen || x.virus ? 1 : 0; M[k] = x.mine ? (x.mine === 1 ? 2 : 1) : 0; X[k] = x.mod === 'x2' ? 2 : x.mod === 'crit' ? 3 : 1;
    }
    const k1 = m[0] * w + m[1], k2 = m[2] * w + m[3];
    const sw = (A) => { const t = A[k1]; A[k1] = A[k2]; A[k2] = t; };
    sw(T); sw(S); sw(Z); sw(M); sw(X);
    const avgW = (W[0] + W[1] + W[2] + W[3] + W[4] + W[5]) / 6;
    // особые обмены
    if (T[k1] === T_NOVA || T[k2] === T_NOVA) {
      const other = T[k1] === T_NOVA ? k2 : k1;
      if (T[other] === T_NOVA) return 60 * avgW + 10;
      let cnt = 0;
      for (let k = 0; k < n; k++) if (T[k] === T[other]) cnt++;
      return cnt * W[T[other]] * (S[other] ? 2.2 : 1) + 6;
    }
    if (S[k1] && S[k2]) return (S[k1] === 3 && S[k2] === 3 ? 25 : 18) * avgW + 6;

    let total = 0, cascade = 0;
    const rem = new Uint8Array(n);
    while (cascade < 6) {
      rem.fill(0);
      let found = false;
      // горизонтали
      for (let r = 0; r < h; r++) {
        let c = 0;
        while (c < w) {
          const t = T[r * w + c];
          if (t < 0 || t >= 6) { c++; continue; }
          let e = c + 1;
          while (e < w && T[r * w + e] === t) e++;
          const len = e - c;
          if (len >= 3) {
            found = true;
            for (let i = c; i < e; i++) rem[r * w + i] = 1;
            total += (len >= 5 ? 9 : len === 4 ? 3.2 : 0) * (0.6 + avgW);
          }
          c = e;
        }
      }
      for (let c = 0; c < w; c++) {
        let r = 0;
        while (r < h) {
          const t = T[r * w + c];
          if (t < 0 || t >= 6) { r++; continue; }
          let e = r + 1;
          while (e < h && T[e * w + c] === t) e++;
          const len = e - r;
          if (len >= 3) {
            found = true;
            for (let i = r; i < e; i++) {
              if (rem[i * w + c]) total += 2.5 * (0.6 + avgW); // пересечение = бомба
              rem[i * w + c] = 1;
            }
            total += (len >= 5 ? 9 : len === 4 ? 3.2 : 0) * (0.6 + avgW);
          }
          r = e;
        }
      }
      if (!found) break;
      cascade++;
      // срабатывание существующих спецблоков
      for (let k = 0; k < n; k++) {
        if (!rem[k] || !S[k]) continue;
        const r = Math.floor(k / w), c = k % w;
        if (S[k] === 1) for (let i = 0; i < w; i++) rem[r * w + i] = rem[r * w + i] || 2;
        else if (S[k] === 2) for (let i = 0; i < h; i++) rem[i * w + c] = rem[i * w + c] || 2;
        else if (S[k] === 3) for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr, cc = c + dc;
          if (rr >= 0 && cc >= 0 && rr < h && cc < w) rem[rr * w + cc] = rem[rr * w + cc] || 2;
        }
      }
      const mult = 1 + 0.25 * (cascade - 1);
      for (let k = 0; k < n; k++) {
        if (!rem[k]) {
          // обломки рядом с совпадением
          if (T[k] === T_JUNK) {
            const r = Math.floor(k / w), c = k % w;
            if ((c > 0 && rem[k - 1] === 1) || (c < w - 1 && rem[k + 1] === 1) || (r > 0 && rem[k - w] === 1) || (r < h - 1 && rem[k + w] === 1)) {
              rem[k] = 3;
              total += 0.8;
            }
          }
          continue;
        }
        const t = T[k];
        if (t >= 0 && t < 6) {
          if (Z[k]) total += 1.0;
          else total += W[t] * (X[k] === 2 ? 2 : 1) * mult + (X[k] === 3 ? 2.5 : 0);
          if (M[k]) total += M[k] === 2 ? 14 : 5;
        } else if (t === T_JUNK) total += 0.8;
      }
      // удаление и гравитация
      for (let c = 0; c < w; c++) {
        let write = h - 1;
        for (let r = h - 1; r >= 0; r--) {
          const k = r * w + c;
          if (!rem[k] && T[k] !== -1) {
            const dst = write * w + c;
            if (dst !== k) { T[dst] = T[k]; S[dst] = S[k]; Z[dst] = Z[k]; M[dst] = M[k]; X[dst] = X[k]; }
            write--;
          }
        }
        for (let r = write; r >= 0; r--) { const k = r * w + c; T[k] = -1; S[k] = 0; Z[k] = 0; M[k] = 0; X[k] = 1; }
      }
    }
    return total;
  },

  chooseMove(ship, battle) {
    const board = ship.board;
    const moves = board.listMoves();
    if (!moves.length) return null;
    const W = AI.needs(ship, battle);
    const noise = ship.diff === 'easy' ? 0.6 : ship.diff === 'hard' ? 0.03 : 0.18;
    let best = null, bestScore = -Infinity;
    const scored = moves.map(m => {
      const v = AI.simulate(board, m, W);
      // небольшой бонус за ходы внизу поля (больше каскадов)
      const low = (Math.max(m[0], m[2]) / board.h) * 0.4;
      return { m, v: (v + low) * (1 + U.rf(-noise, noise)) };
    });
    if (ship.diff === 'easy' && Math.random() < 0.35) return U.pick(moves);
    for (const s of scored) if (s.v > bestScore) { bestScore = s.v; best = s.m; }
    return best;
  },

  chooseTarget(ship, battle) {
    const enemies = battle.enemies(ship);
    if (!enemies.length) return null;
    let best = null, bestV = -Infinity;
    for (const e of enemies) {
      const d = battle.dist(ship, e);
      let reach = 0;
      for (const w of ship.weapons) reach += weaponDps(w) * (w.range >= d ? 1 : 0.35);
      const ehp = e.hp + e.shield * 0.7;
      const threat = U.sum(e.weapons, weaponDps);
      let v = reach * (1.4 - e.hpFrac * 0.6) / Math.sqrt(ehp + 30) + threat * 0.004;
      if (e === ship.target) v *= 1.15; // не дёргаемся без причины
      if (v > bestV) { bestV = v; best = e; }
    }
    return best;
  },
};
