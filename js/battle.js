'use strict';
// ============================================================
//  Боевой движок: очередь ходов, ресурсы, манёвры, стрельба,
//  эффекты, РЭБ, победа. Визуализация — через хуки this.ui.
// ============================================================

const TACTICS = {
  auto: { name: 'Авто', desc: 'Позиция, где ваш урон максимален, а урон по вам минимален (с учётом флангов)' },
  close: { name: 'Сближение', desc: 'Идти вплотную к цели' },
  flank: { name: 'Обход', desc: 'Заходить цели в борт и корму, даже ценой лишнего риска' },
  hold: { name: 'Держать', desc: 'Не двигаться: только разворот носом к цели' },
  far: { name: 'Отход', desc: 'Держаться как можно дальше от всех врагов' },
};

const MAX_ROUNDS = 60;
const FIELD_W = 26, FIELD_H = 16;   // размер двумерного поля боя (в единицах дистанции)
const SPEED_BASE = 26;              // скорость хода = SPEED_BASE + инициатива
const ACT = 100;                    // «стоимость» одного хода на шкале времени
// фланги: угол между носом цели и направлением на стрелка
const FLANK = {
  front: { k: 1, name: 'НОС' },
  side: { k: 1.5, name: 'БОРТ' },
  rear: { k: 2, name: 'КОРМА' },
};
const BOARD_FX = ['freeze', 'jam', 'virus', 'mine', 'scramble'];

class Battle {
  constructor(cfg) {
    this.cfg = cfg;
    this.ui = cfg.ui || {};
    this.ships = [];
    cfg.fleets.forEach((fleet, side) => {
      fleet.ships.forEach((def, i) => {
        const sh = new Ship(def, side, i, fleet.ctrl);
        sh.diff = fleet.diff || 'normal';
        sh.board.onEvent = ev => this.hook('boardEvent', sh, ev);
        this.ships.push(sh);
      });
    });
    this.round = 0;
    this.active = null;
    this.over = false;
    this.winner = null;
    this.log = [];
    this.stopped = false;
    this.time = 0;
    // расстановка: синие слева носом вправо, красные справа носом влево
    for (let side = 0; side < 2; side++) {
      const list = this.ships.filter(sh => sh.side === side);
      list.forEach((sh, i) => {
        sh.y = (i + 1) * FIELD_H / (list.length + 1) + U.rf(-0.4, 0.4);
        sh.x = side === 0 ? U.rf(3, 5.5) : FIELD_W - U.rf(3, 5.5);
        sh.heading = side === 0 ? 0 : Math.PI;
      });
    }
    const avg = U.sum(this.ships, sh => sh.s.init) / this.ships.length;
    this.roundLen = ACT / (SPEED_BASE + avg);
    for (const sh of this.ships) sh.nextAt = ACT / this.speed(sh) * U.rf(0.15, 1);
  }

  // Скорость хода: чем выше инициатива, тем чаще корабль ходит
  speed(ship) {
    const slow = ship.status('slow');
    return Math.max(2, (SPEED_BASE + ship.s.init) * (slow ? 0.8 : 1));
  }
  // Ближайшие ходы (для шкалы очерёдности)
  forecast(n) {
    const alive = this.ships.filter(sh => sh.alive);
    const t = new Map(alive.map(sh => [sh, sh.nextAt]));
    const out = [];
    for (let i = 0; i < n && alive.length; i++) {
      let best = alive[0];
      for (const sh of alive) if (t.get(sh) < t.get(best) - 1e-9 || (Math.abs(t.get(sh) - t.get(best)) < 1e-9 && this.speed(sh) > this.speed(best))) best = sh;
      out.push(best);
      t.set(best, t.get(best) + ACT / this.speed(best));
    }
    return out;
  }

  hook(name, ...args) {
    const f = this.ui[name];
    return f ? f.apply(this.ui, args) : undefined;
  }
  async hookP(name, ...args) {
    const r = this.hook(name, ...args);
    if (r && typeof r.then === 'function') await r;
    return r;
  }
  msg(text, cls = '', ship = null) {
    const e = { text, cls, side: ship ? ship.side : -1, round: this.round };
    this.log.push(e);
    if (this.log.length > 300) this.log.shift();
    this.hook('onLog', e);
  }
  viewing(ship) { return !!this.hook('isViewing', ship); }
  pace(ms) { return Clock.wait(ms); }
  bwait(ship, ms) { return Clock.wait(this.viewing(ship) ? ms : ms * 0.12); }

  enemies(ship) { return this.ships.filter(s => s.alive && s.side !== ship.side); }
  allies(ship) { return this.ships.filter(s => s.alive && s.side === ship.side); }
  dist(a, b) { return Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)); }
  nearestEnemy(ship) {
    let best = null, bd = Infinity;
    for (const e of this.enemies(ship)) { const d = this.dist(ship, e); if (d < bd) { bd = d; best = e; } }
    return best;
  }
  // С какой стороны стрелок att видит цель tgt
  aspectFrom(ax, ay, tgt, heading = tgt.heading) {
    const a = Math.atan2(ay - tgt.y, ax - tgt.x);
    const d = Math.abs(U.angDiff(a, heading));
    return d < Math.PI / 3 ? 'front' : d < Math.PI * 2 / 3 ? 'side' : 'rear';
  }
  aspect(att, tgt) { return this.aspectFrom(att.x, att.y, tgt); }
  // Доля урона оружия корабля, которое не достаёт до цели (для ИИ)
  outOfRange(ship, tgt) {
    if (!tgt) return 0;
    const d = this.dist(ship, tgt);
    const all = U.sum(ship.weapons, weaponDps) || 1;
    return U.sum(ship.weapons.filter(w => w.range < d), weaponDps) / all;
  }

  // Оценка точки на поле для манёвра
  evalPos(ship, tgt, x, y) {
    const t = ship.tactic;
    const dT = Math.max(1, Math.hypot(tgt.x - x, tgt.y - y));
    const flankK = FLANK[this.aspectFrom(x, y, tgt)].k;
    let off = 0;
    const need = Math.abs(U.angDiff(Math.atan2(tgt.y - y, tgt.x - x), ship.heading)) * 180 / Math.PI;
    const miss = Math.max(0, need - ship.turnLeft); // на сколько градусов не успеем довернуть
    for (const w of ship.weapons) {
      if (w.range >= dT && miss <= w.arc) off += weaponDps(w) * (1 - Math.max(0, dT - w.range * 0.55) * 0.014);
    }
    off *= t === 'flank' ? flankK * flankK * flankK : flankK * flankK;
    const myHead = Math.atan2(tgt.y - y, tgt.x - x);
    let def = 0, minD = Infinity;
    for (const e of this.enemies(ship)) {
      const de = Math.max(1, Math.hypot(e.x - x, e.y - y));
      minD = Math.min(minD, de);
      const k = FLANK[this.aspectFrom(e.x, e.y, { x, y }, myHead)].k;
      for (const w of e.weapons) if (w.range >= de) def += weaponDps(w) * k * (e === tgt ? 1 : 0.8);
    }
    let v = off - def * 0.5;
    if (t === 'close') v -= dT * 40;
    if (t === 'far') v = minD * 40 - def * 0.2;
    for (const o of this.ships) {
      if (o === ship || !o.alive) continue;
      const dd = Math.hypot(o.x - x, o.y - y), minD = 1.2 * (o.hull.size + ship.hull.size);
      if (dd < minD) v -= (minD - dd) * 300;
    }
    v -= Math.hypot(x - ship.x, y - ship.y) * 0.3;
    return v;
  }
  // Можно ли переместиться в направлении dir: двигатели толкают вперёд, маневровые — в пределах ±45°,
  // задний ход — на половине тяги без разворота. Возвращает {k: доля дистанции, cost: градусы поворота}
  moveCost(ship, dir) {
    const diff = Math.abs(U.angDiff(dir, ship.heading)) * 180 / Math.PI;
    if (diff <= 45) return { k: 1, cost: 0 };
    if (diff >= 135) return { k: 0.5, cost: 0, reverse: true };
    const cost = diff - 45;
    return cost <= ship.turnLeft ? { k: 1, cost } : null;
  }
  bestPosition(ship, tgt) {
    const R = ship.move;
    const cands = [[ship.x, ship.y, null]];
    if (ship.tactic !== 'hold' && R >= 0.3) {
      const dirs = [];
      for (let k = 0; k < 16; k++) dirs.push(k / 16 * Math.PI * 2);
      dirs.push(Math.atan2(tgt.y - ship.y, tgt.x - ship.x));
      for (const a of dirs) {
        const mc = this.moveCost(ship, a);
        if (!mc) continue;
        for (const f of [1, 0.5]) {
          const r = R * f * mc.k;
          cands.push([ship.x + Math.cos(a) * r, ship.y + Math.sin(a) * r, Object.assign({ a }, mc)]);
        }
      }
    }
    let best = cands[0], bv = -Infinity;
    for (const c of cands) {
      c[0] = U.clamp(c[0], 0.8, FIELD_W - 0.8); c[1] = U.clamp(c[1], 0.8, FIELD_H - 0.8);
      const v = this.evalPos(ship, tgt, c[0], c[1]) - (c[2] ? c[2].cost * 0.05 : 0);
      if (v > bv) { bv = v; best = c; }
    }
    return best;
  }

  // Оценка курса: своё оружие в секторе обстрела минус урон врагов с учётом флангов
  evalHeading(ship, tgt, h) {
    let v = 0;
    for (const w of ship.weapons) {
      let best = 0;
      for (const e of this.enemies(ship)) {
        const d = this.dist(ship, e);
        if (d > w.range) continue;
        if (w.arc < 180 && Math.abs(U.angDiff(Math.atan2(e.y - ship.y, e.x - ship.x), h)) > w.arc * Math.PI / 180) continue;
        best = Math.max(best, weaponDps(w) * (e === tgt ? 1.3 : 1) * FLANK[this.aspect(ship, e)].k);
      }
      v += best;
    }
    for (const e of this.enemies(ship)) {
      const de = this.dist(ship, e);
      const k = FLANK[this.aspectFrom(e.x, e.y, ship, h)].k;
      for (const w of e.weapons) if (w.range + 2 >= de) v -= weaponDps(w) * k * 0.6;
    }
    return v;
  }
  bestHeading(ship, tgt) {
    const max = Math.max(0, ship.turnLeft) * Math.PI / 180;
    const dirs = [ship.heading, Math.atan2(tgt.y - ship.y, tgt.x - ship.x)];
    for (const e of this.enemies(ship)) dirs.push(Math.atan2(e.y - ship.y, e.x - ship.x));
    for (let k = 0; k < 8; k++) dirs.push(k * Math.PI / 4);
    let best = ship.heading, bv = -Infinity;
    for (const d of dirs) {
      const h = U.angNorm(ship.heading + U.clamp(U.angDiff(d, ship.heading), -max, max));
      const v = this.evalHeading(ship, tgt, h);
      if (v > bv + 1e-6) { bv = v; best = h; }
    }
    return best;
  }

  async run() {
    this.msg('Битва началась!', 'sys');
    this.hook('update');
    while (!this.over && !this.stopped) {
      const alive = this.ships.filter(sh => sh.alive);
      let ship = alive[0];
      for (const sh of alive) if (sh.nextAt < ship.nextAt - 1e-9 || (Math.abs(sh.nextAt - ship.nextAt) < 1e-9 && this.speed(sh) > this.speed(ship))) ship = sh;
      this.time = ship.nextAt;
      const r = Math.floor(this.time / this.roundLen) + 1;
      if (r > this.round) {
        this.round = r;
        if (this.round > MAX_ROUNDS) { this.endByScore(); break; }
        this.hook('onRound', this.round);
      }
      ship.nextAt += ACT / this.speed(ship);
      await this.takeTurn(ship);
      this.checkEnd();
    }
    if (!this.stopped) this.hook('onEnd', this);
    return this.winner;
  }

  checkEnd() {
    for (let side = 0; side < 2; side++) {
      if (!this.ships.some(s => s.side === side && s.alive)) {
        this.over = true;
        this.winner = 1 - side;
        this.msg(`Победа: ${this.winner === 0 ? 'Синий' : 'Красный'} флот!`, 'sys');
        return;
      }
    }
  }
  endByScore() {
    const score = side => U.sum(this.ships.filter(s => s.side === side && s.alive), s => s.hpFrac * s.s.maxHp);
    const a = score(0), b = score(1);
    this.over = true;
    this.winner = a === b ? -1 : a > b ? 0 : 1;
    this.msg(`Время вышло! ${this.winner < 0 ? 'Ничья' : 'По очкам победил ' + (this.winner === 0 ? 'Синий' : 'Красный') + ' флот'}.`, 'sys');
  }

  // ---------------- Ход корабля ----------------
  async takeTurn(ship) {
    this.active = ship;
    ship.st.turns++;
    this.hook('onTurn', ship);
    this.hook('update');
    await this.pace(this.viewing(ship) ? 140 : 80);

    await this.startTurn(ship);
    if (!ship.alive || this.over) return;
    const stun = ship.status('stun');
    if (stun) {
      this.msg(`${ship.name}: системы перегружены — пропуск хода`, 'warn', ship);
      this.hook('banner', ship, 'ПЕРЕГРУЗКА СИСТЕМ', 'bad');
      ship.statuses = ship.statuses.filter(s => s.k !== 'stun');
      await this.pace(600);
      return;
    }
    ship.evadeBuff = 0;
    ship.move = ship.s.freeMove;
    ship.turnLeft = ship.s.turn;

    let extra = 0, stuck = 0;
    for (;;) {
      if (ship.ctrl !== 'human' || !ship.target || !ship.target.alive) ship.target = AI.chooseTarget(ship, this);
      this.hook('update');
      let move;
      if (!ship.board.hasMoves()) { ship.board.shuffle(); await this.bwait(ship, 450); }
      if (ship.ctrl === 'human') move = await this.hook('waitHuman', ship);
      else {
        await this.pace(this.viewing(ship) ? 150 : 40);
        move = AI.chooseMove(ship, this);
        if (move && this.viewing(ship)) await this.hookP('aiPreview', ship, move);
      }
      if (this.stopped) return;
      if (!move) {
        if (++stuck > 3) break;
        if (stuck > 1) ship.board.cleanse(10);
        ship.board.shuffle();
        await this.bwait(ship, 400);
        continue;
      }
      const res = await this.resolveMove(ship, move);
      if (this.stopped) return;
      await this.maneuver(ship);
      await this.firePhase(ship);
      if (this.over || this.stopped) return;
      await this.ewPhase(ship);
      if (this.over || this.stopped) return;
      const bonus = res.extra || Math.random() < ship.s.extraTurn;
      if (bonus && extra < 2) {
        extra++;
        this.msg(`${ship.name}: ФОРСАЖ — дополнительный ход!`, 'good', ship);
        this.hook('banner', ship, 'ФОРСАЖ! ДОП. ХОД', 'good');
        await this.pace(500);
        continue;
      }
      break;
    }
    await this.endTurn(ship);
    this.hook('update');
  }

  async startTurn(ship) {
    const s = ship.s;
    if (s.shieldPassive && ship.shield < s.maxShield) ship.shield = Math.min(s.maxShield, ship.shield + s.shieldPassive);
    if (s.rPass && ship.hp < s.maxHp) ship.hp = Math.min(s.maxHp, ship.hp + s.rPass);
    if (s.ePass) ship.feed('energy', s.ePass);
    if (s.aPass) ship.feed('ammo', s.aPass);
    if (s.dPass) ship.feed('data', s.dPass);
    const burn = ship.status('burn');
    if (burn) {
      const dmg = burn.v * (1 - ship.armor * 0.5);
      ship.hp -= dmg;
      ship.st.taken += dmg;
      this.hook('onDot', ship, dmg, 'burn');
      this.msg(`${ship.name} горит: −${Math.round(dmg)} корпуса`, 'bad', ship);
      if (ship.hp <= 0) { ship.hp = 0; await this.kill(ship, burn.src); return; }
    }
    ship.board.thawTick();
    const nv = ship.board.virusTick();
    if (nv) {
      const drain = nv;
      ship.energy = Math.max(0, ship.energy - drain);
      ship.ammo = Math.max(0, ship.ammo - drain);
      ship.data = Math.max(0, ship.data - drain);
      this.msg(`${ship.name}: вирус на поле (${nv}) крадёт ресурсы`, 'bad', ship);
    }
    this.hook('update');
  }

  async endTurn(ship) {
    const ex = ship.board.mineTick();
    if (ex) {
      for (let i = 0; i < ex; i++) {
        const r = ship.takeDamage(22 + this.round * 0.5, 'explosive');
        this.hook('onHit', ship, r, { hit: true, crit: false, mine: true }, null, null);
        this.msg(`${ship.name}: мина взорвалась на поле! −${Math.round(r.hullDmg + r.shieldDmg)}`, 'bad', ship);
        if (r.killed) { await this.kill(ship, null); return; }
      }
      await this.bwait(ship, 500);
    }
    for (const st of ship.statuses) st.t--;
    ship.statuses = ship.statuses.filter(st => st.t > 0);
  }

  async resolveMove(ship, m) {
    const b = ship.board;
    const [r1, c1, r2, c2] = m;
    b.swap(r1, c1, r2, c2);
    await this.bwait(ship, 190);
    const total = { counts: [0, 0, 0, 0, 0, 0], extra: false, cascade: 0, specials: 0 };
    let cascade = 0;
    const handle = async res => {
      cascade++;
      const mult = 1 + (cascade - 1) * (0.25 + ship.s.cascade);
      const g = ship.gainBlocks(res.counts, mult);
      ship.critCharges += res.crit;
      if (res.defused) ship.feed('data', res.defused * 3);
      res.counts.forEach((v, i) => { total.counts[i] += v; });
      ship.st.blocks += res.removed;
      total.specials += res.specials;
      if (res.nova || res.maxRun >= 5) total.extra = true;
      this.hook('onGain', ship, res, g, cascade);
      this.hook('update');
      await this.bwait(ship, 230);
      b.collapse();
      await this.bwait(ship, 270);
    };
    let res = b.activateSwap([r1, c1], [r2, c2]);
    if (res) await handle(res);
    while ((res = b.step(cascade === 0 ? [[r1, c1], [r2, c2]] : null))) await handle(res);
    if (total.specials >= 2) total.extra = true;
    total.cascade = cascade;
    if (cascade >= 3) this.hook('banner', ship, `КАСКАД ×${cascade}`, 'combo');
    // ремонтные дроиды чистят поле
    if (total.counts[3] && ship.s.cleanse) {
      const n = b.cleanse(Math.ceil(total.counts[3] / 3) * ship.s.cleanse);
      if (n) this.msg(`${ship.name}: дроиды очистили ${n} блок(ов)`, 'good', ship);
    }
    if (!b.hasMoves()) {
      b.shuffle();
      await this.bwait(ship, 450);
    }
    const parts = [];
    const g = total.counts;
    BLOCKS.forEach((bl, i) => { if (g[i]) parts.push(`${bl.name} ${g[i]}`); });
    if (parts.length) this.msg(`${ship.name}: ${parts.join(', ')}${cascade > 1 ? ` (каскад ×${cascade})` : ''}`, '', ship);
    return total;
  }

  async maneuver(ship) {
    const tgt = ship.target && ship.target.alive ? ship.target : this.nearestEnemy(ship);
    if (!tgt) return;
    let moved = false, turned = false;
    if (ship.move >= 0.3) {
      const [x, y, mc] = this.bestPosition(ship, tgt);
      const d = Math.hypot(x - ship.x, y - ship.y);
      if (d > 0.3) {
        // разворот, нужный для движения, тратит запас поворота
        if (mc && mc.cost > 0) {
          const diff = U.angDiff(mc.a, ship.heading);
          ship.heading = U.angNorm(ship.heading + Math.sign(diff) * mc.cost * Math.PI / 180);
          ship.turnLeft -= mc.cost;
        }
        ship.x = x; ship.y = y; ship.move -= mc && mc.reverse ? d * 2 : d; moved = true;
        const asp = this.aspect(ship, tgt);
        this.msg(`${ship.name} манёврирует: дистанция ${U.r1(this.dist(ship, tgt))}${asp !== 'front' ? `, заходит в ${asp === 'side' ? 'борт' : 'корму'}` : ''}`, 'move', ship);
      }
    }
    // разворот: лучший курс в пределах запаса поворота
    const want = this.bestHeading(ship, tgt);
    const diff = U.angDiff(want, ship.heading);
    if (Math.abs(diff) > 0.02) {
      ship.heading = U.angNorm(ship.heading + diff);
      ship.turnLeft -= Math.abs(diff) * 180 / Math.PI;
      turned = true;
    }
    if (moved || turned) {
      await this.hookP('onMove', ship);
      await this.pace(this.viewing(ship) ? 120 : 60);
    }
  }

  hitChance(att, w, tgt) {
    const d = this.dist(att, tgt);
    const eva = tgt.evasion * (w.homing ? 0.5 : 1);
    const hk = att.status('hacked');
    const rangePen = Math.max(0, d - w.range * 0.55) * 1.4;
    const dataBonus = Math.min(att.data, 25) * 0.6;
    return U.clamp(w.acc + att.s.acc + dataBonus - eva - rangePen - (hk ? hk.v : 0), 5, 97);
  }
  critChance(att, w) {
    return U.clamp(w.crit + att.s.crit + Math.min(att.data, 25) * 0.3, 0, 75);
  }

  // Цель в секторе обстрела оружия?
  inArc(ship, w, tgt) {
    if (w.arc >= 180) return true;
    return Math.abs(U.angDiff(Math.atan2(tgt.y - ship.y, tgt.x - ship.x), ship.heading)) <= w.arc * Math.PI / 180 + 1e-6;
  }
  canHit(ship, w, tgt) { return this.dist(ship, tgt) <= w.range && this.inArc(ship, w, tgt); }

  pickFireTarget(ship, w) {
    const t = ship.target;
    if (t && t.alive && this.canHit(ship, w, t)) return t;
    const cands = this.enemies(ship).filter(e => this.canHit(ship, w, e));
    if (!cands.length) return null;
    return cands.reduce((a, b) => (b.hp + b.shield < a.hp + a.shield ? b : a));
  }

  async firePhase(ship) {
    ship.topUp();
    this.hook('update');
    // заранее резервируем заряд на все залпы, затем стреляем почти одновременно
    const launches = [];
    for (const w of ship.weapons) {
      let volleys = 0;
      while (w.charge >= w.cost - 1e-6 && volleys < w.rof && this.pickFireTarget(ship, w)) {
        w.charge -= w.cost;
        volleys++;
        launches.push(w);
      }
    }
    const gap = this.ui.shoot ? 170 : 0;
    await Promise.all(launches.map(async (w, i) => {
      if (i) await Clock.wait(i * gap);
      if (this.over || this.stopped || !ship.alive) return;
      const tgt = this.pickFireTarget(ship, w);
      if (!tgt) { w.charge = Math.min(w.cap, w.charge + w.cost); return; }
      await this.fireVolley(ship, w, tgt);
    }));
    ship.topUp();
  }

  async fireVolley(att, w, tgt) {
    const shots = [];
    const pHit = this.hitChance(att, w, tgt);
    const pCrit = this.critChance(att, w);
    const rage = att.s.rage && att.hpFrac < 0.4 ? 1 + att.s.rage : 1;
    const asp = this.aspect(att, tgt);
    const flank = FLANK[asp].k;
    for (let i = 0; i < w.shots; i++) {
      let hit = Math.random() * 100 < pHit;
      let phased = false;
      if (hit && tgt.s.phase && Math.random() < tgt.s.phase) { hit = false; phased = true; }
      let crit = false;
      if (hit) {
        if (att.critCharges > 0) { crit = true; att.critCharges--; }
        else crit = Math.random() * 100 < pCrit;
      }
      const dmg = U.rf(w.dmin, w.dmax) * w.dmgMul * rage * flank * (crit ? att.s.critMult : 1);
      shots.push({ hit, crit, phased, dmg, i, n: w.shots, asp });
    }
    att.st.shots += shots.length;
    const stagger = { tracer: 70, flak: 25, swarm: 70, bolt: 110, missile: 180 }[w.fx] || 140;
    const visible = this.ui.shoot ? true : false;
    let dealt = 0, hits = 0, crits = 0;
    await Promise.all(shots.map(async (sh, i) => {
      if (visible) await Clock.wait(i * stagger);
      await this.hookP('shoot', att, tgt, w, sh);
      if (!tgt.alive || this.stopped) return;
      if (!sh.hit) { this.hook('onHit', tgt, null, sh, w, att); return; }
      hits++;
      if (sh.crit) { crits++; att.st.crits++; }
      const shred = (w.eff || []).find(e => e.k === 'shred');
      const r = tgt.takeDamage(sh.dmg, w.dt, { pierce: w.pierce, armorPen: w.armorPen, halfArmor: sh.crit, shred: shred ? shred.v : 0 });
      const total = r.shieldDmg + r.hullDmg;
      dealt += total;
      att.st.dealt += total;
      this.hook('onHit', tgt, r, sh, w, att);
      if (tgt.s.reflect && att.alive) {
        const rr = att.takeDamage(total * tgt.s.reflect, 'energy');
        this.hook('onHit', att, rr, { hit: true, crit: false, reflect: true }, null, tgt);
        if (rr.killed) await this.kill(att, tgt);
      }
      for (const e of w.eff || []) {
        if (e.k === 'shred') continue;
        if (Math.random() < e.ch) this.applyEffect(att, tgt, e, total);
      }
      if (r.killed) await this.kill(tgt, att);
    }));
    att.st.hits += hits;
    const missTxt = hits === 0 ? ' — промах' : '';
    this.msg(`${att.name} → ${tgt.name}: ${w.it.base}${w.shots > 1 ? ` (${hits}/${w.shots})` : ''}${hits ? ` −${Math.round(dealt)}` : ''}${crits ? ' КРИТ!' : ''}${hits && asp !== 'front' ? ` (${FLANK[asp].name} ×${flank})` : ''}${missTxt}`,
      hits ? (crits ? 'crit' : 'hit') : 'miss', att);
    this.hook('update');
    await this.pace(this.viewing(att) || this.ui.shoot ? 80 : 20);
  }

  applyEffect(att, tgt, e, dmgDone) {
    if (!tgt.alive && e.k !== 'leech') return;
    const E = EFFECTS[e.k];
    let note = null;
    // «Защита систем» может отразить эффект (блоки поля проверяются поштучно в inject)
    if (e.k !== 'leech' && !BOARD_FX.includes(e.k) && Math.random() < tgt.s.ewRes) {
      this.msg(`${E.icon} ${tgt.name}: защита систем отразила «${E.name}»`, 'fx', tgt);
      this.counterHack(tgt, att);
      return;
    }
    switch (e.k) {
      case 'burn': tgt.addStatus('burn', e.v, e.t); tgt.status('burn').src = att; note = `горит (${e.v}/ход)`; break;
      case 'emp': {
        let left = e.v;
        const take = Math.min(tgt.energy, left); tgt.energy -= take; left -= take;
        for (const w of tgt.weapons) if (w.res === 'energy' && left > 0) { const t2 = Math.min(w.charge, left); w.charge -= t2; left -= t2; }
        note = `ЭМИ −${Math.round(e.v - left)} энергии`;
        break;
      }
      case 'freeze': case 'jam': case 'virus': case 'mine': {
        const r = tgt.board.inject(e.k, e.v, tgt.s.ewRes);
        note = r.applied ? `${E.name}: ${r.applied} блок(а)` : (r.blocked ? `${E.name} отражено` : null);
        if (r.blocked) this.counterHack(tgt, att);
        break;
      }
      case 'scramble': tgt.board.inject('scramble', 1, 0); note = 'поле перемешано'; break;
      case 'corrode': tgt.addStatus('corrode', e.v, e.t); note = `коррозия −${Math.round(e.v * 100)}% брони`; break;
      case 'slow': tgt.addStatus('slow', e.v, e.t); note = `замедлен: −${e.v}% уклонения, −20% скорости хода`; break;
      case 'stun': tgt.addStatus('stun', 1, 2); note = 'перегрузка систем!'; break;
      case 'pull': case 'push': {
        const d = this.dist(att, tgt);
        const ux = (tgt.x - att.x) / d, uy = (tgt.y - att.y) / d;
        const m = e.k === 'pull' ? -Math.min(e.v, d - 1.5) : e.v;
        tgt.x = U.clamp(tgt.x + ux * m, 0.8, FIELD_W - 0.8);
        tgt.y = U.clamp(tgt.y + uy * m, 0.8, FIELD_H - 0.8);
        this.hook('onMove', tgt); note = e.k === 'pull' ? 'притянут' : 'отброшен'; break;
      }
      case 'leech': {
        const heal = Math.min(att.s.maxHp - att.hp, dmgDone * e.v);
        if (heal > 0 && att.alive) { att.hp += heal; att.st.healed += heal; note = null; this.hook('onHeal', att, heal); }
        break;
      }
      case 'drain': {
        const t = Math.min(tgt.data, e.v);
        tgt.data -= t; att.feed('data', t);
        if (t) note = `украдено ${Math.round(t)} данных`;
        break;
      }
    }
    if (note) {
      this.hook('onEffect', tgt, e, att);
      this.msg(`${E.icon} ${tgt.name}: ${note}`, 'fx', att);
    }
  }

  async ewPhase(ship) {
    const ew = ship.s.ew;
    const tgt = ship.target && ship.target.alive ? ship.target : this.enemies(ship)[0];
    if (!ew || !tgt || ship.data < ew.cost) return;
    ship.data -= ew.cost;
    ship.st.hacks++;
    await this.hookP('onEW', ship, tgt, ew.kind);
    // любой взлом вызывает сбой систем, если его не отразит защита
    if (Math.random() >= tgt.s.ewRes) tgt.addStatus('hacked', 6 + ew.power * 3, 1);
    if (ew.kind === 'siphon') {
      const e = Math.min(tgt.energy, ew.power), a = Math.min(tgt.ammo, ew.power);
      tgt.energy -= e; tgt.ammo -= a;
      ship.feed('energy', e); ship.feed('ammo', a);
      this.msg(`⌁ ${ship.name} взламывает ${tgt.name}: перехвачено ${Math.round(e)} энергии, ${Math.round(a)} боеприпасов`, 'fx', ship);
    } else {
      const r = tgt.board.inject(ew.kind, ew.power, tgt.s.ewRes);
      if (r.blocked) this.counterHack(tgt, ship);
      const E = EFFECTS[ew.kind];
      this.msg(`⌁ ${ship.name} взламывает поле ${tgt.name}: ${E.name} ×${r.applied}${r.blocked ? ` (отражено ${r.blocked})` : ''}`, 'fx', ship);
    }
    this.hook('update');
    await this.pace(this.viewing(tgt) ? 500 : 150);
  }

  // Обратный взлом: отразивший атаку корабль с защитой систем сбивает системы нападающего
  counterHack(def, att) {
    if (!att || !att.alive || def.s.ewRes < 0.25) return;
    att.addStatus('hacked', 12, 1);
    this.msg(`⌁ ${def.name}: обратный взлом — сбой систем у ${att.name}`, 'fx', def);
    this.hook('onEffect', att, { k: 'hacked', v: 12 }, def);
  }

  async kill(ship, by) {
    if (!ship.alive) return;
    ship.alive = false;
    ship.hp = 0;
    if (by && by !== ship) by.st.kills++;
    this.msg(`💥 ${ship.name} уничтожен${by ? ` (${by.name})` : ''}!`, 'kill', ship);
    for (const s of this.ships) if (s.target === ship) s.target = null;
    this.hook('update');
    await this.hookP('onDeath', ship);
    this.checkEnd();
  }

  stop() { this.stopped = true; }
}
