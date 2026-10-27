'use strict';
// ============================================================
//  Живой ассортимент верфей. Купленное исчезает со склада,
//  проданное — появляется. Новые партии делает завод в столице
//  фракции, а на остальные верфи их возят корабли-снабженцы:
//  если снабженца перехватят, партия не дойдёт (и может выпасть
//  в обломках).
// ============================================================

const YARD_FILL = 0.55;     // доля каталога, которая лежит на складе полной верфи
const SUPPLY_BATCH = [6, 11];

Object.assign(World.prototype, {
  // всё, что верфь может продавать: производители фракции и уровень верфи
  yardCatalog(pl) {
    if (!pl.shipyard) return { items: [], hulls: [] };
    const makers = this.yardMakers(pl), t = this.yardTier(pl);
    const items = Object.values(ITEMS).filter(it => it.cat !== 'artifact' && it.tier <= t && makers.includes(it.maker))
      .concat(t >= 4 ? itemsFor('artifact').filter((_, i) => (i + pl.id) % 4 === 0) : []);
    const hulls = HULL_LIST.filter(h => h.tier <= t && makers.includes(h.maker));
    return { items, hulls };
  },
  // склад верфи (создаётся при первом обращении)
  yard(pl) {
    if (!pl.shipyard) return null;
    if (!pl.yard) {
      const C = this.yardCatalog(pl), stock = {}, hulls = {};
      for (const it of C.items) if (Math.random() < YARD_FILL * (it.cat === 'artifact' ? 0.4 : 1)) stock[it.id] = it.tier <= 2 && Math.random() < 0.4 ? 2 : 1;
      for (const H of C.hulls) if (Math.random() < YARD_FILL * 0.8) hulls[H.id] = 1;
      pl.yard = { stock, hulls, lastSupply: this.day };
    }
    return pl.yard;
  },
  stockOf(pl, id) { const Y = this.yard(pl); return Y ? (Y.stock[id] || Y.hulls[id] || 0) : 0; },
  takeStock(pl, id) {
    const Y = this.yard(pl);
    if (!Y) return;
    const box = HULLS[id] ? Y.hulls : Y.stock;
    if (box[id] > 0) box[id]--;
    if (box[id] <= 0) delete box[id];
  },
  addStock(pl, id, n = 1) {
    const Y = this.yard(pl);
    if (!Y) return;
    const box = HULLS[id] ? Y.hulls : Y.stock;
    box[id] = (box[id] || 0) + n;
  },
  // насколько склад верфи заполнен относительно нормы
  yardFill(pl) {
    const Y = this.yard(pl), C = this.yardCatalog(pl);
    return Y ? Object.keys(Y.stock).length / Math.max(1, C.items.length * YARD_FILL) : 1;
  },
  // недостающие позиции для новой партии
  yardWants(pl, n) {
    const Y = this.yard(pl), C = this.yardCatalog(pl);
    const miss = U.shuffle(C.items.filter(it => !Y.stock[it.id] && (it.cat !== 'artifact' || Math.random() < 0.3)));
    const out = miss.slice(0, n).map(it => it.id);
    // корпуса — изредка
    const mh = C.hulls.filter(H => !Y.hulls[H.id]);
    if (mh.length && Math.random() < 0.5) out.push(U.pick(mh).id);
    return out;
  },

  // ежедневно: заводы в столицах выпускают модули, на остальные верфи уходят снабженцы
  supplyTick() {
    // местные покупатели (флот фракции, частники) понемногу раскупают склады
    for (const pl of this.planets) {
      if (!pl.shipyard || pl.pop <= 0 || Math.random() > 0.35) continue;
      const ids = Object.keys(this.yard(pl).stock);
      if (ids.length) this.takeStock(pl, U.pick(ids));
      if (Math.random() < 0.05) { const hs = Object.keys(pl.yard.hulls); if (hs.length) this.takeStock(pl, U.pick(hs)); }
    }
    for (const f of this.factions) {
      if (!f.alive || f.capital == null) continue;
      const cap = this.planets[f.capital];
      if (cap && cap.owner === f.idx && cap.shipyard) {
        // завод столицы понемногу пополняет свой склад
        if (Math.random() < 0.45 && this.yardFill(cap) < 1.1 && cap.stock.metal >= 3 && cap.stock.tech >= 1.5)
          for (const id of this.yardWants(cap, 1)) { this.addStock(cap, id); cap.stock.metal -= 3; cap.stock.tech -= 1.5; }
      }
      if (!cap || this.day % 2 || Math.random() > 0.7 || f.treasury < 600) continue;
      // самая опустевшая верфь фракции ждёт партию (если к ней уже не летит снабженец)
      const busy = new Set([...this.agents.values()].filter(a => a.kind === 'supply' && a.faction === f.idx && a.task).map(a => a.task.planet));
      const need = this.factionPlanets(f.idx).filter(p => p.shipyard && p.id !== cap.id && !busy.has(p.id) && this.yardFill(p) < 0.8)
        .sort((x, y) => this.yardFill(x) - this.yardFill(y))[0];
      if (!need) continue;
      // партия делается из металла и электроники со склада столицы: торговля питает верфи
      const can = Math.floor(Math.min(cap.stock.metal / 3, cap.stock.tech / 1.5));
      const batch = this.yardWants(need, Math.min(can, U.ri(SUPPLY_BATCH[0], SUPPLY_BATCH[1])));
      if (!batch.length) continue;
      cap.stock.metal -= batch.length * 3; cap.stock.tech -= batch.length * 1.5;
      this.updatePlanetPrice(cap);
      f.treasury -= 400;
      const a = this.spawn('supply', f.idx, cap.sector, { home: cap.id });
      a.yardCargo = batch;
      a.task = { type: 'supply', sector: need.sector, planet: need.id };
      this.go(a, need.sector);
    }
  },
  // снабженец прибыл
  supplyArrive(a, T) {
    const P = this.planets[T.planet];
    if (P && P.owner === a.faction && P.shipyard) {
      for (const id of a.yardCargo || []) this.addStock(P, id);
      P.yard.lastSupply = this.day;
      if (P.sector === (this.player && this.player.loc)) this.log(`⬢ Снабженец ${this.factions[a.faction].short} доставил на верфь ${P.name} новую партию оборудования.`, 'trade', { s: P.sector });
    }
    a.yardCargo = [];
    this.agents.delete(a.id); a.alive = false;
    return false;
  },
});
