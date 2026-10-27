'use strict';
// ============================================================
//  Карьера пилота: заслуги перед фракциями, звания на службе,
//  ордена за подвиги и общий рейтинг рейнджера.
//  Одни правила для игрока и ИИ-наёмников.
// ============================================================

// звания на службе фракции: сколько заслуг нужно
const RANKS = [
  { name: 'Рядовой', merit: 0 },
  { name: 'Ефрейтор', merit: 30 },
  { name: 'Сержант', merit: 80 },
  { name: 'Лейтенант', merit: 180 },
  { name: 'Капитан', merit: 350 },
  { name: 'Майор', merit: 600 },
  { name: 'Полковник', merit: 1000 },
  { name: 'Генерал', merit: 1600 },
  { name: 'Адмирал', merit: 2500 },
];

// ордена: за что дают (счётчик по фракции и порог), награда
const MEDALS = {
  courage:  { name: 'Орден Отваги', icon: '🎖', color: '#ff6b6b', desc: 'уничтожить главаря пиратов по поручению фракции', stat: 'boss', need: 1 },
  shield:   { name: 'Щит Торговли', icon: '🛡', color: '#4cc9f0', desc: 'сбить 20 пиратов в секторах фракции', stat: 'pk', need: 20 },
  storm:    { name: 'Орден Штурма', icon: '💥', color: '#ff9f1c', desc: 'разгромить пиратскую базу', stat: 'base', need: 1 },
  veteran:  { name: 'Крест Ветерана', icon: '✠', color: '#c0c8d8', desc: 'уничтожить 15 кораблей врага на войне за фракцию', stat: 'wk', need: 15 },
  star:     { name: 'Звезда Героя', icon: '★', color: '#ffd166', desc: 'выполнить 8 особых поручений фракции', stat: 'quest', need: 8 },
  peace:    { name: 'Орден Мира', icon: '🕊', color: '#a6ffc4', desc: 'доставить мирный договор', stat: 'peace', need: 1 },
  sage:     { name: 'Знак Просвещения', icon: '✧', color: '#c77dff', desc: 'передать фракции древнюю реликвию', stat: 'relic', need: 1 },
  saviour:  { name: 'Медаль Спасителя', icon: '🛟', color: '#7df9ff', desc: 'спасти выживших', stat: 'rescue', need: 1 },
  hunter:   { name: 'Знак Охотника', icon: '🎯', color: '#ff7af5', desc: 'уничтожить разыскиваемого бандита', stat: 'bounty', need: 1 },
  merchant: { name: 'Почётный Торговец', icon: '⚖', color: '#7bd88f', desc: 'выполнить 5 поставок и гуманитарных поручений', stat: 'aid', need: 5 },
};

// титулы рейнджера по рейтингу
const TITLES = [
  { name: 'Новичок', min: 0 }, { name: 'Опытный', min: 250 }, { name: 'Ветеран', min: 700 },
  { name: 'Мастер', min: 1600 }, { name: 'Герой', min: 3200 }, { name: 'Легенда', min: 6000 },
];

Object.assign(World.prototype, {
  // ---------- заслуги и звания ----------
  meritOf(a, f) { return (a.merit && a.merit[f]) || 0; },
  rankIdx(a, f) {
    const m = this.meritOf(a, f);
    let i = 0;
    while (i + 1 < RANKS.length && m >= RANKS[i + 1].merit) i++;
    return i;
  },
  rankName(a, f = a.member) { return f >= 0 ? RANKS[this.rankIdx(a, f)].name : null; },
  addMerit(a, f, d) {
    if (!a || a.kind !== 'pilot' || f == null || f < 0 || f === PIRATE || !this.factions[f]) return;
    if (typeof a.merit !== 'object' || !a.merit) a.merit = {};
    const before = this.rankIdx(a, f);
    a.merit[f] = (a.merit[f] || 0) + d;
    const after = this.rankIdx(a, f);
    if (after > before && a.member === f) {
      const R = RANKS[after], F = this.factions[f];
      if (a.ctrl === 'human') this.log(`🎖 Вы произведены в звание «${R.name}» (${F.short}): жалованье ${this.salary(a)} кр./день, скидка на верфях ${F.short} ${Math.round(this.rankDiscount(a, f) * 100)}%.`, 'player', { f: [f] });
      else if (after >= 4) this.log(`🎖 ${a.name} получил звание «${R.name}» на службе ${F.short}.`, 'pilot', { f: [f] });
    }
  },
  // жалованье на службе растёт со званием
  salary(a) { return a.member >= 0 ? Math.round(30 * (1 + this.rankIdx(a, a.member) * 0.5)) : 0; },
  // скидка на верфях своей фракции
  rankDiscount(a, f) { return a.member === f && f >= 0 ? this.rankIdx(a, f) * 0.02 : 0; },

  // ---------- счётчики подвигов и ордена ----------
  bumpStat(a, f, stat, n = 1) {
    if (!a || a.kind !== 'pilot' || f == null || f < 0 || f === PIRATE || !this.factions[f]) return;
    a.cs = a.cs || {};
    const S = a.cs[stat] = a.cs[stat] || {};
    S[f] = (S[f] || 0) + n;
    for (const id in MEDALS) if (MEDALS[id].stat === stat && S[f] >= MEDALS[id].need) this.award(a, f, id);
  },
  hasMedal(a, f, id) { return (a.honors || []).some(m => m.id === id && m.f === f); },
  award(a, f, id) {
    if (this.hasMedal(a, f, id)) return;
    a.honors = Array.isArray(a.honors) ? a.honors : [];
    a.honors.push({ id, f, day: this.day });
    const M = MEDALS[id], F = this.factions[f];
    this.addRepRaw(a, f, 5);
    this.addMerit(a, f, 40);
    if (a.ctrl === 'human') this.log(`${M.icon} ${F.short} награждает вас: «${M.name}» — за то, что вы ${M.desc}. Репутация +5.`, 'player', { f: [f] });
    else this.log(`${M.icon} ${a.name} награждён: «${M.name}» (${F.short}).`, 'pilot', { f: [f] });
  },

  // ---------- события, которые двигают карьеру ----------
  careerKill(killer, victim, sec) {
    if (!killer || killer.kind !== 'pilot') return;
    killer.cs = killer.cs || {};
    if (victim.faction === PIRATE) {
      killer.cs.pirates = (killer.cs.pirates || 0) + 1;
      if (sec && sec.owner >= 0) this.bumpStat(killer, sec.owner, 'pk');
      if (killer.member >= 0) this.addMerit(killer, killer.member, 3 + (victim.boss ? 20 : 0));
    } else if (killer.member >= 0 && victim.faction >= 0 && this.atWar(killer.member, victim.faction)) {
      killer.cs.warKills = (killer.cs.warKills || 0) + 1;
      this.bumpStat(killer, killer.member, 'wk');
      this.addMerit(killer, killer.member, victim.kind === 'warship' ? 12 : 6);
    }
  },
  careerQuest(a, q) {
    if (!a || a.kind !== 'pilot') return;
    a.cs = a.cs || {};
    a.cs.quests = (a.cs.quests || 0) + 1;
    this.addMerit(a, q.giver, 25);
    this.bumpStat(a, q.giver, 'quest');
    const st = { boss: 'boss', base: 'base', peace: 'peace', relic: 'relic', rescue: 'rescue', bounty: 'bounty', aid: 'aid' }[q.type];
    if (st) this.bumpStat(a, q.giver, st);
  },
  careerMission(a, o) {
    if (!a || !o || o.faction == null) return;
    this.addMerit(a, o.faction, o.type === 'war' ? 15 : 5);
    if (o.type === 'supply') this.bumpStat(a, o.faction, 'aid');
  },

  // ---------- рейтинг ----------
  pilotWorth(a) { return Math.round(a.credits + this.shopPrice({ price: defPrice(a.def) }) * 0.5); },
  pilotRating(a) {
    const cs = a.cs || {};
    const merit = U.sum(Object.values(a.merit && typeof a.merit === 'object' ? a.merit : {}));
    return Math.round((a.kills || 0) * 6 + (cs.quests || 0) * 40 + (a.honors || []).length * 120 + merit * 0.5 + this.pilotWorth(a) / 400);
  },
  pilotTitle(a) {
    const r = this.pilotRating(a);
    let t = TITLES[0];
    for (const x of TITLES) if (r >= x.min) t = x;
    return t.name;
  },
  // место в общем списке наёмников по рейтингу
  pilotPlace(a) {
    const all = [...this.agents.values()].filter(x => x.kind === 'pilot').map(x => [x, this.pilotRating(x)]).sort((x, y) => y[1] - x[1]);
    return all.findIndex(x => x[0] === a) + 1;
  },
});
