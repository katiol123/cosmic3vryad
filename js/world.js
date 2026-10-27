'use strict';
// ============================================================
//  Кампания: модель галактики. Мир живёт пошагово по дням.
//  Секторы, гиперпереходы, планеты с экономикой, 12 фракций,
//  пиратские базы, корабли-агенты с миссиями, ИИ-пилоты.
//  Бои идут несколько дней: каждый день — ограниченное время боя,
//  и прилетевшие корабли могут вступить в уже идущий бой.
// ============================================================

const WORLD_W = 1200, WORLD_H = 800;
const BATTLE_ROUNDS_PER_DAY = 3;   // сколько «раундов» боя проходит за один день кампании
const NONCOMBAT = ['trader', 'diplomat', 'colonist', 'miner', 'supply'];

class World {
  constructor(opts = {}) {
    this.seed = opts.seed != null ? opts.seed : Math.floor(Math.random() * 1e9);
    this.rnd = U.seeded(this.seed);
    this.nSectors = opts.sectors || 30;
    this.nPilots = opts.pilots != null ? opts.pilots : 16;
    this.day = 1;
    this.sectors = []; this.lanes = []; this.planets = []; this.factions = []; this.bases = [];
    this.agents = new Map();
    this.battles = [];
    this.events = [];
    this.missions = [];
    this.nextId = 1;
    this.stats = { battles: 0, destroyed: 0, pirateKills: 0, lootTotal: 0, tradeTotal: 0, captured: 0, wars: 0, peaces: 0 };
    this.generate();
  }

  // ---------- случайность генерации (с зерном) ----------
  r() { return this.rnd(); }
  ri(a, b) { return Math.floor(a + this.r() * (b - a + 1)); }
  rp(arr) { return arr[Math.floor(this.r() * arr.length)]; }
  rshuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(this.r() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }

  log(text, type = '', extra = {}) {
    this.events.push(Object.assign({ day: this.day, text, type }, extra));
    if (this.events.length > 600) this.events.splice(0, this.events.length - 600);
  }

  // =====================================================
  //  Генерация
  // =====================================================
  generate() {
    this.genSectors();
    this.genLanes();
    this.calcPaths();
    this.genFactions();
    this.genPlanets();
    this.genBases();
    this.genAgents();
    this.log(`Галактика создана: ${this.sectors.length} секторов, ${this.planets.filter(p => p.pop > 0).length} обитаемых планет.`, 'sys');
  }

  genSectors() {
    const pts = [];
    let minD = 165;
    while (pts.length < this.nSectors) {
      let placed = false;
      for (let t = 0; t < 4000 && !placed; t++) {
        const x = 70 + this.r() * (WORLD_W - 140), y = 60 + this.r() * (WORLD_H - 120);
        if (pts.every(p => Math.hypot(p.x - x, p.y - y) >= minD)) { pts.push({ x, y }); placed = true; }
      }
      if (!placed) minD *= 0.93;
    }
    const names = this.rshuffle(STAR_NAMES.slice());
    const starCols = ['#fff4d6', '#ffd27a', '#ff9e6b', '#9cc3ff', '#ffffff', '#ffb3b3', '#c7d8ff'];
    this.sectors = pts.map((p, i) => ({
      id: i, name: names[i % names.length], x: p.x, y: p.y, owner: FREE, planets: [], lanes: [],
      star: this.rp(starCols), starSize: 0.7 + this.r() * 0.7, asteroids: false, base: null,
      heat: 0, traffic: 0,
    }));
  }

  genLanes() {
    const S = this.sectors, n = S.length;
    const d = (a, b) => Math.hypot(S[a].x - S[b].x, S[a].y - S[b].y);
    const cross = (a, b, c, e) => {
      if (a === c || a === e || b === c || b === e) return false;
      const p = S[a], q = S[b], r = S[c], s = S[e];
      const o = (A, B, C) => Math.sign((B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x));
      return o(p, q, r) !== o(p, q, s) && o(r, s, p) !== o(r, s, q);
    };
    const addLane = (a, b) => {
      const len = d(a, b);
      const L = { id: this.lanes.length, a, b, len };
      this.lanes.push(L);
      S[a].lanes.push(L); S[b].lanes.push(L);
    };
    const ok = (a, b) => !this.lanes.some(L => (L.a === a && L.b === b) || (L.a === b && L.b === a) || cross(a, b, L.a, L.b));
    // минимальное остовное дерево — связность
    const edges = [];
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) edges.push([d(a, b), a, b]);
    edges.sort((x, y) => x[0] - y[0]);
    const par = S.map((_, i) => i);
    const find = x => (par[x] === x ? x : (par[x] = find(par[x])));
    for (const [, a, b] of edges) {
      if (find(a) !== find(b) && ok(a, b)) { par[find(a)] = find(b); addLane(a, b); }
    }
    for (const [, a, b] of edges) if (find(a) !== find(b)) { par[find(a)] = find(b); addLane(a, b); }
    // дополнительные коридоры — чтобы были альтернативные маршруты
    for (const [len, a, b] of edges) {
      if (len > 330) break;
      if (S[a].lanes.length >= 4 || S[b].lanes.length >= 4) continue;
      if (ok(a, b) && this.r() < 0.55) addLane(a, b);
    }
  }

  neighbors(sid) { return this.sectors[sid].lanes.map(L => (L.a === sid ? L.b : L.a)); }
  laneBetween(a, b) { return this.sectors[a].lanes.find(L => L.a === b || L.b === b); }

  // кратчайшие пути между всеми секторами (Флойд — секторов немного)
  calcPaths() {
    const n = this.sectors.length;
    const D = Array.from({ length: n }, () => new Array(n).fill(Infinity));
    const H = Array.from({ length: n }, () => new Array(n).fill(Infinity));
    const N = Array.from({ length: n }, () => new Array(n).fill(-1));
    for (let i = 0; i < n; i++) { D[i][i] = 0; H[i][i] = 0; N[i][i] = i; }
    for (const L of this.lanes) {
      D[L.a][L.b] = D[L.b][L.a] = L.len; H[L.a][L.b] = H[L.b][L.a] = 1;
      N[L.a][L.b] = L.b; N[L.b][L.a] = L.a;
    }
    for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if (D[i][k] + D[k][j] < D[i][j]) { D[i][j] = D[i][k] + D[k][j]; H[i][j] = H[i][k] + H[k][j]; N[i][j] = N[i][k]; }
    }
    this.D = D; this.H = H; this.N = N;
  }
  hops(a, b) { return this.H[a][b]; }

  genFactions() {
    const S = this.sectors, n = S.length;
    // столицы — как можно дальше друг от друга
    const caps = [Math.floor(this.r() * n)];
    while (caps.length < FACTIONS.length) {
      let best = -1, bd = -1;
      for (let i = 0; i < n; i++) {
        if (caps.includes(i)) continue;
        const md = Math.min(...caps.map(c => this.D[i][c])) * (0.85 + this.r() * 0.3);
        if (md > bd) { bd = md; best = i; }
      }
      caps.push(best);
    }
    this.rshuffle(caps);
    this.factions = FACTIONS.map((F, i) => ({
      idx: i, ...F, capitalSector: caps[i], capital: null, treasury: 9000 + this.ri(0, 4000),
      tech: 2 + (this.r() < 0.5 ? 1 : 0), rel: new Array(FACTIONS.length).fill(0), base: new Array(FACTIONS.length).fill(0),
      wars: new Set(), warSince: {}, alive: true,
      st: { trade: 0, tax: 0, built: 0, lost: 0, lostToPirates: 0, lostValue: 0, missionsOk: 0, missionsFail: 0, captured: 0, lostPlanets: 0, pirateKills: 0 },
    }));
    caps.forEach((c, i) => { S[c].owner = i; });
    // рост территорий по соседям
    const want = this.factions.map(f => 1 + (this.r() < 0.5 + f.expand * 0.3 ? 1 : 0) + (this.r() < f.expand * 0.35 ? 1 : 0));
    let neutral = n - caps.length;
    let grew = true;
    while (grew && neutral > Math.max(4, Math.round(n * 0.15))) {
      grew = false;
      for (const f of this.factions) {
        if (want[f.idx] <= 0) continue;
        const own = S.filter(s => s.owner === f.idx).map(s => s.id);
        const cand = [...new Set(own.flatMap(s => this.neighbors(s)))].filter(s => S[s].owner === FREE);
        if (!cand.length) continue;
        cand.sort((a, b) => this.D[a][f.capitalSector] - this.D[b][f.capitalSector]);
        S[cand[0]].owner = f.idx;
        want[f.idx]--; neutral--; grew = true;
        if (neutral <= Math.max(4, Math.round(n * 0.15))) break;
      }
    }
    // отношения: характер + соседство + случайность
    const borders = (a, b) => S.some(s => s.owner === a && this.neighbors(s.id).some(t => S[t].owner === b));
    for (const a of this.factions) for (const b of this.factions) {
      if (a === b) { a.rel[b.idx] = 100; a.base[b.idx] = 100; continue; }
      if (b.idx < a.idx) continue;
      let v = 10 + (a.diplo + b.diplo) * 15 - (a.war + b.war) * 18 + (this.r() - 0.5) * 40;
      if (borders(a.idx, b.idx)) v -= 12;
      v = Math.round(U.clamp(v, -70, 70));
      a.rel[b.idx] = b.rel[a.idx] = v;
      a.base[b.idx] = b.base[a.idx] = v;
    }
  }

  genPlanets() {
    const syl = () => { let s = ''; const k = this.ri(2, 3); for (let i = 0; i < k; i++) s += this.rp(SYL); return s[0].toUpperCase() + s.slice(1); };
    const types = ['agri', 'mining', 'indust', 'tech', 'resort'];
    for (const s of this.sectors) {
      const owned = s.owner !== FREE;
      const count = owned ? this.ri(2, 4) : this.ri(1, 3);
      s.asteroids = !owned ? this.r() < 0.7 : this.r() < 0.3;
      for (let k = 0; k < count; k++) {
        const isCap = owned && this.factions[s.owner].capitalSector === s.id && k === 0;
        let inhabited, owner = FREE;
        if (isCap) inhabited = true;
        else if (owned) inhabited = this.r() < 0.72;
        else inhabited = this.r() < 0.25;
        if (inhabited && owned) owner = s.owner;
        const type = isCap ? 'capital' : this.rp(types);
        const p = {
          id: this.planets.length, name: this.r() < 0.5 ? `${s.name} ${U.roman(k + 1)}` : syl(), sector: s.id, owner, type,
          pop: inhabited ? (isCap ? 8 + this.r() * 5 : 1 + this.r() * 5) : 0,
          stock: {}, price: {}, stability: 0.75 + this.r() * 0.15, defense: 0, maxDefense: 0,
          shipyard: 0, orbit: 36 + k * 20 + this.r() * 6, angle: this.r() * Math.PI * 2, size: 0.6 + this.r() * 0.6, omega: 0.45 / Math.sqrt(36 + k * 20),
          shortage: 0,
        };
        if (isCap) { p.shipyard = 4; this.factions[s.owner].capital = p.id; }
        else if (p.pop > 0 && (type === 'indust' || type === 'tech')) p.shipyard = this.r() < 0.6 ? 3 : 2;
        else if (p.pop > 0 && this.r() < 0.25) p.shipyard = 2;
        p.maxDefense = p.pop > 0 ? Math.round(300 + p.pop * 120) : 0;
        p.defense = p.maxDefense;
        for (const g of GOODS) p.stock[g.id] = Math.round(this.target(p, g.id) * (0.6 + this.r() * 0.6));
        this.planets.push(p);
        s.planets.push(p.id);
      }
    }
    this.updatePrices();
  }

  genBases() {
    const nb = Math.max(2, Math.round(this.nSectors / 10));
    for (let i = 0; i < nb; i++) this.newBase();
  }
  newBase() {
    const S = this.sectors;
    const cands = S.filter(s => s.owner === FREE && !s.base);
    const pool = cands.length ? cands : S.filter(s => !s.base);
    // подальше от столиц
    pool.sort((a, b) => Math.min(...this.factions.map(f => this.D[b.id][f.capitalSector])) - Math.min(...this.factions.map(f => this.D[a.id][f.capitalSector])));
    const s = pool[Math.min(pool.length - 1, this.ri(0, 2))];
    const used = new Set(this.bases.map(b => b.name));
    const name = BASE_NAMES.find(n => !used.has(n)) || `Логово-${this.bases.length + 1}`;
    const b = { id: this.nextId++, name, sector: s.id, wealth: 3500, defense: 2500, maxDefense: 2500, alive: true, born: this.day, loot: 0 };
    s.base = b.id;
    s.asteroids = true;
    this.bases.push(b);
    return b;
  }

  genAgents() {
    for (const f of this.factions) {
      const capSec = f.capitalSector;
      const planets = this.factionPlanets(f.idx);
      for (let i = 0; i < Math.max(2, Math.round(planets.length * 0.7)); i++) this.spawn('trader', f.idx, this.rp(planets).sector);
      for (let i = 0; i < 1 + Math.round(f.war * 1.5); i++) this.spawn('patrol', f.idx, capSec);
      if (this.r() < f.diplo) this.spawn('diplomat', f.idx, capSec);
    }
    for (const b of this.bases) for (let i = 0; i < 2; i++) this.spawn('pirate', PIRATE, b.sector, { base: b.id });
    for (let i = 0; i < this.nPilots; i++) {
      const p = this.rp(this.planets.filter(p => p.pop > 0 && p.owner !== FREE));
      this.spawn('pilot', FREE, p.sector);
    }
  }

  factionPlanets(fi) { return this.planets.filter(p => p.owner === fi && p.pop > 0); }
  factionSectors(fi) { return this.sectors.filter(s => s.owner === fi); }

  // =====================================================
  //  Корабли-агенты
  // =====================================================
  designShip(kind, faction, tier) {
    const prefs = {
      trader: ['corvette', 'frigate', 'raider', 'destroyer'], supply: ['corvette', 'frigate', 'raider'], diplomat: ['scout', 'fighter', 'corvette', 'raider'],
      patrol: ['fighter', 'corvette', 'frigate', 'destroyer'], warship: ['frigate', 'destroyer', 'cruiser', 'battleship', 'dreadnought'],
      colonist: ['corvette', 'frigate'], miner: ['corvette', 'frigate'], pirate: ['fighter', 'raider', 'corvette', 'frigate', 'destroyer'],
      pilot: ['scout', 'fighter', 'corvette', 'raider', 'frigate', 'destroyer', 'cruiser'],
    }[kind];
    const maker = faction >= 0 && faction !== PIRATE && Math.random() < 0.75 ? FACTIONS[faction].maker : null;
    let cands = HULL_LIST.filter(h => prefs.includes(h.cls) && h.tier <= tier && (!maker || h.maker === maker));
    if (!cands.length) cands = HULL_LIST.filter(h => prefs.includes(h.cls) && h.tier <= tier);
    if (!cands.length) cands = HULL_LIST.filter(h => h.tier <= tier);
    // ближе к верхнему пределу техуровня — чаще
    const hull = cands[U.weighted(cands.map(h => 1 + h.tier * h.tier))];
    const def = emptyDef(hull.id, U.pick(SHIP_NAMES));
    autoFill(def, tier);
    // мирным кораблям — меньше оружия, больше трюма
    const keep = { trader: 1, colonist: 1, miner: 1, diplomat: 1, supply: 1 }[kind];
    if (keep != null) def.slots.weapon = def.slots.weapon.map((w, i) => (i < keep ? w : null));
    if (keep != null) def.slots.armor = def.slots.armor.map(() => null);
    return def;
  }

  spawn(kind, faction, sector, extra = {}) {
    const f = faction >= 0 && faction !== PIRATE ? this.factions[faction] : null;
    let tier = f ? f.tech : 2;
    if (kind === 'pirate') {
      const b = this.bases.find(x => x.id === extra.base);
      const avg = U.sum(this.factions, f => f.tech) / this.factions.length;
      // пираты вооружаются вслед за наёмниками, которые на них охотятся
      // когда пиратов почти перебили, базы нанимают ветеранов
      const few = [...this.agents.values()].filter(x => x.faction === PIRATE).length < 6 ? 0.7 : 0;
      const base = Math.max(avg - 0.5, this.pilotTierRef() - 0.4) + few;
      tier = U.clamp(Math.round(base + Math.min(1, (b ? b.wealth : 0) / 40000) + (Math.random() < 0.4 ? 1 : 0)), 1, 5);
      // первые недели — время освоиться: пираты ещё на простых кораблях
      if (this.day < 40) tier = Math.min(tier, Math.random() < 0.25 ? 2 : 1);
    }
    if (kind === 'pilot') tier = Math.random() < 0.6 ? 1 : 2;
    if (kind === 'warship') tier = Math.min(5, tier + (Math.random() < 0.3 ? 1 : 0));
    const def = extra.def || this.designShip(kind, faction, tier);
    const a = Object.assign({
      id: this.nextId++, kind, faction, def, name: def.name,
      hp: null, shield: null, credits: 0, cargo: {}, loot: 0,
      loc: sector, travel: null, dest: null, task: null, wait: 0, battle: null,
      born: this.day, kills: 0, rep: {}, member: FREE, personality: null, alive: true, ctrl: 'ai',
    }, extra);
    if (kind === 'pilot') {
      // имена наёмников не повторяются
      const used = new Set([...this.agents.values()].filter(x => x.kind === 'pilot').map(x => x.name));
      let nm = extra.name;
      for (let k = 0; !nm && k < 50; k++) { const c = `${U.pick(PILOT_FIRST)} ${U.pick(PILOT_LAST)}`; if (!used.has(c)) nm = c; }
      a.name = nm || `${U.pick(PILOT_FIRST)} ${U.pick(PILOT_LAST)} ${U.ri(2, 9)}`;
      a.def.name = a.name;
      a.credits = extra.credits != null ? extra.credits : 2500 + Math.floor(Math.random() * 3000);
      a.personality = a.personality || { trade: Math.random(), hunt: Math.random(), merc: Math.random(), loyal: Math.random(), greed: Math.random() };
      a.rep = {};
    }
    if (kind === 'pirate') a.name = `${U.pick(PIRATE_NAMES)}`;
    this.refresh(a);
    this.agents.set(a.id, a);
    return a;
  }

  refresh(a) {
    a.s = computeStats(a.def);
    a.maxHp = a.s.maxHp;
    if (a.hp == null || a.hp > a.maxHp) a.hp = a.maxHp;
    if (a.shield == null) a.shield = a.s.maxShield;
    a.cargoCap = Math.max(4, Math.round((a.s.cap - a.s.mass) * 1.5));
    a.speed = 70 + a.s.thrust * 32 + a.s.init * 2.5;
    a.price = defPrice(a.def);
  }
  // боевая сила: огневая мощь × живучесть
  strength(a) { return (U.sum(a.s.weapons, weaponDps) + 8) * Math.sqrt(Math.max(1, a.hp) + a.s.maxShield) / 10; }
  cargoValue(a, at) {
    let v = 0;
    for (const g in a.cargo) v += a.cargo[g] * (at ? at.price[g] : GOOD[g].base);
    return v;
  }
  cargoUsed(a) { return U.sum(Object.values(a.cargo)); }
  memberOf(a) { return a.faction >= 0 && a.faction !== PIRATE ? a.faction : a.faction === FREE ? a.member : FREE; }
  laneDays(a, L) { return Math.max(1, Math.ceil(L.len / a.speed)); }

  go(a, sector) { a.dest = sector; }

  // =====================================================
  //  Экономика планет
  // =====================================================
  target(p, g) {
    const T = PLANET_TYPES[p.type];
    const use = GOOD[g].use * p.pop * 0.5 + ((T.need && T.need[g]) || 0) * p.pop * 0.5;
    const prod = ((T.prod && T.prod[g]) || 0) * p.pop * 0.5;
    return Math.round((use + prod) * 10 + 25);
  }
  updatePrices() {
    for (const p of this.planets) {
      for (const g of GOODS) {
        const t = this.target(p, g.id);
        p.price[g.id] = Math.round(g.base * U.clamp(Math.pow(t / (p.stock[g.id] + t * 0.2), 0.45), 0.55, 2.1));
      }
    }
  }
  economy() {
    for (const p of this.planets) {
      if (p.pop <= 0) continue;
      const T = PLANET_TYPES[p.type];
      const k = p.pop * 0.5;
      // сырьё для производства
      let eff = 1;
      if (T.need) for (const g in T.need) {
        const need = T.need[g] * k;
        eff = Math.min(eff, need > 0 ? p.stock[g] / need : 1);
      }
      eff = U.clamp(eff, 0.2, 1) * (0.6 + p.stability * 0.4);
      if (T.need) for (const g in T.need) p.stock[g] = Math.max(0, p.stock[g] - T.need[g] * k * eff);
      for (const g in T.prod) p.stock[g] += T.prod[g] * k * eff;
      // потребление населения
      let sat = 0, wsum = 0;
      for (const g of GOODS) {
        if (!g.use) continue;
        const need = g.use * k;
        const got = Math.min(p.stock[g.id], need);
        p.stock[g.id] -= got;
        sat += (got / need) * g.use; wsum += g.use;
      }
      sat /= wsum;
      p.shortage = 1 - sat;
      const s = this.sectors[p.sector];
      p.stability = U.clamp(p.stability + (sat - 0.65) * 0.02 - s.heat * 0.004 + 0.003, 0.15, 1);
      p.pop = U.clamp(p.pop * (1 + (sat - 0.7) * 0.004), 0.3, 20);
      p.defense = Math.min(p.maxDefense = Math.round(300 + p.pop * 120), p.defense + 20);
      // излишки уходят внутренним рынкам — небольшая прибыль казне
      for (const g of GOODS) {
        const t = this.target(p, g.id);
        if (p.stock[g.id] > t * 3) {
          const ex = p.stock[g.id] - t * 3;
          p.stock[g.id] -= ex;
          if (p.owner >= 0) this.factions[p.owner].treasury += ex * g.base * 0.05;
        }
      }
    }
    for (const s of this.sectors) { s.heat *= 0.95; s.traffic *= 0.9; }
    this.updatePrices();
  }

  // =====================================================
  //  Фракции
  // =====================================================
  rel(a, b) {
    if (a === b) return 100;
    if (a === PIRATE || b === PIRATE) return -100;
    if (a < 0 || b < 0) return 0;
    return this.factions[a].rel[b];
  }
  atWar(a, b) { return a >= 0 && b >= 0 && a !== PIRATE && b !== PIRATE && a !== b && this.factions[a].wars.has(b); }
  changeRel(a, b, d) {
    if (a < 0 || b < 0 || a === PIRATE || b === PIRATE || a === b) return;
    const A = this.factions[a], B = this.factions[b];
    A.rel[b] = B.rel[a] = U.clamp(A.rel[b] + d, -100, 100);
  }
  declareWar(a, b, why) {
    const A = this.factions[a], B = this.factions[b];
    if (A.wars.has(b)) return;
    A.wars.add(b); B.wars.add(a);
    A.warSince[b] = B.warSince[a] = this.day;
    this.stats.wars++;
    this.log(`⚔ ${A.name} объявляет войну: ${B.name}${why ? ' — ' + why : ''}!`, 'war', { f: [a, b] });
  }
  makePeace(a, b) {
    const A = this.factions[a], B = this.factions[b];
    if (!A.wars.has(b)) return;
    A.wars.delete(b); B.wars.delete(a);
    A.rel[b] = B.rel[a] = Math.max(A.rel[b], -25);
    this.stats.peaces++;
    this.log(`🕊 Мир между ${A.short} и ${B.short}.`, 'peace', { f: [a, b] });
  }

  factionAI(f) {
    if (!f.alive) return;
    const planets = this.factionPlanets(f.idx);
    if (!planets.length) {
      f.alive = false;
      this.log(`☠ ${f.name} потеряла все планеты и распалась!`, 'war', { f: [f.idx] });
      for (const o of this.factions) if (o.wars.has(f.idx)) { o.wars.delete(f.idx); f.wars.delete(o.idx); }
      // флот распавшейся фракции расходится: корабли списываются, наёмники на службе свободны
      for (const a of [...this.agents.values()]) {
        if (a.faction === f.idx && !a.battle) { this.agents.delete(a.id); a.alive = false; }
        if (a.kind === 'pilot' && a.member === f.idx) a.member = FREE;
      }
      return;
    }
    // налоги
    const tax = U.sum(planets, p => p.pop * p.stability * 9) * (f.buffs && f.buffs.tax > this.day ? 1.15 : 1);
    f.treasury += tax; f.st.tax += tax;
    // содержание флота и жалованье пилотам на службе
    const mine = [...this.agents.values()].filter(a => a.faction === f.idx);
    f.treasury -= U.sum(mine, a => a.price * 0.0015);
    const members = [...this.agents.values()].filter(a => a.kind === 'pilot' && a.member === f.idx);
    // пустая казна: жалованье не платят, недовольство растёт
    if (f.treasury > 0) for (const m of members) { const pay = 30; f.treasury -= pay; m.credits += pay; }
    else for (const p of planets) p.stability = Math.max(0.15, p.stability - 0.004);
    // развитие технологий
    const techCost = 20000 * f.tech * f.tech;
    if (f.tech < 5 && f.treasury > techCost * 1.5 && this.r() < 0.03) {
      f.treasury -= techCost;
      f.tech++;
      this.log(`🔬 ${f.short}: новый технологический уровень ${U.roman(f.tech)}.`, 'tech', { f: [f.idx] });
    }
    // отношения дрейфуют к базовым; на войне — ухудшаются
    for (const o of this.factions) {
      if (o.idx === f.idx || !o.alive || o.idx < f.idx) continue;
      let r = f.rel[o.idx];
      r += (f.base[o.idx] - r) * 0.004;
      if (f.wars.has(o.idx)) r -= 0.25;
      // пограничные трения между воинственными соседями
      if (this.borders(f.idx, o.idx)) {
        r -= (f.war + o.war) * 0.08 * (0.5 + this.r());
        if (this.r() < 0.012 * (f.war + o.war)) {
          const d = 6 + this.r() * 12;
          r -= d;
          this.log(`⚠ Инцидент на границе ${f.short} и ${o.short}: отношения −${Math.round(d)} (${Math.round(r)}).`, 'diplo', { f: [f.idx, o.idx] });
        }
      }
      f.rel[o.idx] = o.rel[f.idx] = r;
      // война и мир
      const warlike = (f.war + o.war) / 2;
      if (!f.wars.has(o.idx) && r < -40 && this.r() < warlike * 0.04) this.declareWar(f.idx, o.idx, 'пограничные конфликты');
      else if (f.wars.has(o.idx)) {
        const len = this.day - (f.warSince[o.idx] || this.day);
        if ((r > -30 && this.r() < 0.1) || (len > 45 && this.r() < 0.02 * (1 - warlike))) this.makePeace(f.idx, o.idx);
      }
    }
    // развитие планет: богатая фракция вкладывается в рост населения и стабильность
    if (f.treasury > 40000) {
      const inv = f.treasury * 0.012;
      f.treasury -= inv;
      const p = planets.sort((a, b) => a.pop - b.pop)[0];
      p.pop = Math.min(20, p.pop + inv / 40000);
      p.stability = Math.min(1, p.stability + 0.01);
    }
    // строительство кораблей: по одному в день, по самой острой нехватке
    const count = k => mine.filter(a => a.kind === k).length;
    const sectors = this.factionSectors(f.idx);
    const wars = [...f.wars].filter(w => this.factions[w].alive);
    const needs = [
      ['trader', Math.round(planets.length * (0.5 + f.trade * 0.7)) - count('trader')],
      ['patrol', Math.max(1, Math.round(sectors.length * (0.4 + f.war * 0.5) + f.treasury / 60000)) - count('patrol')],
      ['diplomat', (this.r() < f.diplo * 0.08 ? 1 : 0) - count('diplomat')],
      ['warship', wars.length ? Math.round(2 + f.war * 4 + f.treasury / 40000) - count('warship') : 0],
      ['colonist', this.colonyTarget(f) && count('colonist') < 1 && this.r() < f.expand * 0.08 ? 1 : 0],
      ['miner', planets.some(p => p.type === 'indust') && this.sectors.some(s => s.asteroids && this.hops(s.id, f.capitalSector) <= 3) ? 1 - count('miner') : 0],
    ].filter(n => n[1] > 0).sort((a, b) => b[1] - a[1]);
    // карательная экспедиция против пиратов, если они сильно вредят
    if (f.st.recentPirateLoss > 4000 && count('warship') < 3 && this.r() < 0.25) needs.unshift(['warship', 1, 'punitive']);
    if (needs.length) {
      const [kind, , mode] = needs[0];
      const yard = planets.filter(p => p.shipyard).sort((a, b) => b.shipyard - a.shipyard)[0] || planets[0];
      const def = this.designShip(kind, f.idx, f.tech);
      const cost = defPrice(def) * 0.6;
      if (f.treasury > cost + 2500) {
        f.treasury -= cost;
        f.st.built++;
        const a = this.spawn(kind, f.idx, yard.sector, { def, home: yard.id });
        if (mode === 'punitive') { a.punitive = true; f.st.recentPirateLoss = 0; }
      }
    }
    f.st.recentPirateLoss = (f.st.recentPirateLoss || 0) * 0.97;
  }

  borders(a, b) {
    return this.sectors.some(s => s.owner === a && this.neighbors(s.id).some(t => this.sectors[t].owner === b));
  }

  colonyTarget(f) {
    return this.planets.find(p => p.pop <= 0 && p.owner === FREE &&
      (this.sectors[p.sector].owner === f.idx || (this.sectors[p.sector].owner === FREE && this.hops(p.sector, f.capitalSector) <= 3) ) &&
      !this.sectors[p.sector].base && ![...this.agents.values()].some(a => a.task && a.task.planet === p.id && a.kind === 'colonist'));
  }

  // =====================================================
  //  Решения агентов (когда корабль в секторе и достиг цели)
  // =====================================================
  friendlyPlanet(a, p) {
    if (p.pop <= 0) return false;
    const m = this.memberOf(a);
    if (a.faction === PIRATE) return false;
    if (p.owner === FREE) return true;
    if (a.kind === 'pilot' && (a.rep[p.owner] || 0) <= -50) return false; // разыскиваемых не пускают
    if (m >= 0 && this.atWar(m, p.owner)) return false;
    return this.rel(m, p.owner) > -60 || m === FREE;
  }

  think(a) {
    const T = a.task;
    // завершение текущей задачи
    if (T && T.sector === a.loc) {
      const done = this.arrive(a, T);
      if (!done) return;
      a.task = null;
    }
    if (a.task) { this.go(a, a.task.sector); return; }
    // выбор новой задачи
    switch (a.kind) {
      case 'trader': return this.planTrade(a, false);
      case 'diplomat': return this.planEmbassy(a);
      case 'patrol': return this.planPatrol(a);
      case 'warship': return this.planWar(a);
      case 'colonist': return this.planColony(a);
      case 'miner': return this.planMine(a);
      case 'pirate': return this.planPirate(a);
      case 'pilot': return this.planPilot(a);
      case 'supply': this.agents.delete(a.id); a.alive = false; return;
    }
  }

  // Действия по прибытии. Возвращает true, если задача завершена
  arrive(a, T) {
    const P = T.planet != null ? this.planets[T.planet] : null;
    switch (T.type) {
      case 'buy': {
        // в учёт прибыли идёт фактическая цена закупки
        const paid = P && P.pop > 0 ? this.buy(a, P, T.good, T.qty) : 0;
        a.task = { type: 'sell', sector: this.planets[T.to].sector, planet: T.to, good: T.good, cost: paid || T.cost || 0 };
        this.go(a, a.task.sector);
        return false;
      }
      case 'sell': {
        if (P && P.pop > 0 && this.friendlyPlanet(a, P)) {
          const gain = this.sellAll(a, P);
          const profit = gain - (T.cost || 0);
          if (a.faction >= 0 && a.faction !== PIRATE) {
            const f = this.factions[a.faction];
            // торговая пошлина с оборота и доля прибыли: торговля кормит казну, даже когда маржа съедена конкурентами
            f.treasury += gain * 0.2 + Math.max(0, profit) * 0.25; f.st.trade += Math.max(0, profit); f.st.missionsOk++;
            this.stats.tradeTotal += Math.max(0, profit);
          }
          if (profit > 2000) this.log(`◇ ${this.who(a)} доставил груз на ${P.name}: прибыль ${Math.round(profit)} кр.`, 'trade', { f: [a.faction], s: P.sector });
        } else a.cargo = {};
        return true;
      }
      case 'embassy': {
        const f = this.factions[a.faction], t = this.factions[T.to];
        if (t.alive) {
          const d = 8 + f.diplo * 10;
          this.changeRel(f.idx, t.idx, d);
          f.st.missionsOk++;
          this.log(`✉ Посольство ${f.short} прибыло к ${t.short}: отношения +${Math.round(d)} (${Math.round(f.rel[t.idx])}).`, 'diplo', { f: [f.idx, t.idx], s: a.loc });
          if (f.wars.has(t.idx) && f.rel[t.idx] > -40 && this.r() < 0.5) this.makePeace(f.idx, t.idx);
        }
        // дипломат возвращается домой и списывается
        a.task = { type: 'retire', sector: this.planets[f.capital] ? this.planets[f.capital].sector : a.loc };
        this.go(a, a.task.sector);
        return false;
      }
      case 'retire': { this.agents.delete(a.id); a.alive = false; return false; }
      case 'patrol': {
        if (T.days-- > 0) { a.wait = 1; return false; }
        return true;
      }
      case 'raid': {
        // осада планеты врага, если в секторе нет его кораблей
        const tp = this.planets.find(p => p.sector === a.loc && p.pop > 0 && this.atWar(a.faction, p.owner));
        if (tp) {
          const intel = this.factions[a.faction].intel && this.factions[a.faction].intel[tp.owner] > this.day ? 1.6 : 1;
          tp.defense -= this.strength(a) / 30 * intel;
          if (tp.defense <= 0) this.capture(tp, a.faction);
          else { a.wait = 1; return false; }
        }
        return true;
      }
      case 'assault': {
        const b = this.bases.find(x => x.id === T.base && x.alive);
        if (b && b.sector === a.loc) {
          const guards = this.present(a.loc).filter(o => o.faction === PIRATE);
          if (!guards.length) {
            b.defense -= this.siegeDamage(a); b.siegeDay = this.day;
            if (b.defense <= 0) this.destroyBase(b, a);
            else { a.wait = 1; return false; }
          } else { a.wait = 1; return false; }
        }
        return true;
      }
      case 'colonize': {
        if (P && P.pop <= 0 && P.owner === FREE) {
          P.pop = 0.6; P.owner = a.faction; P.stability = 0.7;
          for (const g of GOODS) P.stock[g.id] = this.target(P, g.id) * 0.5;
          const s = this.sectors[P.sector];
          if (s.owner === FREE && !s.base) s.owner = a.faction;
          this.factions[a.faction].st.missionsOk++;
          this.log(`⌂ ${this.factions[a.faction].short} основала колонию на ${P.name}.`, 'colony', { f: [a.faction], s: P.sector });
          this.agents.delete(a.id); a.alive = false;
        }
        return true;
      }
      case 'mine': {
        if (T.days-- > 0) {
          const space = a.cargoCap - this.cargoUsed(a);
          a.cargo.ore = (a.cargo.ore || 0) + Math.min(space, 6 + Math.random() * 6);
          a.wait = 1; return false;
        }
        const ind = this.factionPlanets(a.faction).filter(p => p.type === 'indust').sort((x, y) => this.hops(a.loc, x.sector) - this.hops(a.loc, y.sector))[0];
        if (ind) { a.task = { type: 'sell', sector: ind.sector, planet: ind.id, cost: 0 }; this.go(a, ind.sector); return false; }
        return true;
      }
      case 'hunt': {
        if (T.days-- > 0) { a.wait = 1; return false; }
        return true;
      }
      case 'home': {
        const b = this.bases.find(x => x.id === a.base);
        if (b && b.alive) {
          b.wealth += a.loot; b.loot += a.loot; this.stats.lootTotal += a.loot;
          if (a.loot > 1500) this.log(`☠ ${a.name} привёз на базу «${b.name}» добычу на ${Math.round(a.loot)} кр.`, 'pirate', { s: a.loc });
          a.loot = 0; a.cargo = {};
          a.hp = Math.min(a.maxHp, a.hp + a.maxHp * 0.5);
        }
        return true;
      }
      case 'courier': {
        if (P && this.friendlyPlanet(a, P)) {
          a.credits += T.reward;
          this.addRep(a, T.faction, 5);
          this.factions[T.faction].st.missionsOk++;
          this.log(`★ ${a.name} доставил груз для ${this.factions[T.faction].short}: +${T.reward} кр.`, 'pilot', { f: [T.faction], s: a.loc });
        }
        return true;
      }
      case 'goto': return true;
      case 'supply': return this.supplyArrive(a, T);
      case 'quest': return this.pilotQuestArrive(a, T);
      case 'questDock': {
        if (P) this.questOnDock(a, P);
        return true;
      }
    }
    return true;
  }

  buy(a, P, good, qty) {
    const n = Math.max(0, Math.min(qty, Math.floor(P.stock[good] * 0.6), Math.floor(a.cargoCap - this.cargoUsed(a))));
    qty = a.kind === 'pilot' ? this.affordable(P, good, n, a.credits) : n;
    if (qty <= 0) return 0;
    const cost = this.buyCost(P, good, qty);
    if (a.kind === 'pilot') a.credits -= cost;
    P.stock[good] -= qty;
    a.cargo[good] = (a.cargo[good] || 0) + qty;
    this.updatePlanetPrice(P);
    return cost;
  }
  sellAll(a, P) {
    let gain = 0;
    for (const g in a.cargo) if (a.cargo[g] > 0 && this.questOnDeliver) this.questOnDeliver(a, P, g, a.cargo[g]);
    for (const g in a.cargo) {
      const q = a.cargo[g];
      if (q <= 0 || !GOOD[g]) continue;
      gain += this.sellGain(P, g, q);
      P.stock[g] += q;
    }
    a.cargo = {};
    if (a.kind === 'pilot') a.credits += gain;
    this.updatePlanetPrice(P);
    return gain;
  }
  updatePlanetPrice(p) {
    for (const g of GOODS) p.price[g.id] = this.priceAt(p, g.id, p.stock[g.id]);
  }
  // цена единицы товара при данном запасе на складе
  priceAt(p, g, stock) {
    const t = this.target(p, g);
    return Math.round(GOOD[g].base * U.clamp(Math.pow(t / (Math.max(0, stock) + t * 0.2), 0.45), 0.55, 2.1));
  }
  // сделка поштучно: каждая купленная единица дорожает, каждая проданная дешевеет —
  // поэтому «купил и тут же продал» всегда в убыток
  buyCost(p, g, n) { let c = 0; for (let i = 0; i < n; i++) c += this.priceAt(p, g, p.stock[g] - i); return c; }
  sellGain(p, g, n) { let c = 0; for (let i = 0; i < n; i++) c += this.priceAt(p, g, p.stock[g] + i + 1) * 0.92; return c; }
  // сколько единиц можно купить на сумму
  affordable(p, g, n, money) { let c = 0, k = 0; while (k < n) { const u = this.priceAt(p, g, p.stock[g] - k); if (c + u > money) break; c += u; k++; } return k; }

  // лучший торговый маршрут из текущего сектора
  planTrade(a, pilot) {
    const here = this.planets.filter(p => p.sector === a.loc && this.friendlyPlanet(a, p));
    const origins = here.length ? here : this.planets.filter(p => p.pop > 0 && this.friendlyPlanet(a, p) && this.hops(a.loc, p.sector) <= 2);
    const space = a.cargoCap - this.cargoUsed(a);
    // осторожный пилот с хрупким кораблём обходит неспокойные сектора
    const danger = pilot ? Math.max(0, 0.5 - this.assess(a).combat) : 0;
    let best = null, bv = 0;
    // груз, который уже везут конкуренты: он собьёт цену к нашему прилёту
    if (this._pendDay !== this.day) {
      this._pend = {};
      for (const x of this.agents.values()) if (x.task && (x.task.type === 'sell' || x.task.type === 'buy') && x.task.to != null || (x.task && x.task.type === 'sell')) {
        const to = x.task.type === 'sell' ? x.task.planet : x.task.to, g = x.task.good, q = x.task.type === 'sell' ? (x.cargo[g] || 0) : x.task.qty || 0;
        if (to == null || !g) continue;
        const k = to + ':' + g; this._pend[k] = (this._pend[k] || 0) + q;
      }
      this._pendDay = this.day;
    }
    for (const o of origins) {
      for (const d of this.planets) {
        if (d === o || d.pop <= 0 || !this.friendlyPlanet(a, d)) continue;
        const h = this.hops(o.sector, d.sector);
        if (h > 5) continue;
        if (!pilot && a.faction >= 0 && d.owner !== a.faction && this.rel(a.faction, d.owner) < 0) continue;
        for (const g of GOODS) {
          const pend = this._pend[d.id + ':' + g.id] || 0;
          // фракционный торговец — это снабжение: возит и без наценки, лишь бы не в убыток
          const slack = pilot ? 0 : 0.08;
          if (this.priceAt(d, g.id, d.stock[g.id] + pend) * (0.92 + slack) <= o.price[g.id]) continue;
          // цены поштучные: берём столько, пока каждая следующая единица ещё приносит прибыль
          const lim = Math.min(space, Math.floor(o.stock[g.id] * 0.6));
          let qty = 0, profit = 0, spend = 0;
          while (qty < lim) {
            const buyU = this.priceAt(o, g.id, o.stock[g.id] - qty), sellU = this.priceAt(d, g.id, d.stock[g.id] + pend + qty + 1) * 0.92;
            if (sellU + buyU * slack <= buyU || (pilot && spend + buyU > a.credits)) break;
            profit += sellU - buyU; spend += buyU; qty++;
          }
          if (qty < 3 || (pilot ? profit < 150 : profit < -qty * 2)) continue;
          const days = 1 + this.hops(a.loc, o.sector) + h * 1.6;
          // доставка туда, где товара не хватает, ценна сама по себе
          const need = Math.max(0, 1 - (d.stock[g.id] + pend) / Math.max(1, this.target(d, g.id)));
          let v = (profit + (pilot ? 0 : need * qty * GOOD[g.id].base * 0.5)) / days;
          if (danger) v /= 1 + danger * (this.sectors[o.sector].heat + this.sectors[d.sector].heat);
          if (v > bv) { bv = v; best = { o, d, g: g.id, qty }; }
        }
      }
    }
    if (!best) {
      // нечего везти — перелететь в случайный дружественный сектор
      const n = this.rp(this.neighbors(a.loc));
      a.task = { type: 'goto', sector: n };
      this.go(a, n);
      return;
    }
    a.task = { type: 'buy', sector: best.o.sector, planet: best.o.id, to: best.d.id, good: best.g, qty: best.qty, cost: 0 };
    const pk = best.d.id + ':' + best.g; this._pend[pk] = (this._pend[pk] || 0) + best.qty;
    this.go(a, best.o.sector);
    this.sectors[best.o.sector].traffic += 1;
  }

  planEmbassy(a) {
    const f = this.factions[a.faction];
    const others = this.factions.filter(o => o.alive && o.idx !== f.idx && this.planets[o.capital]);
    if (!others.length) { this.agents.delete(a.id); return; }
    // к тем, с кем отношения хуже, но не безнадёжны
    const t = others.sort((x, y) => f.rel[x.idx] - f.rel[y.idx] + (Math.random() - 0.5) * 40)[0];
    a.task = { type: 'embassy', to: t.idx, sector: this.planets[t.capital].sector };
    this.go(a, a.task.sector);
  }

  planPatrol(a) {
    const own = this.factionSectors(a.faction);
    if (!own.length) return;
    // приоритет — сектора, где неспокойно
    const s = own.sort((x, y) => (y.heat + Math.random()) - (x.heat + Math.random()))[0];
    a.task = { type: 'patrol', sector: s.id, days: 1 + Math.floor(Math.random() * 3) };
    this.go(a, s.id);
  }

  planWar(a) {
    const f = this.factions[a.faction];
    if (a.punitive) {
      const b = this.bases.filter(x => x.alive).sort((x, y) => this.hops(a.loc, x.sector) - this.hops(a.loc, y.sector))[0];
      if (b) { a.task = { type: 'assault', base: b.id, sector: b.sector }; this.go(a, b.sector); return; }
      a.punitive = false;
    }
    const enemies = [...f.wars].filter(e => this.factions[e].alive);
    if (!enemies.length) { a.kind = 'patrol'; return this.planPatrol(a); }
    const targets = this.planets.filter(p => p.pop > 0 && enemies.includes(p.owner));
    if (!targets.length) return this.planPatrol(a);
    const t = targets.sort((x, y) => this.hops(a.loc, x.sector) + x.defense / 2000 - this.hops(a.loc, y.sector) - y.defense / 2000)[0];
    a.task = { type: 'raid', sector: t.sector, planet: t.id };
    this.go(a, t.sector);
  }

  planColony(a) {
    const p = this.colonyTarget(this.factions[a.faction]);
    if (!p) { this.agents.delete(a.id); a.alive = false; return; }
    a.task = { type: 'colonize', sector: p.sector, planet: p.id };
    this.go(a, p.sector);
  }

  planMine(a) {
    const s = this.sectors.filter(x => x.asteroids && !x.base).sort((x, y) => this.hops(a.loc, x.id) - this.hops(a.loc, y.id))[0];
    if (!s) return;
    a.task = { type: 'mine', sector: s.id, days: 3 + Math.floor(Math.random() * 3) };
    this.go(a, s.id);
  }

  planPirate(a) {
    if (a.guardian) { a.wait = 5; return; }
    if (a.escort) {
      const boss = this.agents.get(a.escort);
      if (boss && boss.alive) { const s = boss.loc != null ? boss.loc : boss.travel ? boss.travel.to : a.loc; a.task = { type: 'hunt', sector: s, days: 1 }; this.go(a, s); return; }
      a.escort = null;
    }
    if (a.boss && a.huntFaction != null && a.hp > a.maxHp * 0.4) {
      const secs = this.factionSectors(a.huntFaction);
      if (secs.length) { const s = U.pick(secs); a.task = { type: 'hunt', sector: s.id, days: 2 + Math.floor(Math.random() * 3) }; this.go(a, s.id); return; }
    }
    const b = this.bases.find(x => x.id === a.base && x.alive) || this.bases.find(x => x.alive);
    if (b) a.base = b.id;
    if ((a.loot > 0 || a.hp < a.maxHp * 0.5) && b) { a.task = { type: 'home', sector: b.sector }; this.go(a, b.sector); return; }
    // охотимся там, где много торговли и мало патрулей
    const from = b ? b.sector : a.loc;
    const cands = this.sectors.filter(s => this.hops(from, s.id) <= 4);
    const score = s => (s.traffic + 0.5) / (1 + this.present(s.id).filter(o => o.kind === 'patrol' || o.kind === 'warship').length * 2) * (0.6 + Math.random() * 0.8);
    const s = cands.sort((x, y) => score(y) - score(x))[0];
    a.task = { type: 'hunt', sector: s.id, days: 2 + Math.floor(Math.random() * 4) };
    this.go(a, s.id);
  }

  addRep(a, f, d) {
    if (a.kind !== 'pilot' || f < 0 || f === PIRATE) return;
    const before = a.rep[f] || 0;
    a.rep[f] = U.clamp(before + d, -100, 100);
    if (this.repCrossed) this.repCrossed(a, f, before, a.rep[f]);
    // предложение поступить на службу
    if (a.member === FREE && a.rep[f] >= 40 && a.personality.loyal > 0.45 && Math.random() < 0.15 && a.ctrl !== 'human') {
      a.member = f;
      this.log(`⚑ Пилот ${a.name} поступил на службу: ${this.factions[f].name}.`, 'pilot', { f: [f] });
    }
  }

  // ИИ-пилот: такой же наёмник, как игрок
  // трезвая оценка пилотом самого себя: сила относительно типичной угрозы и кошелёк
  // типичная угроза: сила пирата на 60-м перцентиле (пересчёт раз в день)
  threatRef() {
    if (this._thrDay !== this.day) {
      const pir = [...this.agents.values()].filter(x => x.faction === PIRATE && x.s).map(x => this.strength(x)).sort((x, y) => x - y);
      this._thr = pir.length ? pir[Math.floor(pir.length * 0.6)] : 200;
      this._thrDay = this.day;
    }
    return this._thr;
  }
  assess(a) {
    this.threatRef();
    const P = a.personality || { hunt: 0.5 };
    const hpF = (a.hp || 0) / Math.max(1, a.maxHp);
    const power = this.strength(a) / this._thr;
    // осторожность: смелые лезут в драку при меньшем перевесе
    const caution = 1.25 - P.hunt * 0.4;
    const combat = Math.max(0.03, Math.min(1.6, (power / caution - 0.6) / 0.6)) * (hpF < 0.6 ? hpF : 1);
    return { power, hpF, combat, weak: combat < 0.35, strong: combat > 1, broke: a.credits < 700, poor: a.credits < 2500, rich: a.credits > 15000, caution };
  }
  planPilot(a) {
    const here = this.planets.filter(p => p.sector === a.loc && this.friendlyPlanet(a, p));
    const dock = here.sort((x, y) => y.shipyard - x.shipyard)[0];
    // у дружественной планеты: продать подобранный груз, ремонт, а на верфи — закупка модулей или новый корпус
    if (dock && this.cargoUsed(a) > 0) this.sellAll(a, dock);
    if (dock) this.pilotOutfit(a, dock);
    const A = this.assess(a);
    // побитый корабль — сначала в ремонт (слабые и осторожные чинятся раньше)
    if (A.hpF < (A.weak ? 0.7 : 0.45)) {
      const p = this.planets.filter(x => this.friendlyPlanet(a, x)).sort((x, y) => this.hops(a.loc, x.sector) - this.hops(a.loc, y.sector))[0];
      if (p && p.sector !== a.loc) { a.intent = 'ремонт'; a.task = { type: 'goto', sector: p.sector }; this.go(a, p.sector); return; }
    }
    // есть деньги на улучшения — лететь на верфь, где продают модули получше
    const yard = this.pilotWantsYard(a, dock);
    if (yard && Math.random() < (A.weak ? 0.8 : 0.5)) {
      a.intent = 'на верфь'; a.task = { type: 'goto', sector: yard.sector }; this.go(a, yard.sector); return;
    }
    const P = a.personality;
    const m = a.member;
    const cf = A.combat;
    // бедному важнее заработок, богатому — слава и репутация
    const money = A.broke ? 2.4 : A.poor ? 1.7 : A.rich ? 0.6 : 1;
    const opts = [];
    if (m >= 0 && this.factions[m].wars.size) opts.push(['war', (0.6 + P.loyal) * cf * (A.rich ? 1.3 : 1)]);
    if (m >= 0) opts.push(['patrol', (0.3 + P.loyal * 0.5) * Math.min(1.2, cf * 1.5)]);
    // торговля нужна трюм и хоть немного денег на закупку
    opts.push(['trade', (0.2 + P.trade * (a.cargoCap > 10 ? 1.2 : 0.3)) * (A.broke ? 0.5 : money) * (A.weak ? 1.4 : 1)]);
    opts.push(['hunt', (0.1 + P.hunt * (a.s.weapons.length ? 1 : 0)) * cf]);
    opts.push(['courier', (0.2 + P.merc) * money * (A.weak ? 1.3 : 1)]);
    const bw = this.banditWeight ? this.banditWeight(a, A) : 0;
    if (bw > 0) opts.push(['rob', bw]);
    const q = this.pilotPickQuest ? this.pilotPickQuest(a, A) : null;
    if (q) opts.push(['quest', (0.5 + P.merc * 0.8 + P.hunt * 0.4) * (A.poor ? 1.3 : 1)]);
    const choice = opts[U.weighted(opts.map(o => o[1]))][0];
    a.intent = { war: 'война', patrol: 'патруль', trade: 'торговля', hunt: 'охота на пиратов', courier: 'курьер', quest: 'поручение' }[choice];
    if (choice === 'quest' && this.pilotDoQuest(a, q)) return;
    if (choice === 'rob') return this.planRobbery(a);
    if (choice === 'trade') return this.planTrade(a, true);
    if (choice === 'war') {
      const enemies = [...this.factions[m].wars];
      const ts = this.sectors.filter(s => enemies.includes(s.owner)).sort((x, y) => this.hops(a.loc, x.id) - this.hops(a.loc, y.id));
      if (ts.length) { a.task = { type: 'hunt', sector: ts[0].id, days: 2 }; this.go(a, ts[0].id); return; }
    }
    if (choice === 'patrol' && m >= 0) {
      // слабый патрулирует спокойные свои сектора, сильный — горячие
      const own = this.factionSectors(m).sort((x, y) => A.weak ? x.heat - y.heat : y.heat - x.heat);
      if (own.length) { a.task = { type: 'hunt', sector: own[0].id, days: 2 }; this.go(a, own[0].id); return; }
    }
    if (choice === 'hunt') {
      // туда, где пираты были замечены — но не туда, где их больше, чем по силам
      const ok = this.sectors.filter(x => this.hops(a.loc, x.id) <= 4 && this.pirateForce(x.id) < this.strength(a) * 0.9 / A.caution);
      const s = (ok.length ? ok : [this.sectors[a.loc]]).sort((x, y) => (y.heat + Math.random()) - (x.heat + Math.random()))[0];
      a.task = { type: 'hunt', sector: s.id, days: 2 + Math.floor(Math.random() * 3) };
      this.go(a, s.id);
      return;
    }
    a.intent = 'курьер';
    // курьерское задание фракции, которой принадлежит планета (слабые обходят пиратские сектора)
    const src = dock || this.rp(this.planets.filter(p => p.owner >= 0 && p.pop > 0));
    const fac = src.owner >= 0 ? src.owner : this.rp(this.factions.filter(f => f.alive)).idx;
    let dests = this.planets.filter(p => p.pop > 0 && p.owner === fac && p.id !== src.id && this.hops(a.loc, p.sector) >= 1 && this.hops(a.loc, p.sector) <= 5);
    if (A.weak) { const safe = dests.filter(p => this.sectors[p.sector].heat < 2); if (safe.length) dests = safe; }
    if (!dests.length) { a.intent = 'торговля'; return this.planTrade(a, true); }
    const d = this.rp(dests);
    const h = this.hops(a.loc, d.sector);
    a.task = { type: 'courier', sector: d.sector, planet: d.id, faction: fac, reward: Math.round(500 + h * 380 + this.sectors[d.sector].heat * 80) }; // как курьерские задания игрока
    this.go(a, d.sector);
  }
  // суммарная сила пиратов в секторе
  pirateForce(sid) { return U.sum(this.present(sid).filter(x => x.faction === PIRATE), x => this.strength(x)); }

  capture(p, fi) {
    const old = p.owner;
    p.owner = fi; p.defense = p.maxDefense * 0.3; p.stability = 0.4; p.pop *= 0.85;
    this.stats.captured++;
    this.factions[fi].st.captured++;
    if (old >= 0) this.factions[old].st.lostPlanets++;
    const s = this.sectors[p.sector];
    const owners = s.planets.map(id => this.planets[id]).filter(x => x.pop > 0).map(x => x.owner);
    if (owners.length && owners.every(o => o === fi)) s.owner = fi;
    if (old >= 0 && this.factions[old].capital === p.id) {
      const rest = this.factionPlanets(old);
      this.factions[old].capital = rest.length ? rest.sort((a, b) => b.pop - a.pop)[0].id : null;
      if (rest.length) this.factions[old].capitalSector = this.planets[this.factions[old].capital].sector;
    }
    this.log(`🏴 ${this.factions[fi].short} захватила планету ${p.name}${old >= 0 ? ' у ' + this.factions[old].short : ''}!`, 'war', { f: [fi, old], s: p.sector });
  }

  // урон по станции за день осады: даже лёгкий корабль что-то да пробьёт
  siegeDamage(a) { return Math.max(60, this.strength(a) / 12); }
  destroyBase(b, by) {
    if (!b.alive) return;
    b.alive = false;
    if (this.questOnBaseDestroyed) this.questOnBaseDestroyed(b, by);
    this.sectors[b.sector].base = null;
    const f = by.faction >= 0 && by.faction !== PIRATE ? this.factions[by.faction] : null;
    if (f) { f.treasury += b.wealth * 0.5; f.st.pirateKills += 3; }
    this.log(`💥 Пиратская база «${b.name}» уничтожена${f ? ' силами ' + f.short : ''}!`, 'war', { s: b.sector });
    for (const a of this.agents.values()) if (a.base === b.id) a.base = null;
    this.baseRespawn = this.day + 15 + Math.floor(Math.random() * 15);
  }

  pirateAI() {
    for (const b of this.bases) {
      if (!b.alive) continue;
      b.wealth += 160; // дань с окрестностей, контрабанда
      // богатая база тратится на укрепления и вербовку
      if (b.wealth > 20000) { const sp = b.wealth * 0.03; b.wealth -= sp; b.fort = Math.min(5000, (b.fort || 0) + sp * 0.3); }
      b.maxDefense = 2500 + (b.fort || 0);
      // в осаде станцию не чинят
      if (!(b.siegeDay >= this.day - 1)) b.defense = Math.min(b.maxDefense, b.defense + 25);
      const mine = [...this.agents.values()].filter(a => a.faction === PIRATE && a.base === b.id);
      const cap = 3 + Math.floor(b.wealth / 3000);
      const starving = mine.length < 3 && this.r() < 0.6; // база всегда может набрать хотя бы пару кораблей
      // поредевшая банда вербует охотнее
      if (starving || (mine.length < Math.min(cap, 8) && b.wealth > 1000 && this.r() < (mine.length < 4 ? 0.9 : 0.45))) {
        const a = this.spawn('pirate', PIRATE, b.sector, { base: b.id });
        if (!starving) b.wealth = Math.max(0, b.wealth - a.price * 0.2);
      }
    }
    // пока баз меньше нормы, на месте разгромленной со временем появляется новая
    const want = Math.max(2, Math.round(this.nSectors / 10));
    if (!this.baseRespawn && this.bases.filter(b => b.alive).length < want) this.baseRespawn = this.day + 15 + Math.floor(Math.random() * 15);
    if (this.baseRespawn && this.day >= this.baseRespawn && this.bases.filter(b => b.alive).length < want) {
      const b = this.newBase();
      this.baseRespawn = null;
      this.log(`☠ Пираты основали новую базу «${b.name}» в секторе ${this.sectors[b.sector].name}.`, 'pirate', { s: b.sector });
      for (let i = 0; i < 3; i++) this.spawn('pirate', PIRATE, b.sector, { base: b.id });
    }
  }

  // =====================================================
  //  Встречи и бои
  // =====================================================
  present(sid) {
    const out = [];
    for (const a of this.agents.values()) if (a.alive && a.loc === sid && !a.travel) out.push(a);
    return out;
  }
  hostile(a, b) {
    if (a.faction === PIRATE) return b.faction !== PIRATE;
    if (b.faction === PIRATE) return true;
    // охотник за головой и его цель
    if ((a.bountyOn != null && a.bountyOn === b.id) || (b.bountyOn != null && b.bountyOn === a.id)) return true;
    // пилот с очень плохой репутацией у фракции — её враг
    if (a.kind === 'pilot' && b.faction >= 0 && (a.rep[b.faction] || 0) <= -50) return true;
    if (b.kind === 'pilot' && a.faction >= 0 && (b.rep[a.faction] || 0) <= -50) return true;
    const fa = this.memberOf(a), fb = this.memberOf(b);
    if (fa >= 0 && fb >= 0) return this.atWar(fa, fb);
    return false;
  }
  // хочет ли A сам напасть на B
  // сила группы: корабль и союзники в том же секторе, которые вступят на его сторону
  team(X, here) {
    return here.filter(N => N === X || (!N.battle && N.faction === X.faction && N.faction !== FREE && !NONCOMBAT.includes(N.kind)));
  }
  wantsAttack(A, B, here) {
    const rob = this.isRobbery && this.isRobbery(A, B);
    if ((!this.hostile(A, B) && !rob) || A.battle || B.battle) return false;
    if (NONCOMBAT.includes(A.kind)) return false;
    const sum = list => U.sum(list, x => this.strength(x));
    const ratio = here ? sum(this.team(A, here)) / Math.max(1, sum(this.team(B, here))) : this.strength(A) / Math.max(1, this.strength(B));
    switch (A.kind) {
      case 'pirate': {
        if (A.loot > 0 && Math.random() > 0.1) return false; // с добычей — домой, а не в новый бой
        const juicy = NONCOMBAT.includes(B.kind) || (B.kind === 'pilot' && (this.cargoValue(B) > 1500 || B.credits > 8000));
        const safe = B.faction >= 0 && B.faction !== PIRATE && this.factions[B.faction].buffs && this.factions[B.faction].buffs.convoy > this.day;
        if (safe && Math.random() < 0.6) return false;
        return ratio > (juicy ? 0.7 : 1.4) && Math.random() < (juicy ? 0.65 : 0.25);
      }
      case 'patrol': return ratio > 0.8 && Math.random() < (B.faction === PIRATE ? 0.7 : 0.5);
      case 'warship': return ratio > 0.45 && Math.random() < 0.9;
      case 'pilot': {
        if (A.ctrl === 'human') return false;
        // не лезет в драку побитым или с ценным грузом, требует перевеса с учётом своей осторожности
        const me = this.assess(A);
        if (me.hpF < 0.5) return false;
        if (rob) return ratio > me.caution * 1.3 && Math.random() < 0.6;
        // бой «три в ряд» непредсказуем: нужен ощутимый перевес, а не равенство
        const need = me.caution * 1.5 * (this.cargoValue(A) > 2000 ? 1.5 : 1);
        if (B.faction === PIRATE) return ratio > need && Math.random() < 0.35 + A.personality.hunt * 0.5;
        return ratio > need * 1.1 && Math.random() < 0.4;
      }
    }
    return false;
  }
  // на чьей стороне корабль вступит в идущий бой (-1 — не вступает)
  joinSide(N, wb) {
    if (N.battle || NONCOMBAT.includes(N.kind) || N.ctrl === 'human') return -1;
    const sides = [0, 1].map(s => wb.b.ships.filter(sh => sh.alive && sh.side === s).map(sh => this.agents.get(sh.ref)).filter(Boolean));
    for (let s = 0; s < 2; s++) {
      const allies = sides[s], foes = sides[1 - s];
      if (!foes.length) continue;
      const helpsAlly = allies.some(x => !this.hostile(N, x) && (x.faction === N.faction && N.faction !== FREE || this.memberOf(x) === this.memberOf(N) && this.memberOf(N) >= 0));
      const hatesFoe = foes.some(x => this.hostile(N, x));
      if (!hatesFoe || allies.some(x => this.hostile(N, x))) continue;
      if (N.kind === 'pirate') return Math.random() < 0.8 ? s : -1;
      if (N.kind === 'pilot') {
        // вступает, только если с его помощью бой выигрываем
        const me = this.assess(N);
        const st = list => U.sum(list, x => this.strength(x));
        if (me.hpF < 0.5 || (st(allies) + this.strength(N)) < st(foes) * me.caution * 1.3) continue;
        const vsPirates = foes.some(x => x.faction === PIRATE);
        if (vsPirates && Math.random() < 0.3 + N.personality.hunt * 0.6) return s;
        if (helpsAlly && Math.random() < 0.5 + N.personality.loyal * 0.4) return s;
        continue;
      }
      if (N.kind === 'patrol' || N.kind === 'warship') return Math.random() < 0.9 ? s : -1;
      if (helpsAlly) return s;
    }
    return -1;
  }

  entry(a) { return { def: a.def, name: a.faction === PIRATE ? a.name : a.kind === 'pilot' ? a.name : a.def.name, hp: a.hp, shield: a.shield, ref: a.id, ctrl: a.ctrl === 'human' ? 'human' : 'ai', diff: 'normal' }; }

  startBattle(sid, sideA, sideB) {
    // сторона игрока — всегда «синие»
    if (sideB.some(a => a.ctrl === 'human')) [sideA, sideB] = [sideB, sideA];
    const b = new Battle({ fleets: [{ ctrl: 'ai', ships: sideA.map(a => this.entry(a)) }, { ctrl: 'ai', ships: sideB.map(a => this.entry(a)) }], maxRounds: 45 });
    const wb = { id: this.nextId++, sector: sid, b, day: this.day, title: `${this.who(sideA[0])} против ${this.who(sideB[0])}` };
    const all = sideA.concat(sideB).filter(a => a.sx != null);
    wb.sx = all.length ? U.sum(all, a => a.sx) / all.length : 0;
    wb.sy = all.length ? U.sum(all, a => a.sy) / all.length : 0;
    for (const a of sideA.concat(sideB)) a.chase = null;
    for (const a of [...sideA, ...sideB]) { a.battle = wb.id; a.wait = 0; }
    this.battles.push(wb);
    this.stats.battles++;
    this.sectors[sid].heat += sideA.concat(sideB).some(a => a.faction === PIRATE) ? 2 : 1;
    const big = sideA.length + sideB.length > 3;
    if (big || sideA.concat(sideB).some(a => a.kind === 'pilot' || a.kind === 'diplomat' || a.kind === 'warship'))
      this.log(`⚔ Бой в секторе ${this.sectors[sid].name}: ${wb.title}.`, 'battle', { s: sid });
    return wb;
  }

  encounters() {
    for (const s of this.sectors) {
      const here = this.present(s.id).filter(a => a.docked == null);
      if (here.length < 1) continue;
      // подкрепления в идущие бои
      for (const wb of this.battles.filter(x => x.sector === s.id && !x.b.over)) {
        for (const N of here) {
          if (N.battle) continue;
          const side = this.joinSide(N, wb);
          if (side >= 0) {
            wb.b.addShip(this.entry(N), side);
            N.battle = wb.id;
            if (N.kind === 'pilot' || N.kind === 'warship' || wb.b.ships.length >= 5)
              this.log(`⚑ ${this.who(N)} вступает в бой в секторе ${s.name}.`, 'battle', { s: s.id });
          }
        }
      }
      // новые нападения
      for (const A of U.shuffle(here.slice())) {
        if (A.battle || A.chase) continue;
        const targets = here.filter(B => B !== A && !B.battle && this.wantsAttack(A, B, here));
        if (!targets.length) continue;
        const B = targets.sort((x, y) => this.cargoValue(y) - this.cargoValue(x))[0];
        // пилот, которому бой не по силам, пытается уйти на форсаже
        const gang = U.sum(here.filter(x => x.faction === A.faction && !x.battle && (x === A || !this.hostile(x, A))), x => this.strength(x));
        if (B.kind === 'pilot' && B.ctrl !== 'human' && gang > this.strength(B) * 0.8) {
          const p = U.clamp(0.35 + (B.speed - A.speed) / 120 + B.personality.trade * 0.1, 0.15, 0.85);
          if (Math.random() < p) {
            const pl = this.planets.find(x => x.sector === s.id && x.pop > 0 && this.friendlyPlanet(B, x));
            if (pl) { B.docked = pl.id; B.hide = 1; B.intent = 'ушёл от погони'; }
            else if (B.dest == null || B.dest === s.id) { B.dest = this.rp(this.neighbors(s.id)); }
            if (Math.random() < 0.3) this.log(`↯ ${this.who(B)} ушёл от ${this.who(A)} в секторе ${s.name}.`, 'pilot', { s: s.id });
            continue;
          }
        }
        // на игрока сначала заходят на перехват — бой начнётся, когда догонят
        if (B.ctrl === 'human') { if (!A.chase) { A.chase = B.id; this.log(`⚠ ${this.who(A)} идёт на перехват!`, 'player', { s: s.id }); } continue; }
        // кто ещё в секторе поддержит каждую сторону
        const sideA = [A], sideB = [B];
        const robbery = this.isRobbery && this.isRobbery(A, B) && !this.hostile(A, B);
        if (robbery) this.onRobbery(A, B, s.id);
        for (const N of here) {
          if (N === A || N === B || N.battle || N.ctrl === 'human') continue;
          if (!this.hostile(N, A) && this.hostile(N, B) && !NONCOMBAT.includes(N.kind) && (N.faction === A.faction || (A.faction === PIRATE && N.faction === PIRATE))) sideA.push(N);
          else if (!this.hostile(N, B) && this.hostile(N, A) && (N.faction === B.faction && N.faction !== FREE)) sideB.push(N);
          // на разбой своих кораблей патрули и военные отвечают сразу
          else if (robbery && N.faction === B.faction && (N.kind === 'patrol' || N.kind === 'warship')) sideB.push(N);
        }
        this.startBattle(s.id, sideA, sideB);
      }
    }
  }

  async battlesStep() {
    const prev = Clock.instant;
    Clock.instant = true;
    for (const wb of this.battles) {
      if (wb.b.over) continue;
      const dt = wb.b.roundLen * BATTLE_ROUNDS_PER_DAY;
      const human = wb.b.ships.some(sh => sh.alive && sh.ctrl === 'human');
      if (human && this.hooks && this.hooks.liveBattle) {
        // бой игрока проходит на экране боя: игрок сам собирает блоки
        Clock.instant = false;
        await this.hooks.liveBattle(wb, dt);
        Clock.instant = true;
      } else {
        if (human) wb.b.ships.forEach(sh => { if (sh.ctrl === 'human') sh.ctrl = 'ai'; });
        await wb.b.advance(dt);
      }
      this.syncBattle(wb);
      if (!wb.b.over) this.retreats(wb);
    }
    Clock.instant = prev;
    for (const wb of this.battles) if (wb.b.over && !wb.closed) this.closeBattle(wb);
    this.battles = this.battles.filter(wb => !wb.closed);
  }

  // перенос повреждений и потерь из боя в мир
  syncBattle(wb) {
    for (const sh of wb.b.ships) {
      const a = this.agents.get(sh.ref);
      // уже учтённый корабль (погиб, ушёл) не трогаем: у пилота после катапультирования тот же номер, но новый корабль
      if (!a || !a.alive || sh.synced) continue;
      a.hp = sh.hp; a.shield = sh.shield;
      if (!sh.alive && !sh.fled && !sh.synced) {
        sh.synced = true;
        const killer = sh.killer ? this.agents.get(sh.killer.ref) : null;
        this.destroyed(a, killer, wb);
      } else if (sh.fled && !sh.synced) {
        sh.synced = true;
        a.battle = null;
        this.wearBattle(a, sh);
      }
    }
  }

  // мирные корабли пытаются уйти из боя
  retreats(wb) {
    for (const sh of wb.b.ships) {
      if (!sh.alive) continue;
      const a = this.agents.get(sh.ref);
      if (!a || a.ctrl === 'human') continue;
      const frac = sh.hp / sh.s.maxHp;
      let p = 0;
      if (NONCOMBAT.includes(a.kind)) p = 0.25 + sh.s.thrust * 0.08;
      else if (frac < 0.25) p = a.kind === 'pirate' ? 0.5 : 0.35;
      else if (a.kind === 'pilot') {
        // наёмник не умирает за чужое дело: проигрываем — уходим, а при явном перевесе врага — сразу
        const side = s => U.sum(wb.b.ships.filter(x => x.alive && x.side === s), x => this.strength(this.agents.get(x.ref) || a));
        const r = side(sh.side) / Math.max(1, side(1 - sh.side));
        if (r < 0.5) p = 0.5;
        else if (frac < 0.5 && r < 0.7) p = 0.4;
      }
      if (p && Math.random() < p) {
        wb.b.retreat(sh);
        a.battle = null;
        a.hp = sh.hp;
        sh.synced = true;
        this.wearBattle(a, sh);
        // уходит в соседний сектор
        const n = this.rp(this.neighbors(wb.sector));
        a.travel = { from: wb.sector, to: n, left: this.laneDays(a, this.laneBetween(wb.sector, n)), total: 1 };
        a.travel.total = a.travel.left;
        a.loc = null;
        if (a.kind === 'pirate') a.task = null;
      }
    }
  }

  closeBattle(wb) {
    wb.closed = true;
    this.syncBattle(wb);
    const survivors = wb.b.ships.filter(sh => sh.alive).map(sh => this.agents.get(sh.ref)).filter(Boolean);
    for (const sh of wb.b.ships) if (sh.alive) this.wearBattle(this.agents.get(sh.ref), sh);
    // сильно подбитые теряют часть груза и модулей
    for (const a of survivors) if (this.makeDrop && a.hp < a.maxHp * 0.3) this.makeDrop(a, wb.sector, a.sx != null ? a.sx : wb.sx, a.sy != null ? a.sy : wb.sy, DROP_HURT_K, true);
    for (const a of survivors) {
      a.battle = null; a.wait = 1;
      if (a.faction === PIRATE && a.loot > 0) { a.task = null; a.wait = 0; } // с добычей — сразу на базу
    }
    for (const sh of wb.b.ships) { const a = this.agents.get(sh.ref); if (a && a.battle === wb.id) a.battle = null; }
  }

  destroyed(a, killer, wb) {
    a.alive = false;
    this.agents.delete(a.id);
    this.stats.destroyed++;
    const sec = this.sectors[a.loc != null ? a.loc : wb.sector];
    // обломки: часть груза и модулей уцелела
    if (this.makeDrop) this.makeDrop(a, sec.id, a.sx != null ? a.sx : wb ? wb.sx : 0, a.sy != null ? a.sy : wb ? wb.sy : 0);
    // бандит, убивший мирный корабль, окончательно портит отношения
    if (killer && killer.kind === 'pilot' && a.faction >= 0 && a.faction !== PIRATE && !this.hostile(killer, a)) this.addRepRaw(killer, a.faction, -10);
    const byPirate = killer && killer.faction === PIRATE;
    const value = a.price + this.cargoValue(a);
    if (a.faction >= 0 && a.faction !== PIRATE) {
      const f = this.factions[a.faction];
      f.st.lost++; f.st.lostValue += value;
      if (NONCOMBAT.includes(a.kind)) f.st.missionsFail++;
      if (byPirate) {
        f.st.lostToPirates++;
        f.st.recentPirateLoss = (f.st.recentPirateLoss || 0) + value;
        for (const pid of sec.planets) { const p = this.planets[pid]; if (p.owner === a.faction) p.stability = Math.max(0.15, p.stability - 0.04); }
      }
      if (a.kind === 'diplomat') {
        const T = a.task;
        if (T && T.to != null) this.changeRel(a.faction, T.to, byPirate ? -4 : 0);
        const kf = killer ? this.memberOf(killer) : FREE;
        if (kf >= 0) this.changeRel(a.faction, kf, -25);
        this.log(`✉ Посольство ${f.short} уничтожено${killer ? ' (' + this.who(killer) + ')' : ''} — переговоры сорваны!`, 'diplo', { f: [a.faction], s: sec.id });
      } else if (a.kind === 'trader' && byPirate) {
        this.log(`☠ Пираты (${killer.name}) разграбили караван ${f.short} в секторе ${sec.name}: потери ${Math.round(value)} кр.`, 'pirate', { f: [a.faction], s: sec.id });
      } else if (a.kind === 'colonist') {
        this.log(`⌂ Колонисты ${f.short} погибли в секторе ${sec.name}.`, 'pirate', { f: [a.faction], s: sec.id });
      }
    }
    if (this.questOnKill) this.questOnKill(a, killer);
    if (killer) {
      killer.kills++;
      if (killer.ctrl === 'human' && this.onPlayerKill) this.onPlayerKill(a);
      if (killer.faction === PIRATE) killer.loot += this.cargoValue(a) * 0.35 + a.price * 0.1 + (a.kind === 'pilot' ? a.credits * 0.3 : 0); // остальной груз — в обломках
      if (a.faction === PIRATE) {
        this.stats.pirateKills++;
        const kf = this.memberOf(killer);
        if (kf >= 0) this.factions[kf].st.pirateKills++;
        if (killer.kind === 'pilot') {
          const bounty = Math.round(300 + a.price * 0.2);
          killer.credits += bounty;
          if (sec.owner >= 0) { this.addRep(killer, sec.owner, 4); this.factions[sec.owner].treasury -= bounty * 0.5; }
          this.log(`★ ${killer.name} уничтожил пирата ${a.name}: награда ${bounty} кр.`, 'pilot', { s: sec.id });
        }
      } else if (killer.kind === 'pilot' && killer.member >= 0 && a.faction >= 0) {
        this.addRep(killer, killer.member, 6);
        killer.credits += Math.round(a.price * 0.08);
      } else if (killer.kind === 'pilot' && a.kind === 'pilot' && !this.hostile(killer, a)) {
        // убийство мирного наёмника — преступление: его друзья и наниматель этого не простят
        killer.banditry = (killer.banditry || 0) + 1;
        if (a.member >= 0) this.addRepRaw(killer, a.member, -20);
        for (const f in a.rep) if (a.rep[f] > 20 && +f !== a.member) this.addRepRaw(killer, +f, -6);
      }
    }
    if (a.kind === 'pilot') {
      // как в «Рейнджерах»: пилот катапультируется и начинает заново
      const home = this.planets.filter(p => p.pop > 0 && this.friendlyPlanet(a, p)).sort((x, y) => this.hops(sec.id, x.sector) - this.hops(sec.id, y.sector))[0];
      // страховка возмещает пятую часть стоимости корабля — но не чаще раза в 30 дней
      const insured = a.lastLoss == null || this.day - a.lastLoss >= 30;
      const insurance = insured ? Math.round(this.shopPrice({ price: a.price }) * 0.2) : 0;
      const credits = Math.round(a.credits * 0.6) + insurance;
      this.log(`★ Пилот ${a.name} потерял корабль в секторе ${sec.name} и катапультировался.`, 'pilot', { s: sec.id });
      if (home) {
        const np = this.spawn('pilot', FREE, home.sector, { name: a.name, credits: credits + (a.ctrl === 'human' ? 0 : 800), lastLoss: this.day, banditry: a.banditry, personality: a.personality, rep: a.rep, member: a.member, kills: a.kills, ctrl: a.ctrl, stash: a.stash, stashW: a.stashW, honors: a.honors, merit: a.merit, deaths: (a.deaths || 0) + 1 });
        // тот же пилот: сохраняем его номер (задания, репутация, награды)
        this.agents.delete(np.id); np.id = a.id; this.agents.set(np.id, np);
        np.rep = a.rep;
        if (a.ctrl === 'human') {
          this.player = np;
          np.docked = home.id; np.target = null; np.route = null;
          [np.sx, np.sy] = this.planetPos ? this.planetPos(home) : [0, 0];
          np.def = this.starterDef ? this.starterDef(a.name) : np.def;
          np.hp = null; np.shield = null; this.refresh(np);
          // страховой корабль не продашь дороже лома
          np.insuredItems = defItems(np.def).map(i => i.id); np.insuredHull = np.def.hull;
          this.log(`★ Спасательная капсула доставила вас на ${home.name}. Страховка выдала новый корабль${insurance ? ` и ${insurance} кр. возмещения` : ' (возмещения нет: прошлая потеря была меньше 30 дней назад)'}.`, 'player', { s: home.sector });
        }
      }
    }
  }

  who(a) {
    if (!a) return 'неизвестный';
    if (a.ctrl === 'human') return `${a.name} (вы)`;
    if (a.kind === 'pilot') return `${a.name}${a.member >= 0 ? ' [' + this.factions[a.member].short + ']' : ''}`;
    if (a.faction === PIRATE) return `пират ${a.name}`;
    const f = this.factions[a.faction];
    return `${AGENT_KINDS[a.kind].name.toLowerCase()} ${f ? f.short : ''} «${a.name}»`;
  }

  // =====================================================
  //  Движение
  // =====================================================
  movement() {
    for (const a of [...this.agents.values()]) {
      if (!a.alive || a.battle) continue;
      if (a.travel) {
        a.travel.left--;
        this.wearTravel(a);
        if (a.travel.left <= 0) { a.loc = a.travel.to; a.arrFrom = a.travel.from; a.justArrived = true; a.travel = null; this.sectors[a.loc].traffic += NONCOMBAT.includes(a.kind) ? 1 : 0.3; }
        continue;
      }
      // вне боя щит восстанавливается, дроид понемногу чинит
      a.shield = a.s.maxShield;
      a.hp = Math.min(a.maxHp, a.hp + (a.s.rPass || 0) * 4);
      if (a.ctrl === 'human') continue; // игрок решает сам
      // преследователь не бросает погоню, пока цель в секторе
      if (a.chase) {
        const t = this.agents.get(a.chase);
        if (t && t.alive && t.loc === a.loc && !t.travel && t.docked == null && !t.battle) continue;
        a.chase = null;
      }
      if (a.wait > 0) { a.wait--; continue; }
      if (a.kind === 'pilot' && this.pilotLayLow(a)) continue;
      if (a.dest != null && a.dest !== a.loc) { this.depart(a); continue; }
      this.think(a);
      if (a.alive && a.dest != null && a.dest !== a.loc && !a.wait && !(a.kind === 'pilot' && this.pilotLayLow(a))) this.depart(a);
    }
  }
  // осторожность пилота: не лезть туда, где пиратов больше, чем по силам, и пересидеть опасность у планеты
  pilotLayLow(a) {
    const A = this.assess(a);
    const me = this.strength(a) / A.caution;
    const danger = sid => this.pirateForce(sid) > me;
    const shelter = () => {
      const pl = this.planets.find(p => p.sector === a.loc && p.pop > 0 && this.friendlyPlanet(a, p));
      if (!pl) return false;
      if (a.docked == null) { a.intentPrev = a.intent; a.intent = 'пережидает пиратов'; }
      a.docked = pl.id;
      return true;
    };
    if (danger(a.loc) && (a.hide || 0) < 4 && shelter()) { a.hide = (a.hide || 0) + 1; return true; }
    const hop = a.dest != null && a.dest !== a.loc ? this.N[a.loc][a.dest] : -1;
    if (hop >= 0 && danger(hop)) {
      if ((a.hide || 0) < 3) { a.hide = (a.hide || 0) + 1; if (!shelter()) a.docked = null; return true; }
      // ждать надоело — бросить затею и заняться другим
      a.task = null; a.dest = null; a.hide = 0; a.docked = null; a.intentPrev = null;
      return false;
    }
    a.hide = 0; a.docked = null;
    if (a.intentPrev) { a.intent = a.intentPrev; a.intentPrev = null; }
    return false;
  }
  depart(a) {
    a.docked = null; a.lootTarget = null;
    const hop = this.N[a.loc][a.dest];
    if (hop < 0 || hop === a.loc) { a.dest = null; return; }
    const L = this.laneBetween(a.loc, hop);
    const days = this.laneDays(a, L);
    a.travel = { from: a.loc, to: hop, left: days, total: days };
    a.loc = null;
  }

  // =====================================================
  //  Один день
  // =====================================================
  async tick() {
    this.economy();
    for (const f of this.factions) this.factionAI(f);
    this.pirateAI();
    if (this.supplyTick) this.supplyTick();
    this.movement();
    if (this.player) this.playerMove();
    this.updateLocal();
    this.encounters();
    if (this.player) this.chaseCheck();
    await this.battlesStep();
    if (this.player) this.missionsTick();
    if (this.questDirector) { this.questDirector(); this.questDaily(); }
    if (this.dropsTick) { this.dropsTick(); this.pilotsDaily(); }
    this.day++;
  }

  // сводка для отчётов и интерфейса
  summary() {
    const agents = [...this.agents.values()];
    return this.factions.map(f => {
      const ps = this.factionPlanets(f.idx);
      const ships = agents.filter(a => a.faction === f.idx);
      return {
        f, planets: ps.length, pop: U.sum(ps, p => p.pop), treasury: f.treasury, tech: f.tech,
        ships: ships.length, power: U.sum(ships, a => this.strength(a)), wars: [...f.wars],
        stab: ps.length ? U.sum(ps, p => p.stability) / ps.length : 0,
      };
    });
  }
}
