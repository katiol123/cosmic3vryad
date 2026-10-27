'use strict';
// ============================================================
//  Боевой движок: очередь ходов, ресурсы, манёвры, стрельба,
//  эффекты, РЭБ, победа. Визуализация — через хуки this.ui.
// ============================================================

const TACTICS = {
  auto: { name: 'Авто', desc: 'ИИ выбирает выгодную дистанцию' },
  close: { name: 'Сближение', desc: 'Идти на минимальную дистанцию' },
  hold: { name: 'Держать', desc: 'Оставаться на месте, весь манёвр — в уклонение' },
  far: { name: 'Отход', desc: 'Разрывать дистанцию' },
};

const MAX_ROUNDS = 70;
const FIELD_LEN = 22; // длина поля боя: корабли стоят на одной оси, синие слева

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
    this.order = [];
    this.stopped = false;
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
  dist(a, b) { return Math.max(1, Math.abs(a.pos - b.pos)); }

  // Оптимальная дистанция до цели: максимум своего урона минус урон врага
  desiredDistance(ship, tgt) {
    const t = ship.tactic;
    if (t === 'close') return 2;
    if (t === 'far') return FIELD_LEN;
    if (t === 'hold' || !tgt) return this.dist(ship, tgt || ship);
    let best = 12, bestV = -Infinity;
    const cur = this.dist(ship, tgt);
    for (let d = 2; d <= FIELD_LEN; d++) {
      let v = 0;
      for (const w of ship.weapons) if (w.range >= d) v += weaponDps(w) * (1 - Math.max(0, d - w.range * 0.5) * 0.012);
      for (const w of tgt.weapons) if (w.range >= d) v -= weaponDps(w) * 0.45;
      v -= Math.abs(d - cur) * 0.05;
      if (v > bestV) { bestV = v; best = d; }
    }
    return best;
  }

  async run() {
    this.msg('Битва началась!', 'sys');
    this.hook('update');
    while (!this.over && !this.stopped) {
      this.round++;
      this.order = this.ships.filter(s => s.alive)
        .map(s => ({ s, k: s.s.init + Math.random() * 3 }))
        .sort((a, b) => b.k - a.k).map(o => o.s);
      this.hook('onRound', this.round);
      for (const ship of this.order) {
        if (!ship.alive || this.over || this.stopped) continue;
        await this.takeTurn(ship);
        this.checkEnd();
        if (this.over || this.stopped) break;
      }
      if (!this.over && this.round >= MAX_ROUNDS) this.endByScore();
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
    await this.pace(this.viewing(ship) ? 200 : 120);

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

    let extra = 0, stuck = 0;
    for (;;) {
      if (ship.ctrl !== 'human' || !ship.target || !ship.target.alive) ship.target = AI.chooseTarget(ship, this);
      this.hook('update');
      let move;
      if (!ship.board.hasMoves()) { ship.board.shuffle(); await this.bwait(ship, 450); }
      if (ship.ctrl === 'human') move = await this.hook('waitHuman', ship);
      else {
        await this.pace(this.viewing(ship) ? 240 : 60);
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
    await this.bwait(ship, 230);
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
      await this.bwait(ship, 300);
      b.collapse();
      await this.bwait(ship, 340);
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
    const tgt = ship.target;
    if (!tgt || !tgt.alive || ship.move < 0.1) return;
    const cur = this.dist(ship, tgt);
    const want = this.desiredDistance(ship, tgt);
    const delta = cur - want;
    if (Math.abs(delta) < 0.5) return;
    const dir = Math.sign(tgt.pos - ship.pos) || (ship.side === 0 ? 1 : -1);
    const step = Math.sign(delta) * Math.min(Math.abs(delta), ship.move);
    const np = U.clamp(ship.pos + dir * step, 0, FIELD_LEN);
    const used = Math.abs(np - ship.pos);
    if (used < 0.3) return;
    ship.pos = np;
    ship.move -= used;
    this.msg(`${ship.name} ${step > 0 ? 'сближается' : 'отходит'}: дистанция ${U.r1(this.dist(ship, tgt))}`, 'move', ship);
    await this.hookP('onMove', ship);
    await this.pace(this.viewing(ship) ? 250 : 120);
  }

  hitChance(att, w, tgt) {
    const d = this.dist(att, tgt);
    const eva = tgt.evasion * (w.homing ? 0.5 : 1);
    const rangePen = Math.max(0, d - w.range * 0.55) * 1.4;
    const dataBonus = Math.min(att.data, 25) * 0.6;
    return U.clamp(w.acc + att.s.acc + dataBonus - eva - rangePen, 5, 97);
  }
  critChance(att, w) {
    return U.clamp(w.crit + att.s.crit + Math.min(att.data, 25) * 0.3, 0, 75);
  }

  pickFireTarget(ship, w) {
    const t = ship.target;
    if (t && t.alive && this.dist(ship, t) <= w.range) return t;
    const cands = this.enemies(ship).filter(e => this.dist(ship, e) <= w.range);
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
    const gap = this.ui.shoot ? 240 : 0;
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
    for (let i = 0; i < w.shots; i++) {
      let hit = Math.random() * 100 < pHit;
      let phased = false;
      if (hit && tgt.s.phase && Math.random() < tgt.s.phase) { hit = false; phased = true; }
      let crit = false;
      if (hit) {
        if (att.critCharges > 0) { crit = true; att.critCharges--; }
        else crit = Math.random() * 100 < pCrit;
      }
      const dmg = U.rf(w.dmin, w.dmax) * w.dmgMul * rage * (crit ? att.s.critMult : 1);
      shots.push({ hit, crit, phased, dmg, i, n: w.shots });
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
      const r = tgt.takeDamage(sh.dmg, w.dt, { pierce: w.pierce, armorPen: w.armorPen, shred: shred ? shred.v : 0 });
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
    this.msg(`${att.name} → ${tgt.name}: ${w.it.base}${w.shots > 1 ? ` (${hits}/${w.shots})` : ''}${hits ? ` −${Math.round(dealt)}` : ''}${crits ? ' КРИТ!' : ''}${missTxt}`,
      hits ? (crits ? 'crit' : 'hit') : 'miss', att);
    this.hook('update');
    await this.pace(this.viewing(att) || this.ui.shoot ? 120 : 20);
  }

  applyEffect(att, tgt, e, dmgDone) {
    if (!tgt.alive && e.k !== 'leech') return;
    const E = EFFECTS[e.k];
    let note = null;
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
        break;
      }
      case 'scramble': tgt.board.inject('scramble', 1, 0); note = 'поле перемешано'; break;
      case 'corrode': tgt.addStatus('corrode', e.v, e.t); note = `коррозия −${Math.round(e.v * 100)}% брони`; break;
      case 'slow': tgt.addStatus('slow', e.v, e.t); note = `замедлен −${e.v}% уклонения`; break;
      case 'stun': tgt.addStatus('stun', 1, 2); note = 'перегрузка систем!'; break;
      case 'pull': {
        const d = this.dist(att, tgt), dir = Math.sign(att.pos - tgt.pos) || 1;
        tgt.pos = U.clamp(tgt.pos + dir * Math.min(e.v, d - 1), 0, FIELD_LEN);
        this.hook('onMove', tgt); note = 'притянут'; break;
      }
      case 'push': {
        const dir = Math.sign(tgt.pos - att.pos) || (tgt.side === 0 ? -1 : 1);
        tgt.pos = U.clamp(tgt.pos + dir * e.v, 0, FIELD_LEN);
        this.hook('onMove', tgt); note = 'отброшен'; break;
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
    if (ew.kind === 'siphon') {
      const e = Math.min(tgt.energy, ew.power), a = Math.min(tgt.ammo, ew.power);
      tgt.energy -= e; tgt.ammo -= a;
      ship.feed('energy', e); ship.feed('ammo', a);
      this.msg(`⌁ ${ship.name} взламывает ${tgt.name}: перехвачено ${Math.round(e)} энергии, ${Math.round(a)} боеприпасов`, 'fx', ship);
    } else {
      const r = tgt.board.inject(ew.kind, ew.power, tgt.s.ewRes);
      const E = EFFECTS[ew.kind];
      this.msg(`⌁ ${ship.name} взламывает поле ${tgt.name}: ${E.name} ×${r.applied}${r.blocked ? ` (отражено ${r.blocked})` : ''}`, 'fx', ship);
    }
    this.hook('update');
    await this.pace(this.viewing(tgt) ? 500 : 150);
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
