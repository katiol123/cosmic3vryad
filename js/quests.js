'use strict';
// ============================================================
//  Особые поручения фракций.
//  Фракция выдаёт поручение только из конкретной нужды (потери от пиратов,
//  дефицит на планете, проигрываемая война, отставание в технологиях…).
//  Поручения общие для всех пилотов — игрока и ИИ-наёмников: кто первым
//  выполнил, тот и получил награду; остальных «опередили».
//  Успех заметно улучшает отношение фракции к пилоту.
// ============================================================

const QUEST_TYPES = {
  boss:    { name: 'Охота на главаря', icon: '☠' },
  base:    { name: 'Разгром пиратской базы', icon: '💥' },
  aid:     { name: 'Гуманитарная помощь', icon: '✚' },
  rescue:  { name: 'Поиск выживших', icon: '🛟' },
  recon:   { name: 'Разведка', icon: '👁' },
  convoy:  { name: 'Удар по снабжению', icon: '⚔' },
  peace:   { name: 'Мирный договор', icon: '🕊' },
  relic:   { name: 'Древние технологии', icon: '✧' },
  bounty:  { name: 'Охота за головой', icon: '🎯' },
};
const QUEST_POINT_R = 90;   // радиус точки задания внутри сектора

Object.assign(World.prototype, {
  questById(id) { return (this.quests || []).find(q => q.id === id); },
  openQuests() { return (this.quests || []).filter(q => q.status === 'open'); },
  pilotQuests(a) { return this.openQuests().filter(q => q.taken === a.id || (q.takers || []).includes(a.id)); },

  // ---------- создание поручения ----------
  makeQuest(type, f, data) {
    if (!this.quests) this.quests = [];
    const F = this.factions[f];
    const q = Object.assign({
      id: this.nextId++, type, giver: f, status: 'open', day: this.day, takers: [], taken: null, exclusive: false,
      reward: 2000, rep: 15, deadline: this.day + 20, contrib: {},
    }, data);
    q.title = `${QUEST_TYPES[type].icon} ${QUEST_TYPES[type].name}` + (q.titleExtra ? ': ' + q.titleExtra : '');
    this.quests.push(q);
    F.lastQuest = this.day;
    this.log(`📯 ${F.short} объявляет особое поручение «${QUEST_TYPES[type].name}»: ${q.reason}`, 'quest', { f: [f], s: q.sector });
    return q;
  },
  randomPoint(r0 = 250, r1 = 750) { const a = Math.random() * 6.28, r = r0 + Math.random() * (r1 - r0); return [Math.cos(a) * r, Math.sin(a) * r]; },

  // ---------- нужды фракций → поручения ----------
  questDirector() {
    if (!this.quests) this.quests = [];
    // просроченные
    for (const q of this.openQuests()) if (this.day > q.deadline) this.questFail(q, 'срок истёк');
    if (this.openQuests().length >= 9) return;
    for (const f of this.factions) {
      if (!f.alive || (f.lastQuest && this.day - f.lastQuest < 6)) continue;
      if (this.openQuests().some(q => q.giver === f.idx && q.type !== 'rescue' && q.type !== 'bounty')) continue;
      const need = this.factionNeed(f);
      if (need) need();
      if (this.openQuests().length >= 9) break;
    }
  },

  // самая острая нужда фракции (или null)
  factionNeed(f) {
    const mySecs = this.factionSectors(f.idx).map(s => s.id);
    const near = sid => mySecs.some(m => this.hops(m, sid) <= 2);
    const opts = [];
    // 1) пираты грабят караваны — главарь
    const loss = f.st.recentPirateLoss || 0;
    if (loss > 2500) opts.push([loss / 1000, () => this.questBoss(f)]);
    // 2) пиратская база под боком
    const base = this.bases.find(b => b.alive && near(b.sector));
    if (base && loss > 1200 && !this.openQuests().some(q => q.type === 'base' && q.base === base.id)) opts.push([2 + loss / 2000, () => this.questBase(f, base)]);
    // 3) дефицит на планете
    for (const p of this.factionPlanets(f.idx)) {
      for (const g of ['meds', 'food']) {
        const t = this.target(p, g);
        if (p.stock[g] < t * 0.1 && p.shortage > 0.3 && p.stability < 0.5 && !this.openQuests().some(q => q.type === 'aid' && q.giver === f.idx))
          opts.push([1 + p.shortage * 3, () => this.questAid(f, p, g)]);
      }
    }
    // 4) война: разведка, если проигрываем; удар по снабжению — всегда; мир — если миролюбивы и война затянулась
    for (const e of f.wars) {
      const E = this.factions[e];
      if (!E.alive) continue;
      const myPow = U.sum([...this.agents.values()].filter(a => a.faction === f.idx), a => this.strength(a));
      const enPow = U.sum([...this.agents.values()].filter(a => a.faction === e), a => this.strength(a));
      const len = this.day - (f.warSince[e] || this.day);
      if (myPow < enPow * 0.9 || f.st.lostPlanets > 0) opts.push([2.5, () => this.questRecon(f, E)]);
      opts.push([1.5 + f.war, () => this.questConvoy(f, E)]);
      if (len > 18 && f.diplo > 0.45 && !this.openQuests().some(q => q.type === 'peace' && [q.giver, q.enemy].includes(f.idx)))
        opts.push([1 + f.diplo * 3 + len / 30, () => this.questPeace(f, E)]);
    }
    // 5) отставание в технологиях
    const avg = U.sum(this.factions.filter(x => x.alive), x => x.tech) / this.factions.filter(x => x.alive).length;
    if (f.tech < 5 && f.tech <= avg - 0.3 && !this.openQuests().some(q => q.type === 'relic')) opts.push([1.5, () => this.questRelic(f)]);
    if (!opts.length) return null;
    opts.sort((a, b) => b[0] - a[0]);
    return Math.random() < 0.35 ? opts[0][1] : null;
  },

  // бандит: репутация у фракции рухнула — награда за его голову
  questBounty(fi, a) {
    const F = this.factions[fi];
    if (!F || !F.alive || this.openQuests().some(q => q.type === 'bounty' && q.giver === fi && q.target === a.id)) return;
    const reward = Math.round(2500 + this.strength(a) * 6 + (a.banditry || 0) * 500);
    const q = this.makeQuest('bounty', fi, {
      target: a.id, sector: a.loc != null ? a.loc : a.travel ? a.travel.to : null, titleExtra: a.name, reward, rep: 15, deadline: this.day + 45,
      reason: `${a.ctrl === 'human' ? 'пилот' : 'наёмник'} ${a.name} нападает на наши корабли. Уничтожьте его — патрули и военные тоже атакуют его при встрече.`,
    });
    if (a.ctrl === 'human') this.log(`🎯 ${F.short} объявила награду ${reward} кр. за вашу голову! Её патрули атакуют вас при встрече, а наёмники могут начать охоту.`, 'player');
    return q;
  },
  questBoss(f) {
    // главарь — с той базы, что ближе всего к нашей территории
    const base = this.bases.filter(b => b.alive).sort((a, b) => this.hops(a.sector, f.capitalSector) - this.hops(b.sector, f.capitalSector))[0];
    if (!base) return;
    const avg = U.sum(this.factions, x => x.tech) / this.factions.length;
    const tier = U.clamp(Math.round(avg + 1), 2, 5);
    const H = U.pick(HULL_LIST.filter(h => ['destroyer', 'cruiser', 'frigate', 'raider'].includes(h.cls) && h.tier <= tier));
    const def = emptyDef(H.id, 'Флагман');
    autoFill(def, tier);
    // главарь — не новый корабль, а самый опасный из пиратов базы, которому база справила флагман
    const crew = [...this.agents.values()].filter(a => a.faction === PIRATE && a.base === base.id && !a.battle);
    let boss = crew.find(a => a.boss);
    if (!boss) {
      boss = crew.sort((x, y) => this.strength(y) - this.strength(x))[0];
      if (boss) {
        def.name = boss.def.name;
        boss.def = def; boss.hp = null; boss.shield = null; boss.boss = true;
        this.refresh(boss);
        base.wealth = Math.max(0, base.wealth - boss.price * 0.3);
      } else boss = this.spawn('pirate', PIRATE, base.sector, { def, base: base.id, boss: true });
      boss.name = 'Капитан ' + U.pick(PIRATE_NAMES);
      boss.huntFaction = f.idx;
      for (const e of crew.filter(a => a !== boss && !a.escort).slice(0, 2)) e.escort = boss.id;
    }
    const lost = f.st.lostToPirates;
    this.makeQuest('boss', f.idx, {
      boss: boss.id, sector: base.sector, titleExtra: boss.name, reward: Math.round(4000 + tier * 1800), rep: 18, deadline: this.day + 35,
      reason: `пираты уничтожили уже ${lost} наших кораблей. Их ведёт ${boss.name} с базы «${base.name}». Награда — тому, кто его уничтожит.`,
    });
  },
  questBase(f, base) {
    this.makeQuest('base', f.idx, {
      base: base.id, sector: base.sector, titleExtra: base.name, reward: Math.round(7000 + base.wealth * 0.3), rep: 22, deadline: this.day + 40,
      reason: `база «${base.name}» в секторе ${this.sectors[base.sector].name} угрожает нашим трассам. Перебейте охрану и разрушьте укрепления станции.`,
    });
  },
  questAid(f, p, g) {
    const qty = Math.round(this.target(p, g) * 0.6 + 15);
    this.makeQuest('aid', f.idx, {
      planet: p.id, sector: p.sector, good: g, qty, delivered: 0, titleExtra: p.name, reward: Math.round(GOOD[g].base * qty * 0.8), rep: 14, deadline: this.day + 28,
      perUnit: Math.round(GOOD[g].base * 1.6),
      reason: `на планете ${p.name} острая нехватка: «${GOOD[g].name}» (стабильность ${Math.round(p.stability * 100)}%). Нужно ${qty} ед.; оплата за каждую единицу и премия тому, кто привезёт больше всех.`,
    });
  },
  questRescue(f, sector, point, lostName) {
    if (this.openQuests().filter(q => q.type === 'rescue').length >= 2) return;
    this.makeQuest('rescue', f, {
      sector, point, titleExtra: this.sectors[sector].name, reward: 1800 + Math.round(Math.random() * 1200), rep: 12, deadline: this.day + 8,
      ambush: Math.random() < 0.3,
      reason: `наш корабль «${lostName}» погиб в секторе ${this.sectors[sector].name}. Возможно, кто-то выжил — найдите спасательные капсулы на месте гибели.`,
    });
  },
  questRecon(f, E) {
    const tp = this.factionPlanets(E.idx).sort((a, b) => b.pop - a.pop)[0];
    if (!tp) return;
    const [px, py] = this.planetPos(tp);
    this.makeQuest('recon', f.idx, {
      enemy: E.idx, sector: tp.sector, point: [px * 0.8 + 60, py * 0.8 - 60], titleExtra: E.short, reward: 3500, rep: 15, deadline: this.day + 20,
      reason: `мы проигрываем войну с ${E.name}. Нужны сведения об обороне планеты ${tp.name}: пролетите вблизи и снимите данные. Если засекут — ${E.short} не простит.`,
    });
  },
  questConvoy(f, E) {
    const n = U.ri(2, 3);
    this.makeQuest('convoy', f.idx, {
      enemy: E.idx, count: n, kills: {}, titleExtra: `${E.short} ×${n}`, reward: 2200 * n, rep: 14, deadline: this.day + 25,
      sector: (this.factionSectors(E.idx)[0] || {}).id,
      reason: `${E.name} снабжает фронт торговыми караванами. Уничтожьте ${n} их торговцев — награда первому, кто справится.`,
    });
  },
  questPeace(f, E) {
    const cap = this.planets[E.capital];
    if (!cap) return;
    this.makeQuest('peace', f.idx, {
      enemy: E.idx, planet: cap.id, sector: cap.sector, exclusive: true, titleExtra: `${f.short} — ${E.short}`, reward: 6000, rep: 20, deadline: this.day + 20,
      reason: `война с ${E.name} истощает нас. Доставьте мирный договор в их столицу ${cap.name}. Сторонники войны попытаются перехватить курьера.`,
    });
  },
  questRelic(f) {
    const cands = this.sectors.filter(s => s.owner === FREE && !s.base);
    if (!cands.length) return;
    const s = U.pick(cands);
    this.makeQuest('relic', f.idx, {
      sector: s.id, point: this.randomPoint(300, 700), stage: 0, holder: null, guardian: null, titleExtra: s.name,
      reward: 9000, rep: 20, deadline: this.day + 45, artifact: U.pick(itemsFor('artifact')).id,
      reason: `мы отстаём в технологиях. Учёные засекли аномалию древних в секторе ${s.name}. Добудьте реликвию и доставьте в нашу столицу — её охраняет страж.`,
    });
  },

  // ---------- участие ----------
  canTake(a, q) {
    if (q.status !== 'open') return 'Поручение уже закрыто';
    if (q.exclusive && q.taken && q.taken !== a.id) return 'Поручение уже взял другой пилот';
    if (q.type === 'bounty' && q.target === a.id) return 'Это награда за вашу голову';
    if (q.type === 'peace' && (a.rep[q.enemy] || 0) <= -40) return 'Враг не примет вас как посланника';
    if ((a.rep[q.giver] || 0) <= -30) return `${this.factions[q.giver].short} вам не доверяет`;
    return null;
  },
  questTake(a, q) {
    const err = this.canTake(a, q);
    if (err) return err;
    if (q.exclusive) q.taken = a.id;
    if (!q.takers.includes(a.id)) q.takers.push(a.id);
    if (q.type === 'bounty') a.bountyOn = q.target;
    if (a.ctrl === 'human') this.log(`📜 Вы взялись за поручение: ${q.title}.`, 'player');
    else if (q.exclusive || q.type === 'boss' || q.type === 'relic') this.log(`★ ${a.name} берётся за поручение «${q.title}».`, 'pilot', { s: q.sector });
    return null;
  },
  questDrop(a, q) {
    q.takers = q.takers.filter(x => x !== a.id);
    if (q.taken === a.id) q.taken = null;
  },

  questComplete(q, winner, note) {
    if (q.status !== 'open') return;
    q.status = 'done';
    q.winner = winner ? winner.id : null;
    const F = this.factions[q.giver];
    if (winner && winner.kind === 'pilot') {
      winner.credits += q.reward;
      this.addRepRaw(winner, q.giver, q.rep);
      if (winner.ctrl !== 'human') this.addRep(winner, q.giver, 0);
      F.st.missionsOk++;
      this.log(`🏆 Поручение «${q.title}» выполнил ${this.who(winner)}: +${q.reward} кр., репутация у ${F.short} +${q.rep}.${note ? ' ' + note : ''}`, winner.ctrl === 'human' ? 'player' : 'quest', { f: [q.giver], s: q.sector });
    } else this.log(`✔ Поручение «${q.title}» закрыто: ${note || 'выполнено силами фракции'}.`, 'quest', { f: [q.giver], s: q.sector });
    // вклад остальных участников тоже ценится
    for (const id in q.contrib) {
      const a = this.agents.get(+id);
      if (a && a !== winner && a.kind === 'pilot') this.addRepRaw(a, q.giver, Math.min(8, Math.ceil(q.rep * 0.4)));
    }
    // кого опередили
    for (const id of q.takers) {
      const a = this.agents.get(id);
      if (!a || a === winner) continue;
      if (a.ctrl === 'human') this.log(`✖ Вас опередили: «${q.title}» — ${winner ? 'выполнил ' + this.who(winner) : note || 'выполнено без вас'}.`, 'player');
      if (a.task && a.task.quest === q.id) a.task = null;
    }
    this.questRelease(q);
    this.questEffect(q);
  },
  // охотники больше не преследуют цель закрытого поручения
  questRelease(q) {
    if (q.type !== 'bounty') return;
    for (const id of q.takers) { const a = this.agents.get(id); if (a && a.bountyOn === q.target && !this.openQuests().some(o => o !== q && o.type === 'bounty' && o.target === q.target && o.takers.includes(id))) a.bountyOn = null; }
  },
  // куда лететь пилоту по поручению: сектор и цель внутри сектора
  questSector(p, q) {
    if (q.type === 'relic' && q.holder === p.id) return this.planets[this.factions[q.giver].capital].sector;
    return q.sector;
  },
  questTarget(p, q) {
    if (q.type === 'relic' && q.holder === p.id) return { type: 'planet', id: this.factions[q.giver].capital };
    if (q.type === 'bounty') return { type: 'ship', id: q.target, attack: true };
    if (q.point) return { type: 'quest', id: q.id };
    if (q.planet != null) return { type: 'planet', id: q.planet };
    if (q.type === 'base') return { type: 'base' };
    return null;
  },

  questFail(q, why) {
    if (q.status !== 'open') return;
    q.status = 'failed';
    this.log(`✖ Поручение «${q.title}» сорвано: ${why}.`, 'quest', { f: [q.giver] });
    for (const id of q.takers) {
      const a = this.agents.get(id);
      if (!a) continue;
      if (a.ctrl === 'human') this.log(`✖ Поручение провалено: ${q.title} (${why}).`, 'player');
      if (q.exclusive && q.taken === a.id) this.addRepRaw(a, q.giver, -8);
      if (a.task && a.task.quest === q.id) a.task = null;
    }
    this.questRelease(q);
    if (q.type === 'boss') { const b = this.agents.get(q.boss); if (b) b.boss = false; }
  },

  // последствия выполненного поручения для фракции
  // Каждое выполненное поручение даёт фракции конкретное усиление
  questEffect(q) {
    const F = this.factions[q.giver];
    F.buffs = F.buffs || {};
    const boost = text => this.log(`⬆ Усиление ${F.short}: ${text}`, 'buff', { f: [F.idx] });
    const freeShip = kind => { const yard = this.factionPlanets(F.idx).sort((a, b) => b.shipyard - a.shipyard)[0]; if (yard) { this.spawn(kind, F.idx, yard.sector, { home: yard.id }); F.st.built++; } };
    switch (q.type) {
      case 'bounty': {
        for (const p of this.factionPlanets(F.idx)) p.stability = Math.min(1, p.stability + 0.03);
        boost('разбойник уничтожен — торговцы снова спокойно летают по трассам (стабильность +3%)');
        return;
      }
      case 'boss':
        F.st.recentPirateLoss = 0;
        for (const s of this.factionSectors(F.idx)) s.heat *= 0.4;
        F.buffs.convoy = this.day + 30;
        F.treasury += 3000;
        boost('пиратская угроза снята — 30 дней пираты реже трогают караваны, из логова главаря возвращено 3000 кр.');
        break;
      case 'base': {
        F.st.recentPirateLoss = 0;
        F.buffs.convoy = this.day + 40;
        freeShip('patrol');
        boost('трассы свободны от пиратов на 40 дней, трофейные верфи базы дали новый патрульный корабль.');
        break;
      }
      case 'aid': {
        const p = this.planets[q.planet];
        p.stability = Math.min(1, p.stability + 0.2);
        p.pop *= 1.05;
        F.buffs.tax = this.day + 20;
        boost(`планета ${p.name} спасена: стабильность +20%, население +5%, налоги фракции +15% на 20 дней.`);
        break;
      }
      case 'rescue':
        for (const p of this.factionPlanets(F.idx)) p.stability = Math.min(1, p.stability + 0.03);
        freeShip('trader');
        boost('спасённые экипажи вернулись в строй — новый торговый корабль и рост стабильности на всех планетах.');
        break;
      case 'recon':
        F.intel = F.intel || {}; F.intel[q.enemy] = this.day + 25;
        boost(`разведданные о ${this.factions[q.enemy].short}: 25 дней осады её планет на 60% эффективнее.`);
        break;
      case 'convoy': {
        const E = this.factions[q.enemy];
        const loot = Math.round(E.treasury * 0.15);
        E.treasury -= loot; F.treasury += loot * 0.5;
        boost(`снабжение ${E.short} сорвано: её казна −${loot} кр., половина трофеев — в нашу казну.`);
        break;
      }
      case 'peace':
        this.makePeace(F.idx, q.enemy);
        this.changeRel(F.idx, q.enemy, 20);
        for (const p of this.factionPlanets(F.idx)) p.stability = Math.min(1, p.stability + 0.08);
        F.buffs.tax = this.day + 20;
        boost('мир подписан: стабильность +8% на всех планетах, налоги +15% на 20 дней.');
        break;
      case 'relic':
        if (F.tech < 5) { F.tech++; boost(`реликвия изучена — технологический уровень ${U.roman(F.tech)}: новые корабли фракции строятся с оборудованием лучше.`); }
        else { freeShip('warship'); freeShip('warship'); boost('реликвия древних дала чертежи — два новых военных корабля.'); }
        break;
    }
  },

  // ---------- события мира → прогресс поручений ----------
  questOnKill(victim, killer) {
    for (const q of this.openQuests()) {
      if (q.type === 'bounty' && victim.id === q.target) {
        if (killer && killer.kind === 'pilot') this.questComplete(q, killer, `${victim.name} уничтожен`);
        else this.questComplete(q, null, killer ? `${victim.name} уничтожен: ${this.who(killer)}` : `${victim.name} погиб`);
        continue;
      }
      if (q.type === 'boss' && victim.id === q.boss) {
        if (killer && killer.kind === 'pilot') this.questComplete(q, killer);
        else this.questComplete(q, null, killer ? `главаря уничтожил ${this.who(killer)}` : 'главарь погиб');
      } else if (q.type === 'convoy' && killer && killer.kind === 'pilot' && victim.faction === q.enemy && victim.kind === 'trader') {
        q.kills[killer.id] = (q.kills[killer.id] || 0) + 1;
        q.contrib[killer.id] = 1;
        if (!q.takers.includes(killer.id)) q.takers.push(killer.id);
        if (q.kills[killer.id] >= q.count) this.questComplete(q, killer);
        else if (killer.ctrl === 'human') this.log(`⚔ Удар по снабжению: ${q.kills[killer.id]}/${q.count}.`, 'player');
      } else if (q.type === 'relic' && victim.id === q.guardian) {
        q.guardian = null;
        if (killer && killer.kind === 'pilot') {
          q.stage = 1; q.holder = killer.id;
          if (!q.takers.includes(killer.id)) q.takers.push(killer.id);
          this.log(`✧ ${this.who(killer)} победил стража древних и завладел реликвией!`, killer.ctrl === 'human' ? 'player' : 'quest', { s: q.sector });
          for (const id of q.takers) { const a = this.agents.get(id); if (a && a !== killer && a.ctrl === 'human') this.log(`✖ Реликвию забрал ${this.who(killer)} — теперь её можно только отбить.`, 'player'); }
        }
      }
    }
    // носитель реликвии погиб — она остаётся на месте гибели
    for (const q of this.openQuests()) if (q.type === 'relic' && q.holder === victim.id) {
      q.holder = null; q.stage = 0; q.sector = victim.loc != null ? victim.loc : q.sector; q.point = [victim.sx || 0, victim.sy || 0]; q.dropped = true;
      this.log(`✧ Реликвия выпала из обломков в секторе ${this.sectors[q.sector].name} — кто подберёт первым?`, 'quest', { s: q.sector });
    }
    // гибель торговца или дипломата от пиратов — повод искать выживших
    if (killer && killer.faction === PIRATE && victim.faction >= 0 && victim.faction !== PIRATE && NONCOMBAT.includes(victim.kind) && Math.random() < 0.35)
      this.questRescue(victim.faction, victim.loc != null ? victim.loc : 0, [victim.sx || 0, victim.sy || 0], victim.name);
  },
  questOnBaseDestroyed(b, by) {
    for (const q of this.openQuests()) if (q.type === 'base' && q.base === b.id) {
      if (by && by.kind === 'pilot') this.questComplete(q, by);
      else this.questComplete(q, null, by ? `базу разрушил ${this.who(by)}` : 'база уничтожена');
    }
  },
  // поставка товара на планету (игрок, ИИ-пилоты и торговцы)
  questOnDeliver(a, p, good, qty) {
    for (const q of this.openQuests()) {
      if (q.type !== 'aid' || q.planet !== p.id || q.good !== good) continue;
      const n = Math.min(qty, q.qty - q.delivered);
      if (n <= 0) continue;
      q.delivered += n;
      if (a && a.kind === 'pilot') {
        a.credits += n * q.perUnit;
        q.contrib[a.id] = (q.contrib[a.id] || 0) + n;
        if (!q.takers.includes(a.id)) q.takers.push(a.id);
        if (a.ctrl === 'human') this.log(`✚ Помощь доставлена: ${n} ед. (+${n * q.perUnit} кр.). Собрано ${q.delivered}/${q.qty}.`, 'player');
      }
      if (q.delivered >= q.qty) {
        const top = Object.entries(q.contrib).sort((x, y) => y[1] - x[1])[0];
        this.questComplete(q, top ? this.agents.get(+top[0]) : null, top ? '' : 'груз доставили торговые караваны');
      }
    }
  },
  // пилот достиг точки задания внутри сектора
  questReach(a) {
    for (const q of this.openQuests()) {
      if (!q.point || q.sector !== a.loc) continue;
      if (q.type === 'relic' && q.stage !== 0) continue;
      if (q.exclusive && q.taken !== a.id) continue;
      if (a.ctrl === 'human' && Math.hypot(a.sx - q.point[0], a.sy - q.point[1]) > QUEST_POINT_R) continue;
      if (!q.takers.includes(a.id)) q.takers.push(a.id);
      q.contrib[a.id] = 1;
      switch (q.type) {
        case 'rescue':
          this.questComplete(q, a, 'спасатели доставлены домой');
          if (q.ambush) this.ambush(a, 2, 'это была пиратская ловушка');
          break;
        case 'recon':
          if (Math.random() < 0.5) { this.addRepRaw(a, q.enemy, -12); if (a.ctrl === 'human') this.log(`⚠ Вас засекли: ${this.factions[q.enemy].short} −12 к репутации.`, 'player'); }
          this.questComplete(q, a);
          break;
        case 'relic':
          if (q.dropped) { q.stage = 1; q.holder = a.id; q.dropped = false; this.log(`✧ ${this.who(a)} подобрал реликвию.`, a.ctrl === 'human' ? 'player' : 'quest', { s: q.sector }); break; }
          if (!q.guardian || !this.agents.get(q.guardian)) {
            const H = U.pick(HULL_LIST.filter(h => h.maker === 'aether' && ['cruiser', 'destroyer', 'battleship'].includes(h.cls)));
            const def = emptyDef(H.id, 'Страж древних');
            autoFill(def, 5);
            const g = this.spawn('pirate', PIRATE, q.sector, { def, guardian: true, base: null });
            g.name = 'Страж древних';
            g.sx = q.point[0]; g.sy = q.point[1];
            q.guardian = g.id;
            this.log(`✧ У аномалии в секторе ${this.sectors[q.sector].name} пробудился Страж древних!`, a.ctrl === 'human' ? 'player' : 'quest', { s: q.sector });
          }
          const g = this.agents.get(q.guardian);
          if (g && !g.battle && !a.battle) this.startBattle(a.loc, [a], [g]);
          break;
      }
    }
  },
  // пилот пристыковался/прибыл к планете — доставка договора или реликвии
  questOnDock(a, p) {
    for (const q of this.openQuests()) {
      if (q.type === 'peace' && q.taken === a.id && q.planet === p.id) this.questComplete(q, a, 'мирный договор подписан');
      if (q.type === 'relic' && q.stage === 1 && q.holder === a.id && p.owner === q.giver && this.factions[q.giver].capital === p.id) this.questComplete(q, a, 'реликвия передана учёным');
    }
  },
  // игрок оставляет реликвию себе как артефакт
  questKeepRelic(q) {
    const p = this.player;
    if (q.holder !== p.id) return;
    p.stash = p.stash || [];
    p.stash.push(q.artifact);
    q.status = 'failed';
    this.addRepRaw(p, q.giver, -10);
    this.log(`✧ Вы оставили реликвию себе: «${ITEMS[q.artifact].name}» в трюме. ${this.factions[q.giver].short} недовольна (−10).`, 'player');
  },
  ambush(a, n, why) {
    const base = this.bases.find(b => b.alive && !b.alien) || null;
    const foes = [];
    for (let i = 0; i < n; i++) {
      const pr = this.spawn('pirate', PIRATE, a.loc, { base: base ? base.id : null });
      pr.sx = a.sx + U.rf(-80, 80); pr.sy = a.sy + U.rf(-80, 80);
      foes.push(pr);
    }
    this.log(`⚠ Засада: ${why}!`, a.ctrl === 'human' ? 'player' : 'quest', { s: a.loc });
    if (!a.battle) this.startBattle(a.loc, [a], foes);
  },

  // ежедневные эффекты поручений: курьера договора преследуют, главарь охотится в нужных секторах
  questDaily() {
    for (const q of this.openQuests()) {
      if (q.type === 'peace' && q.taken) {
        const c = this.agents.get(q.taken);
        if (!c) { this.questFail(q, 'курьер погиб'); continue; }
        if (c.loc != null && !c.travel && !c.battle && c.docked == null && Math.random() < 0.12) this.ambush(c, 1, 'наёмники сторонников войны');
      }
      if (q.type === 'bounty') {
        const t = this.agents.get(q.target);
        if (t) q.sector = t.loc != null ? t.loc : t.travel ? t.travel.to : q.sector;
        // бандит загладил вину — охоту отменяют
        if (t && (t.rep[q.giver] || 0) > -30) this.questFail(q, 'фракция простила');
      }
      if (q.type === 'boss') {
        const b = this.agents.get(q.boss);
        if (!b) { this.questComplete(q, null, 'главарь пропал'); continue; }
        q.sector = b.loc != null ? b.loc : b.travel ? b.travel.to : q.sector;
      }
      if (q.type === 'relic' && q.stage === 1) {
        const h = this.agents.get(q.holder);
        if (h) q.sector = h.loc != null ? h.loc : q.sector;
      }
    }
  },

  // ---------- ИИ-наёмники берутся за поручения ----------
  pilotPickQuest(a, A) {
    A = A || this.assess(a);
    const me = this.strength(a), thr = this._thr || 200;
    const opts = [];
    for (const q of this.openQuests()) {
      if (this.canTake(a, q)) continue;
      if (q.type === 'convoy' && a.member !== q.giver) continue;
      if (q.type === 'relic' && q.stage === 1 && q.holder !== a.id) continue;
      // какую силу требует поручение (с запасом на осторожность пилота)
      let need = 0;
      if (q.type === 'boss') { const b = this.agents.get(q.boss); need = b ? this.strength(b) * 1.1 : 0; }
      if (q.type === 'bounty') { const t = this.agents.get(q.target); if (!t || t === a) continue; need = this.strength(t) * 1.2; }
      if (q.type === 'base') need = Math.max(this.pirateForce(q.sector) * 0.9, thr * 1.5); // охрана может вернуться, у станции свои орудия
      if (q.type === 'relic' && q.stage === 0) need = Math.max(260, thr * 1.2);
      if (q.type === 'convoy') need = thr;
      if (q.type === 'recon' || q.type === 'rescue') need = thr * 0.6;
      if (q.type === 'aid' && a.credits < 1500) continue; // не на что закупить груз
      if (me < need * A.caution) continue;
      const far = q.sector != null ? this.hops(a.loc, q.sector) : 3;
      // бедный ценит деньги, богатый — репутацию
      const v = (q.reward * (A.poor ? 1.4 : 1) + q.rep * (A.rich ? 250 : 120)) / (2 + far) * (0.6 + Math.random() * 0.8);
      opts.push([v, q]);
    }
    if (!opts.length) return null;
    opts.sort((x, y) => y[0] - x[0]);
    return opts[0][1];
  },
  pilotDoQuest(a, q) {
    if (this.questTake(a, q)) return false;
    if (q.type === 'aid') {
      // закупить нужный товар там, где он есть, и отвезти
      const src = this.planets.filter(p => p.pop > 0 && p.id !== q.planet && p.stock[q.good] > 10 && this.friendlyPlanet(a, p))
        .sort((x, y) => this.hops(a.loc, x.sector) - this.hops(a.loc, y.sector))[0];
      if (!src) return false;
      a.task = { type: 'buy', sector: src.sector, planet: src.id, to: q.planet, good: q.good, qty: q.qty - q.delivered, cost: 0, quest: q.id };
    } else if (q.type === 'peace') {
      a.task = { type: 'questDock', sector: q.sector, planet: q.planet, quest: q.id };
    } else if (q.type === 'relic' && q.stage === 1) {
      const cap = this.planets[this.factions[q.giver].capital];
      a.task = { type: 'questDock', sector: cap.sector, planet: cap.id, quest: q.id };
    } else if (q.type === 'convoy') {
      const s = this.factionSectors(q.enemy).sort((x, y) => y.traffic - x.traffic)[0];
      if (!s) return false;
      a.task = { type: 'hunt', sector: s.id, days: 3, quest: q.id };
    } else {
      if (q.sector == null) return false;
      a.task = { type: 'quest', sector: q.sector, quest: q.id, days: q.type === 'base' ? 6 : q.type === 'boss' || q.type === 'bounty' ? 3 : 1 };
    }
    this.go(a, a.task.sector);
    return true;
  },
  // прибытие ИИ-пилота по заданию
  pilotQuestArrive(a, T) {
    const q = this.questById(T.quest);
    if (!q || q.status !== 'open') return true;
    if (q.type === 'boss' || q.type === 'bounty') {
      // главарь улетел — догоняем
      if (q.sector !== a.loc) { T.sector = q.sector; this.go(a, q.sector); return false; }
      if (T.days-- > 0) { a.wait = 1; return false; }
      return true;
    }
    if (q.type === 'base') {
      const b = this.bases.find(x => x.id === q.base && x.alive);
      if (!b) return true;
      const guards = this.present(a.loc).filter(o => o.faction === PIRATE && !o.battle);
      if (!guards.length) {
        const dmg = this.strength(a) / 25;
        b.defense -= dmg;
        q.contrib[a.id] = (q.contrib[a.id] || 0) + dmg;
        if (b.defense <= 0) this.destroyBase(b, a);
      }
      if (T.days-- > 0 && b.alive) { a.wait = 1; return false; }
      return true;
    }
    // точки: выживших, разведки, аномалии — день на поиск точки в секторе
    if (!T.searched) { T.searched = true; a.sx = q.point ? q.point[0] : a.sx; a.sy = q.point ? q.point[1] : a.sy; a.wait = 1; return false; }
    this.questReach(a);
    return true;
  },
});
