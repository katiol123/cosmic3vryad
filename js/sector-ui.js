'use strict';
// ============================================================
//  Кампания: вид сектора, корабль игрока, стыковка с планетами
// ============================================================

const SectorUI = {
  active: false,
  world: null,
  cam: { x: 0, y: 0, z: 0.4 },
  follow: true,
  sel: null,
  hover: null,
  anim: 1,
  prev: new Map(),
  leaving: [],
  busy: false,
  t: 0,
  dpr: 1,
  tab: 'target',
  heads: new Map(),

  // ---------- запуск ----------
  newGame(name, seed) {
    const w = new World({ seed: seed != null ? seed : Math.floor(Math.random() * 1e9) });
    w.createPlayer(name || 'Рейнджер');
    this.world = w;
    GalaxyUI.world = w;
    this.open();
    const pl = w.planets[w.player.docked];
    setTimeout(() => this.openDock(pl), 400);
  },
  open() {
    const w = this.world;
    w.hooks = { dock: pl => this.openDock(pl), liveBattle: (wb, dt) => this.liveBattle(wb, dt) };
    GalaxyUI.active = false;
    this.build();
    Screens.show('scr-sector');
    this.active = true;
    this.viewSector = w.player.loc != null ? w.player.loc : (w.player.travel ? w.player.travel.to : 0);
    requestAnimationFrame(() => { this.resize(); this.centerOnPlayer(true); this.refresh(); });
    Sound.startDrone();
  },
  close() {
    this.active = false;
    this.closeDock();
    Sound.stopDrone();
    Menu.build();
    Screens.show('scr-menu');
  },

  build() {
    const el = document.getElementById('scr-sector');
    el.innerHTML = '';
    const E = this.els = {};
    E.title = h('div', { class: 'sx-title' });
    E.day = h('div', { class: 'gx-day' });
    E.turn = h('button', { class: 'btn primary big', onclick: () => this.nextDay() }, '⏭ Ход');
    el.appendChild(h('div', { class: 'topbar' },
      h('button', { class: 'btn ghost', onclick: () => this.close() }, '← Меню'),
      E.title, E.day,
      h('div', { class: 'grow' }),
      h('button', { class: 'btn', onclick: () => this.openGalaxy() }, '🗺 Карта галактики'),
      h('button', { class: 'ibtn', title: 'Центрировать на корабле', onclick: () => { this.follow = true; this.centerOnPlayer(true); } }, '⌖'),
      E.snd = h('button', { class: 'ibtn' + (Sound.on ? ' on' : ''), title: 'Звук', onclick: () => { E.snd.classList.toggle('on', Sound.toggle()); } }, '🔊'),
      E.turn));
    E.cv = h('canvas', { class: 'sx-cv' });
    E.tip = h('div', { class: 'gx-tip' });
    E.toasts = h('div', { class: 'sx-toasts' });
    E.hud = h('div', { class: 'sx-hud panel' });
    E.travel = h('div', { class: 'sx-travel' });
    E.dock = h('div', { class: 'sx-dock' });
    E.side = h('div', { class: 'gx-side panel' });
    E.tabs = seg([['target', 'Цель'], ['missions', 'Задания'], ['cargo', 'Трюм'], ['pilot', 'Пилот'], ['news', 'Новости']], this.tab, v => { this.tab = v; this.refresh(); }, 'small tabs');
    E.body = h('div', { class: 'gx-body' });
    E.side.append(E.tabs, E.body);
    el.appendChild(h('div', { class: 'gx-main' },
      h('div', { class: 'gx-map panel sx-map' }, E.cv, E.tip, E.toasts, E.hud, E.travel, E.dock,
        h('div', { class: 'gx-legend' }, 'Щелчок — лететь (планета: стыковка, ворота: прыжок) · по кораблю или бою — выбрать · колёсико — масштаб · пробел — ход')),
      E.side));
    this.bindMap();
    if (!this._ro) this._ro = new ResizeObserver(() => this.resize());
    this._ro.disconnect();
    this._ro.observe(E.cv);
    if (!this._keys) {
      this._keys = true;
      addEventListener('keydown', e => {
        if (!this.active || Screens.cur.id !== 'scr-sector') return;
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
        if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); if (!this.dockPl) this.nextDay(); }
      });
    }
  },

  resize() {
    const cv = this.els && this.els.cv;
    if (!cv) return;
    const r = cv.getBoundingClientRect();
    this.dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = Math.max(100, r.width * this.dpr); cv.height = Math.max(100, r.height * this.dpr);
    this.bgFor = null;
  },
  baseZoom() { const cv = this.els.cv; return Math.min(cv.width, cv.height) / (2 * 1080); },
  centerOnPlayer(snap) {
    const p = this.world.player;
    if (!this.els) return;
    if (snap) this.cam.z = this.baseZoom() * 1.5;
    const pos = this.playerPos();
    if (pos) { this.cam.x = pos[0]; this.cam.y = pos[1]; }
  },
  toScreen(x, y) { const c = this.cam, cv = this.els.cv; return [(x - c.x) * c.z + cv.width / 2, (y - c.y) * c.z + cv.height / 2]; },
  toWorld(sx, sy) { const c = this.cam, cv = this.els.cv; return [(sx - cv.width / 2) / c.z + c.x, (sy - cv.height / 2) / c.z + c.y]; },

  bindMap() {
    const cv = this.els.cv;
    let drag = null;
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      const b = cv.getBoundingClientRect();
      const sx = (e.clientX - b.left) * this.dpr, sy = (e.clientY - b.top) * this.dpr;
      const [wx, wy] = this.toWorld(sx, sy);
      const base = this.baseZoom();
      this.cam.z = U.clamp(this.cam.z * (e.deltaY < 0 ? 1.15 : 0.87), base * 0.8, base * 6);
      const [nx, ny] = this.toWorld(sx, sy);
      this.cam.x += wx - nx; this.cam.y += wy - ny;
      this.follow = false;
    }, { passive: false });
    cv.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, cx: this.cam.x, cy: this.cam.y, moved: false }; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', e => {
      const b = cv.getBoundingClientRect();
      const sx = (e.clientX - b.left) * this.dpr, sy = (e.clientY - b.top) * this.dpr;
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 5) { drag.moved = true; this.follow = false; }
        if (drag.moved) { this.cam.x = drag.cx - dx * this.dpr / this.cam.z; this.cam.y = drag.cy - dy * this.dpr / this.cam.z; }
      }
      this.hover = this.pick(sx, sy);
      this.showTip(e, b);
    });
    cv.addEventListener('pointerup', e => {
      if (drag && !drag.moved) {
        const b = cv.getBoundingClientRect();
        this.click((e.clientX - b.left) * this.dpr, (e.clientY - b.top) * this.dpr);
      }
      drag = null;
    });
    cv.addEventListener('pointerleave', () => { this.hover = null; this.els.tip.style.opacity = 0; });
  },

  // объекты сектора, видимые на экране
  objects() {
    const w = this.world, sid = this.viewSector, out = [];
    const s = w.sectors[sid];
    for (const pid of s.planets) { const p = w.planets[pid]; const [x, y] = w.planetPos(p, w.day - 1 + this.animK()); out.push({ type: 'planet', id: p.id, x, y, r: 22 + p.size * 20 }); }
    for (const n of w.neighbors(sid)) { const [x, y] = w.gatePos(sid, n); out.push({ type: 'gate', to: n, x, y, r: 34 }); }
    for (const q of w.openQuests()) if (q.sector === sid && q.point && !(q.type === 'relic' && q.stage === 1)) out.push({ type: 'quest', id: q.id, x: q.point[0], y: q.point[1], r: QUEST_POINT_R });
    if (s.base) { const [x, y] = w.basePos(sid); out.push({ type: 'base', id: s.base, x, y, r: 34 }); }
    for (const wb of w.battles) if (wb.sector === sid && wb.sx != null) out.push({ type: 'battle', id: wb.id, x: wb.sx, y: wb.sy, r: 70 });
    for (const a of w.agents.values()) {
      if (a.ctrl === 'human') continue;
      const p = this.agentPos(a);
      if (p) out.push({ type: 'ship', id: a.id, x: p[0], y: p[1], r: 18 });
    }
    return out;
  },
  animK() { return U.ease.inOutCubic(this.anim); },
  agentPos(a) {
    if (a.loc !== this.viewSector || a.travel || a.sx == null) return null;
    const pv = this.prev.get(a.id);
    const k = this.animK();
    return pv ? [U.lerp(pv[0], a.sx, k), U.lerp(pv[1], a.sy, k)] : [a.sx, a.sy];
  },
  playerPos() {
    const p = this.world.player;
    if (!p || p.loc !== this.viewSector || p.sx == null) return null;
    const pv = this.prev.get(p.id), k = this.animK();
    return pv ? [U.lerp(pv[0], p.sx, k), U.lerp(pv[1], p.sy, k)] : [p.sx, p.sy];
  },

  pick(sx, sy) {
    const [wx, wy] = this.toWorld(sx, sy);
    const z = this.cam.z, d = this.dpr;
    let best = null, bd = Infinity;
    for (const o of this.objects()) {
      const dd = Math.hypot(o.x - wx, o.y - wy) * z;
      const lim = Math.max(o.r * z, (o.type === 'ship' ? 12 : 16) * d);
      if (dd < lim && dd - (o.type === 'ship' ? 6 : 0) < bd) { bd = dd; best = o; }
    }
    return best || { type: 'point', x: wx, y: wy };
  },

  click(sx, sy) {
    const w = this.world, p = w.player;
    const o = this.pick(sx, sy);
    if (!p || !p.alive) return;
    if (p.travel || p.loc !== this.viewSector) { this.sel = o.type !== 'point' ? o : null; this.tab = 'target'; this.refresh(); return; }
    if (p.battle) { this.toast('Вы в бою: продолжайте бой или попытайтесь уйти'); return; }
    this.sel = o.type !== 'point' ? o : null;
    if (o.type === 'planet') this.setCourse({ type: 'planet', id: o.id });
    else if (o.type === 'gate') this.setCourse({ type: 'gate', to: o.to });
    else if (o.type === 'point') this.setCourse({ type: 'point', x: o.x, y: o.y });
    else if (o.type === 'base') this.setCourse({ type: 'point', x: o.x * 0.9, y: o.y * 0.9 });
    else if (o.type === 'quest') this.setCourse({ type: 'quest', id: o.id });
    this.tab = 'target';
    this.refresh();
  },
  setCourse(t) {
    const w = this.world;
    w.undock();
    this.closeDock();
    w.player.target = t;
    w.player.route = t.type === 'gate' ? w.player.route : null;
    Sound.click();
  },

  showTip(e, b) {
    const t = this.els.tip, w = this.world, o = this.hover;
    if (!o || o.type === 'point') { t.style.opacity = 0; return; }
    let html = '';
    if (o.type === 'planet') {
      const p = w.planets[o.id], f = p.owner >= 0 ? w.factions[p.owner] : null;
      html = `<b>${p.name}</b><br>${p.pop > 0 ? PLANET_TYPES[p.type].name + ' · ' + p.pop.toFixed(1) + ' млн' : 'необитаема'}<br><span style="color:${f ? f.color : '#aaa'}">${f ? f.name : p.pop > 0 ? 'независимая' : ''}</span>${p.shipyard ? '<br>верфь ТУ ' + U.roman(w.yardTier(p)) : ''}`;
    } else if (o.type === 'gate') {
      const s = w.sectors[o.to], f = s.owner >= 0 ? w.factions[s.owner] : null;
      html = `<b>Гиперворота → ${s.name}</b><br><span style="color:${f ? f.color : '#aaa'}">${f ? f.name : 'ничейный сектор'}</span><br>в коридоре ≈ ${w.laneDays(w.player, w.laneBetween(this.viewSector, o.to))} дн.`;
    } else if (o.type === 'ship') {
      const a = w.agents.get(o.id);
      if (!a) return;
      html = `<b>${w.who(a)}</b><br>${HULLS[a.def.hull].name}<br>${GalaxyUI.taskText.call({ world: w }, a)}${w.hostile(w.player, a) ? '<br><b style="color:#ff6b6b">враждебен</b>' : ''}`;
    } else if (o.type === 'battle') {
      const wb = w.battles.find(x => x.id === o.id);
      if (wb) html = `<b>⚔ Идёт бой</b><br>${GalaxyUI.battleText.call({ world: w }, wb)}`;
    } else if (o.type === 'base') {
      const bs = w.bases.find(x => x.id === o.id);
      html = `<b>☠ Пиратская база «${bs ? bs.name : ''}»</b><br>Опасно!`;
    }
    t.innerHTML = html;
    t.style.opacity = 1;
    t.style.left = (e.clientX - b.left + 14) + 'px';
    t.style.top = (e.clientY - b.top + 12) + 'px';
  },

  toast(text, cls = '') {
    const el = h('div', { class: 'sx-toast ' + cls }, text);
    this.els.toasts.appendChild(el);
    while (this.els.toasts.childNodes.length > 5) this.els.toasts.removeChild(this.els.toasts.firstChild);
    setTimeout(() => el.classList.add('out'), 4200);
    setTimeout(() => el.remove(), 4800);
  },

  // ---------- ход ----------
  async nextDay() {
    const w = this.world, p = w.player;
    if (this.busy || !p) return;
    this.busy = true;
    this.els.turn.disabled = true;
    this.closeDock(true);
    // запоминаем положения для плавной анимации
    const sid = this.viewSector;
    const prev = new Map(), was = new Set();
    for (const a of w.agents.values()) {
      const pos = a.ctrl === 'human' ? this.playerPos() : this.agentPos(a);
      if (pos) { prev.set(a.id, pos); if (a.loc === sid) was.add(a.id); }
    }
    const lastEv = w.events.length;
    await w.tick();
    // кто прилетел — появляется у ворот, кто улетел — уходит в ворота
    this.leaving = [];
    for (const a of w.agents.values()) {
      if (a.loc === sid && !prev.has(a.id) && a.arrFrom != null && a.ctrl !== 'human') prev.set(a.id, w.gatePos(sid, a.arrFrom));
      if (was.has(a.id) && a.travel && a.travel.from === sid) this.leaving.push({ a, from: prev.get(a.id), to: w.gatePos(sid, a.travel.to) });
    }
    if (p.loc === sid && !prev.has(p.id) && p.arrFrom != null) prev.set(p.id, w.gatePos(sid, p.arrFrom));
    this.prev = prev;
    this.anim = 0;
    // вид следует за игроком
    const np = w.player;
    if (np.loc != null && np.loc !== this.viewSector) { this.viewSector = np.loc; this.prev = new Map(); this.anim = 1; this.bgFor = null; this.follow = true; this.centerOnPlayer(true); Sound.special('nova'); }
    // уведомления
    for (const e of w.events.slice(lastEv)) {
      if (e.type === 'player') this.toast(e.text, 'me');
      else if ((e.s === this.viewSector && ['battle', 'pirate', 'war'].includes(e.type)) || e.type === 'war' || e.type === 'peace') this.toast(e.text);
    }
    this.busy = false;
    this.els.turn.disabled = false;
    this.refresh();
  },

  // бой игрока за один день: на экране боя «три в ряд»
  async liveBattle(wb, dt) {
    const w = this.world;
    this.closeDock(true);
    await BattleUI.playLive(wb, dt, w);
    Screens.show('scr-sector');
    this.active = true;
    Sound.startDrone();
    if (wb.b.over) {
      const p = w.player;
      const won = wb.b.ships.some(sh => sh.alive && sh.ref === p.id);
      this.toast(won ? '🏆 Бой выигран!' : '💥 Бой окончен', won ? 'me' : 'bad');
    }
  },

  openGalaxy() {
    GalaxyUI.world = this.world;
    GalaxyUI.pilotMode = true;
    GalaxyUI.build();
    Screens.show('scr-galaxy');
    GalaxyUI.active = true;
    this.active = false;
    requestAnimationFrame(() => { GalaxyUI.resize(); GalaxyUI.fit(); GalaxyUI.refresh(); });
  },
  backFromGalaxy() {
    GalaxyUI.active = false;
    this.active = true;
    Screens.show('scr-sector');
    this.refresh();
  },

  // ---------- панели ----------
  refresh() {
    const w = this.world, E = this.els, p = w.player;
    if (!E) return;
    const s = w.sectors[this.viewSector], f = s.owner >= 0 ? w.factions[s.owner] : null;
    E.title.innerHTML = `<b>${s.name}</b> <span style="color:${f ? f.color : '#aaa'}">${f ? f.name : 'ничейный сектор'}</span>`;
    E.day.innerHTML = `День <b>${w.day}</b>`;
    const labels = { target: 'Цель', missions: 'Задания', cargo: 'Трюм', pilot: 'Пилот', news: 'Новости' };
    E.tabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.textContent === labels[this.tab]));
    this.renderHud();
    E.body.innerHTML = '';
    ({ target: () => this.renderTarget(), missions: () => this.renderMissions(), cargo: () => this.renderCargo(), pilot: () => this.renderPilot(), news: () => this.renderNews() })[this.tab]();
    E.turn.textContent = p && p.battle ? '⚔ Продолжить бой' : p && p.travel ? '⏭ Лететь дальше' : '⏭ Ход';
    // режим перелёта по коридору
    if (p && p.travel) {
      const a = w.sectors[p.travel.from], b = w.sectors[p.travel.to];
      E.travel.innerHTML = `<div class="tv-title">ГИПЕРКОРИДОР</div><div>${a.name} → <b>${b.name}</b></div><div class="tv-days">осталось ${p.travel.left} дн.</div>`;
      E.travel.classList.add('show');
    } else E.travel.classList.remove('show');
  },

  renderHud() {
    const w = this.world, p = w.player, E = this.els;
    if (!p) return;
    const wb = w.playerBattle();
    E.hud.innerHTML = '';
    const pct = (a, b) => (b > 0 ? U.clamp(a / b * 100, 0, 100) : 0) + '%';
    E.hud.append(
      h('div', { class: 'hd-top' }, h('img', { src: GFX.shipImage(p.def.hull, 0, 100) }),
        h('div', null, h('div', { class: 'hd-name' }, p.name), h('div', { class: 'hd-sub' }, HULLS[p.def.hull].name),
          h('div', { class: 'hd-cr' }, `💰 ${Math.round(p.credits).toLocaleString('ru')} кр.`))),
      Info.helpBind(h('div', { class: 'gauge hp' }, h('i', { style: { width: pct(p.hp, p.maxHp) } }), h('span', null, `Корпус ${Math.round(p.hp)} / ${p.maxHp}`)), 'Корпус'),
      h('div', { class: 'hd-row' }, `📦 ${Math.round(w.cargoUsed(p))}/${p.cargoCap}`, ` · ➤ ${Math.round(w.localSpeed(p))} ед./день`, p.member >= 0 ? h('span', { style: { color: w.factions[p.member].color } }, ` · ⚑ ${w.factions[p.member].short}`) : ' · наёмник'),
      h('div', { class: 'hd-task' }, this.courseText()));
    if (wb) {
      E.hud.appendChild(h('div', { class: 'hd-battle' },
        h('div', null, `⚔ Вы в бою (день ${w.day - wb.day + 1})`),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', onclick: () => this.nextDay() }, '⚔ Продолжить бой'),
          h('button', { class: 'btn', onclick: () => { const ok = w.playerEscape(); this.toast(ok ? 'Вы оторвались от противника' : 'Уйти не удалось — бой продолжится', ok ? 'me' : 'bad'); this.refresh(); } }, '↩ Попытаться уйти'))));
    }
    if (p.docked != null) E.hud.appendChild(h('button', { class: 'btn', onclick: () => this.openDock(w.planets[p.docked]) }, `🛰 Пристыкован: ${w.planets[p.docked].name}`));
  },
  courseText() {
    const w = this.world, p = w.player, t = p.target;
    if (p.travel) return `В коридоре к ${w.sectors[p.travel.to].name}`;
    if (p.battle) return 'В бою';
    if (p.docked != null) return `Пристыкован к ${w.planets[p.docked].name}`;
    if (!t) return p.route != null ? `Курс на ${w.sectors[p.route].name}` : 'Курс не задан — щёлкните по карте';
    const pos = w.targetPos(t);
    const d = pos ? Math.hypot(pos[0] - p.sx, pos[1] - p.sy) : 0;
    const days = Math.max(1, Math.ceil(d / w.localSpeed(p)));
    const name = t.type === 'planet' ? w.planets[t.id].name : t.type === 'gate' ? `ворота → ${w.sectors[t.to].name}` : t.type === 'ship' ? (w.agents.get(t.id) ? w.who(w.agents.get(t.id)) : 'корабль') : t.type === 'battle' ? 'место боя' : 'точка';
    return `Курс: ${name} · ≈ ${days} дн.${p.route != null ? ' · маршрут до ' + w.sectors[p.route].name : ''}`;
  },

  renderTarget() {
    const w = this.world, B = this.els.body, o = this.sel, p = w.player;
    if (!o) { B.appendChild(h('div', { class: 'empty-note' }, 'Выберите объект в секторе: планету, ворота, корабль или бой.')); this.renderSectorList(); return; }
    if (o.type === 'planet') {
      const pl = w.planets[o.id], f = pl.owner >= 0 ? w.factions[pl.owner] : null;
      U.add(B, h('div', { class: 'ph' }, pl.name), h('img', { class: 'sx-plimg', src: GFX.planet(pl, 120).canvas.toDataURL() }),
        h('div', { class: 'fs' }, pl.pop > 0 ? `${PLANET_TYPES[pl.type].name} · 👥 ${pl.pop.toFixed(1)} млн · стабильность ${Math.round(pl.stability * 100)}%` : 'Необитаемая планета'),
        f ? h('div', { class: 'fs', style: { color: f.color } }, f.name + (pl.shipyard ? ` · верфь ТУ ${U.roman(w.yardTier(pl))}` : '')) : null,
        pl.pop > 0 ? h('button', { class: 'btn primary', onclick: () => { if (p.docked === pl.id) this.openDock(pl); else this.setCourse({ type: 'planet', id: pl.id }); this.refresh(); } }, p.docked === pl.id ? '🛰 Открыть станцию' : '➤ Лететь и пристыковаться') : null);
    } else if (o.type === 'gate') {
      const s = w.sectors[o.to], f = s.owner >= 0 ? w.factions[s.owner] : null;
      U.add(B, h('div', { class: 'ph' }, 'Гиперворота → ' + s.name), h('div', { class: 'fs', style: { color: f ? f.color : '#aaa' } }, f ? f.name : 'ничейный сектор'),
        s.base ? h('div', { class: 'fs red' }, '☠ там пиратская база') : null,
        h('button', { class: 'btn primary', onclick: () => { this.setCourse({ type: 'gate', to: o.to }); this.refresh(); } }, '➤ Лететь к воротам'));
    } else if (o.type === 'ship') {
      const a = w.agents.get(o.id);
      if (!a) { B.appendChild(h('div', { class: 'empty-note' }, 'Корабль покинул сектор')); return; }
      const hostile = w.hostile(p, a);
      U.add(B, h('div', { class: 'ph' }, AGENT_KINDS[a.kind].icon + ' ' + w.who(a)), h('img', { class: 'gx-shipimg', src: GFX.shipImage(a.def.hull, a.faction === PIRATE ? 1 : 0, 160) }),
        h('div', { class: 'fs' }, `${HULLS[a.def.hull].name} · корпус ${Math.round(a.hp)}/${a.maxHp}`),
        h('div', { class: 'fs' }, GalaxyUI.taskText.call({ world: w }, a)),
        h('div', { class: 'fs' }, 'Оружие: ' + (a.s.weapons.map(x => x.it.base).join(', ') || 'нет')),
        hostile ? h('div', { class: 'fs red' }, 'Враждебен вам') : a.faction >= 0 && a.faction !== PIRATE ? h('div', { class: 'fs dim' }, 'Нападение испортит репутацию у ' + w.factions[a.faction].short) : null,
        !a.battle ? h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => { this.setCourse({ type: 'ship', id: a.id }); this.refresh(); } }, '➤ Лететь к нему'),
          h('button', { class: 'btn danger', onclick: () => { this.setCourse({ type: 'ship', id: a.id, attack: true }); this.refresh(); } }, '⚔ Атаковать')) : null);
    } else if (o.type === 'battle') {
      const wb = w.battles.find(x => x.id === o.id);
      if (!wb) { B.appendChild(h('div', { class: 'empty-note' }, 'Бой завершён')); return; }
      const sideNames = s => wb.b.ships.filter(sh => sh.side === s && sh.alive).map(sh => { const a = w.agents.get(sh.ref); return a ? w.who(a) : sh.name; });
      U.add(B, h('div', { class: 'ph' }, '⚔ Бой'), h('div', { class: 'gx-bt', html: GalaxyUI.battleText.call({ world: w }, wb) }));
      if (!p.battle) {
        U.add(B, h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => { this.setCourse({ type: 'battle', id: wb.id, side: 0 }); this.refresh(); } }, `⚑ За: ${sideNames(0)[0] || '—'}`),
          h('button', { class: 'btn', onclick: () => { this.setCourse({ type: 'battle', id: wb.id, side: 1 }); this.refresh(); } }, `⚑ За: ${sideNames(1)[0] || '—'}`)),
          h('div', { class: 'fs dim' }, 'Корабль долетит до места боя и вступит в него на выбранной стороне.'));
      }
      U.add(B, h('div', { class: 'gx-log' }, wb.b.log.slice(-15).map(e => h('div', { class: 'le ' + e.cls + ' s' + e.side }, e.text))));
    } else if (o.type === 'base') {
      const bs = w.bases.find(x => x.id === o.id);
      U.add(B, h('div', { class: 'ph' }, '☠ ' + (bs ? bs.name : 'База')), h('div', { class: 'fs' }, bs ? `Богатство ${Math.round(bs.wealth)} · оборона ${Math.round(bs.defense)}` : ''),
        h('div', { class: 'fs dim' }, 'Пиратская база. Её охраняют пираты, а штурмуют её карательные экспедиции фракций.'));
    }
  },
  renderSectorList() {
    const w = this.world, B = this.els.body, sid = this.viewSector;
    const s = w.sectors[sid];
    B.appendChild(h('div', { class: 'ph sm' }, 'Планеты'));
    for (const pid of s.planets) {
      const pl = w.planets[pid];
      B.appendChild(h('div', { class: 'gx-ag', onclick: () => { this.sel = { type: 'planet', id: pid }; this.refresh(); } },
        h('i', { class: 'pdot', style: { background: PLANET_TYPES[pl.type].color } }), ' ', pl.name, h('span', { class: 'dim' }, pl.pop > 0 ? ` — ${pl.owner >= 0 ? w.factions[pl.owner].short : 'независимая'}${pl.shipyard ? ', верфь' : ''}` : ' — необитаема')));
    }
    const ships = w.present(sid).filter(a => a.ctrl !== 'human');
    B.appendChild(h('div', { class: 'ph sm' }, `Корабли: ${ships.length}`));
    for (const a of ships) B.appendChild(h('div', { class: 'gx-ag' + (w.hostile(w.player, a) ? ' red' : ''), onclick: () => { this.sel = { type: 'ship', id: a.id }; this.refresh(); } }, `${AGENT_KINDS[a.kind].icon} ${w.who(a)}`));
  },
  renderMissions() {
    const w = this.world, B = this.els.body;
    const mineQ = w.pilotQuests(w.player);
    B.appendChild(h('div', { class: 'ph sm' }, `Особые поручения: ваши (${mineQ.length})`));
    for (const q of mineQ) B.appendChild(this.questCard(q, true));
    const rest = w.openQuests().filter(q => !mineQ.includes(q));
    B.appendChild(h('div', { class: 'ph sm' }, `Объявлены в галактике (${rest.length})`));
    for (const q of rest) B.appendChild(this.questCard(q, true));
    B.appendChild(h('div', { class: 'ph sm' }, 'Обычные задания'));
    const ms = w.missionsP || [];
    if (!ms.length) B.appendChild(h('div', { class: 'empty-note' }, 'Нет активных заданий. Их выдают на планетах фракций (вкладка «Задания» при стыковке).'));
    for (const o of ms) {
      const left = o.deadline - w.day;
      const prog = o.type === 'bounty' || o.type === 'war' ? ` · ${o.killed}/${o.count}` : '';
      B.appendChild(h('div', { class: 'gx-pl' }, h('div', { class: 'pn' }, '📜 ' + o.title),
        h('div', { class: 'fs' }, o.text), h('div', { class: 'fs' }, `Награда ${o.reward} кр. · осталось ${left} дн.${prog}`)));
    }
  },
  renderCargo() {
    const w = this.world, B = this.els.body, p = w.player;
    B.appendChild(h('div', { class: 'ph sm' }, `Трюм: ${Math.round(w.cargoUsed(p))} / ${p.cargoCap}`));
    const keys = Object.keys(p.cargo).filter(k => p.cargo[k] > 0);
    if (!keys.length) B.appendChild(h('div', { class: 'empty-note' }, 'Трюм пуст'));
    for (const g of keys) B.appendChild(h('div', { class: 'gx-ag' }, g === 'parcel' ? `📦 Курьерские посылки ×${p.cargo[g]}` : `${GOOD[g].icon} ${GOOD[g].name} ×${Math.round(p.cargo[g])}`));
    B.appendChild(h('div', { class: 'fs dim' }, 'Трюм — это свободная вместимость корпуса: чем меньше оборудования, тем больше груза.'));
  },
  renderPilot() {
    const w = this.world, B = this.els.body, p = w.player;
    U.add(B, h('div', { class: 'ph' }, p.name), h('div', { class: 'fs' }, `Кредиты: ${Math.round(p.credits).toLocaleString('ru')} · уничтожено кораблей: ${p.kills}`),
      h('div', { class: 'fs' }, p.member >= 0 ? `На службе: ${w.factions[p.member].name}` : 'Свободный наёмник'),
      h('div', { class: 'ph sm' }, 'Репутация'));
    const list = h('div', { class: 'gx-rel' });
    for (const f of w.factions) {
      if (!f.alive) continue;
      const v = Math.round(p.rep[f.idx] || 0);
      list.appendChild(h('div', null, h('span', { style: { color: f.color } }, f.short),
        h('i', { class: 'relbar' }, h('b', { style: { width: Math.abs(v) / 2 + '%', left: v < 0 ? (50 - Math.abs(v) / 2) + '%' : '50%', background: v < 0 ? '#ff4d6d' : '#2ee66b' } })),
        h('span', { class: v <= -50 ? 'red' : '' }, String(v))));
    }
    U.add(B, list, h('div', { class: 'fs dim' }, 'Репутация растёт за задания и уничтожение пиратов. От 30 можно поступить на службу. При −50 фракция считает вас врагом.'),
      h('div', { class: 'ph sm' }, 'Корабль'), h('div', { class: 'stats' }, Info.shipLines(p.s).map(([k, v]) => Info.statRow(k, v))));
  },
  renderNews() {
    const w = this.world, B = this.els.body;
    const list = h('div', { class: 'gx-ev' });
    for (const e of w.events.slice(-80).reverse()) list.appendChild(h('div', { class: 'ev ' + e.type }, h('b', null, `д${e.day} `), e.text));
    B.appendChild(list);
  },

  // ---------- станция планеты ----------
  openDock(pl) {
    const w = this.world, E = this.els;
    if (!E) return;
    this.dockPl = pl;
    this.dockTab = this.dockTab || 'market';
    E.dock.classList.add('show');
    this.renderDock();
    Sound.special('make');
  },
  closeDock(silent) {
    if (!this.els) return;
    this.dockPl = null;
    this.els.dock.classList.remove('show');
  },
  renderDock() {
    const w = this.world, pl = this.dockPl, E = this.els, p = w.player;
    if (!pl) return;
    const f = pl.owner >= 0 ? w.factions[pl.owner] : null;
    E.dock.innerHTML = '';
    const tabs = [['market', '🛒 Рынок'], ['yard', '🔧 Верфь'], ['repair', '✚ Ремонт'], ['missions', '📜 Задания'], ['faction', '⚑ Фракция'], ['news', '📰 Новости']];
    const body = h('div', { class: 'dk-body' });
    const box = h('div', { class: 'dk panel' },
      h('div', { class: 'dk-head' },
        h('img', { class: 'dk-planet', src: GFX.planet(pl, 140).canvas.toDataURL() }),
        h('div', { class: 'grow' }, h('h2', null, pl.name), h('div', { class: 'fs' }, `${PLANET_TYPES[pl.type].name} · 👥 ${pl.pop.toFixed(1)} млн · стабильность ${Math.round(pl.stability * 100)}%`),
          h('div', { class: 'fs', style: { color: f ? f.color : '#aaa' } }, f ? f.name : 'Независимая планета'),
          h('div', { class: 'fs' }, `💰 ${Math.round(p.credits).toLocaleString('ru')} кр. · 📦 ${Math.round(w.cargoUsed(p))}/${p.cargoCap} · корпус ${Math.round(p.hp)}/${p.maxHp}`)),
        h('button', { class: 'btn primary big', onclick: () => { this.closeDock(); w.undock(); this.refresh(); } }, '🚀 Улететь')),
      seg(tabs, this.dockTab, v => { this.dockTab = v; this.renderDock(); }, 'tabs'),
      body);
    E.dock.appendChild(box);
    const fill = { market: () => this.dkMarket(body), yard: () => this.dkYard(body), repair: () => this.dkRepair(body), missions: () => this.dkMissions(body), faction: () => this.dkFaction(body), news: () => this.dkNews(body) };
    fill[this.dockTab]();
    this.refresh();
  },
  dkMarket(B) {
    const w = this.world, pl = this.dockPl, p = w.player;
    const tbl = h('div', { class: 'mk' });
    tbl.appendChild(h('div', { class: 'mk-row mk-h' }, h('span', null, 'Товар'), h('span', null, 'Купить'), h('span', null, 'Продать'), h('span', null, 'На складе'), h('span', null, 'В трюме'), h('span', null, '')));
    for (const g of GOODS) {
      const buy = pl.price[g.id], sell = Math.round(pl.price[g.id] * 0.92), r = buy / g.base;
      const have = Math.round(p.cargo[g.id] || 0);
      const act = (fn, n) => () => { fn.call(w, pl, g.id, n); Sound.click(); this.renderDock(); };
      tbl.appendChild(h('div', { class: 'mk-row' },
        h('span', null, `${g.icon} ${g.name}`),
        h('span', { class: r < 0.85 ? 'cheap' : r > 1.25 ? 'dear' : '' }, buy),
        h('span', null, sell), h('span', null, Math.round(pl.stock[g.id])), h('span', null, have || ''),
        h('span', { class: 'mk-btns' },
          h('button', { class: 'ibtn', title: 'Купить 1', onclick: act(w.playerBuy, 1) }, '+1'),
          h('button', { class: 'ibtn', title: 'Купить 10', onclick: act(w.playerBuy, 10) }, '+10'),
          h('button', { class: 'ibtn', title: 'Купить сколько влезет', onclick: act(w.playerBuy, 9999) }, 'max'),
          h('button', { class: 'ibtn', title: 'Продать 10', onclick: act(w.playerSell, 10) }, '−10'),
          h('button', { class: 'ibtn', title: 'Продать всё', onclick: act(w.playerSell, 9999) }, 'всё'))));
    }
    U.add(B, tbl, h('div', { class: 'fs dim' }, 'Зелёная цена — товар здесь дёшев, красная — дорог. Цены меняются от запасов: продажа насыщает рынок. Поставка еды и медикаментов на планету с дефицитом повышает репутацию.'));
  },
  dkYard(B) {
    const w = this.world, pl = this.dockPl, p = w.player;
    if (!pl.shipyard) { B.appendChild(h('div', { class: 'empty-note' }, 'На этой планете нет верфи.')); return; }
    const cap = HULLS[p.def.hull].cap, mass = defMass(p.def);
    const wrap = h('div', { class: 'yd' });
    const left = h('div', { class: 'yd-col' }), right = h('div', { class: 'yd-col' });
    left.append(h('div', { class: 'ph sm' }, `Ваш корабль: ${HULLS[p.def.hull].name}`),
      h('div', { class: 'mass' + (mass > cap ? ' over' : '') }, h('div', { class: 'mass-l' }, 'Вместимость', h('b', null, `${mass} / ${cap}`)), h('div', { class: 'bar' }, h('i', { style: { width: Math.min(100, mass / cap * 100) + '%' } }))));
    for (const k of SLOT_ORDER) {
      p.def.slots[k].forEach((id, i) => {
        const it = id ? ITEMS[id] : null;
        const row = h('div', { class: 'slot' + (it ? ' full' : '') + (this.yardSlot && this.yardSlot.cat === k && this.yardSlot.i === i ? ' sel' : ''), onclick: () => { this.yardSlot = { cat: k, i }; this.renderDock(); } },
          h('span', { class: 'slot-ico' }, SLOT_TYPES[k].icon),
          it ? h('div', { class: 'slot-b' }, h('div', { class: 'nm' }, it.name, this.wearBadge(p.def, k, i)), h('div', { class: 'sh' }, Info.short(it))) : h('div', { class: 'slot-b empty' }, `${SLOT_TYPES[k].name}: пусто`),
          it ? h('button', { class: 'ibtn danger', title: `Продать за ${w.sellValue(id, slotWear(p.def, k, i))} кр.`, onclick: e => { e.stopPropagation(); w.sellItem(k, i); Sound.click(); this.renderDock(); } }, '₵') : null);
        if (it) Tip.bind(row, () => Info.tooltip(it));
        left.appendChild(row);
      });
    }
    const S = this.yardSlot;
    if (S && p.def.slots[S.cat] && S.i < p.def.slots[S.cat].length) {
      const cur = p.def.slots[S.cat][S.i] ? ITEMS[p.def.slots[S.cat][S.i]] : null;
      // трофеи и реликвии из трюма — установка бесплатно
      const stash = (p.stash || []).filter(id => ITEMS[id] && ITEMS[id].cat === S.cat);
      if (stash.length) {
        right.appendChild(h('div', { class: 'ph sm' }, 'Из трюма (трофеи)'));
        for (const id of stash) {
          const it = ITEMS[id];
          const row = h('div', { class: 'pick-row cur' }, h('span', { class: 'tier' }, '✧'), h('div', { class: 'pb' }, h('div', { class: 'nm' }, it.name), h('div', { class: 'sh' }, Info.short(it))), h('div', { class: 'pr' }, 'установить'));
          row.addEventListener('click', () => {
            if (defMass(p.def) - (cur ? cur.mass : 0) + it.mass > cap) { this.toast('Не хватает вместимости', 'bad'); return; }
            p.stash.splice(p.stash.indexOf(id), 1);
            if (cur) p.stash.push(cur.id);
            p.def.slots[S.cat][S.i] = id;
            w.refreshKeep(p);
            Sound.special('make');
            this.renderDock();
          });
          Tip.bind(row, () => Info.tooltip(it));
          right.appendChild(row);
        }
      }
      right.appendChild(h('div', { class: 'ph sm' }, `Купить: ${SLOT_TYPES[S.cat].name}`));
      const items = w.shopItems(pl, S.cat).sort((a, b) => a.tier - b.tier || a.price - b.price);
      if (!items.length) right.appendChild(h('div', { class: 'empty-note' }, 'Здесь такое не продают'));
      for (const it of items) {
        const cost = w.shopPrice(it) - (cur ? w.sellValue(cur.id, slotWear(p.def, S.cat, S.i)) : 0);
        const heavy = mass - (cur ? cur.mass : 0) + it.mass > cap, poor = cost > p.credits;
        const row = h('div', { class: 'pick-row' + (heavy || poor ? ' dis' : '') },
          h('span', { class: 'tier' }, U.roman(it.tier)),
          h('div', { class: 'pb' }, h('div', { class: 'nm' }, it.name), h('div', { class: 'sh' }, Info.short(it))),
          h('div', { class: 'pr' }, h('span', { class: heavy ? 'red' : '' }, '⚖' + it.mass), h('span', { class: poor ? 'red' : '' }, `${cost} кр.`)));
        row.addEventListener('click', () => { const err = w.buyItem(S.cat, S.i, it.id); if (err) this.toast(err, 'bad'); else Sound.special('make'); this.renderDock(); });
        Tip.bind(row, () => Info.tooltip(it));
        right.appendChild(row);
      }
    } else {
      right.appendChild(h('div', { class: 'ph sm' }, 'Корпуса на продажу'));
      for (const H of w.shopHulls(pl)) {
        const cost = w.shopPrice(H) - Math.round(w.shopPrice(HULLS[p.def.hull]) * 0.5);
        const row = h('div', { class: 'pick-row' + (cost > p.credits ? ' dis' : '') + (H.id === p.def.hull ? ' cur' : '') },
          h('img', { src: GFX.shipImage(H.id, 0, 80), style: { width: '44px' } }),
          h('div', { class: 'pb' }, h('div', { class: 'nm' }, H.name), h('div', { class: 'sh' }, `♥${H.hp} ⚖${H.cap} укл.${H.ev}% · ${Info.slotsText(H)}`)),
          h('div', { class: 'pr' }, h('span', { class: cost > p.credits ? 'red' : '' }, `${Math.max(0, cost)} кр.`)));
        if (H.id !== p.def.hull) row.addEventListener('click', () => { const err = w.buyHull(H.id); if (err) this.toast(err, 'bad'); else { Sound.victory(true); this.toast(`Куплен корпус ${H.name}`, 'me'); } this.renderDock(); });
        Tip.bind(row, () => Info.hullTooltip(H));
        right.appendChild(row);
      }
      right.appendChild(h('div', { class: 'fs dim' }, 'Щёлкните по слоту слева, чтобы купить оборудование. Старое продаётся за полцены.'));
    }
    wrap.append(left, right);
    B.appendChild(wrap);
  },
  // значок износа модуля
  wearBadge(def, k, i) {
    const wr = slotWear(def, k, i);
    if (wr < 0.05) return null;
    return h('span', { class: 'wear' + (wr >= 1 ? ' broken' : wr >= 0.6 ? ' bad' : ''), title: wr >= 1 ? 'Модуль сломан и не работает' : `Износ ${Math.round(wr * 100)}%: мощность модуля −${Math.round(wr * 50)}%` }, wr >= 1 ? ' СЛОМАН' : ` износ ${Math.round(wr * 100)}%`);
  },
  dkRepair(B) {
    const w = this.world, p = w.player;
    const c = w.repairCost();
    U.add(B, h('div', { class: 'ph sm' }, 'Корпус'),
      h('div', { class: 'gauge hp big' }, h('i', { style: { width: (p.hp / p.maxHp * 100) + '%' } }), h('span', null, `Корпус ${Math.round(p.hp)} / ${p.maxHp}`)),
      c > 0 ? h('button', { class: 'btn primary big', onclick: () => { w.repair(); Sound.special('cleanse'); this.renderDock(); } }, `✚ Залатать корпус: ${c} кр.`) : h('div', { class: 'fs dim' }, 'Корпус цел.'));
    // оборудование
    const rows = [];
    for (const k of SLOT_ORDER) p.def.slots[k].forEach((id, i) => { if (id && k !== 'artifact') rows.push([k, i, id]); });
    const total = w.gearRepairTotal(p);
    B.appendChild(h('div', { class: 'ph sm' }, 'Оборудование'));
    if (total > 0) B.appendChild(h('button', { class: 'btn primary', onclick: () => { const sp = w.repairGear(p, p.credits); if (!sp) this.toast('Не хватает кредитов', 'bad'); else Sound.special('cleanse'); this.renderDock(); } }, `🔧 Починить всё: ${total} кр.`));
    for (const [k, i, id] of rows) {
      const it = ITEMS[id], wr = slotWear(p.def, k, i), cost = w.gearRepairCost(p, k, i);
      B.appendChild(h('div', { class: 'rp-row' },
        h('span', { class: 'slot-ico' }, SLOT_TYPES[k].icon),
        h('div', { class: 'fb' }, h('div', { class: 'nm' }, it.name), h('div', { class: 'gauge wear-g' + (wr >= 0.6 ? ' bad' : '') }, h('i', { style: { width: Math.round((1 - wr) * 100) + '%' } }), h('span', null, wr >= 1 ? 'сломан' : `состояние ${Math.round((1 - wr) * 100)}%`))),
        cost > 0 ? h('button', { class: 'btn ghost', disabled: cost > p.credits ? true : null, onclick: () => { w.repairGear(p, cost, k, i); Sound.special('cleanse'); this.renderDock(); } }, `🔧 ${cost} кр.`) : h('span', { class: 'fs dim' }, 'как новый')));
    }
    B.appendChild(h('div', { class: 'fs dim' }, 'Модули изнашиваются в боях (сильнее — в тяжёлых), двигатель и реактор — в перелётах. Изношенный модуль слабее, вплоть до половины мощности; на 100% он ломается и перестаёт работать. Щиты восстанавливаются сами вне боя, ремонтный дроид понемногу чинит корпус.'));
  },
  questCard(q, compact) {
    const w = this.world, p = w.player, F = w.factions[q.giver];
    const mine = q.taken === p.id || q.takers.includes(p.id);
    const others = q.takers.filter(id => id !== p.id).map(id => w.agents.get(id)).filter(Boolean);
    const err = w.canTake(p, q);
    let progress = '';
    if (q.type === 'aid') progress = `Собрано ${q.delivered}/${q.qty} · за единицу ${q.perUnit} кр.`;
    if (q.type === 'convoy') progress = `Ваш счёт: ${q.kills[p.id] || 0}/${q.count}`;
    if (q.type === 'relic') progress = q.stage === 1 ? (q.holder === p.id ? 'Реликвия у вас — доставьте в столицу ' + F.short : 'Реликвию забрал ' + w.who(w.agents.get(q.holder))) : q.dropped ? 'Реликвия лежит на месте гибели носителя' : 'Аномалия ждёт';
    const box = h('div', { class: 'gx-pl quest' + (mine ? ' mine' : '') },
      h('div', { class: 'pn' }, q.title, h('span', { style: { color: F.color } }, ' · ' + F.short)),
      compact ? null : h('div', { class: 'fs' }, '«' + q.reason + '»'),
      h('div', { class: 'fs' }, `Награда: ${q.reward} кр. · репутация +${q.rep} · осталось ${q.deadline - w.day} дн.${q.sector != null ? ' · сектор ' + w.sectors[q.sector].name : ''}`),
      progress ? h('div', { class: 'fs gold' }, progress) : null,
      others.length ? h('div', { class: 'fs dim' }, (q.exclusive ? 'Взял: ' : 'Тоже взялись: ') + others.map(a => a.name).join(', ')) : null,
      h('div', { class: 'row' },
        !mine ? h('button', { class: 'btn', disabled: err ? true : null, title: err || '', onclick: () => { const e = w.questTake(p, q); if (e) this.toast(e, 'bad'); else this.toast('Вы взялись за поручение', 'me'); this.dockPl ? this.renderDock() : this.refresh(); } }, err || 'Взяться') : h('span', { class: 'fs gold' }, '✔ Вы участвуете'),
        q.sector != null ? h('button', { class: 'btn ghost', onclick: () => this.courseToQuest(q) }, '🧭 Курс') : null,
        q.type === 'relic' && q.holder === p.id ? h('button', { class: 'btn ghost', onclick: () => { w.questKeepRelic(q); this.toast('Реликвия теперь в вашем трюме', 'me'); this.refresh(); } }, 'Оставить себе') : null));
    return box;
  },
  courseToQuest(q) {
    const w = this.world, p = w.player;
    const sec = w.questSector(p, q);
    if (sec == null) return;
    this.closeDock(); w.undock();
    p.questGoal = q.id;
    if (p.loc === sec) p.target = w.questTarget(p, q);
    else { p.route = sec; p.target = { type: 'gate', to: w.N[p.loc][sec] }; }
    this.toast('Курс проложен', 'me');
    this.refresh();
  },

  dkMissions(B) {
    const w = this.world, pl = this.dockPl;
    const special = w.openQuests().filter(q => q.giver === pl.owner || q.takers.includes(w.player.id));
    B.appendChild(h('div', { class: 'ph sm' }, 'Особые поручения'));
    if (!special.length) B.appendChild(h('div', { class: 'empty-note' }, 'У фракции сейчас нет особых нужд.'));
    for (const q of special) B.appendChild(this.questCard(q));
    const elsewhere = w.openQuests().filter(q => !special.includes(q));
    if (elsewhere.length) B.appendChild(h('div', { class: 'fs dim' }, `Другие фракции объявили ещё ${elsewhere.length} поручений — смотрите вкладку «Задания» или новости.`));
    B.appendChild(h('div', { class: 'ph sm' }, 'Обычные задания'));
    const offers = w.offers(pl);
    if (!offers.length) B.appendChild(h('div', { class: 'empty-note' }, 'Заданий сейчас нет. Загляните через несколько дней.'));
    for (const o of offers) {
      B.appendChild(h('div', { class: 'gx-pl' }, h('div', { class: 'pn' }, '📜 ' + o.title), h('div', { class: 'fs' }, o.text),
        h('div', { class: 'fs' }, `Награда: ${o.reward} кр. · срок: ${o.deadline - w.day} дн.${o.needRep ? ' · нужна репутация ' + o.needRep : ''}`),
        h('button', { class: 'btn', onclick: () => { const err = w.acceptOffer(pl, o); if (err) this.toast(err, 'bad'); else this.toast('Задание принято', 'me'); this.renderDock(); } }, 'Принять')));
    }
    if ((w.missionsP || []).length) {
      B.appendChild(h('div', { class: 'ph sm' }, 'Ваши задания'));
      for (const o of w.missionsP) B.appendChild(h('div', { class: 'gx-ag' }, `📜 ${o.title} — ${o.deadline - w.day} дн.${o.count ? ` (${o.killed}/${o.count})` : ''}`));
    }
  },
  dkFaction(B) {
    const w = this.world, pl = this.dockPl, p = w.player;
    if (pl.owner < 0) { B.appendChild(h('div', { class: 'empty-note' }, 'Независимая планета — здесь нет фракции.')); return; }
    const f = w.factions[pl.owner], rep = Math.round(p.rep[f.idx] || 0);
    U.add(B, h('div', { class: 'ph', style: { color: f.color } }, f.name),
      h('div', { class: 'fs' }, `Планет: ${w.factionPlanets(f.idx).length} · казна ${Math.round(f.treasury).toLocaleString('ru')} · ТУ ${U.roman(f.tech)}`),
      h('div', { class: 'fs' }, f.wars.size ? '⚔ Война с: ' + [...f.wars].map(x => w.factions[x].short).join(', ') : 'Ни с кем не воюет'),
      h('div', { class: 'fs' }, `Ваша репутация: ${rep}`));
    if (p.member === f.idx) U.add(B, h('div', { class: 'fs' }, 'Вы на службе этой фракции: жалованье 30 кр. в день, враги фракции — ваши враги.'), h('button', { class: 'btn danger', onclick: () => { w.leaveFaction(); this.renderDock(); } }, 'Уйти со службы'));
    else if (p.member >= 0) U.add(B, h('div', { class: 'fs dim' }, `Вы служите фракции ${w.factions[p.member].short}.`));
    else U.add(B, h('button', { class: 'btn primary', disabled: rep < 30 ? true : null, onclick: () => { if (w.joinFaction(f.idx)) { Sound.victory(true); this.renderDock(); } } }, rep < 30 ? `Поступить на службу (нужна репутация 30)` : 'Поступить на службу'));
  },
  dkNews(B) {
    const w = this.world;
    const list = h('div', { class: 'gx-ev' });
    for (const e of w.events.filter(e => e.type !== 'trade').slice(-40).reverse()) list.appendChild(h('div', { class: 'ev ' + e.type }, h('b', null, `д${e.day} `), e.text));
    B.appendChild(list);
  },

  // ---------- отрисовка ----------
  frame(dt) {
    if (!this.active || !this.els || !this.world) return;
    this.t += dt;
    if (this.anim < 1) this.anim = Math.min(1, this.anim + dt * 1.25);
    if (this.follow) {
      const pos = this.playerPos();
      if (pos) { this.cam.x += (pos[0] - this.cam.x) * Math.min(1, dt * 3); this.cam.y += (pos[1] - this.cam.y) * Math.min(1, dt * 3); }
    }
    this.render();
  },

  render() {
    const w = this.world, cv = this.els.cv, ctx = cv.getContext('2d'), d = this.dpr, z = this.cam.z;
    const sid = this.viewSector, s = w.sectors[sid];
    if (this.bgFor !== sid) {
      this.bg = GFX.starfield(cv.width, cv.height, 1000 + sid * 77, { nebula: [s.star, '#3a0ca3', '#4361ee', '#7209b7', '#0f6e8c'] });
      this.bgFor = sid;
      const rnd = U.seeded(sid * 31 + 5);
      this.rocks = Array.from({ length: 160 }, () => ({ a: rnd() * Math.PI * 2, r: RING_R + (rnd() - 0.5) * 110, s: 2 + rnd() * 6, sp: (0.002 + rnd() * 0.004) }));
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.bg, 0, 0);
    const S = (x, y) => this.toScreen(x, y);
    const k = this.animK();
    const tday = w.day - 1 + k;
    // граница сектора
    const [cx, cy] = S(0, 0);
    ctx.strokeStyle = 'rgba(120,170,255,0.08)'; ctx.lineWidth = 2 * d;
    ctx.beginPath(); ctx.arc(cx, cy, SECTOR_R * z, 0, Math.PI * 2); ctx.stroke();
    // астероиды
    if (s.asteroids) {
      ctx.fillStyle = 'rgba(160,150,135,0.75)';
      for (const r of this.rocks) {
        const a = r.a + this.t * r.sp;
        const [x, y] = S(Math.cos(a) * r.r, Math.sin(a) * r.r);
        ctx.beginPath(); ctx.arc(x, y, Math.max(1, r.s * z * 0.9), 0, Math.PI * 2); ctx.fill();
      }
    }
    // орбиты
    for (const pid of s.planets) {
      const p = w.planets[pid];
      ctx.strokeStyle = 'rgba(150,180,255,0.08)'; ctx.lineWidth = 1 * d;
      ctx.beginPath(); ctx.arc(cx, cy, p.orbit * 6.4 * z, 0, Math.PI * 2); ctx.stroke();
    }
    // звезда
    const sr = (60 + s.starSize * 45) * z;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const rr = sr * (2.5 + i * 1.8) * (1 + 0.03 * Math.sin(this.t * (1.3 + i)));
      const g = ctx.createRadialGradient(cx, cy, sr * 0.2, cx, cy, rr);
      g.addColorStop(0, U.rgba(s.star, 0.35 - i * 0.08)); g.addColorStop(1, U.rgba(s.star, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.fill();
    }
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, sr);
    core.addColorStop(0, '#ffffff'); core.addColorStop(0.6, s.star); core.addColorStop(1, U.rgba(s.star, 0));
    ctx.fillStyle = core; ctx.beginPath(); ctx.arc(cx, cy, sr, 0, Math.PI * 2); ctx.fill();
    // лучи
    ctx.strokeStyle = U.rgba(s.star, 0.25); ctx.lineWidth = 2 * d;
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3 + this.t * 0.05;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * sr * 0.8, cy + Math.sin(a) * sr * 0.8); ctx.lineTo(cx + Math.cos(a) * sr * 3.2, cy + Math.sin(a) * sr * 3.2); ctx.stroke();
    }
    ctx.restore();
    // планеты
    for (const pid of s.planets) {
      const p = w.planets[pid];
      const [px, py] = w.planetPos(p, tday);
      const [x, y] = S(px, py);
      const R = (22 + p.size * 20) * z;
      const spr = GFX.planet(p, Math.max(16, Math.round(R * 2 / 8) * 8));
      const sc = R * 2 / (spr.R * 2);
      ctx.drawImage(spr.canvas, x - spr.canvas.width * sc / 2, y - spr.canvas.height * sc / 2, spr.canvas.width * sc, spr.canvas.height * sc);
      const sel = this.sel && this.sel.type === 'planet' && this.sel.id === pid, hov = this.hover && this.hover.type === 'planet' && this.hover.id === pid;
      if (sel || hov) { ctx.strokeStyle = sel ? '#fff' : 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1.5 * d; ctx.beginPath(); ctx.arc(x, y, R + 8 * d, 0, Math.PI * 2); ctx.stroke(); }
      ctx.font = `600 ${11 * d}px "Exo 2", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillStyle = p.owner >= 0 ? w.factions[p.owner].color : 'rgba(200,210,230,0.7)';
      ctx.fillText(p.name, x, y + R + 4 * d);
      if (p.shipyard && p.pop > 0) { ctx.fillStyle = 'rgba(255,224,102,0.8)'; ctx.fillText('🔧', x + R + 6 * d, y - R); }
    }
    // гиперворота
    for (const n of w.neighbors(sid)) {
      const [gx, gy] = w.gatePos(sid, n);
      const [x, y] = S(gx, gy);
      const o = w.sectors[n], col = o.owner >= 0 ? w.factions[o.owner].color : '#9cc3ff';
      const r = 26 * Math.max(0.6, z * 2.2) * d / d;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 3; i++) {
        ctx.strokeStyle = U.rgba(col, 0.5 - i * 0.12); ctx.lineWidth = (3 - i) * d;
        ctx.beginPath(); ctx.ellipse(x, y, r * (1 + i * 0.25), r * (0.45 + i * 0.1), Math.atan2(gy, gx) + Math.PI / 2, this.t * (1 + i), this.t * (1 + i) + Math.PI * 1.6); ctx.stroke();
      }
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, U.rgba(col, 0.35)); g.addColorStop(1, U.rgba(col, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.font = `600 ${11 * d}px "Exo 2", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillStyle = U.rgba(col, 0.9); ctx.fillText('⟿ ' + o.name, x, y + r * 0.7);
      if (this.hover && this.hover.type === 'gate' && this.hover.to === n) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5 * d; ctx.beginPath(); ctx.arc(x, y, r * 1.4, 0, Math.PI * 2); ctx.stroke(); }
    }
    // пиратская база
    if (s.base) {
      const [bx, by] = w.basePos(sid);
      const [x, y] = S(bx, by);
      const st = GFX.station(64, true), sz = Math.max(28 * d, 70 * z);
      ctx.save(); ctx.translate(x, y); ctx.rotate(this.t * 0.2);
      ctx.drawImage(st, -sz / 2, -sz / 2, sz, sz);
      ctx.restore();
    }
    // маяки особых поручений в этом секторе
    for (const q of w.openQuests()) {
      if (q.sector !== sid || !q.point || (q.type === 'relic' && q.stage === 1)) continue;
      const [x, y] = S(q.point[0], q.point[1]);
      const mine = q.takers.includes(w.player.id);
      const pul = 0.5 + 0.5 * Math.sin(this.t * 4 + q.id);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const col = q.type === 'relic' ? '#c77dff' : q.type === 'recon' ? '#ff9e6b' : '#7df9ff';
      const g = ctx.createRadialGradient(x, y, 0, x, y, (QUEST_POINT_R * z + 10 * d));
      g.addColorStop(0, U.rgba(col, 0.25 + pul * 0.2)); g.addColorStop(1, U.rgba(col, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, QUEST_POINT_R * z + 10 * d, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = U.rgba(col, mine ? 0.9 : 0.45); ctx.lineWidth = 1.5 * d; ctx.setLineDash([4 * d, 4 * d]);
      ctx.beginPath(); ctx.arc(x, y, QUEST_POINT_R * z, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      ctx.font = `700 ${11 * d}px "Exo 2", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillStyle = col; ctx.fillText(q.title, x, y - QUEST_POINT_R * z - 4 * d);
    }
    // путь игрока
    const p = w.player;
    const ppos = this.playerPos();
    if (p && ppos && p.target && !p.battle) {
      const tp = w.targetPos(p.target);
      if (tp) {
        const [x1, y1] = S(ppos[0], ppos[1]), [x2, y2] = S(tp[0], tp[1]);
        ctx.strokeStyle = 'rgba(255,224,102,0.55)'; ctx.lineWidth = 1.5 * d; ctx.setLineDash([6 * d, 6 * d]); ctx.lineDashOffset = -this.t * 20 * d;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]);
        // где окажемся к концу хода
        const dd = Math.hypot(tp[0] - p.sx, tp[1] - p.sy), st = Math.min(dd, w.localSpeed(p));
        if (dd > 0) {
          const [ex, ey] = S(p.sx + (tp[0] - p.sx) / dd * st, p.sy + (tp[1] - p.sy) / dd * st);
          ctx.strokeStyle = 'rgba(255,224,102,0.9)'; ctx.lineWidth = 2 * d;
          ctx.beginPath(); ctx.arc(ex, ey, 7 * d, 0, Math.PI * 2); ctx.stroke();
          ctx.font = `700 ${10 * d}px "Exo 2", sans-serif`; ctx.fillStyle = 'rgba(255,224,102,0.9)'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
          ctx.fillText('конец хода', ex, ey - 9 * d);
        }
      }
    }
    // бои
    for (const wb of w.battles) {
      if (wb.sector !== sid || wb.sx == null) continue;
      const [x, y] = S(wb.sx, wb.sy);
      const R = 90 * z + 20 * d;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const pulse = 0.5 + 0.5 * Math.sin(this.t * 5 + wb.id);
      const g = ctx.createRadialGradient(x, y, 0, x, y, R);
      g.addColorStop(0, `rgba(255,90,60,${0.18 + pulse * 0.12})`); g.addColorStop(1, 'rgba(255,60,40,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
      // вспышки выстрелов между участниками
      const ships = wb.b.ships.filter(sh => sh.alive).map(sh => w.agents.get(sh.ref)).filter(a => a && a.sx != null);
      for (let i = 0; i < 3; i++) {
        if (ships.length < 2 || Math.random() < 0.4) continue;
        const A = U.pick(ships), B = U.pick(ships);
        if (A === B) continue;
        const [ax, ay] = S(A.sx, A.sy), [bx, by] = S(B.sx, B.sy);
        ctx.strokeStyle = U.pick(['rgba(255,90,90,0.8)', 'rgba(120,200,255,0.8)', 'rgba(255,220,120,0.8)']); ctx.lineWidth = 1.5 * d;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
        ctx.fillStyle = 'rgba(255,200,120,0.9)'; ctx.beginPath(); ctx.arc(bx, by, 3 * d, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
      ctx.font = `${16 * d}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff'; ctx.fillText('⚔', x, y - R * 0.75);
    }
    // корабли
    const drawShip = (a, pos, alpha = 1, me = false) => {
      const [x, y] = S(pos[0], pos[1]);
      const prevH = this.heads.get(a.id) || 0;
      const pv = this.prev.get(a.id);
      let head = prevH;
      if (pv && Math.hypot(a.sx - pv[0], a.sy - pv[1]) > 3) head = Math.atan2(a.sy - pv[1], a.sx - pv[0]);
      else if (me && p.target) { const tp = w.targetPos(p.target); if (tp) head = Math.atan2(tp[1] - a.sy, tp[0] - a.sx); }
      this.heads.set(a.id, head);
      const len = Math.max(18 * d, 44 * z * HULLS[a.def.hull].size * 1.6);
      const sp = GFX.ship(a.def.hull, a.faction === PIRATE ? 1 : 0, Math.round(len / 4) * 4);
      const col = me ? '#ffe066' : a.faction === PIRATE ? '#ff3b3b' : a.kind === 'pilot' ? '#ffe066' : w.factions[a.faction] ? w.factions[a.faction].color : '#ccc';
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = U.rgba(col, me ? 0.9 : 0.5); ctx.lineWidth = (me ? 2 : 1.2) * d;
      ctx.beginPath(); ctx.arc(x, y, len * 0.55, 0, Math.PI * 2); ctx.stroke();
      ctx.translate(x, y); ctx.rotate(head);
      if (Math.cos(head) < 0) ctx.scale(1, -1);
      // пламя двигателей при движении
      if (pv && this.anim < 1 && Math.hypot(a.sx - pv[0], a.sy - pv[1]) > 3) {
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createLinearGradient(-len * 0.5, 0, -len * 1.1, 0);
        g.addColorStop(0, 'rgba(160,230,255,0.9)'); g.addColorStop(1, 'rgba(60,120,255,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(-len * 0.75, 0, len * 0.3, len * 0.08, 0, 0, Math.PI * 2); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.drawImage(sp.canvas, -sp.canvas.width / 2, -sp.canvas.height / 2);
      ctx.restore();
      const sel = this.sel && this.sel.type === 'ship' && this.sel.id === a.id;
      if (sel || (this.hover && this.hover.type === 'ship' && this.hover.id === a.id) || me) {
        ctx.font = `600 ${10.5 * d}px "Exo 2", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillStyle = col; ctx.fillText(me ? 'ВЫ' : w.who(a), x, y - len * 0.6);
      }
      if (sel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5 * d; ctx.beginPath(); ctx.arc(x, y, len * 0.75, 0, Math.PI * 2); ctx.stroke(); }
      if (a.boss) { ctx.font = `${13 * d}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillStyle = '#ffe066'; ctx.fillText('👑', x, y - len * 0.6 - 12 * d); }
      if (a.chase && w.player && a.chase === w.player.id) {
        ctx.fillStyle = '#ff4d4d'; ctx.font = `${12 * d}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText('⚠', x, y + len * 0.9);
      }
    };
    for (const a of w.agents.values()) {
      if (a.ctrl === 'human') continue;
      const pos = this.agentPos(a);
      if (pos) drawShip(a, pos);
    }
    for (const L of this.leaving) {
      if (!L.from || this.anim >= 1) continue;
      drawShip(L.a, [U.lerp(L.from[0], L.to[0], k), U.lerp(L.from[1], L.to[1], k)], 1 - k);
    }
    if (p && ppos) drawShip(p, ppos, 1, true);
  },
};
