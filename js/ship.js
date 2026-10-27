'use strict';
// ============================================================
//  Корабль: описание сборки (def), расчёт характеристик,
//  боевое состояние, случайная генерация флотов
// ============================================================

// ---------- Описание сборки ----------
function emptyDef(hullId, name) {
  const h = HULLS[hullId];
  const slots = {};
  for (const k of SLOT_ORDER) slots[k] = new Array(h.slots[k] || 0).fill(null);
  return { name: name || U.pick(SHIP_NAMES), hull: hullId, slots };
}

function cloneDef(def) {
  const d = { name: def.name, hull: def.hull, slots: Object.fromEntries(SLOT_ORDER.map(k => [k, (def.slots[k] || []).slice()])) };
  if (def.wear) d.wear = Object.fromEntries(Object.entries(def.wear).map(([k, v]) => [k, v.slice()]));
  if (def.ins) d.ins = Object.fromEntries(Object.entries(def.ins).map(([k, v]) => [k, v.slice()]));
  return d;
}

function setHull(def, hullId) {
  const h = HULLS[hullId];
  const nd = { name: def.name, hull: hullId, slots: {}, wear: {}, ins: {} };
  // список снятых модулей — служебный, в сохранения не попадает
  Object.defineProperty(nd, 'removed', { value: [], enumerable: false, writable: true, configurable: true });
  for (const k of SLOT_ORDER) {
    const n = h.slots[k] || 0;
    // модули переезжают в новый корпус вместе со своим износом и страховой отметкой
    const old = (def.slots[k] || []).map((id, i) => [id, slotWear(def, k, i), slotInsured(def, k, i)]).filter(x => x[0]);
    nd.slots[k] = new Array(n).fill(null).map((_, i) => old[i] ? old[i][0] : null);
    nd.wear[k] = new Array(n).fill(0).map((_, i) => old[i] ? old[i][1] : 0);
    nd.ins[k] = new Array(n).fill(false).map((_, i) => old[i] ? old[i][2] : false);
    // не поместившиеся по числу слотов — снимаются (их продаст вызывающий код)
    for (const x of old.slice(n)) nd.removed.push({ id: x[0], wear: x[1], ins: x[2] });
  }
  return nd;
}

// ---------- Износ оборудования ----------
// def.wear[cat][i]: 0 — новое, 1 — сломано (не работает). Изношенный модуль слабее, вплоть до половины мощности.
const WEAR_SCALE = {
  weapon: ['dmin', 'dmax'], shield: ['max', 'regen', 'passive'], engine: ['thrust', 'evade', 'ev', 'init'],
  reactor: ['ePer', 'eCap', 'ePass'], arsenal: ['aPer', 'aCap', 'aPass'], droid: ['rPer', 'rPass'],
  computer: ['acc', 'crit'], radar: ['range', 'acc', 'ev'], ew: ['power', 'ewRes', 'dPass'], armor: ['hp', 'armor'],
};
// страховой модуль (выдан бесплатно после гибели) — продаётся только как лом
function slotInsured(def, cat, i) { return !!(def.ins && def.ins[cat] && def.ins[cat][i]); }
function setInsured(def, cat, i, v) {
  def.ins = def.ins || {};
  def.ins[cat] = def.ins[cat] || new Array((def.slots[cat] || []).length).fill(false);
  def.ins[cat][i] = !!v;
}
function slotWear(def, cat, i) { return (def.wear && def.wear[cat] && def.wear[cat][i]) || 0; }
function setWear(def, cat, i, v) {
  def.wear = def.wear || {};
  def.wear[cat] = def.wear[cat] || new Array((def.slots[cat] || []).length).fill(0);
  def.wear[cat][i] = U.clamp(v, 0, 1);
}
const wearMult = w => (w >= 1 ? 0 : 1 - w * 0.5);
function wornItem(it, w) {
  const k = wearMult(w), keys = WEAR_SCALE[it.cat];
  if (k >= 1 || !keys) return it;
  const c = Object.assign({}, it);
  for (const key of keys) if (typeof c[key] === 'number') c[key] *= k;
  return c;
}

function defItems(def) {
  const out = [];
  for (const k of SLOT_ORDER) for (const id of def.slots[k] || []) if (id && ITEMS[id]) out.push(ITEMS[id]);
  return out;
}
const defMass = def => U.sum(defItems(def), it => it.mass);
const defPrice = def => HULLS[def.hull].price + U.sum(defItems(def), it => it.price);

// ---------- Расчёт характеристик ----------
function computeStats(def) {
  const h = HULLS[def.hull];
  const zero = () => Object.fromEntries(DMG_KEYS.map(k => [k, 0]));
  const s = {
    maxHp: h.hp, armor: h.armor, cap: h.cap, mass: 0, evasion: h.ev, init: h.init, turn: h.turn, turnPer: 4,
    resist: Object.assign(zero(), h.resist), shieldResist: zero(),
    maxShield: h.shield, shieldRegen: h.shield ? 4 : 0, shieldPassive: h.shield ? 2 : 0, hasShield: h.shield > 0,
    ePer: 1.5, eCap: 10, ePass: 0, over: 0.02,
    aPer: 1.5, aCap: 10, aPass: 0, critStar: 0.012,
    rPer: 2, rPass: 0, cleanse: 0,
    thrust: 0.6, evadePer: 1.5, freeMove: 1,
    dPer: 1, dPass: 0, dCap: 30, acc: 0, crit: 5, critMult: 2, range: 0,
    ew: null, ewRes: 0, extraTurn: 0, phase: 0, reflect: 0, rage: 0, wcap: 0, cascade: 0, explDmg: 0,
    bias: h.bias.slice(), weapons: [], artifacts: [],
  };
  s.broken = 0;
  const items = [];
  for (const k of SLOT_ORDER) (def.slots[k] || []).forEach((id, i) => {
    if (!id || !ITEMS[id]) return;
    const w = slotWear(def, k, i);
    if (w >= 1) { s.mass += ITEMS[id].mass; s.broken++; return; } // сломанный модуль — мёртвый груз
    items.push(wornItem(ITEMS[id], w));
  });
  for (const it of items) {
    s.mass += it.mass;
    switch (it.cat) {
      case 'weapon': s.weapons.push(it); break;
      case 'shield':
        s.hasShield = true;
        s.maxShield += it.max; s.shieldRegen = Math.max(s.shieldRegen, 0) + it.regen; s.shieldPassive += it.passive;
        for (const k in it.resist) s.shieldResist[k] = Math.min(0.8, s.shieldResist[k] + it.resist[k]);
        break;
      case 'engine':
        s.thrust = it.thrust; s.evadePer = it.evade; s.init += it.init; s.evasion += it.ev; s.turn += it.turn || 0; break;
      case 'reactor':
        s.ePer = it.ePer; s.eCap = it.eCap; s.ePass += it.ePass; s.over += it.over; break;
      case 'arsenal':
        s.aPer = it.aPer; s.aCap = it.aCap; s.aPass += it.aPass; s.critStar += it.critStar; break;
      case 'droid':
        s.rPer = it.rPer; s.rPass += it.rPass; s.cleanse += it.cleanse; break;
      case 'computer':
        s.acc += it.acc; s.crit += it.crit; s.dPer = Math.max(s.dPer, it.dPer); break;
      case 'radar':
        s.range += it.range; s.acc += it.acc; s.evasion += it.ev; break;
      case 'ew':
        if (it.kind) s.ew = { kind: it.kind, cost: it.cost, power: it.power, name: it.name };
        s.ewRes += it.ewRes; s.dPass += it.dPass || 0; break;
      case 'armor':
        s.maxHp += it.hp; s.armor += it.armor; s.evasion += it.ev;
        for (const k in it.resist) s.resist[k] = Math.min(0.7, s.resist[k] + it.resist[k]);
        break;
      case 'artifact':
        s.artifacts.push(it);
        for (const k in it.mods) {
          if (k === 'biasAdd') it.mods[k].forEach((v, i) => { s.bias[i] *= 1 + v; });
          else if (typeof s[k] === 'number') s[k] += it.mods[k];
        }
        break;
    }
  }
  if (!s.hasShield) { s.maxShield = 0; s.shieldRegen = 0; }
  s.maxHp = Math.round(s.maxHp); s.maxShield = Math.round(s.maxShield);
  s.armor = U.clamp(s.armor, 0, 0.6);
  s.evasion = Math.max(0, s.evasion);
  s.ewRes = Math.min(0.85, s.ewRes);
  s.overload = s.mass > s.cap;
  // эффективные параметры оружия
  s.weapons = s.weapons.map(it => ({
    it, name: it.name, res: it.res, dt: it.dt, fx: it.fx,
    dmin: it.dmin, dmax: it.dmax, shots: it.shots, cost: it.cost, rof: it.rof,
    range: it.range + s.range, acc: it.acc, crit: it.crit, arc: it.arc,
    cap: Math.max(it.cost, Math.round(it.cap * (1 + s.wcap))),
    pierce: it.pierce, armorPen: it.armorPen, homing: it.homing, eff: it.eff,
    dmgMul: it.dt === 'explosive' ? 1 + s.explDmg : 1,
  }));
  return s;
}

// Средний урон за ход (оценка для ИИ и UI)
function weaponDps(w) {
  return (w.dmin + w.dmax) / 2 * w.shots * Math.min(w.rof, Math.max(1, w.cap / w.cost)) * w.dmgMul;
}

// ---------- Боевое состояние корабля ----------
class Ship {
  constructor(def, side, idx, ctrl) {
    this.id = U.uid();
    this.def = cloneDef(def);
    this.side = side;
    this.idx = idx;
    this.ctrl = ctrl || 'ai';
    this.hull = HULLS[def.hull];
    this.name = def.name;
    this.s = computeStats(def);
    this.hp = this.s.maxHp;
    this.shield = this.s.maxShield;
    this.energy = Math.round(this.s.eCap * 0.3);
    this.ammo = Math.round(this.s.aCap * 0.3);
    this.data = 0;
    this.weapons = this.s.weapons.map(w => Object.assign({}, w, { charge: Math.ceil(w.cost * 0.5) }));
    this.evadeBuff = 0;
    this.move = 0;
    // положение на двумерном поле боя задаёт Battle
    this.x = 0; this.y = 0; this.heading = side === 0 ? 0 : Math.PI;
    this.turnLeft = 0;
    this.nextAt = 0;
    this.statuses = [];
    this.critCharges = 0;
    this.alive = true;
    this.tactic = 'auto';
    this.target = null;
    this.diff = 'normal';
    this.board = new Board(this);
    this.st = { dealt: 0, taken: 0, blocks: 0, kills: 0, shots: 0, hits: 0, crits: 0, healed: 0, turns: 0, hacks: 0 };
  }

  status(k) { return this.statuses.find(x => x.k === k); }
  addStatus(k, v, t) {
    const ex = this.status(k);
    if (ex) { ex.v = Math.max(ex.v, v); ex.t = Math.max(ex.t, t); }
    else this.statuses.push({ k, v, t });
  }
  get evasion() {
    const slow = this.status('slow'), hk = this.status('hacked');
    return U.clamp(this.s.evasion + this.evadeBuff - (slow ? slow.v : 0) - (hk ? hk.v : 0), 0, 65);
  }
  get armor() {
    const c = this.status('corrode');
    return Math.max(0, this.s.armor - (c ? c.v : 0));
  }
  get hpFrac() { return this.hp / this.s.maxHp; }

  // распределение заряда по оружию данного ресурса, остаток — в накопитель
  feed(res, amount) {
    const ws = this.weapons.filter(w => w.res === res);
    let left = amount;
    let guard = 0;
    while (left > 0.001 && guard++ < 20) {
      const need = ws.filter(w => w.charge < w.cap);
      if (!need.length) break;
      const share = left / need.length;
      for (const w of need) {
        const add = Math.min(share, w.cap - w.charge);
        w.charge += add;
        left -= add;
      }
    }
    if (left > 0) {
      const key = res, capKey = res === 'energy' ? 'eCap' : res === 'ammo' ? 'aCap' : 'dCap';
      this[key] = Math.min(this.s[capKey], this[key] + left);
    }
  }
  // добор заряда из накопителя перед стрельбой
  topUp() {
    for (const w of this.weapons) {
      const need = w.cap - w.charge;
      if (need <= 0) continue;
      const take = Math.min(need, this[w.res]);
      w.charge += take;
      this[w.res] -= take;
    }
  }

  // начисление ресурсов за собранные блоки
  gainBlocks(counts, mult) {
    const s = this.s, g = {};
    const n = i => counts[i] * mult;
    if (counts[0]) { g.energy = n(0) * s.ePer; this.feed('energy', g.energy); }
    if (counts[1]) { g.ammo = n(1) * s.aPer; this.feed('ammo', g.ammo); }
    if (counts[2]) {
      const before = this.shield;
      // блоки щита могут перезарядить щит сверх максимума — до 150%
      this.shield = Math.max(this.shield, Math.min(s.maxShield * 1.5, this.shield + n(2) * s.shieldRegen));
      g.shield = this.shield - before;
    }
    if (counts[3]) {
      const before = this.hp;
      this.hp = Math.min(s.maxHp, this.hp + n(3) * s.rPer);
      g.repair = this.hp - before;
      this.st.healed += g.repair;
    }
    if (counts[4]) {
      g.thrust = n(4) * s.thrust;
      this.move += g.thrust;
      this.turnLeft += n(4) * s.turnPer;
      this.evadeBuff = Math.min(45, this.evadeBuff + n(4) * s.evadePer);
    }
    if (counts[5]) { g.data = n(5) * s.dPer; this.feed('data', g.data); }
    return g;
  }

  // Получение урона. Возвращает {shieldDmg, hullDmg, killed}
  takeDamage(dmg, type, opt = {}) {
    const D = DMG[type];
    const s = this.s;
    let bypass = Math.min(1, (D.bypass || 0) + (opt.pierce || 0));
    let toShield = dmg * (1 - bypass);
    let direct = dmg * bypass;
    let shieldDmg = 0;
    if (this.shield > 0 && toShield > 0) {
      const eff = D.shield * (1 - s.shieldResist[type]) * (1 + (opt.shred || 0));
      const want = toShield * eff;
      if (want <= this.shield) { this.shield -= want; shieldDmg = want; toShield = 0; }
      else { shieldDmg = this.shield; toShield -= this.shield / eff; this.shield = 0; }
    }
    let hullDmg = 0;
    const raw = toShield + direct;
    if (raw > 0) {
      const armor = Math.max(0, this.armor * (1 - (D.armorIgnore || 0)) * (opt.halfArmor ? 0.5 : 1) - (opt.armorPen || 0));
      hullDmg = raw * D.hull * (1 - s.resist[type]) * (1 - armor);
      this.hp -= hullDmg;
    }
    this.st.taken += shieldDmg + hullDmg;
    const killed = this.hp <= 0 && this.alive;
    if (this.hp <= 0) { this.hp = 0; }
    return { shieldDmg, hullDmg, killed };
  }
}

// ---------- Случайная генерация ----------
function randomName(used) {
  const free = SHIP_NAMES.filter(n => !used || !used.has(n));
  const n = free.length ? U.pick(free) : U.pick(SHIP_NAMES) + ' ' + U.ri(2, 9);
  if (used) used.add(n);
  return n;
}

function pickItem(cat, tier, maxMass, filter) {
  let c = itemsFor(cat).filter(it => it.tier <= tier && it.tier >= tier - 1 && it.mass <= maxMass && (!filter || filter(it)));
  if (!c.length) c = itemsFor(cat).filter(it => it.tier <= tier && it.mass <= maxMass && (!filter || filter(it)));
  if (!c.length && filter) return pickItem(cat, tier, maxMass, null);
  return c.length ? U.pick(c) : null;
}

function randomDef(tier, used, hullId) {
  let hull;
  if (hullId) hull = HULLS[hullId];
  else {
    const cands = HULL_LIST.filter(h => h.tier <= tier);
    const w = cands.map(h => (h.tier === tier ? 4 : h.tier === tier - 1 ? 3 : h.tier === tier - 2 ? 1.5 : 0.6));
    hull = cands[U.weighted(w)];
  }
  const def = emptyDef(hull.id, randomName(used));
  autoFill(def, tier);
  return def;
}

// Автоматическая сборка корабля под техуровень (заполняет пустые слоты)
function autoFill(def, tier) {
  const hull = HULLS[def.hull];
  let free = hull.cap - defMass(def);
  const doctrine = U.pick(['energy', 'ammo', 'mixed', 'mixed', 'exotic']);
  const rangePref = U.pick(['close', 'mid', 'long', 'any', 'any']);
  const wFilter = it => {
    const dOk = doctrine === 'energy' ? it.res === 'energy' :
      doctrine === 'ammo' ? it.res === 'ammo' :
      doctrine === 'exotic' ? ['ion', 'gravity', 'nano', 'plasma'].includes(it.dt) : true;
    const rOk = rangePref === 'close' ? it.range <= 11 : rangePref === 'long' ? it.range >= 12 :
      rangePref === 'mid' ? it.range >= 8 && it.range <= 16 : true;
    return dOk && rOk;
  };
  const put = (cat, i, filter, reserve = 0) => {
    if (def.slots[cat][i]) return;
    const it = pickItem(cat, tier, free - reserve, filter);
    if (it) { def.slots[cat][i] = it.id; free -= it.mass; }
  };
  const has = cat => (def.slots[cat] || []).some(Boolean);
  const nW = def.slots.weapon.length;
  if (def.slots.engine.length) put('engine', 0);
  if (def.slots.reactor.length) put('reactor', 0);
  for (let i = 0; i < nW; i++) put('weapon', i, wFilter, 10 + (nW - i - 1) * 4);
  if (def.slots.shield.length) put('shield', 0);
  const usesAmmo = defItems(def).some(it => it.cat === 'weapon' && it.res === 'ammo');
  const usesData = defItems(def).some(it => it.cat === 'weapon' && it.res === 'data');
  if (usesAmmo && def.slots.arsenal.length) put('arsenal', 0);
  if (def.slots.droid.length) put('droid', 0);
  if (def.slots.computer.length && (usesData || U.chance(0.7))) put('computer', 0);
  for (let i = 0; i < def.slots.armor.length; i++) if (U.chance(0.6)) put('armor', i);
  if (def.slots.radar.length && U.chance(0.6)) put('radar', 0);
  if (def.slots.ew.length && U.chance(0.55)) put('ew', 0);
  const used = new Set(defItems(def).filter(i => i.cat === 'artifact').map(i => i.id));
  for (let i = 0; i < def.slots.artifact.length; i++) {
    if (U.chance(0.12 * tier)) put('artifact', i, it => !used.has(it.id));
    if (def.slots.artifact[i]) used.add(def.slots.artifact[i]);
  }
  // второй проход — пустые слоты оружия, если осталось место
  for (let i = 0; i < nW; i++) put('weapon', i);
  if (!has('arsenal') && def.slots.arsenal.length && defItems(def).some(it => it.res === 'ammo')) put('arsenal', 0);
  return def;
}

function randomFleet(n, tier, used) {
  return Array.from({ length: n }, () => randomDef(tier, used));
}

// Две примерно равные по стоимости стороны
function randomFleets(n, tier) {
  const used = new Set();
  const a = randomFleet(n, tier, used);
  let b = randomFleet(n, tier, used);
  const P = f => U.sum(f, defPrice);
  for (let k = 0; k < 40; k++) {
    const pa = P(a), pb = P(b);
    if (Math.abs(pa - pb) / Math.max(pa, pb) < 0.1) break;
    const strong = pa > pb ? a : b;
    const i = U.ri(0, n - 1);
    used.delete(strong[i].name);
    strong[i] = randomDef(tier, used);
  }
  return [a, b];
}
