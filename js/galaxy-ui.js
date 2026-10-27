'use strict';
// ============================================================
//  Карта галактики: наблюдение за живым миром кампании
// ============================================================

const GalaxyUI = {
  active: false,
  world: null,
  cam: { x: WORLD_W / 2, y: WORLD_H / 2, z: 1 },
  sel: null,           // { type: 'sector'|'agent'|'battle'|'faction', id }
  hover: null,
  playing: false,
  daysPerSec: 1.5,
  anim: 1,             // 0..1 — анимация между днями
  prevPos: new Map(),
  busy: false,
  t: 0,
  focusFaction: null,
  dpr: 1,

  open(newWorld) {
    this.pilotMode = false;
    if (newWorld || !this.world || this.world.player) this.world = new World({ seed: Math.floor(Math.random() * 1e9) });
    this.build();
    Screens.show('scr-galaxy');
    this.active = true;
    requestAnimationFrame(() => { this.resize(); this.fit(); this.refresh(); });
  },
  close() {
    this.active = false;
    this.playing = false;
    Menu.build();
    Screens.show('scr-menu');
  },

  build() {
    const el = document.getElementById('scr-galaxy');
    el.innerHTML = '';
    const E = this.els = {};
    E.day = h('div', { class: 'gx-day' });
    E.play = h('button', { class: 'btn', onclick: () => this.togglePlay() }, '▶ Авто');
    const speed = seg([[0.7, '½'], [1.5, '1×'], [4, '3×'], [10, '8×']], this.daysPerSec, v => { this.daysPerSec = v; }, 'small');
    el.appendChild(this.pilotMode ? h('div', { class: 'topbar' },
      h('button', { class: 'btn', onclick: () => SectorUI.backFromGalaxy() }, '← В сектор'),
      h('h2', null, 'Карта галактики'),
      E.day,
      h('div', { class: 'grow' }),
      h('span', { class: 'dim' }, 'Выберите сектор и проложите курс — корабль полетит через гиперворота сам'),
      h('button', { class: 'btn primary big', onclick: () => SectorUI.nextDay().then(() => this.refresh()) }, '⏭ Ход')) : h('div', { class: 'topbar' },
      h('button', { class: 'btn ghost', onclick: () => this.close() }, '← Меню'),
      h('h2', null, 'Галактика'),
      E.day,
      h('div', { class: 'grow' }),
      h('button', { class: 'btn primary', onclick: () => this.nextDay() }, '⏭ Следующий день'),
      E.play, speed,
      h('button', { class: 'btn ghost', title: 'Сгенерировать новую галактику', onclick: () => { this.playing = false; this.open(true); } }, '🎲 Новая галактика')));
    E.cv = h('canvas', { class: 'gx-cv' });
    E.tip = h('div', { class: 'gx-tip' });
    E.side = h('div', { class: 'gx-side panel' });
    E.tabs = seg([['factions', 'Фракции'], ['events', 'События'], ['pilots', 'Пилоты'], ['sel', 'Выбрано']], 'factions', v => { this.tab = v; this.refresh(); }, 'small tabs');
    this.tab = 'factions';
    E.body = h('div', { class: 'gx-body' });
    E.side.append(E.tabs, E.body);
    el.appendChild(h('div', { class: 'gx-main' }, h('div', { class: 'gx-map panel' }, E.cv, E.tip,
      h('div', { class: 'gx-legend' },
        h('span', null, h('i', { class: 'lg tr' }), 'торговец'), h('span', null, h('i', { class: 'lg pa' }), 'военный'),
        h('span', null, h('i', { class: 'lg pi' }), 'пират'), h('span', null, h('i', { class: 'lg pl' }), 'пилот'),
        h('span', null, '☠ база'), h('span', null, '⚔ бой'))), E.side));
    this.bindMap();
    if (!this._ro) this._ro = new ResizeObserver(() => this.resize());
    this._ro.disconnect();
    this._ro.observe(E.cv);
  },

  resize() {
    const cv = this.els && this.els.cv;
    if (!cv) return;
    const r = cv.getBoundingClientRect();
    this.dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = Math.max(100, Math.round(r.width * this.dpr)); cv.height = Math.max(100, Math.round(r.height * this.dpr));
    this.bg = GFX.starfield(cv.width, cv.height, this.world ? this.world.seed : 7);
  },
  fit() {
    const cv = this.els.cv;
    this.cam.z = Math.min(cv.width / (WORLD_W + 80), cv.height / (WORLD_H + 80));
    this.cam.x = WORLD_W / 2; this.cam.y = WORLD_H / 2;
    // узкий экран: карта во всю высоту, по центру — сектор игрока, остальное — перетаскиванием
    if (cv.width / (this.dpr || 1) < 640) {
      this.cam.z = Math.max(cv.width / (WORLD_W + 80), cv.height / (WORLD_H + 80)) * 0.95;
      const p = this.world && this.world.player, s = p && p.loc != null ? this.world.sectors[p.loc] : null;
      if (s) { this.cam.x = s.x; this.cam.y = s.y; }
    }
  },
  toScreen(x, y) { const c = this.cam, cv = this.els.cv; return [(x - c.x) * c.z + cv.width / 2, (y - c.y) * c.z + cv.height / 2]; },
  toWorld(sx, sy) { const c = this.cam, cv = this.els.cv; return [(sx - cv.width / 2) / c.z + c.x, (sy - cv.height / 2) / c.z + c.y]; },

  bindMap() {
    const cv = this.els.cv;
    let drag = null;
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      const b = cv.getBoundingClientRect();
      const sx = (e.clientX - b.left) * cv.width / Math.max(1, b.width), sy = (e.clientY - b.top) * cv.height / Math.max(1, b.height);
      const [wx, wy] = this.toWorld(sx, sy);
      this.cam.z = U.clamp(this.cam.z * (e.deltaY < 0 ? 1.15 : 0.87), 0.3, 4);
      const [nx, ny] = this.toWorld(sx, sy);
      this.cam.x += wx - nx; this.cam.y += wy - ny;
    }, { passive: false });
    cv.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, cx: this.cam.x, cy: this.cam.y, moved: false }; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', e => {
      const b = cv.getBoundingClientRect();
      const sx = (e.clientX - b.left) * cv.width / Math.max(1, b.width), sy = (e.clientY - b.top) * cv.height / Math.max(1, b.height);
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
        this.cam.x = drag.cx - dx * this.dpr / this.cam.z; this.cam.y = drag.cy - dy * this.dpr / this.cam.z;
      }
      this.hover = this.pick(sx, sy);
      this.showTip(e, b);
    });
    cv.addEventListener('pointerup', e => {
      if (drag && !drag.moved) {
        const b = cv.getBoundingClientRect();
        const p = this.pick((e.clientX - b.left) * cv.width / Math.max(1, b.width), (e.clientY - b.top) * cv.height / Math.max(1, b.height));
        if (p) { this.sel = p; this.tab = 'sel'; this.els.tabs.querySelectorAll('button').forEach(x => x.classList.toggle('on', x.textContent === 'Выбрано')); this.refresh(); }
      }
      drag = null;
    });
    cv.addEventListener('pointerleave', () => { this.hover = null; this.els.tip.style.opacity = 0; });
  },

  // что под курсором: корабль, бой или сектор
  pick(sx, sy) {
    const w = this.world, d = this.dpr;
    let best = null, bd = 14 * d;
    for (const a of w.agents.values()) {
      const p = this.agentPos(a, this.anim);
      if (!p) continue;
      const [x, y] = this.toScreen(p[0], p[1]);
      const dd = Math.hypot(x - sx, y - sy);
      if (dd < bd) { bd = dd; best = { type: 'agent', id: a.id }; }
    }
    if (best) return best;
    for (const wb of w.battles) {
      const s = w.sectors[wb.sector];
      const [x, y] = this.toScreen(s.x + 22, s.y - 22);
      if (Math.hypot(x - sx, y - sy) < 14 * d) return { type: 'battle', id: wb.id };
    }
    for (const s of w.sectors) {
      const [x, y] = this.toScreen(s.x, s.y);
      if (Math.hypot(x - sx, y - sy) < Math.max(26 * d, 50 * this.cam.z)) return { type: 'sector', id: s.id };
    }
    return null;
  },

  showTip(e, b) {
    const t = this.els.tip, w = this.world, hv = this.hover;
    if (!hv) { t.style.opacity = 0; return; }
    let html = '';
    if (hv.type === 'sector') {
      const s = w.sectors[hv.id];
      const own = s.owner >= 0 ? w.factions[s.owner] : null;
      html = `<b>${s.name}</b><br><span style="color:${own ? own.color : '#aaa'}">${own ? own.name : 'Ничейный сектор'}</span><br>Планет: ${s.planets.length}, кораблей: ${w.present(s.id).length}${s.base ? '<br><b style="color:#ff6b6b">☠ пиратская база</b>' : ''}${s.asteroids ? '<br>астероидное поле' : ''}`;
    } else if (hv.type === 'agent') {
      const a = w.agents.get(hv.id);
      if (!a) { t.style.opacity = 0; return; }
      html = `<b>${w.who(a)}</b><br>${HULLS[a.def.hull].name}<br>${this.taskText(a)}`;
    } else if (hv.type === 'battle') {
      const wb = w.battles.find(x => x.id === hv.id);
      if (!wb) { t.style.opacity = 0; return; }
      html = `<b>⚔ Бой</b> — ${w.sectors[wb.sector].name}<br>${this.battleText(wb)}`;
    }
    t.innerHTML = html;
    t.style.opacity = 1;
    t.style.left = (e.clientX - b.left + 14) + 'px';
    t.style.top = (e.clientY - b.top + 12) + 'px';
  },

  taskText(a) {
    const w = this.world, T = a.task;
    if (a.battle) return '⚔ в бою';
    if (!T) return a.travel ? 'в пути' : 'ожидает';
    const sec = T.sector != null ? w.sectors[T.sector].name : '';
    const P = T.planet != null ? w.planets[T.planet].name : '';
    switch (T.type) {
      case 'buy': return `торговля: закупка ${GOOD[T.good].name.toLowerCase()} на ${P}`;
      case 'sell': return `торговля: везёт груз на ${P}`;
      case 'embassy': return `посольство к ${w.factions[T.to].short}`;
      case 'retire': return 'возвращается домой';
      case 'patrol': return `патрулирует ${sec}`;
      case 'raid': return `атака на ${P || sec}`;
      case 'assault': return `штурм пиратской базы в ${sec}`;
      case 'colonize': return `колонизация ${P}`;
      case 'mine': return `добыча руды в ${sec}`;
      case 'hunt': return a.faction === PIRATE ? `охотится в секторе ${sec}` : `охота на пиратов: ${sec}`;
      case 'home': return `везёт добычу на базу (${Math.round(a.loot)} кр.)`;
      case 'courier': return `курьер для ${w.factions[T.faction].short} → ${P} (+${T.reward} кр.)`;
      case 'goto': return `летит в ${sec}`;
      case 'quest': case 'questDock': { const q = w.questById && w.questById(T.quest); return q ? `поручение: ${q.title}` : 'особое поручение'; }
    }
    return T.type;
  },
  battleText(wb) {
    const w = this.world;
    const side = s => wb.b.ships.filter(sh => sh.side === s && sh.alive).map(sh => { const a = w.agents.get(sh.ref); return a ? w.who(a) : sh.name; });
    const a = side(0), b = side(1);
    return `Идёт ${w.day - wb.day + 1}-й день, раунд ${wb.b.round}<br><span style="color:#7df9ff">${a.join(', ') || '—'}</span><br>против<br><span style="color:#ff9e6b">${b.join(', ') || '—'}</span>`;
  },

  // положение корабля на карте (anim — доля анимации текущего дня)
  agentPos(a, k = 1) {
    const w = this.world;
    const cur = this.calcPos(a);
    const prev = this.prevPos.get(a.id);
    if (!cur) return null;
    if (!prev || k >= 1) return cur;
    return [U.lerp(prev[0], cur[0], k), U.lerp(prev[1], cur[1], k)];
  },
  calcPos(a) {
    const w = this.world;
    if (a.travel) {
      const A = w.sectors[a.travel.from], B = w.sectors[a.travel.to];
      const f = (a.travel.total - a.travel.left + 0.5) / (a.travel.total + 0.5);
      return [U.lerp(A.x, B.x, f), U.lerp(A.y, B.y, f)];
    }
    if (a.loc == null) return null;
    const s = w.sectors[a.loc];
    const ang = (a.id * 2.399) % (Math.PI * 2), r = 26 + (a.id % 5) * 4;
    return [s.x + Math.cos(ang) * r, s.y + Math.sin(ang) * r];
  },

  togglePlay() {
    this.playing = !this.playing;
    this.els.play.textContent = this.playing ? '⏸ Пауза' : '▶ Авто';
    this.els.play.classList.toggle('primary', this.playing);
  },
  async nextDay() {
    if (this.busy) return;
    this.busy = true;
    this.prevPos = new Map();
    for (const a of this.world.agents.values()) { const p = this.agentPos(a, this.anim); if (p) this.prevPos.set(a.id, p); }
    const lastEv = this.world.events.length;
    await this.world.tick();
    this.anim = 0;
    this.busy = false;
    const fresh = this.world.events.slice(lastEv);
    if (fresh.some(e => e.type === 'war' || e.type === 'peace')) Sound.special('nova');
    else if (fresh.some(e => e.type === 'battle')) Sound.hit('hull');
    this.refresh();
  },

  // ---------- Панель ----------
  refresh() {
    const w = this.world, E = this.els;
    if (!E) return;
    E.day.innerHTML = `День <b>${w.day}</b> · кораблей ${w.agents.size} · боёв ${w.battles.length}`;
    const labels = { factions: 'Фракции', events: 'События', pilots: 'Пилоты', sel: 'Выбрано' };
    E.tabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.textContent === labels[this.tab]));
    E.body.innerHTML = '';
    if (this.tab === 'factions') this.renderFactions();
    else if (this.tab === 'events') this.renderEvents();
    else if (this.tab === 'pilots') this.renderPilots();
    else this.renderSel();
  },
  renderFactions() {
    const w = this.world, B = this.els.body;
    const rows = w.summary().sort((a, b) => b.pop - a.pop);
    for (const r of rows) {
      const f = r.f;
      const row = h('div', { class: 'gx-f' + (f.alive ? '' : ' dead') + (this.focusFaction === f.idx ? ' on' : ''), onclick: () => { this.focusFaction = this.focusFaction === f.idx ? null : f.idx; this.refresh(); } },
        h('i', { class: 'fdot', style: { background: f.color, boxShadow: `0 0 8px ${f.color}` } }),
        h('div', { class: 'fb' },
          h('div', { class: 'fn' }, f.name),
          h('div', { class: 'fs' }, `🪐 ${r.planets} · 👥 ${r.pop.toFixed(1)} млн · 💰 ${Math.round(r.treasury).toLocaleString('ru')} · ТУ ${U.roman(f.tech)} · 🚀 ${r.ships}`),
          r.wars.length ? h('div', { class: 'fw' }, '⚔ война: ' + r.wars.map(x => w.factions[x].short).join(', ')) : null,
          h('div', { class: 'fs dim' }, `потери ${f.st.lost} (пираты ${f.st.lostToPirates}) · миссии ${f.st.missionsOk}/${f.st.missionsFail}`)));
      B.appendChild(row);
    }
    // отношения выбранной фракции
    if (this.focusFaction != null) {
      const f = w.factions[this.focusFaction];
      B.appendChild(h('div', { class: 'ph sm' }, `Отношения: ${f.short}`));
      const list = h('div', { class: 'gx-rel' });
      for (const o of w.factions) {
        if (o === f || !o.alive) continue;
        const v = Math.round(f.rel[o.idx]);
        list.appendChild(h('div', null, h('span', { style: { color: o.color } }, o.short),
          h('i', { class: 'relbar' }, h('b', { style: { width: Math.abs(v) / 2 + '%', left: v < 0 ? (50 - Math.abs(v) / 2) + '%' : '50%', background: v < 0 ? '#ff4d6d' : '#2ee66b' } })),
          h('span', { class: f.wars.has(o.idx) ? 'red' : '' }, f.wars.has(o.idx) ? '⚔ ' + v : String(v))));
      }
      B.appendChild(list);
    }
    const pir = [...w.agents.values()].filter(a => a.faction === PIRATE);
    B.appendChild(h('div', { class: 'gx-f pir' }, h('i', { class: 'fdot', style: { background: PIRATES.color } }),
      h('div', { class: 'fb' }, h('div', { class: 'fn' }, 'Пираты'),
        h('div', { class: 'fs' }, `баз ${w.bases.filter(b => b.alive).length} · кораблей ${pir.length} · награблено ${Math.round(w.stats.lootTotal).toLocaleString('ru')} кр.`))));
  },
  renderEvents() {
    const w = this.world, B = this.els.body;
    const list = h('div', { class: 'gx-ev' });
    for (const e of w.events.slice(-160).reverse()) {
      const el = h('div', { class: 'ev ' + e.type }, h('b', null, `д${e.day} `), e.text);
      if (e.s != null) el.addEventListener('click', () => { const s = w.sectors[e.s]; this.cam.x = s.x; this.cam.y = s.y; this.sel = { type: 'sector', id: e.s }; });
      list.appendChild(el);
    }
    B.appendChild(list);
  },
  renderPilots() {
    const w = this.world, B = this.els.body;
    const pilots = [...w.agents.values()].filter(a => a.kind === 'pilot').sort((a, b) => b.credits - a.credits);
    for (const p of pilots) {
      const tt = this.taskText(p), showIntent = p.intent && p.ctrl !== 'human' && !tt.startsWith(p.intent);
      const row = h('div', { class: 'gx-f' + (p.ctrl === 'human' ? ' me' : ''), onclick: () => { this.sel = { type: 'agent', id: p.id }; this.tab = 'sel'; this.refresh(); } },
        h('img', { class: 'pimg2', src: GFX.shipImage(p.def.hull, 0, 80) }),
        h('div', { class: 'fb' },
          h('div', { class: 'fn' }, p.name, p.member >= 0 ? h('span', { style: { color: w.factions[p.member].color } }, ` [${w.factions[p.member].short}]`) : h('span', { class: 'dim' }, ' [наёмник]')),
          h('div', { class: 'fs' }, `${HULLS[p.def.hull].name} · ТУ ${w.shipTier(p).toFixed(1)} · 💰 ${Math.round(p.credits).toLocaleString('ru')} · ☠ ${p.kills}`),
          h('div', { class: 'fs dim' }, (showIntent ? '🧠 ' + p.intent + ' · ' : '') + tt)));
      B.appendChild(row);
    }
  },
  renderSel() {
    const w = this.world, B = this.els.body, S = this.sel;
    if (!S) { B.appendChild(h('div', { class: 'empty-note' }, 'Щёлкните по сектору, кораблю или бою на карте')); return; }
    if (S.type === 'sector') {
      const s = w.sectors[S.id];
      const own = s.owner >= 0 ? w.factions[s.owner] : null;
      B.appendChild(h('div', { class: 'ph' }, s.name, h('span', { style: { color: own ? own.color : '#aaa' } }, ' · ' + (own ? own.short : 'ничейный'))));
      if (this.pilotMode && w.player) {
        const p = w.player, here = p.loc === s.id;
        const from = p.loc != null ? p.loc : p.travel ? p.travel.to : null;
        B.appendChild(here ? h('div', { class: 'fs gold' }, 'Вы здесь') : h('div', null,
          h('div', { class: 'fs' }, from != null ? `Прыжков: ${w.hops(from, s.id)}` : ''),
          h('button', { class: 'btn primary', onclick: () => {
            p.route = s.id;
            if (p.loc != null && !p.battle) { w.undock(); p.target = { type: 'gate', to: w.N[p.loc][s.id] }; }
            SectorUI.backFromGalaxy();
          } }, '🧭 Проложить курс сюда')));
      }
      if (s.base) { const b = w.bases.find(x => x.id === s.base); if (b) B.appendChild(h('div', { class: 'gx-base' }, `☠ Пиратская база «${b.name}»: богатство ${Math.round(b.wealth)}, оборона ${Math.round(b.defense)}`)); }
      for (const pid of s.planets) {
        const p = w.planets[pid];
        const po = p.owner >= 0 ? w.factions[p.owner] : null;
        const box = h('div', { class: 'gx-pl' },
          h('div', { class: 'pn' }, h('i', { class: 'pdot', style: { background: PLANET_TYPES[p.type].color } }), p.name,
            h('span', { style: { color: po ? po.color : '#888' } }, ' · ' + (p.pop > 0 ? (po ? po.short : 'независимая') : 'необитаема'))),
          p.pop > 0 ? h('div', { class: 'fs' }, `${PLANET_TYPES[p.type].name} · 👥 ${p.pop.toFixed(1)} млн · стабильность ${Math.round(p.stability * 100)}% · оборона ${Math.round(p.defense)}${p.shipyard ? ' · верфь ТУ ' + U.roman(w.yardTier(p)) : ''}`) : null);
        if (p.pop > 0) {
          const tbl = h('div', { class: 'prices' });
          for (const g of GOODS) {
            const r = p.price[g.id] / g.base;
            tbl.appendChild(h('span', { title: `${g.name}: запас ${Math.round(p.stock[g.id])}`, class: r < 0.8 ? 'cheap' : r > 1.3 ? 'dear' : '' }, `${g.icon}${p.price[g.id]}`));
          }
          box.appendChild(tbl);
        }
        B.appendChild(box);
      }
      const ships = w.present(s.id);
      B.appendChild(h('div', { class: 'ph sm' }, `Корабли в секторе: ${ships.length}`));
      for (const a of ships) B.appendChild(h('div', { class: 'gx-ag', onclick: () => { this.sel = { type: 'agent', id: a.id }; this.refresh(); } }, `${AGENT_KINDS[a.kind].icon} ${w.who(a)}`, h('span', { class: 'dim' }, ' — ' + this.taskText(a))));
      for (const wb of w.battles.filter(x => x.sector === s.id)) B.appendChild(h('div', { class: 'gx-bt', html: '⚔ ' + this.battleText(wb) }));
    } else if (S.type === 'agent') {
      const a = w.agents.get(S.id);
      if (!a) { B.appendChild(h('div', { class: 'empty-note' }, 'Корабль больше не существует')); return; }
      const st = a.s;
      B.appendChild(h('div', null,
        h('div', { class: 'ph' }, AGENT_KINDS[a.kind].icon + ' ' + w.who(a)),
        h('img', { class: 'gx-shipimg', src: GFX.shipImage(a.def.hull, a.faction === PIRATE ? 1 : 0, 160) }),
        h('div', { class: 'fs' }, `${HULLS[a.def.hull].name} · корпус ${Math.round(a.hp)}/${a.maxHp} · щит ${Math.round(st.maxShield)}${a.kind === 'pilot' ? ' · ТУ ' + w.shipTier(a).toFixed(1) : ''}${st.broken ? ' · сломано модулей: ' + st.broken : ''}`),
        h('div', { class: 'fs' }, `Задание: ${this.taskText(a)}`),
        h('div', { class: 'fs' }, `Скорость: ${Math.round(a.speed)} ед./день · трюм ${Math.round(w.cargoUsed(a))}/${a.cargoCap}`),
        a.kind === 'pilot' ? h('div', { class: 'fs' }, `Кредиты: ${Math.round(a.credits).toLocaleString('ru')} · уничтожено: ${a.kills} · ${a.member >= 0 ? 'служит: ' + w.factions[a.member].name : 'свободный наёмник'}`) : null,
        a.kind === 'pilot' && a.ctrl !== 'human' ? h('div', { class: 'fs' }, '🧠 ' + (a.intent || 'думает')) : null,
        a.kind === 'pilot' ? h('div', { class: 'fs dim' }, 'Репутация: ' + (Object.entries(a.rep).filter(([, v]) => Math.abs(v) >= 3).map(([f, v]) => `${w.factions[f].short} ${v > 0 ? '+' : ''}${Math.round(v)}`).join(', ') || 'нет')) : null,
        a.loot ? h('div', { class: 'fs' }, `Добыча: ${Math.round(a.loot)} кр.`) : null,
        Object.keys(a.cargo).length ? h('div', { class: 'fs' }, 'Груз: ' + Object.entries(a.cargo).map(([g, q]) => `${GOOD[g].icon} ${GOOD[g].name} ×${Math.round(q)}`).join(', ')) : null,
        h('div', { class: 'ph sm' }, 'Вооружение'),
        h('div', { class: 'fs' }, st.weapons.map(x => x.it.name).join(', ') || 'нет')));
    } else if (S.type === 'battle') {
      const wb = w.battles.find(x => x.id === S.id);
      if (!wb) { B.appendChild(h('div', { class: 'empty-note' }, 'Бой завершён')); return; }
      U.add(B, h('div', { class: 'ph' }, '⚔ Бой в секторе ' + w.sectors[wb.sector].name), h('div', { class: 'gx-bt', html: this.battleText(wb) }),
        h('div', { class: 'fs dim' }, `За день проходит ${BATTLE_ROUNDS_PER_DAY} раунда боя — прилетающие корабли могут вступить в бой.`),
        h('div', { class: 'gx-log' }, wb.b.log.slice(-25).map(e => h('div', { class: 'le ' + e.cls + ' s' + e.side }, e.text))));
    }
  },

  // ---------- Отрисовка ----------
  frame(dt) {
    if (!this.active || !this.els || !this.bg) return;
    // размер холста следует за окном (иначе картинка растягивается и щелчок «уезжает»)
    const r = this.els.cv.getBoundingClientRect();
    if (r.width > 0 && Math.abs(this.els.cv.width - Math.round(r.width * this.dpr)) > 1) { const k = Math.round(r.width * this.dpr) / this.els.cv.width; this.resize(); if (this.fit && Math.abs(k - 1) > 0.2) this.fit(); }
    this.t += dt;
    if (this.anim < 1) this.anim = Math.min(1, this.anim + dt * Math.max(1.6, this.daysPerSec * 1.2));
    if (this.playing && !this.busy && this.anim >= 1) {
      this.acc = (this.acc || 0) + dt;
      if (this.acc >= 1 / this.daysPerSec) { this.acc = 0; this.nextDay(); }
    }
    this.render();
  },

  render() {
    const w = this.world, cv = this.els.cv, ctx = cv.getContext('2d'), d = this.dpr, z = this.cam.z;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.bg) ctx.drawImage(this.bg, 0, 0); else { ctx.fillStyle = '#04060f'; ctx.fillRect(0, 0, cv.width, cv.height); }
    const S = (x, y) => this.toScreen(x, y);
    // территории фракций
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of w.sectors) {
      if (s.owner < 0) continue;
      const f = w.factions[s.owner];
      const [x, y] = S(s.x, s.y), r = 105 * z;
      const dim = this.focusFaction != null && this.focusFaction !== s.owner ? 0.35 : 1;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, U.rgba(f.color, 0.2 * dim)); g.addColorStop(0.7, U.rgba(f.color, 0.07 * dim)); g.addColorStop(1, U.rgba(f.color, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    // гиперкоридоры
    for (const L of w.lanes) {
      const [x1, y1] = S(w.sectors[L.a].x, w.sectors[L.a].y), [x2, y2] = S(w.sectors[L.b].x, w.sectors[L.b].y);
      const g = ctx.createLinearGradient(x1, y1, x2, y2);
      const ca = w.sectors[L.a].owner >= 0 ? w.factions[w.sectors[L.a].owner].color : '#8aa0c8';
      const cb = w.sectors[L.b].owner >= 0 ? w.factions[w.sectors[L.b].owner].color : '#8aa0c8';
      g.addColorStop(0, U.rgba(ca, 0.35)); g.addColorStop(1, U.rgba(cb, 0.35));
      ctx.strokeStyle = g; ctx.lineWidth = 1.5 * d;
      ctx.setLineDash([6 * d, 6 * d]);
      ctx.lineDashOffset = -this.t * 10 * d;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    ctx.setLineDash([]);
    // секторы: звезда, планеты, название
    for (const s of w.sectors) {
      const [x, y] = S(s.x, s.y);
      const sel = this.sel && this.sel.type === 'sector' && this.sel.id === s.id;
      const hov = this.hover && this.hover.type === 'sector' && this.hover.id === s.id;
      const sr = (5 + s.starSize * 4) * Math.max(0.7, z) * d;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(x, y, 0, x, y, sr * 4);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.15, s.star); g.addColorStop(1, U.rgba(s.star.length === 7 ? s.star : '#ffffff', 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, sr * 4, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      if (s.asteroids) {
        ctx.fillStyle = 'rgba(180,170,150,0.5)';
        for (let i = 0; i < 14; i++) { const a = i * 0.45 + this.t * 0.02, rr = 52 * z + (i % 3) * 3 * z; ctx.fillRect(x + Math.cos(a) * rr, y + Math.sin(a) * rr, 1.5 * d, 1.5 * d); }
      }
      for (const pid of s.planets) {
        const p = w.planets[pid];
        const a = p.angle + this.t * 0.05 * (40 / p.orbit);
        const px = x + Math.cos(a) * p.orbit * z * 0.9, py = y + Math.sin(a) * p.orbit * z * 0.9;
        ctx.strokeStyle = 'rgba(150,180,255,0.07)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x, y, p.orbit * z * 0.9, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = p.pop > 0 ? PLANET_TYPES[p.type].color : '#5a5f6a';
        ctx.beginPath(); ctx.arc(px, py, (2 + p.size * 2.2) * Math.max(0.7, z) * d, 0, Math.PI * 2); ctx.fill();
        if (p.pop > 0 && p.owner >= 0) { ctx.strokeStyle = w.factions[p.owner].color; ctx.lineWidth = 1.2 * d; ctx.stroke(); }
      }
      if (s.base) {
        ctx.font = `${16 * d}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ff4d4d'; ctx.fillText('☠', x - 30 * z, y + 30 * z);
      }
      if (sel || hov) {
        ctx.strokeStyle = sel ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1.5 * d;
        ctx.beginPath(); ctx.arc(x, y, 60 * z, 0, Math.PI * 2); ctx.stroke();
      }
      // на узком экране подписи мешают друг другу: показываем только важные, остальные — по нажатию
      const narrow = this.els.cv.width / d < 640 && z < 0.9;
      const important = sel || hov || (w.player && w.player.loc != null && (w.player.loc === s.id || w.neighbors(w.player.loc).includes(s.id))) || w.openQuests().some(q => q.sector === s.id);
      if (!narrow || important) {
        ctx.font = `600 ${Math.max(11, 12 * Math.min(1.4, z + 0.3)) * d}px "Exo 2", sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.lineWidth = 3.5 * d; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(2,4,12,0.85)';
        ctx.strokeText(s.name, x, y + 62 * z);
        ctx.fillStyle = s.owner >= 0 ? U.rgba(w.factions[s.owner].color, 0.95) : '#d4ddf2';
        ctx.fillText(s.name, x, y + 62 * z);
      }
    }
    // корабли
    for (const a of w.agents.values()) {
      const p = this.agentPos(a, U.ease.inOutCubic(this.anim));
      if (!p) continue;
      const [x, y] = S(p[0], p[1]);
      const col = a.faction === PIRATE ? '#ff3b3b' : a.kind === 'pilot' ? '#ffe066' : w.factions[a.faction] ? w.factions[a.faction].color : '#ccc';
      const dim = this.focusFaction != null && a.faction !== this.focusFaction ? 0.3 : 1;
      let ang = 0;
      if (a.travel) { const A = w.sectors[a.travel.from], B = w.sectors[a.travel.to]; ang = Math.atan2(B.y - A.y, B.x - A.x); }
      const sz = (a.kind === 'warship' ? 6 : a.kind === 'trader' ? 4.5 : 5) * d * Math.max(0.8, z);
      ctx.save();
      ctx.translate(x, y); ctx.rotate(ang);
      ctx.globalAlpha = dim;
      ctx.fillStyle = col;
      ctx.shadowColor = col; ctx.shadowBlur = 6 * d;
      ctx.beginPath();
      if (a.kind === 'trader' || a.kind === 'miner' || a.kind === 'colonist') { ctx.rect(-sz * 0.7, -sz * 0.5, sz * 1.4, sz); }
      else { ctx.moveTo(sz, 0); ctx.lineTo(-sz * 0.8, -sz * 0.6); ctx.lineTo(-sz * 0.4, 0); ctx.lineTo(-sz * 0.8, sz * 0.6); ctx.closePath(); }
      ctx.fill();
      ctx.restore();
      if (this.sel && this.sel.type === 'agent' && this.sel.id === a.id) {
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5 * d;
        ctx.beginPath(); ctx.arc(x, y, 10 * d, 0, Math.PI * 2); ctx.stroke();
        // маршрут
        if (a.dest != null) {
          let cur = a.travel ? a.travel.to : a.loc, guard = 0;
          ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.setLineDash([3 * d, 4 * d]);
          ctx.beginPath(); ctx.moveTo(x, y);
          while (cur != null && guard++ < 30) {
            const [sx2, sy2] = S(w.sectors[cur].x, w.sectors[cur].y);
            ctx.lineTo(sx2, sy2);
            if (cur === a.dest) break;
            cur = w.N[cur][a.dest];
          }
          ctx.stroke(); ctx.setLineDash([]);
        }
      }
    }
    // особые поручения
    for (const q of (w.openQuests ? w.openQuests() : [])) {
      if (q.sector == null) continue;
      const s = w.sectors[q.sector];
      const [x, y] = S(s.x - 26, s.y - 26);
      const mine = w.player && q.takers.includes(w.player.id);
      ctx.font = `${(mine ? 16 : 13) * d}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = mine ? '#ffe066' : 'rgba(125,249,255,0.85)';
      ctx.fillText(QUEST_TYPES[q.type].icon, x, y);
    }
    // игрок и его маршрут
    if (w.player && w.player.alive) {
      const p = w.player;
      const pos = this.calcPos(p);
      if (pos) {
        const [x, y] = S(pos[0], pos[1]);
        if (p.route != null) {
          let cur = p.travel ? p.travel.to : p.loc, guard = 0;
          ctx.strokeStyle = 'rgba(255,224,102,0.8)'; ctx.lineWidth = 2.5 * d; ctx.setLineDash([8 * d, 6 * d]);
          ctx.beginPath(); ctx.moveTo(x, y);
          while (cur != null && guard++ < 30) { const [sx2, sy2] = S(w.sectors[cur].x, w.sectors[cur].y); ctx.lineTo(sx2, sy2); if (cur === p.route) break; cur = w.N[cur][p.route]; }
          ctx.stroke(); ctx.setLineDash([]);
        }
        const pr = (10 + 4 * Math.sin(this.t * 4)) * d;
        ctx.strokeStyle = '#ffe066'; ctx.lineWidth = 2.5 * d;
        ctx.beginPath(); ctx.arc(x, y, pr, 0, Math.PI * 2); ctx.stroke();
        ctx.font = `800 ${11 * d}px "Exo 2", sans-serif`; ctx.fillStyle = '#ffe066'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText('ВЫ', x, y - pr - 2 * d);
      }
    }
    // бои
    for (const wb of w.battles) {
      const s = w.sectors[wb.sector];
      const [x, y] = S(s.x + 22, s.y - 22);
      const pulse = 0.5 + 0.5 * Math.sin(this.t * 6 + wb.id);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(x, y, 0, x, y, 22 * d);
      g.addColorStop(0, `rgba(255,80,60,${0.5 + pulse * 0.4})`); g.addColorStop(1, 'rgba(255,60,40,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 22 * d, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.font = `${15 * d}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff'; ctx.fillText('⚔', x, y);
      ctx.font = `700 ${10 * d}px "Exo 2", sans-serif`;
      ctx.fillText(String(wb.b.ships.filter(sh => sh.alive).length), x + 13 * d, y - 11 * d);
    }
  },
};
