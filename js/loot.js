'use strict';
// ============================================================
//  Обломки и трофеи: груз и модули выпадают из уничтоженных
//  (и сильно подбитых) кораблей и дрейфуют в секторе, пока их
//  кто-нибудь не подберёт. Бандитизм наёмников и охота за головой.
// ============================================================

const DROP_DAYS = 8;        // столько дней обломки дрейфуют в секторе
const DROP_GOOD_P = 0.45;   // шанс, что уцелеет часть каждого вида груза
const DROP_ITEM_P = 0.12;   // шанс, что уцелеет каждый модуль
const DROP_HURT_K = 0.25;   // у сильно подбитого (но уцелевшего) корабля — шансы ниже
const DROP_PICK_R = 45;     // с какого расстояния подбирают

Object.assign(World.prototype, {
  // ---------- выпадение ----------
  // k — множитель шансов; remove — снять выпавшее с корабля (он уцелел)
  makeDrop(a, sid, x, y, k = 1, remove = false) {
    const goods = {}, items = [];
    for (const g in a.cargo) {
      const q = a.cargo[g];
      if (q < 1 || Math.random() > DROP_GOOD_P * k) continue;
      const n = Math.max(1, Math.round(q * U.rf(0.3, 0.7)));
      goods[g] = n;
      if (remove) { a.cargo[g] -= n; if (a.cargo[g] <= 0) delete a.cargo[g]; }
    }
    // груз снабженца — модули для верфи: выпадают как груз
    for (const id of a.yardCargo || []) if (ITEMS[id] && Math.random() < DROP_GOOD_P * k) items.push({ id, wear: 0 }); // корпус целиком не выпадает
    for (const cat of SLOT_ORDER) (a.def.slots[cat] || []).forEach((id, i) => {
      if (!id || Math.random() > DROP_ITEM_P * k * (cat === 'artifact' ? 0.5 : 1)) return;
      items.push({ id, wear: Math.min(0.95, slotWear(a.def, cat, i) + U.rf(0.1, 0.4)) });
      if (remove) { a.def.slots[cat][i] = null; setWear(a.def, cat, i, 0); }
    });
    if (!Object.keys(goods).length && !items.length) return null;
    if (remove) this.refreshKeep(a);
    const d = { id: this.nextId++, sector: sid, x: x + U.rf(-25, 25), y: y + U.rf(-25, 25), goods, items, day: this.day, until: this.day + DROP_DAYS };
    (this.drops = this.drops || []).push(d);
    const v = this.dropValue(d);
    const near = this.player && this.player.loc === sid;
    if ((near && (items.length || v > 300)) || v > 6000) this.log(`✧ В секторе ${this.sectors[sid].name} дрейфуют обломки ${this.who(a)}: ${this.dropText(d)}.`, 'loot', { s: sid });
    return d;
  },
  dropValue(d) {
    return U.sum(Object.entries(d.goods), ([g, q]) => GOOD[g].base * q) + U.sum(d.items, it => this.sellValue(it.id, it.wear));
  },
  dropText(d) {
    const parts = Object.entries(d.goods).map(([g, q]) => `${GOOD[g].icon}${GOOD[g].name.toLowerCase()} ×${q}`);
    for (const it of d.items) parts.push(`${SLOT_TYPES[ITEMS[it.id].cat].icon}${ITEMS[it.id].name}`);
    return parts.join(', ') || 'пусто';
  },
  dropsIn(sid) { return (this.drops || []).filter(d => d.sector === sid); },
  dropById(id) { return (this.drops || []).find(d => d.id === id); },

  // ---------- подбор ----------
  pickDrop(a, d) {
    if (!d || !this.drops.includes(d)) return false;
    const got = [];
    if (a.faction === PIRATE) {
      // пираты всё обращают в добычу для базы
      const v = this.dropValue(d);
      a.loot += v;
      d.goods = {}; d.items = [];
      got.push(`добыча на ${Math.round(v)} кр.`);
    } else {
      for (const g in d.goods) {
        const space = Math.floor(a.cargoCap - this.cargoUsed(a));
        const n = Math.min(space, d.goods[g]);
        if (n <= 0) continue;
        a.cargo[g] = (a.cargo[g] || 0) + n;
        d.goods[g] -= n;
        if (d.goods[g] <= 0) delete d.goods[g];
        got.push(`${GOOD[g].icon}${GOOD[g].name.toLowerCase()} ×${n}`);
      }
      for (const it of d.items) {
        got.push(ITEMS[it.id].name);
        if (a.ctrl === 'human') { (a.stash = a.stash || []).push(it.id); }
        else this.pilotTakeItem(a, it.id, it.wear);
      }
      d.items = [];
    }
    if (!Object.keys(d.goods).length) this.drops.splice(this.drops.indexOf(d), 1);
    if (!got.length) return false;
    if (a.ctrl === 'human') this.log(`✧ Подобрано: ${got.join(', ')}.${Object.keys(d.goods).length ? ' Остальное не влезло в трюм.' : ''}`, 'player');
    else if (Math.random() < 0.5) this.log(`✧ ${this.who(a)} подобрал обломки в секторе ${this.sectors[a.loc].name}.`, 'loot', { s: a.loc });
    return true;
  },
  // ИИ-пилот ставит найденный модуль, если тот лучше своего; иначе — в трюм на продажу
  pilotTakeItem(a, id, wear) {
    const it = ITEMS[id], cat = it.cat;
    const slots = a.def.slots[cat] || [];
    const base = this.pilotScore(a, a.s);
    let best = null, bg = 0.02;
    slots.forEach((cur, i) => {
      if (cat === 'artifact' && slots.includes(id)) return;
      if (defMass(a.def) - (cur ? ITEMS[cur].mass : 0) + it.mass > this.pilotMassLimit(a)) return;
      const d = cloneDef(a.def);
      d.slots[cat][i] = id; setWear(d, cat, i, wear);
      const g = this.pilotScore(a, computeStats(d)) / base - 1;
      if (g > bg) { bg = g; best = i; }
    });
    a.stash = a.stash || [];
    if (best == null) { a.stash.push(id); return false; }
    const old = slots[best];
    if (old) a.stash.push(old);
    a.def.slots[cat][best] = id;
    setWear(a.def, cat, best, wear);
    this.refreshKeep(a);
    if (it.tier >= 3 && Math.random() < 0.5) this.log(`★ ${a.name} поставил трофейный ${it.name}.`, 'pilot', { s: a.loc });
    return true;
  },

  // ежедневно: обломки истлевают, кто рядом — летит подбирать
  dropsTick() {
    if (!this.drops) return;
    this.drops = this.drops.filter(d => d.until > this.day);
    for (const d of this.drops) {
      const v = this.dropValue(d);
      // уже летящие к обломкам задерживаются ещё на день
      const going = this.present(d.sector).filter(a => a.lootTarget === d.id && !a.battle);
      for (const a of going) a.wait = Math.max(a.wait || 0, 1);
      if (going.length >= 2) continue;
      // пираты (без добычи на борту) и наёмники не пройдут мимо; военные и мирные — заняты своим. Летят двое ближайших
      const cands = this.present(d.sector).filter(a => a.ctrl !== 'human' && !a.battle && a.docked == null && a.lootTarget == null && a.sx != null &&
        (a.faction === PIRATE ? !a.guardian && !a.escort && a.loot < 500 : a.kind === 'pilot' ? v > 150 && (a.cargoCap - this.cargoUsed(a) > 2 || d.items.length) : false))
        .sort((x, y) => Math.hypot(x.sx - d.x, x.sy - d.y) - Math.hypot(y.sx - d.x, y.sy - d.y)).slice(0, 2 - going.length);
      for (const a of cands) {
        a.lootTarget = d.id;
        a.wait = Math.max(a.wait || 0, 1);
      }
    }
  },
  // перемещение к обломкам внутри сектора (вызывается из updateLocal)
  lootMove(a) {
    const d = this.dropById(a.lootTarget);
    if (!d || d.sector !== a.loc) { a.lootTarget = null; return null; }
    if (Math.hypot(d.x - a.sx, d.y - a.sy) <= DROP_PICK_R) { this.pickDrop(a, d); a.lootTarget = null; return null; }
    return [d.x, d.y];
  },

  // ---------- бандитизм ----------
  // жадный свободный наёмник иногда выходит на большую дорогу
  banditWeight(a, A) {
    const P = a.personality;
    if (a.member !== FREE || P.greed == null || P.greed < 0.55 || A.weak) return 0;
    return (P.greed - 0.45) * 2 * (A.poor ? 1.6 : 1) * Math.min(1.2, A.combat) * (1 - P.loyal * 0.6);
  },
  planRobbery(a) {
    // туда, где много торговых кораблей и мало патрулей
    const cands = this.sectors.filter(s => this.hops(a.loc, s.id) <= 3);
    const score = s => (s.traffic + 0.3) / (1 + this.present(s.id).filter(o => o.kind === 'patrol' || o.kind === 'warship').length * 2) * U.rf(0.6, 1.4);
    const s = cands.sort((x, y) => score(y) - score(x))[0];
    a.robbing = this.day + 6;
    a.intent = 'разбой';
    a.task = { type: 'hunt', sector: s.id, days: 3 };
    this.go(a, s.id);
  },
  // наёмник-бандит нападает на мирный корабль
  isRobbery(A, B) {
    return A.kind === 'pilot' && A.ctrl !== 'human' && A.robbing > this.day && B.faction >= 0 && B.faction !== PIRATE &&
      (NONCOMBAT.includes(B.kind)) && B.faction !== A.member;
  },
  onRobbery(A, B, sid) {
    this.addRepRaw(A, B.faction, -14);
    A.banditry = (A.banditry || 0) + 1;
    this.log(`☠ Разбой: наёмник ${A.name} напал на ${this.who(B)} в секторе ${this.sectors[sid].name}!`, 'pirate', { s: sid, f: [B.faction] });
  },
  // ежедневно у пилотов: обиды фракций понемногу забываются
  pilotsDaily() {
    for (const a of this.agents.values()) {
      if (a.kind !== 'pilot') continue;
      for (const f in a.rep) if (a.rep[f] < 0) a.rep[f] = Math.min(0, a.rep[f] + 0.06);
    }
  },
  // репутация рухнула — фракция объявляет охоту за головой
  repCrossed(a, f, before, after) {
    if (before > -50 && after <= -50 && a.kind === 'pilot' && this.questBounty) this.questBounty(f, a);
  },
});
