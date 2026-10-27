'use strict';
// ============================================================
//  Развитие пилотов: износ оборудования, ремонт, закупка модулей
//  и корпусов. Одни правила для ИИ-наёмников и игрока.
// ============================================================

// цена ремонта полностью изношенного модуля — доля его магазинной цены
const GEAR_REPAIR_K = 0.3;

Object.assign(World.prototype, {
  // уровень верфи: столица технологически сильной фракции продаёт и ТУ V
  yardTier(pl) {
    if (!pl.shipyard) return 0;
    const f = pl.owner >= 0 ? this.factions[pl.owner] : null;
    return pl.shipyard >= 4 && f && f.tech >= 4 ? 5 : pl.shipyard;
  },
  // технологический уровень корабля: средний по установленным модулям и корпусу
  shipTier(a) {
    const its = defItems(a.def).filter(it => it.cat !== 'artifact');
    return (U.sum(its, it => it.tier) + HULLS[a.def.hull].tier) / (its.length + 1);
  },

  // типичный технологический уровень ИИ-наёмников (на него равняются пираты), пересчёт раз в день
  pilotTierRef() {
    if (this._ptDay !== this.day) {
      const t = [...this.agents.values()].filter(a => a.kind === 'pilot' && a.ctrl !== 'human').map(a => this.shipTier(a)).sort((x, y) => x - y);
      this._pt = t.length ? t[Math.floor(t.length * 0.6)] : 1;
      this._ptDay = this.day;
    }
    return this._pt;
  },

  // ---------- износ ----------
  addWear(a, cat, i, d) {
    const id = a.def.slots[cat] && a.def.slots[cat][i];
    if (!id || cat === 'artifact') return;
    const it = ITEMS[id];
    const before = slotWear(a.def, cat, i);
    if (before >= 1) return;
    // модули высоких ТУ служат дольше
    const after = Math.min(1, before + d * (1.15 - it.tier * 0.07));
    setWear(a.def, cat, i, after);
    if (after >= 1 && a.ctrl === 'human') this.log(`⚠ Сломался модуль «${it.name}» — он больше не работает. Почините его на станции.`, 'player');
    else if (before < 0.7 && after >= 0.7 && a.ctrl === 'human') this.log(`⚠ «${it.name}» сильно изношен (${Math.round(after * 100)}%) — пора в ремонт.`, 'player');
  },
  // после боя изнашивается всё, что работало; тем сильнее, чем жарче был бой
  wearBattle(a, sh) {
    if (!a || a.kind !== 'pilot' || !sh || sh.wornOut) return;
    sh.wornOut = true;
    const st = sh.st || {};
    const heat = Math.min(1.5, (st.taken || 0) / Math.max(1, sh.s.maxHp + sh.s.maxShield));
    const nW = Math.max(1, a.def.slots.weapon.filter(Boolean).length);
    for (const k of SLOT_ORDER) (a.def.slots[k] || []).forEach((id, i) => {
      if (!id) return;
      let d = (0.012 + 0.045 * heat) * U.rf(0.6, 1.4);
      if (k === 'weapon') d += 0.0015 * (st.shots || 0) / nW;
      if (k === 'armor' || k === 'shield') d += 0.02 * heat;
      this.addWear(a, k, i, d);
    });
    this.refreshKeep(a);
  },
  // в пути изнашиваются двигатель и реактор
  wearTravel(a) {
    if (a.kind !== 'pilot') return;
    this.addWear(a, 'engine', 0, 0.006);
    this.addWear(a, 'reactor', 0, 0.003);
  },
  gearRepairCost(a, cat, i) {
    const id = a.def.slots[cat][i];
    return id ? Math.ceil(this.shopPrice(ITEMS[id]) * slotWear(a.def, cat, i) * GEAR_REPAIR_K) : 0;
  },
  gearRepairTotal(a) {
    let c = 0;
    for (const k of SLOT_ORDER) (a.def.slots[k] || []).forEach((_, i) => { c += this.gearRepairCost(a, k, i); });
    return c;
  },
  // ремонт модулей, начиная с самых изношенных, в пределах бюджета
  repairGear(a, budget, onlyCat, onlyIdx) {
    const list = [];
    for (const k of SLOT_ORDER) (a.def.slots[k] || []).forEach((id, i) => {
      if (id && slotWear(a.def, k, i) > 0 && (onlyCat == null || (k === onlyCat && i === onlyIdx))) list.push([k, i, slotWear(a.def, k, i)]);
    });
    list.sort((x, y) => y[2] - x[2]);
    let spent = 0;
    for (const [k, i] of list) {
      const c = this.gearRepairCost(a, k, i);
      if (c > budget - spent || c > a.credits) continue;
      a.credits -= c; spent += c;
      setWear(a.def, k, i, 0);
    }
    if (spent) this.refreshKeep(a);
    return spent;
  },
  // за сколько верфь купит модуль: полцены, изношенный — дешевле
  sellValue(id, wear) { return id ? Math.round(this.shopPrice(ITEMS[id]) * 0.5 * (1 - (wear || 0) * 0.6)) : 0; },

  // ---------- закупки ИИ-пилота ----------
  // ценность корабля в глазах пилота: охотник ценит огневую мощь, осторожный — живучесть, торговец — скорость
  pilotScore(a, s) {
    const P = a.personality, careful = 1 - P.hunt;
    const off = (U.sum(s.weapons, weaponDps) + 8) * (1 + s.acc / 150 + s.crit / 250) * (1 + 0.05 * (s.ePer + s.aPer + s.dPer - 4) + 0.02 * (s.ePass + s.aPass));
    const ehp = (s.maxHp / (1 - s.armor) + s.maxShield * 1.3 + s.shieldRegen * 6 + s.shieldPassive * 8 + s.rPer * 8 + s.rPass * 15) * (1 + s.evasion / 100);
    const mob = 1 + 0.06 * s.thrust + 0.01 * s.init + 0.02 * s.evadePer;
    const misc = 1 + 0.002 * s.range + 0.3 * s.ewRes + (s.ew ? 0.04 : 0) + 0.05 * s.artifacts.length;
    return Math.pow(off, 0.75 + 0.5 * P.hunt) * Math.pow(ehp, 0.35 + 0.4 * careful) * Math.pow(mob, 1 + 2 * P.trade) * misc;
  },
  // резерв на ремонт и на жизнь после потери корабля
  pilotReserve(a) { return 800 + this.shopPrice({ price: defPrice(a.def) }) * 0.06; },
  // торговец оставляет место под груз
  pilotMassLimit(a) { return HULLS[a.def.hull].cap * (1 - 0.35 * a.personality.trade); },

  pilotOutfit(a, pl) {
    // трофеи из трюма — на продажу (на верфи они пополнят склад)
    if (a.stash && a.stash.length && pl.shipyard) {
      for (const id of a.stash) { a.credits += this.sellValue(id, 0.3); this.addStock(pl, id); }
      a.stash = [];
    }
    // сначала ремонт: корпус, затем модули (на ремонт можно потратить и часть резерва)
    const reserve = this.pilotReserve(a);
    const dmg = a.maxHp - a.hp;
    if (dmg > 1) { const cost = Math.min(a.credits, dmg * 2); a.credits -= cost; a.hp += cost / 2; }
    this.repairGear(a, Math.max(0, a.credits - reserve * 0.4));
    const yt = this.yardTier(pl);
    if (!yt) return 0;
    const limit = this.pilotMassLimit(a);
    // корпус ограничивает рост: если модули уже под стать корпусу — копим на новый, покупая только крупные улучшения
    const plan = this.pilotHullPlan(a, pl);
    const saving = plan && this.shipTier(a) >= HULLS[a.def.hull].tier + 0.4;
    const minGain = saving ? 0.15 : 0.03;
    let bought = 0;
    for (let step = 0; step < 4; step++) {
      const budget = a.credits - reserve - (saving ? plan.cost : 0) * (saving ? 0.5 : 0);
      if (budget < 200) break;
      const mass = defMass(a.def);
      const base = this.pilotScore(a, a.s);
      let best = null, bv = 0;
      for (const k of SLOT_ORDER) {
        const slots = a.def.slots[k] || [];
        if (!slots.length) continue;
        const shop = this.shopItems(pl, k);
        if (!shop.length) continue;
        slots.forEach((cur, i) => {
          const wr = slotWear(a.def, k, i);
          const curVal = cur ? ITEMS[cur].price * wearMult(wr) : 0;
          const curMass = cur ? ITEMS[cur].mass : 0;
          // по 3 самых дорогих доступных кандидата на слот — их и примеряем
          const cands = shop.filter(it => it.id !== cur && it.price > curVal * 1.2 && mass - curMass + it.mass <= limit &&
            !(k === 'artifact' && slots.includes(it.id)) && this.shopPrice(it) - this.sellValue(cur, wr) <= budget)
            .sort((x, y) => y.price - x.price).slice(0, 3);
          for (const it of cands) {
            const cost = Math.max(100, this.shopPrice(it) - this.sellValue(cur, wr));
            const d = cloneDef(a.def);
            d.slots[k][i] = it.id;
            setWear(d, k, i, 0);
            const gain = this.pilotScore(a, computeStats(d)) / base - 1;
            if (gain < minGain) continue;
            const v = gain / Math.sqrt(cost);
            if (v > bv) { bv = v; best = { k, i, it, cost }; }
          }
        });
      }
      if (!best) break;
      a.credits -= best.cost;
      const old = a.def.slots[best.k][best.i];
      this.takeStock(pl, best.it.id);
      if (old) this.addStock(pl, old);
      a.def.slots[best.k][best.i] = best.it.id;
      setWear(a.def, best.k, best.i, 0);
      a.s = computeStats(a.def);
      bought += best.cost;
      if (best.it.tier >= 3 && best.cost > 5000 && Math.random() < 0.4)
        this.log(`★ ${a.name} установил ${best.it.name} (ТУ ${U.roman(best.it.tier)}).`, 'pilot', { s: a.loc });
    }
    // накопил — новый корпус
    if (plan && a.credits - reserve >= plan.cost) bought += this.pilotHull(a, pl, plan);
    if (bought) this.refreshKeep(a);
    return bought;
  },
  // какой корпус пилот присмотрел на этой верфи (может быть ещё не по карману)
  pilotHullPlan(a, pl) {
    const P = a.personality;
    const score = H => H.hp + H.cap * (0.6 + P.trade) + (H.slots.weapon || 0) * 45 * (0.5 + P.hunt) + H.shield * 0.8 + H.tier * 60;
    const cur = HULLS[a.def.hull];
    const yt = this.yardTier(pl);
    // не дороже, чем пилот способен накопить в обозримое время
    const reach = Math.max(12000, (a.credits + this.shopPrice({ price: defPrice(a.def) }) * 0.5) * 2.5);
    let best = null, bv = 0;
    for (const H of this.shopHulls(pl)) {
      if (H.id === cur.id || H.tier > yt || H.tier < cur.tier || score(H) < score(cur) * 1.15) continue;
      const cost = Math.max(0, this.shopPrice(H) - Math.round(this.shopPrice(cur) * 0.5));
      if (cost > reach) continue;
      const v = (score(H) / score(cur) - 1) / Math.sqrt(cost + 2000);
      if (v > bv) { bv = v; best = { H, cost }; }
    }
    return best;
  },
  pilotHull(a, pl, best) {
    if (!best) return 0;
    const { H, cost } = best;
    if (!this.stockOf(pl, H.id)) return 0;
    a.credits -= Math.max(0, cost);
    this.takeStock(pl, H.id);
    this.addStock(pl, a.def.hull);
    const nd = setHull(a.def, H.id);
    // не поместившееся — на продажу
    const order = ['artifact', 'ew', 'radar', 'armor', 'computer', 'droid', 'arsenal', 'shield', 'weapon', 'reactor', 'engine'];
    for (const k of order) for (let i = nd.slots[k].length - 1; i >= 0 && defMass(nd) > H.cap; i--) {
      if (nd.slots[k][i]) { a.credits += this.sellValue(nd.slots[k][i], slotWear(nd, k, i)); nd.slots[k][i] = null; }
    }
    const after = defItems(nd).map(i => i.id);
    for (const it of defItems(a.def)) { const j = after.indexOf(it.id); if (j >= 0) after.splice(j, 1); else a.credits += this.sellValue(it.id, 0.3); }
    nd.name = a.name;
    a.def = nd;
    a.hp = null;
    this.refreshKeep(a, true);
    this.log(`★ ${a.name} пересел на новый корпус: ${H.name} (ТУ ${U.roman(H.tier)}).`, 'pilot', { s: a.loc });
    return Math.max(1, cost);
  },
  // трофеи с уничтоженного пирата: обломки оборудования на продажу, игроку иногда — целый модуль
  salvage(killer, victim) {
    if (!killer || killer.kind !== 'pilot') return 0;
    const its = defItems(victim.def).filter(it => it.cat !== 'artifact');
    if (killer.ctrl === 'human' && its.length && Math.random() < 0.35) {
      const it = U.pick(its);
      killer.stash = killer.stash || [];
      killer.stash.push(it.id);
      this.log(`✧ Трофей: «${it.name}» (ТУ ${U.roman(it.tier)}) — в трюме, установить можно на верфи.`, 'player');
      return 0;
    }
    const v = Math.round(this.shopPrice({ price: victim.price }) * U.rf(0.04, 0.09));
    killer.credits += v;
    if (killer.ctrl === 'human') this.log(`✧ Обломки ${victim.name} проданы как трофеи: +${v} кр.`, 'player');
    return v;
  },
  // стоит ли лететь на верфь получше: есть деньги, а здешняя верфь (или её отсутствие) уже ничего не даёт
  pilotWantsYard(a, dock) {
    const spare = a.credits - this.pilotReserve(a);
    if (spare < 2500) return null;
    const here = dock ? this.yardTier(dock) : 0;
    const tier = this.shipTier(a);
    const yard = this.planets.filter(p => p.shipyard && p.sector !== a.loc && this.friendlyPlanet(a, p) && this.hops(a.loc, p.sector) <= 4 && this.yardTier(p) > Math.max(here, tier - 0.3))
      .sort((x, y) => this.yardTier(y) - this.yardTier(x) || this.hops(a.loc, x.sector) - this.hops(a.loc, y.sector))[0];
    return yard || null;
  },
});
