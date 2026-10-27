'use strict';
// ============================================================
//  Кампания: пространство внутри сектора и игрок-пилот.
//  Координаты внутри сектора — от −SECTOR_R до +SECTOR_R вокруг звезды.
// ============================================================

const SECTOR_R = 1000;
const GATE_R = 930;
const RING_R = 790;
const ENGAGE_R = 140;   // на такой дистанции начинается бой
const SHOP_K = 12;      // цены верфи в кампании относительно каталога конструктора

Object.assign(World.prototype, {
  // ---------- геометрия сектора ----------
  planetPos(p, t = this.day) {
    const a = p.angle + t * (p.omega || 0.05);
    const r = p.orbit * 6.4;
    return [Math.cos(a) * r, Math.sin(a) * r];
  },
  gatePos(sid, to) {
    const s = this.sectors[sid], o = this.sectors[to];
    const a = Math.atan2(o.y - s.y, o.x - s.x);
    return [Math.cos(a) * GATE_R, Math.sin(a) * GATE_R];
  },
  basePos(sid) {
    const a = sid * 2.1 + 0.7;
    return [Math.cos(a) * RING_R, Math.sin(a) * RING_R];
  },
  localSpeed(a) { return a.speed * 4.2; },

  // ---------- создание игрока ----------
  // стартовый корабль рейнджера: корвет с основными системами ТУ II и свободным трюмом
  starterDef(name) {
    const hull = U.pick(HULL_LIST.filter(h => h.cls === 'corvette' && h.tier === 1));
    const def = emptyDef(hull.id, name);
    for (const k of ['armor', 'radar', 'ew', 'artifact']) def.slots[k] = def.slots[k].map(() => '-');
    autoFill(def, 2);
    for (const k of ['armor', 'radar', 'ew', 'artifact']) def.slots[k] = def.slots[k].map(() => null);
    // трюм не меньше 15: снимаем второстепенное, но оставляем хотя бы два орудия
    const cap = HULLS[def.hull].cap;
    for (const [k, keep] of [['computer', 0], ['droid', 0], ['arsenal', 0], ['weapon', 2], ['reactor', 0]])
      for (let i = def.slots[k].length - 1; i >= keep && cap - defMass(def) < 10; i--) def.slots[k][i] = null;
    return def;
  },
  createPlayer(name) {
    const yards = this.planets.filter(p => p.pop > 0 && p.owner >= 0 && p.shipyard && !this.factions[p.owner].wars.size);
    const home = U.pick(yards.length ? yards : this.planets.filter(p => p.pop > 0 && p.owner >= 0));
    const def = this.starterDef(name);
    const p = this.spawn('pilot', FREE, home.sector, { name, def, credits: 4000, ctrl: 'human', personality: { trade: 0, hunt: 0, merc: 0, loyal: 0 } });
    p.name = name; p.def.name = name;
    const [x, y] = this.planetPos(home);
    p.sx = x; p.sy = y;
    p.docked = home.id;
    p.target = null;
    p.route = null;
    this.player = p;
    this.missionsP = [];
    this.log(`★ Новый пилот ${name} получил лицензию рейнджера на планете ${home.name}.`, 'player', { s: home.sector });
    return p;
  },

  // ---------- положение ИИ-кораблей внутри сектора ----------
  updateLocal() {
    for (const a of this.agents.values()) {
      if (!a.alive || a.loc == null || a.travel) continue;
      if (a.ctrl === 'human') continue;
      if (a.justArrived) {
        const [gx, gy] = this.gatePos(a.loc, a.arrFrom);
        a.sx = gx; a.sy = gy; a.justArrived = false;
      }
      if (a.sx == null) { const ang = Math.random() * 6.28, r = 200 + Math.random() * 500; a.sx = Math.cos(ang) * r; a.sy = Math.sin(ang) * r; }
      if (a.battle) continue;
      let tx = a.sx, ty = a.sy;
      const pl = this.player;
      const lt = a.lootTarget != null ? this.lootMove(a) : null;
      if (lt) [tx, ty] = lt;
      else if (a.docked != null) [tx, ty] = this.planetPos(this.planets[a.docked]);
      else if (a.chase && pl && pl.alive && pl.loc === a.loc && !pl.travel) { tx = pl.sx; ty = pl.sy; }
      else if (a.task && a.task.planet != null && this.planets[a.task.planet].sector === a.loc) [tx, ty] = this.planetPos(this.planets[a.task.planet]);
      else if (a.faction === PIRATE) {
        const b = this.bases.find(x => x.id === a.base && x.alive && x.sector === a.loc);
        if (b) [tx, ty] = this.basePos(a.loc);
        else { if (!a.wp || Math.hypot(a.wp[0] - a.sx, a.wp[1] - a.sy) < 40) { const ang = Math.random() * 6.28; a.wp = [Math.cos(ang) * RING_R * 0.8, Math.sin(ang) * RING_R * 0.8]; } [tx, ty] = a.wp; }
      } else {
        if (!a.wp || Math.hypot(a.wp[0] - a.sx, a.wp[1] - a.sy) < 40) { const ang = Math.random() * 6.28, r = 150 + Math.random() * 550; a.wp = [Math.cos(ang) * r, Math.sin(ang) * r]; }
        [tx, ty] = a.wp;
      }
      const d = Math.hypot(tx - a.sx, ty - a.sy), step = this.localSpeed(a) * (a.chase ? 1 : 0.6);
      if (d <= step) { a.sx = tx; a.sy = ty; } else { a.sx += (tx - a.sx) / d * step; a.sy += (ty - a.sy) / d * step; }
    }
    // корабли в бою держатся у точки боя
    for (const wb of this.battles) {
      if (wb.sx == null) continue;
      wb.b.ships.forEach((sh, i) => {
        const a = this.agents.get(sh.ref);
        if (!a || !sh.alive) return;
        const ang = i * 2.399 + (sh.side ? Math.PI : 0) * 0.3, r = 40 + (i % 3) * 18;
        a.sx = wb.sx + (sh.side ? 40 : -40) + Math.cos(ang) * r * 0.5;
        a.sy = wb.sy + Math.sin(ang) * r;
      });
    }
  },

  // ---------- цель игрока ----------
  targetPos(t) {
    switch (t.type) {
      case 'point': return [t.x, t.y];
      case 'drop': { const d = this.dropById(t.id); return d && d.sector === this.player.loc ? [d.x, d.y] : null; }
      case 'planet': return this.planetPos(this.planets[t.id]);
      case 'gate': return this.gatePos(this.player.loc, t.to);
      case 'ship': { const a = this.agents.get(t.id); return a && a.loc === this.player.loc && !a.travel ? [a.sx, a.sy] : null; }
      case 'battle': { const wb = this.battles.find(x => x.id === t.id); return wb ? [wb.sx, wb.sy] : null; }
      case 'base': return this.basePos(this.player.loc);
      case 'quest': { const q = this.questById(t.id); return q && q.point && q.sector === this.player.loc ? q.point : null; }
    }
    return null;
  },

  // Один день полёта игрока внутри сектора (вызывается в tick)
  playerMove() {
    const p = this.player;
    if (!p || !p.alive || p.battle) return;
    if (p.travel) return;
    // прилёт через ворота
    if (p.justArrived) {
      const [gx, gy] = this.gatePos(p.loc, p.arrFrom);
      p.sx = gx * 0.92; p.sy = gy * 0.92; p.justArrived = false;
      this.log(`➤ Вы прибыли в сектор ${this.sectors[p.loc].name}.`, 'player', { s: p.loc });
      if (p.route != null && p.route !== p.loc) p.target = { type: 'gate', to: this.N[p.loc][p.route] };
      else {
        p.route = null; p.target = null;
        // в конце маршрута — сразу к планете из задания, если она здесь
        const m = (this.missionsP || []).find(o => o.to != null && this.planets[o.to].sector === p.loc);
        if (m) { p.target = { type: 'planet', id: m.to }; this.log(`➤ Курс на ${this.planets[m.to].name} (задание).`, 'player'); }
        // или к цели особого поручения
        const q = p.questGoal != null && this.questById(p.questGoal);
        if (q && q.status === 'open' && this.questSector(p, q) === p.loc) {
          const t = this.questTarget(p, q);
          if (t) { p.target = t; this.log(`➤ Курс на цель поручения «${q.title}».`, 'player'); }
        }
        p.questGoal = null;
      }
      return;
    }
    if (p.docked != null || !p.target) return;
    const pos = this.targetPos(p.target);
    if (!pos) { p.target = null; return; }
    const [tx, ty] = pos;
    const d = Math.hypot(tx - p.sx, ty - p.sy), step = this.localSpeed(p);
    const reach = p.target.type === 'ship' || p.target.type === 'battle' ? ENGAGE_R * 0.8 : p.target.type === 'base' ? 130 : 1;
    if (d - reach <= step) {
      const k = Math.max(0, d - reach) / Math.max(1, d);
      p.sx += (tx - p.sx) * k; p.sy += (ty - p.sy) * k;
      this.playerArrive(p.target);
    } else { p.sx += (tx - p.sx) / d * step; p.sy += (ty - p.sy) / d * step; }
  },

  playerArrive(t) {
    const p = this.player;
    switch (t.type) {
      case 'planet': {
        const pl = this.planets[t.id];
        if (pl.pop <= 0) { this.log(`Планета ${pl.name} необитаема — стыковаться не с кем.`, 'player'); p.target = null; return; }
        if (!this.friendlyPlanet(p, pl)) { this.log(`${pl.name}: в стыковке отказано (враждебная фракция).`, 'player'); p.target = null; return; }
        p.docked = pl.id; p.target = null;
        this.onDock(pl);
        this.questOnDock(p, pl);
        if (this.hooks && this.hooks.dock) this.hooks.dock(pl);
        return;
      }
      case 'gate': {
        const L = this.laneBetween(p.loc, t.to);
        const days = this.laneDays(p, L);
        p.travel = { from: p.loc, to: t.to, left: days, total: days };
        this.log(`⟿ Гиперпрыжок к сектору ${this.sectors[t.to].name}: ${days} дн. в коридоре.`, 'player');
        p.loc = null; p.target = null;
        return;
      }
      case 'ship': {
        const a = this.agents.get(t.id);
        if (a && t.attack) this.playerAttack(a);
        p.target = null;
        return;
      }
      case 'battle': {
        const wb = this.battles.find(x => x.id === t.id);
        if (wb && t.side != null) this.playerJoin(wb, t.side);
        p.target = null;
        return;
      }
      case 'drop':
        p.target = null;
        if (!this.pickDrop(p, this.dropById(t.id))) this.log('Обломки уже кто-то подобрал.', 'player');
        return;
      case 'base': return this.playerSiege();
      case 'point': case 'quest':
        p.target = null;
        this.questReach(p);
        return;
      default: p.target = null;
    }
  },

  // штурм пиратской станции: сначала охрана, потом обстрел, пока оборона не обнулится
  playerSiege() {
    const p = this.player;
    const b = this.bases.find(x => x.alive && x.sector === p.loc);
    if (!b) { p.target = null; return; }
    const guards = this.present(p.loc).filter(o => o.faction === PIRATE && !o.battle);
    if (guards.length) {
      p.target = null;
      this.log(`⚔ Охрана станции «${b.name}» вступает в бой! Разбейте её и продолжите штурм.`, 'player', { s: p.loc });
      this.startBattle(p.loc, [p], guards.slice(0, 4));
      return;
    }
    // обстреливают и союзники в секторе: военные фракций и наёмники, которые не в бою
    const allies = this.present(p.loc).filter(o => o !== p && !o.battle && o.faction !== PIRATE && !NONCOMBAT.includes(o.kind) && !this.hostile(p, o));
    const dmg = this.siegeDamage(p) + U.sum(allies, o => this.siegeDamage(o));
    b.defense -= dmg; b.siegeDay = this.day;
    for (const q of (this.openQuests ? this.openQuests() : [])) if (q.type === 'base' && q.base === b.id) {
      q.contrib[p.id] = (q.contrib[p.id] || 0) + dmg;
      if (!q.takers.includes(p.id)) q.takers.push(p.id);
    }
    // станция отстреливается; на последнем издыхании — отход
    p.hp -= p.maxHp * 0.04;
    if (b.defense <= 0) { p.target = null; this.destroyBase(b, p); return; }
    if (p.hp < p.maxHp * 0.15) { p.target = null; this.log('⚠ Корпус на исходе — вы отходите от станции. Почините корабль и возвращайтесь.', 'player', { s: p.loc }); return; }
    this.log(`💥 Обстрел станции «${b.name}»: оборона ${Math.round(b.defense)}/${Math.round(b.maxDefense || 2500)}. Станция отвечает огнём.`, 'player', { s: p.loc });
  },
  undock() { if (this.player) this.player.docked = null; },

  // ---------- погоня и бои с участием игрока ----------
  chaseCheck() {
    const p = this.player;
    for (const a of this.agents.values()) {
      if (!a.chase) continue;
      if (!p || !p.alive || p.loc !== a.loc || p.travel || p.docked != null || a.battle || !this.hostile(a, p)) { a.chase = null; continue; }
      if (p.battle) { a.chase = null; continue; }
      if (Math.hypot(a.sx - p.sx, a.sy - p.sy) <= ENGAGE_R) {
        const here = this.present(p.loc).filter(x => x.docked == null);
        const sideA = this.team(a, here).filter(x => !x.battle);
        for (const x of sideA) x.chase = null;
        this.log(`⚠ ${this.who(a)} атакует вас!`, 'player', { s: p.loc });
        this.startBattle(p.loc, [p], sideA);
      }
    }
  },
  playerAttack(a) {
    const p = this.player;
    if (!a || !a.alive || a.battle || a.loc !== p.loc) return;
    const af = a.kind === 'pilot' ? a.member : a.faction;
    if (!this.hostile(p, a) && af >= 0 && af !== PIRATE) {
      this.addRepRaw(p, af, -35);
      this.log(`⚠ Вы напали на корабль ${this.factions[af].short} — репутация резко падает!`, 'player');
    } else if (!this.hostile(p, a) && a.kind === 'pilot') this.log(`⚠ Вы напали на мирного наёмника ${a.name}. Его друзья среди фракций этого не забудут.`, 'player');
    const here = this.present(p.loc).filter(x => x.docked == null && x !== a);
    const foes = [a, ...here.filter(x => !x.battle && x.ctrl !== 'human' && x.faction === a.faction && x.faction !== FREE && !NONCOMBAT.includes(x.kind))];
    this.startBattle(p.loc, [p], foes);
  },
  playerJoin(wb, side) {
    const p = this.player;
    if (!wb || wb.b.over || p.battle) return;
    const foes = wb.b.ships.filter(sh => sh.alive && sh.side !== side).map(sh => this.agents.get(sh.ref)).filter(Boolean);
    for (const f of foes) { const ff = f.kind === 'pilot' ? f.member : f.faction; if (ff >= 0 && ff !== PIRATE && !this.hostile(p, f)) this.addRepRaw(p, ff, -15); }
    const allies = wb.b.ships.filter(sh => sh.alive && sh.side === side).map(sh => this.agents.get(sh.ref)).filter(Boolean);
    for (const a of allies) if (a.faction >= 0 && a.faction !== PIRATE) this.addRepRaw(p, a.faction, 3);
    wb.b.addShip(this.entry(p), side);
    p.battle = wb.id;
    this.log(`⚑ Вы вступаете в бой в секторе ${this.sectors[wb.sector].name}.`, 'player', { s: wb.sector });
  },
  // попытка выйти из боя между днями
  playerEscape() {
    const p = this.player;
    const wb = this.battles.find(x => x.id === p.battle);
    if (!wb) return true;
    const sh = wb.b.ships.find(s => s.ref === p.id && s.alive);
    if (!sh) return true;
    // одна попытка в день, откуда бы её ни делали
    if (p.escDay === this.day) { this.log('Сегодня попытка уйти уже была — следующая завтра.', 'player'); return false; }
    p.escDay = this.day;
    const ch = U.clamp(0.3 + sh.s.thrust * 0.12 + sh.s.evasion * 0.006, 0.2, 0.85);
    if (Math.random() < ch) {
      wb.b.retreat(sh);
      sh.synced = true;
      p.battle = null; p.hp = sh.hp; p.shield = sh.shield;
      const ang = Math.random() * 6.28;
      p.sx += Math.cos(ang) * 260; p.sy += Math.sin(ang) * 260;
      for (const a of this.agents.values()) if (a.chase === p.id) a.chase = null;
      this.log('↩ Вам удалось оторваться от противника.', 'player');
      return true;
    }
    this.log('✖ Уйти из боя не удалось — противник не отпускает.', 'player');
    return false;
  },
  playerBattle() { const p = this.player; return p && p.battle ? this.battles.find(x => x.id === p.battle) : null; },

  // ---------- репутация ----------
  addRepRaw(a, f, d) {
    if (f < 0 || f === PIRATE) return;
    const before = a.rep[f] || 0;
    a.rep[f] = U.clamp(before + d, -100, 100);
    if (this.repCrossed) this.repCrossed(a, f, before, a.rep[f]);
    if (a.ctrl === 'human' && a.member === f && a.rep[f] < 0) { a.member = FREE; this.log(`Вас уволили со службы: ${this.factions[f].name}.`, 'player'); }
  },
  joinFaction(f) {
    const p = this.player;
    if ((p.rep[f] || 0) < 30) return false;
    p.member = f;
    this.log(`⚑ Вы поступили на службу: ${this.factions[f].name} в звании «${this.rankName(p, f)}». Жалованье — ${this.salary(p)} кр. в день.`, 'player', { f: [f] });
    return true;
  },
  leaveFaction() {
    const p = this.player;
    if (p.member < 0) return;
    this.addRepRaw(p, p.member, -10);
    this.log(`Вы покинули службу: ${this.factions[p.member].name}.`, 'player');
    p.member = FREE;
  },

  // ---------- рынок ----------
  playerBuy(pl, good, qty) {
    const p = this.player;
    const n0 = Math.max(0, Math.min(qty, Math.floor(pl.stock[good]), Math.floor(p.cargoCap - this.cargoUsed(p))));
    const n = this.affordable(pl, good, n0, p.credits);
    if (!n) return 0;
    p.credits -= this.buyCost(pl, good, n); pl.stock[good] -= n;
    p.cargo[good] = (p.cargo[good] || 0) + n;
    // откуда груз: купленное здесь же не считается помощью этой планете
    p.cargoSrc = p.cargoSrc || {};
    const src = p.cargoSrc[good] = p.cargoSrc[good] || {};
    src[pl.id] = (src[pl.id] || 0) + n;
    this.updatePlanetPrice(pl);
    return n;
  },
  playerSell(pl, good, qty) {
    const p = this.player;
    const n = Math.max(0, Math.min(qty, Math.floor(p.cargo[good] || 0)));
    if (!n) return 0;
    p.credits += this.sellGain(pl, good, n);
    // сначала уходит груз, купленный на других планетах — только он считается привезённым
    const src = (p.cargoSrc = p.cargoSrc || {})[good] = (p.cargoSrc[good] || {});
    const local = src[pl.id] || 0, other = Math.max(0, (p.cargo[good] || 0) - local);
    const brought = Math.min(n, other);
    let left = brought;
    for (const k in src) { if (+k === pl.id || left <= 0) continue; const d = Math.min(left, src[k]); src[k] -= d; left -= d; if (src[k] <= 0) delete src[k]; }
    if (n > brought) { src[pl.id] = Math.max(0, local - (n - brought)); if (!src[pl.id]) delete src[pl.id]; }
    if (brought > 0) this.questOnDeliver(p, pl, good, brought);
    pl.stock[good] += n;
    p.cargo[good] -= n;
    if (p.cargo[good] <= 0) { delete p.cargo[good]; delete p.cargoSrc[good]; }
    this.updatePlanetPrice(pl);
    // репутация за помощь в дефиците — только за привезённое и не больше 3 за день на планете
    if (brought > 0 && pl.owner >= 0 && pl.shortage > 0.2 && ['food', 'meds'].includes(good)) {
      const key = pl.id + ':' + this.day;
      p.aidRep = p.aidRep && p.aidRep.key === key ? p.aidRep : { key, v: 0 };
      const d = Math.min(3 - p.aidRep.v, brought / 10);
      if (d > 0) { p.aidRep.v += d; this.addRepRaw(p, pl.owner, d); }
    }
    return n;
  },

  // ---------- верфь ----------
  yardMakers(pl) {
    const m = pl.owner >= 0 ? FACTIONS[pl.owner].maker : 'zot';
    return [...new Set([m, 'terra', pl.shipyard >= 4 ? 'aether' : m])];
  },
  shopItems(pl, cat) {
    if (!pl.shipyard) return [];
    // в продаже — только то, что есть на складе верфи
    if (this.yard) { const Y = this.yard(pl); return Object.keys(Y.stock).map(id => ITEMS[id]).filter(it => it && it.cat === cat); }
    const makers = this.yardMakers(pl);
    if (cat === 'artifact') return pl.shipyard >= 4 ? itemsFor('artifact').filter((_, i) => (i + pl.id) % 4 === 0) : [];
    const t = this.yardTier(pl);
    return itemsFor(cat).filter(it => it.tier <= t && makers.includes(it.maker));
  },
  shopHulls(pl) {
    if (!pl.shipyard) return [];
    if (this.yard) { const Y = this.yard(pl); return Object.keys(Y.hulls).map(id => HULLS[id]).filter(Boolean); }
    const makers = this.yardMakers(pl);
    const t = this.yardTier(pl);
    return HULL_LIST.filter(h => h.tier <= t && makers.includes(h.maker));
  },
  shopPrice(x) { return Math.round(x.price * SHOP_K); },
  // цена для игрока на текущей верфи: служащим фракции — скидка по званию
  buyPrice(x) {
    const p = this.player, pl = p && p.docked != null ? this.planets[p.docked] : null;
    const disc = pl && this.rankDiscount ? this.rankDiscount(p, pl.owner) : 0;
    return Math.round(this.shopPrice(x) * (1 - disc));
  },
  buyItem(cat, idx, id) {
    const p = this.player, it = ITEMS[id];
    const old = p.def.slots[cat][idx] ? ITEMS[p.def.slots[cat][idx]] : null;
    const insOld = old && slotInsured(p.def, cat, idx);
    const cost = this.buyPrice(it) - (old ? (insOld ? Math.round(this.shopPrice(old) * 0.1) : this.sellValue(old.id, slotWear(p.def, cat, idx))) : 0);
    if (p.credits < cost) return 'Не хватает кредитов';
    if (defMass(p.def) - (old ? old.mass : 0) + it.mass > HULLS[p.def.hull].cap) return 'Не хватает вместимости корпуса';
    if (cat === 'artifact' && p.def.slots.artifact.includes(id)) return 'Такой артефакт уже установлен';
    const pl = this.planets[p.docked];
    if (pl && this.yard && !this.stockOf(pl, id)) return 'Этого уже нет на складе';
    p.credits -= cost;
    if (pl && this.yard) { this.takeStock(pl, id); if (old) this.addStock(pl, old.id); }
    setInsured(p.def, cat, idx, false);
    p.def.slots[cat][idx] = id;
    setWear(p.def, cat, idx, 0);
    this.refreshKeep(p);
    return null;
  },
  sellItem(cat, idx) {
    const p = this.player, id = p.def.slots[cat][idx];
    if (!id) return;
    p.credits += this.playerItemValue(id, slotWear(p.def, cat, idx), slotInsured(p.def, cat, idx));
    setInsured(p.def, cat, idx, false);
    const pl = this.planets[p.docked];
    if (pl && pl.shipyard && this.addStock) this.addStock(pl, id); // проданное пополняет склад верфи
    p.def.slots[cat][idx] = null;
    setWear(p.def, cat, idx, 0);
    this.refreshKeep(p);
  },
  buyHull(hullId) {
    const p = this.player, H = HULLS[hullId];
    const cost = this.buyPrice(H) - this.hullTradeIn();
    if (p.credits < cost) return 'Не хватает кредитов';
    const pl = this.planets[p.docked];
    if (pl && this.yard && !this.stockOf(pl, hullId)) return 'Этого корпуса уже нет на складе';
    p.credits -= cost;
    if (pl && this.yard) { this.takeStock(pl, hullId); this.addStock(pl, p.def.hull); }
    let nd = setHull(p.def, hullId);
    // не поместившееся оборудование продаётся за полцены
    const order = ['artifact', 'armor', 'ew', 'radar', 'computer', 'droid', 'arsenal', 'shield', 'weapon', 'reactor', 'engine'];
    for (const k of order) for (let i = nd.slots[k].length - 1; i >= 0 && defMass(nd) > H.cap; i--) {
      if (nd.slots[k][i]) { p.credits += this.playerItemValue(nd.slots[k][i], slotWear(nd, k, i), slotInsured(nd, k, i)); nd.slots[k][i] = null; setInsured(nd, k, i, false); }
    }
    // снятое из-за меньшего числа слотов — тоже продаём
    for (const x of nd.removed) p.credits += this.playerItemValue(x.id, x.wear, x.ins);
    delete nd.removed;
    nd.name = p.name;
    p.def = nd;
    p.insuredHull = null;
    p.hp = null;
    this.refreshKeep(p, true);
    // лишний груз не помещается
    let over = this.cargoUsed(p) - p.cargoCap;
    for (const g in p.cargo) { if (over <= 0) break; const d = Math.min(over, p.cargo[g]); p.cargo[g] -= d; over -= d; if (!p.cargo[g]) delete p.cargo[g]; }
    return null;
  },
  // сколько верфь даст за модуль игрока: страховые (выданные бесплатно) — только как лом
  playerItemValue(id, wear, insured) {
    return insured ? Math.round(this.shopPrice(ITEMS[id]) * 0.1) : this.sellValue(id, wear);
  },
  // зачёт старого корпуса при покупке нового: страховой — как лом
  hullTradeIn() {
    const p = this.player, H = HULLS[p.def.hull];
    return Math.round(this.shopPrice(H) * (p.insuredHull === H.id ? 0.1 : 0.5));
  },
  // продать трофей из трюма
  sellStash(i) {
    const p = this.player;
    if (!p.stash || i < 0 || i >= p.stash.length) return;
    const { id, wear, ins } = this.stashTake(p, i);
    p.credits += this.playerItemValue(id, wear, ins);
    const pl = this.planets[p.docked];
    if (pl && pl.shipyard && this.addStock) this.addStock(pl, id);
  },
  refreshKeep(p, full) {
    const frac = p.hp != null && p.maxHp ? p.hp / p.maxHp : 1;
    p.hp = null; p.shield = null;
    this.refresh(p);
    if (!full) p.hp = p.maxHp * frac;
  },
  repairCost() { const p = this.player; return Math.ceil((p.maxHp - p.hp) * 2); },
  repair() {
    const p = this.player, c = this.repairCost();
    const pay = Math.min(c, p.credits);
    p.credits -= pay;
    p.hp = Math.min(p.maxHp, p.hp + pay / 2);
  },

  // ---------- задания ----------
  offers(pl) {
    if (pl.offers && this.day - pl.offersDay < 5) return pl.offers;
    pl.offersDay = this.day;
    const f = pl.owner;
    const out = [];
    if (f < 0 || pl.pop <= 0) return (pl.offers = out);
    const F = this.factions[f];
    const dests = this.planets.filter(q => q.pop > 0 && q.id !== pl.id && (q.owner === f || this.rel(f, q.owner) > 20) && this.hops(pl.sector, q.sector) >= 1 && this.hops(pl.sector, q.sector) <= 5);
    for (let i = 0; i < 2 && dests.length; i++) {
      const d = U.pick(dests), hops = this.hops(pl.sector, d.sector);
      out.push({ id: this.nextId++, type: 'courier', faction: f, from: pl.id, to: d.id, cargo: 4, reward: Math.round(500 + hops * 380 + this.sectors[d.sector].heat * 80), deadline: this.day + hops * 4 + 6,
        title: `Курьерская доставка на ${d.name}`, text: `Доставить посылку ${F.short} на планету ${d.name} (сектор ${this.sectors[d.sector].name}, ${hops} прыж.).` });
    }
    const heat = U.sum(this.factionSectors(f), s => s.heat);
    if (heat > 1 || Math.random() < 0.6) {
      const n = U.ri(1, 3);
      out.push({ id: this.nextId++, type: 'bounty', faction: f, count: n, killed: 0, reward: 900 * n + Math.round(heat * 150), deadline: this.day + 30,
        title: `Охота на пиратов (${n})`, text: `Уничтожить ${n} пиратск. корабл. в любом секторе. Награду выплатят на любой планете ${F.short}.` });
    }
    const short = GOODS.filter(g => pl.price[g.id] > g.base * 1.25);
    if (short.length) {
      const g = U.pick(short), qty = U.ri(8, 25);
      out.push({ id: this.nextId++, type: 'supply', faction: f, to: pl.id, good: g.id, qty, reward: Math.round(pl.price[g.id] * qty * 1.35), deadline: this.day + 20,
        title: `Поставка: ${g.name} ×${qty}`, text: `Планете ${pl.name} не хватает товара «${g.name}». Привезите ${qty} ед.` });
    }
    for (const e of F.wars) {
      if (!this.factions[e].alive) continue;
      const n = U.ri(1, 3);
      out.push({ id: this.nextId++, type: 'war', faction: f, enemy: e, count: n, killed: 0, reward: 1500 * n, deadline: this.day + 30, needRep: 10,
        title: `Военный контракт против ${this.factions[e].short} (${n})`, text: `Уничтожить ${n} корабл. фракции ${this.factions[e].name}.` });
      break;
    }
    return (pl.offers = out);
  },
  acceptOffer(pl, o) {
    const p = this.player;
    if (this.missionsP.length >= 4) return 'Не больше 4 заданий одновременно';
    if (o.needRep && (p.rep[o.faction] || 0) < o.needRep) return `Нужна репутация ${o.needRep} у ${this.factions[o.faction].short}`;
    if (o.type === 'courier' && p.cargoCap - this.cargoUsed(p) < o.cargo) return 'Нет места в трюме для посылки';
    pl.offers = pl.offers.filter(x => x !== o);
    if (o.type === 'courier') p.cargo.parcel = (p.cargo.parcel || 0) + o.cargo;
    this.missionsP.push(o);
    this.log(`📜 Принято задание: ${o.title}.`, 'player');
    return null;
  },
  missionDone(o, pl) {
    const p = this.player;
    p.credits += o.reward;
    if (this.careerMission) this.careerMission(p, o);
    this.addRepRaw(p, o.faction, o.type === 'war' ? 10 : o.type === 'bounty' ? 6 : 5);
    this.factions[o.faction].st.missionsOk++;
    this.missionsP = this.missionsP.filter(x => x !== o);
    this.log(`✔ Задание выполнено: ${o.title}. Награда ${o.reward} кр.`, 'player', { s: pl ? pl.sector : null });
  },
  // сколько единиц товара привезено с других планет (купленное здесь же не в счёт)
  broughtQty(p, good, plId) { const src = (p.cargoSrc || {})[good] || {}; return Math.max(0, (p.cargo[good] || 0) - (src[plId] || 0)); },
  takeBrought(p, good, plId, n) {
    const src = (p.cargoSrc || {})[good] || {};
    for (const k in src) { if (+k === plId || n <= 0) continue; const d = Math.min(n, src[k]); src[k] -= d; n -= d; if (src[k] <= 0) delete src[k]; }
  },
  onDock(pl) {
    const p = this.player;
    for (const o of this.missionsP.slice()) {
      if (o.type === 'courier' && o.to === pl.id) { p.cargo.parcel = Math.max(0, (p.cargo.parcel || 0) - o.cargo); if (!p.cargo.parcel) delete p.cargo.parcel; this.missionDone(o, pl); }
      else if (o.type === 'supply' && o.to === pl.id && this.broughtQty(p, o.good, pl.id) >= o.qty) {
        this.takeBrought(p, o.good, pl.id, o.qty);
        p.cargo[o.good] -= o.qty; if (!p.cargo[o.good]) delete p.cargo[o.good];
        pl.stock[o.good] += o.qty; this.updatePlanetPrice(pl);
        this.missionDone(o, pl);
      } else if ((o.type === 'bounty' || o.type === 'war') && o.killed >= o.count && pl.owner === o.faction) this.missionDone(o, pl);
    }
  },
  missionsTick() {
    if (!this.missionsP) return;
    const p = this.player;
    for (const o of this.missionsP.slice()) {
      if (this.day > o.deadline) {
        this.missionsP = this.missionsP.filter(x => x !== o);
        if (o.type === 'courier' && p) { p.cargo.parcel = Math.max(0, (p.cargo.parcel || 0) - o.cargo); if (!p.cargo.parcel) delete p.cargo.parcel; }
        if (p) this.addRepRaw(p, o.faction, -6);
        this.factions[o.faction].st.missionsFail++;
        this.log(`✖ Задание провалено (срок истёк): ${o.title}.`, 'player');
      }
    }
  },
  onPlayerKill(victim) {
    if (!this.missionsP) return;
    // одна цель засчитывается только в одно задание — самое раннее из подходящих
    const o = this.missionsP.find(o => o.killed < o.count && ((o.type === 'bounty' && victim.faction === PIRATE) || (o.type === 'war' && victim.faction === o.enemy)));
    if (!o) return;
    o.killed++;
    if (o.killed === o.count) this.log(`📜 Цель задания «${o.title}» достигнута — получите награду на планете ${this.factions[o.faction].short}.`, 'player');
  },
});
