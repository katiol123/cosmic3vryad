'use strict';
// ============================================================
//  Экран боя: портреты флотов, поле выбранного корабля,
//  окно сражения, журнал, управление скоростью
// ============================================================

const BattleUI = {
  active: false,
  battle: null,
  view: null,
  follow: true,
  human: null,
  bv: null,
  arena: null,
  els: {},

  start() {
    if (Game.problems().length) { Setup.open(); return; }
    if (this.battle) this.battle.stop();
    Clock.clear();
    Clock.paused = false;
    this.build();
    const cfg = Game.fleets.map(f => ({ ctrl: f.ctrl, diff: f.diff, ships: f.ships.map(cloneDef) }));
    this.lastCfg = cfg;
    this.launch(cfg);
  },
  // Бой кампании: за один день проходит только часть боя (dt единиц времени)
  // Бой кампании: за один день проходит только часть боя (dt единиц времени).
  // Пока бой идёт, экран боя не закрывается — дни сменяют друг друга прямо здесь.
  async playLive(wb, dt, world) {
    const cont = this.liveMode && this.liveWb === wb && this.battle === wb.b && Screens.cur && Screens.cur.id === 'scr-battle';
    if (!cont) {
      if (this.battle && this.battle !== wb.b) this.battle.ui = {};
      Clock.clear();
      Clock.paused = false;
      this.liveMode = true;
      this.liveWorld = world;
      this.liveWb = wb;
      this.build();
      this.battle = wb.b;
      wb.b.ui = this;
      this.human = null;
      this.buildPortraits();
      Screens.show('scr-battle');
      this.active = true;
      await new Promise(r => requestAnimationFrame(r));
      this.bv.resize();
      this.arena.setBattle(wb.b);
      for (const V of this.arena.vis.values()) if (!V.ship.alive) V.alpha = 0;
      const me = wb.b.ships.find(s => s.ctrl === 'human' && s.alive) || wb.b.ships.find(s => s.alive);
      this.follow = !(me && me.ctrl === 'human');
      this.els.follow.classList.toggle('on', this.follow);
      this.setView(me);
      this.els.log.innerHTML = '';
      for (const e of wb.b.log.slice(-25)) this.onLog(e);
    }
    this.liveUntil = wb.b.time + dt;
    this.bannerText(`ДЕНЬ ${world.day - wb.day + 1} БОЯ`, 'good');
    if (!cont) { Sound.intro(); Sound.startDrone(); await Clock.wait(900); }
    this.refreshEscape();
    await wb.b.advance(dt);
    // игрок всё ещё сражается — экран боя остаётся, следующий день начнётся сразу
    const mine = wb.b.ships.find(s => s.ref === world.player.id);
    if (!wb.b.over && mine && mine.alive) return true;
    await Clock.wait(wb.b.over ? 1600 : 400);
    wb.b.ui = {};
    if (this.human) { const hm = this.human; this.human = null; hm.res(null); }
    this.active = false;
    this.liveMode = false;
    this.liveWb = null;
    Sound.stopDrone();
    return false;
  },
  // попытка выйти из боя кампании (одна в день боя)
  liveEscape() {
    const w = this.liveWorld, wb = this.liveWb;
    if (!w || !wb || w.player.escDay === w.day) return;
    const ok = w.playerEscape();
    if (ok) {
      this.bannerText('ВЫ ВЫШЛИ ИЗ БОЯ', 'good');
      if (this.human) { const hm = this.human; this.human = null; hm.res(null); }
      wb.b.cutDay = true;
    } else this.bannerText('УЙТИ НЕ УДАЛОСЬ', 'bad');
    this.refreshEscape();
  },
  refreshEscape() {
    const b = this.els && this.els.esc;
    if (!b || !this.liveWorld) return;
    const used = this.liveWorld.player.escDay === this.liveWorld.day;
    b.disabled = used;
    b.title = used ? 'Сегодня попытка уже была — следующая завтра' : 'Попытаться оторваться от противника (одна попытка в день)';
  },

  launch(cfg) {
    this.liveMode = false;
    this.battle = new Battle({ fleets: cfg.map(f => ({ ctrl: f.ctrl, diff: f.diff, ships: f.ships.map(cloneDef) })), ui: this });
    this.human = null;
    this.follow = true;
    this.buildPortraits();
    Screens.show('scr-battle');
    this.active = true;
    requestAnimationFrame(() => {
      this.bv.resize();
      this.arena.setBattle(this.battle);
      const first = this.battle.ships.find(s => s.ctrl === 'human') || this.battle.ships[0];
      this.setView(first);
      this.els.log.innerHTML = '';
      this.intro().then(() => this.battle.run());
    });
  },

  intro() {
    const watch = this.battle.ships.every(s => s.ctrl === 'ai');
    const el = h('div', { class: 'bt-intro' },
      h('div', { class: 'bi-vs' },
        h('span', { class: 'c0' }, SIDE_NAMES[0]), h('b', null, 'VS'), h('span', { class: 'c1' }, SIDE_NAMES[1])),
      h('div', { class: 'bi-main' }, 'К БОЮ!'),
      h('div', { class: 'bi-sub' }, watch ? 'Режим наблюдателя · щёлкните по кораблю, чтобы увидеть его поле' : 'Собирайте блоки на своём поле — корабль сам манёврирует и стреляет'));
    this.els.root.appendChild(el);
    Sound.intro();
    Sound.startDrone();
    return Clock.wait(2100).then(() => { el.classList.add('out'); setTimeout(() => el.remove(), 600); });
  },

  build() {
    const el = document.getElementById('scr-battle');
    el.innerHTML = '';
    const E = this.els = {};
    E.root = el;
    E.p0 = h('div', { class: 'fleet-bar side0' });
    E.p1 = h('div', { class: 'fleet-bar side1' });
    E.round = h('div', { class: 'bt-round' }, 'Раунд 1');
    E.turn = h('div', { class: 'bt-turn' }, '—');
    E.pause = h('button', { class: 'ibtn', title: 'Пауза (пробел)', onclick: () => this.togglePause() }, '⏸');
    E.follow = h('button', { class: 'ibtn on', title: 'Камера следует за активным кораблём', onclick: () => { this.follow = !this.follow; E.follow.classList.toggle('on', this.follow); if (this.follow && this.battle.active) this.setView(this.battle.active); } }, '🎥');
    const speeds = seg([[0.5, '½×'], [1, '1×'], [2, '2×'], [4, '4×'], [8, '8×']], Clock.speed, v => { Clock.speed = v; Store.set('speed', v); }, 'small');
    E.queue = h('div', { class: 'bt-queue' });
    Info.helpBind(E.queue, 'Инициатива');
    const center = h('div', { class: 'bt-center' },
      h('div', { class: 'bt-info' }, E.round, E.turn),
      E.queue,
      h('div', { class: 'bt-ctrl' }, E.pause, speeds, E.follow,
        E.snd = h('button', { class: 'ibtn' + (Sound.on ? ' on' : ''), title: 'Звук', onclick: () => { E.snd.classList.toggle('on', Sound.toggle()); E.snd.textContent = Sound.on ? '🔊' : '🔇'; } }, Sound.on ? '🔊' : '🔇'),
        E.mus = h('button', { class: 'ibtn' + (Sound.musicOn ? ' on' : ''), title: 'Фоновая музыка', onclick: () => E.mus.classList.toggle('on', Sound.toggleMusic()) }, '🎵'),
        h('button', { class: 'ibtn', title: 'Справочник', onclick: () => Modal.help() }, '?'),
        this.liveMode ? (E.esc = h('button', { class: 'btn danger small', onclick: () => this.liveEscape() }, '↩ Уйти из боя')) : h('button', { class: 'ibtn danger', title: 'Покинуть бой', onclick: () => this.exit() }, '⏏')));
    const top = h('div', { class: 'bt-top' }, E.p0, center, E.p1);

    // левая панель — поле
    E.headImg = h('img', { class: 'bp-img' });
    E.headName = h('div', { class: 'bp-name' });
    E.headHull = h('div', { class: 'bp-hull' });
    E.headCtrl = h('span', { class: 'badge' });
    E.target = h('div', { class: 'bp-target' });
    E.target.addEventListener('mouseover', e => { const k = e.target.dataset && e.target.dataset.h; if (k) Tip.show(Info.statTip(k), e); });
    E.target.addEventListener('mouseout', () => Tip.hide());
    E.hpBar = h('i'); E.hpTxt = h('span'); E.shBar = h('i'); E.shTxt = h('span');
    E.hp = h('div', { class: 'gauge hp', 'data-res': '3' }, E.hpBar, E.hpTxt);
    E.sh = h('div', { class: 'gauge sh', 'data-res': '2' }, E.shBar, E.shTxt);
    Info.helpBind(E.hpTxt, 'Корпус');
    Info.helpBind(E.shTxt, 'Щит');
    E.canvas = h('canvas', { class: 'board-cv' });
    E.banner = h('div', { class: 'bp-banner' });
    E.yourTurn = h('div', { class: 'your-turn', onclick: () => { if (this.human) this.setView(this.human.ship); } }, '');
    const meter = (key, res, label) => {
      const m = h('div', { class: 'meter m-' + key, 'data-res': String(res) },
        h('img', { src: GFX.block(res, 48).toDataURL() }),
        h('div', { class: 'mt' }, h('div', { class: 'ml' }, label), h('div', { class: 'mb' }, h('i')), h('div', { class: 'mv' })));
      Info.helpBind(m.querySelector('.ml'), label);
      return m;
    };
    E.mE = meter('e', 0, 'Энергия');
    E.mA = meter('a', 1, 'Боеприпасы');
    E.mD = meter('d', 5, 'Данные');
    E.mT = meter('t', 4, 'Манёвр');
    E.weap = h('div', { class: 'bp-weap' });
    E.status = h('div', { class: 'bp-status' });
    E.tactic = h('div', { class: 'seg small tactic' });
    for (const [k, T] of Object.entries(TACTICS)) {
      const b = h('button', { 'data-t': k, title: T.desc, onclick: () => {
        if (this.view && this.view.ctrl === 'human') { this.view.tactic = k; this.refresh(); }
      } }, T.name);
      E.tactic.appendChild(b);
    }
    const left = E.left = h('div', { class: 'bt-left panel' },
      h('div', { class: 'bp-head' }, E.headImg, h('div', { class: 'bp-hd' }, h('div', { class: 'row' }, E.headName, E.headCtrl), E.headHull, E.target)),
      h('div', { class: 'bp-gauges' }, E.hp, E.sh),
      h('div', { class: 'bp-board' }, E.canvas, E.banner, E.yourTurn),
      h('div', { class: 'bp-meters' }, E.mE, E.mA, E.mD, E.mT),
      h('div', { class: 'bp-tac' }, Info.helpBind(h('span', null, 'Тактика:'), 'Тактика'), E.tactic),
      E.stats = h('div', { class: 'bp-stats' }),
      E.status,
      E.weap);

    E.arenaCv = h('canvas', { class: 'arena-cv' });
    E.log = h('div', { class: 'bt-log' });
    const right = h('div', { class: 'bt-right' },
      h('div', { class: 'arena-wrap panel' }, E.arenaCv, h('div', { class: 'arena-hint' }, 'Щелчок по вражескому кораблю — выбрать цель · по своему — открыть его поле')),
      h('div', { class: 'log-wrap panel' }, h('div', { class: 'ph sm' }, 'Журнал боя'), E.log));
    el.append(top, h('div', { class: 'bt-main' }, left, right));

    this.bv = new BoardView(E.canvas);
    this.arena = new Arena(E.arenaCv);
    this.arena.onShipClick = s => this.arenaClick(s);
    if (!this._ro) {
      this._ro = new ResizeObserver(() => { if (this.bv) this.bv.resize(); if (this.arena) { this.arena.resize(); } });
    }
    this._ro.disconnect();
    this._ro.observe(E.canvas);
    this._ro.observe(E.arenaCv);
  },

  buildPortraits() {
    const E = this.els;
    E.p0.innerHTML = ''; E.p1.innerHTML = '';
    E.ports = new Map();
    for (const s of this.battle.ships) {
      const hp = h('i', { class: 'php' }), sh = h('i', { class: 'psh' });
      const el = h('div', { class: 'portrait', onclick: () => { this.follow = false; E.follow.classList.remove('on'); this.setView(s); } },
        h('div', { class: 'pimg' }, h('img', { src: GFX.shipImage(s.hull.id, s.side, 120) })),
        h('div', { class: 'pname' }, s.name),
        h('div', { class: 'pbars' }, sh, hp),
        h('span', { class: 'pctrl' }, s.ctrl === 'human' ? '🎮' : ''),
        h('span', { class: 'pord' }));
      Tip.bind(el, () => this.shipTip(s));
      E.ports.set(s.id, { el, hp, sh, ord: el.querySelector('.pord') });
      (s.side ? E.p1 : E.p0).appendChild(el);
    }
  },

  shipTip(s) {
    const lines = Info.shipLines(s.s);
    return `<div class="tt"><div class="tt-title">${s.name}</div><div class="tt-sub">${s.hull.name} · ${SIDE_NAMES[s.side]} · ${s.ctrl === 'human' ? 'Игрок' : 'ИИ'}</div>
      <table><tr><td>Корпус</td><td>${Math.ceil(s.hp)} / ${s.s.maxHp}</td></tr><tr><td>Щит</td><td>${Math.ceil(s.shield)} / ${s.s.maxShield}</td></tr>
      ${lines.slice(3).map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>
      <div class="tt-eff">${s.weapons.map(w => `<div style="color:${DMG[w.dt].color}">✦ ${w.name} — дал. ${w.range}</div>`).join('')}</div></div>`;
  },

  setView(ship) {
    if (!ship) return;
    this.view = ship;
    this.bv.setBoard(ship.board, ship.side);
    this.arena.viewed = ship;
    const E = this.els;
    E.headImg.src = GFX.shipImage(ship.hull.id, ship.side, 120);
    E.headName.textContent = ship.name;
    E.headHull.innerHTML = `${ship.hull.name} · <span style="color:${MAKER[ship.hull.maker].color}">${MAKER[ship.hull.maker].name}</span>`;
    E.headCtrl.textContent = ship.ctrl === 'human' ? 'ИГРОК' : 'ИИ';
    E.headCtrl.className = 'badge ' + (ship.ctrl === 'human' ? 'me' : 'ai');
    E.root.querySelector('.bt-left').className = 'bt-left panel side' + ship.side;
    // оружие
    E.weap.innerHTML = '';
    E.wrows = ship.weapons.map(w => {
      const bar = h('i'), tick = h('b'), info = h('span', { class: 'wst' });
      const row = h('div', { class: 'wrow' },
        h('span', { class: 'wdot', style: { background: DMG[w.dt].color, boxShadow: `0 0 8px ${DMG[w.dt].color}` } }),
        h('div', { class: 'wb' },
          h('div', { class: 'wn' }, w.it.base, h('span', null, ` · дал. ${w.range}`)),
          h('div', { class: 'wbar res-' + w.res }, bar, tick)),
        info);
      Tip.bind(row, () => Info.tooltip(w.it));
      return { w, row, bar, tick, info };
    });
    E.wrows.forEach(r => E.weap.appendChild(r.row));
    if (!ship.weapons.length) E.weap.appendChild(h('div', { class: 'empty-note' }, 'Нет оружия'));
    // ввод игрока
    if (this.human && this.human.ship === ship) {
      this.bv.onMove = m => this.humanDone(m);
    } else this.bv.onMove = null;
    this.refresh();
  },

  humanDone(m) {
    const hm = this.human;
    if (!hm) return;
    this.human = null;
    this.bv.onMove = null;
    this.refresh();
    hm.res(m);
  },

  arenaClick(s) {
    const v = this.view;
    if (v && v.ctrl === 'human' && v.alive && s.side !== v.side) {
      v.target = s;
      this.battle.msg(`${v.name}: новая цель — ${s.name}`, 'move', v);
      this.refresh();
      return;
    }
    this.follow = false;
    this.els.follow.classList.remove('on');
    this.setView(s);
  },

  togglePause() {
    Clock.paused = !Clock.paused;
    this.els.pause.textContent = Clock.paused ? '▶' : '⏸';
    this.els.root.classList.toggle('paused', Clock.paused);
  },

  exit() {
    const box = Modal.open(h('div', { class: 'confirm' },
      h('h3', null, 'Покинуть бой?'),
      h('p', null, 'Текущее сражение будет прервано.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => Modal.close() }, 'Остаться'),
        h('button', { class: 'btn danger', onclick: () => { Modal.close(); this.stop(); Setup.open(); } }, 'К подготовке'),
        h('button', { class: 'btn danger', onclick: () => { Modal.close(); this.stop(); Menu.build(); Screens.show('scr-menu'); } }, 'В меню'))));
    return box;
  },
  stop() {
    if (this.battle) this.battle.stop();
    if (this.human) { const hm = this.human; this.human = null; hm.res(null); }
    Clock.clear();
    Clock.paused = false;
    this.active = false;
    Sound.stopDrone();
  },

  // ---------- Обновление интерфейса ----------
  refresh() {
    if (!this.battle) return;
    const E = this.els, b = this.battle;
    E.round.textContent = `Раунд ${b.round}`;
    const act = b.active;
    E.turn.innerHTML = (act ? `Ход: <b class="c${act.side}">${act.name}</b>` : '—') +
      (this.liveMode ? ` · <span class="gold">до конца дня ${Math.max(0, U.r1((this.liveUntil - b.time) / b.roundLen))} р.</span>` : '');
    // шкала ближайших ходов
    const fc = b.forecast(9);
    const fkey = (act ? act.id : 0) + ':' + fc.map(s => s.id).join(',');
    if (fkey !== this._fkey) {
      this._fkey = fkey;
      E.queue.innerHTML = '';
      const list = act && act.alive ? [act, ...fc] : fc;
      list.forEach((s, i) => E.queue.appendChild(h('div', { class: `q s${s.side}${i === 0 && s === act ? ' now' : ''}`, style: { animationDelay: i * 0.03 + 's' } },
        h('img', { src: GFX.shipImage(s.hull.id, s.side, 80) }))));
    }
    for (const s of b.ships) {
      const p = E.ports.get(s.id);
      if (!p) continue;
      p.hp.style.width = U.clamp(s.hp / s.s.maxHp * 100, 0, 100) + '%';
      // перезаряд щита сверх максимума не растягивает полосу за край карточки
      p.sh.style.width = (s.s.maxShield ? U.clamp(s.shield / s.s.maxShield * 100, 0, 100) : 0) + '%';
      p.sh.classList.toggle('over', s.shield > s.s.maxShield + 0.5);
      p.el.classList.toggle('active', s === act && s.alive);
      p.el.classList.toggle('viewed', s === this.view);
      p.el.classList.toggle('dead', !s.alive);
      p.el.classList.toggle('targeted', !!(act && act.target === s));
      p.el.classList.toggle('low', s.alive && s.hpFrac < 0.3);
      const k = fc.indexOf(s);
      p.ord.textContent = !s.alive ? '' : s === act ? '▶' : k >= 0 ? String(k + 1) : '';
    }
    const v = this.view;
    if (!v) return;
    const pct = (a, m) => (m > 0 ? U.clamp(a / m * 100, 0, 100) : 0) + '%';
    E.hpBar.style.width = pct(v.hp, v.s.maxHp);
    E.hpBar.style.opacity = v.hp > 0 ? 1 : 0;
    E.shBar.style.opacity = v.shield > 0 ? 1 : 0;
    // уничтоженный корабль: поле гаснет, поверх — плашка
    E.left.classList.toggle('dead', !v.alive);
    E.left.dataset.dead = v.fled ? 'ВЫШЕЛ ИЗ БОЯ' : 'КОРАБЛЬ УНИЧТОЖЕН';
    E.hpTxt.textContent = `Корпус ${Math.ceil(v.hp)} / ${v.s.maxHp}`;
    E.shBar.style.width = pct(v.shield, v.s.maxShield);
    E.shBar.classList.toggle('over', v.shield > v.s.maxShield + 0.5);
    E.shTxt.textContent = v.s.maxShield ? `Щит ${Math.ceil(v.shield)} / ${v.s.maxShield}` : 'Нет генератора щита';
    const setM = (m, val, cap, txt) => {
      m.querySelector('.mb i').style.width = pct(val, cap);
      m.querySelector('.mv').textContent = txt;
    };
    setM(E.mE, v.energy, v.s.eCap, `${Math.floor(v.energy)}/${v.s.eCap}`);
    setM(E.mA, v.ammo, v.s.aCap, `${Math.floor(v.ammo)}/${v.s.aCap}`);
    setM(E.mD, v.data, v.s.dCap, `${Math.floor(v.data)}/${v.s.dCap}`);
    setM(E.mT, v.evasion, 65, `укл. ${Math.round(v.evasion)}%`);
    const t = v.target && v.target.alive ? v.target : null;
    if (t) {
      const asp = b.aspect(v, t);
      E.target.innerHTML = `Цель: <b class="c${t.side}">${t.name}</b> · <span class="help-lab" data-h="Дистанция">дист. ${U.r1(b.dist(v, t))}</span>${asp !== 'front' ? ` · <b class="gold">${FLANK[asp].name} ×${FLANK[asp].k}</b>` : ''}`;
    } else E.target.innerHTML = v.alive ? 'Цель не выбрана' : '<b class="red">Уничтожен</b>';
    // компактная строка характеристик с подсказками
    const sv = [['Броня', Info.pct(v.armor)], ['Уклонение', Math.round(v.evasion) + '%'], ['Инициатива', v.s.init], ['Поворот', Math.round(v.s.turn) + '°'],
      ['Точность', '+' + v.s.acc + '%'], ['Крит', v.s.crit + '%'], ['Защита систем', Info.pct(v.s.ewRes)]];
    const skey = sv.map(x => x[1]).join('|') + v.id;
    if (skey !== this._skey) {
      this._skey = skey;
      E.stats.innerHTML = '';
      for (const [k, val] of sv) E.stats.appendChild(Info.helpBind(h('span', { class: 'bst' }, `${k} `, h('b', null, String(val))), k));
    }
    for (const r of E.wrows || []) {
      const w = r.w;
      r.bar.style.width = pct(w.charge, w.cap);
      r.tick.style.left = pct(w.cost, w.cap);
      const ready = Math.min(w.rof, Math.floor((w.charge + 1e-6) / w.cost));
      const inRange = t ? b.dist(v, t) <= w.range : false;
      r.info.textContent = ready ? `готово ×${ready}` : `${Math.floor(w.charge)}/${w.cost}`;
      r.row.classList.toggle('ready', ready > 0);
      r.row.classList.toggle('far', !!t && !inRange);
    }
    E.tactic.querySelectorAll('button').forEach(bt => bt.classList.toggle('on', bt.dataset.t === v.tactic));
    E.tactic.classList.toggle('locked', v.ctrl !== 'human');
    const st = v.statuses.map(x => `<span class="stt">${EFFECTS[x.k].icon} ${EFFECTS[x.k].name} (${x.t})</span>`);
    if (v.critCharges) st.push(`<span class="stt gold">★ Крит ×${v.critCharges}</span>`);
    const deb = v.board.debuffs();
    if (deb) st.push(`<span class="stt bad">▦ Вредоносных блоков: ${deb}</span>`);
    E.status.innerHTML = st.join('');
    // подсказка «ваш ход»
    if (this.human) {
      const mine = this.human.ship === v;
      E.yourTurn.textContent = mine ? 'ВАШ ХОД' : `Ваш ход: ${this.human.ship.name} — вернуться ↩`;
      E.yourTurn.className = 'your-turn show' + (mine ? '' : ' away');
    } else E.yourTurn.className = 'your-turn';
  },

  bannerText(txt, cls) {
    const el = this.els.banner;
    el.textContent = txt;
    el.className = 'bp-banner ' + (cls || '');
    void el.offsetWidth;
    el.classList.add('show');
  },

  // ---------- Хуки боя ----------
  isViewing(ship) { return this.active && this.view === ship; },
  update() { this.refresh(); },
  onRound(n) {
    this.els.round.textContent = `Раунд ${n}`;
    this.els.round.classList.remove('flash'); void this.els.round.offsetWidth; this.els.round.classList.add('flash');
  },
  onTurn(ship) {
    if (this.follow || ship.ctrl === 'human') this.setView(ship);
    this.refresh();
  },
  onLog(e) {
    const el = h('div', { class: `le ${e.cls} s${e.side}` }, e.text);
    const log = this.els.log;
    log.appendChild(el);
    while (log.childNodes.length > 140) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
  },
  waitHuman(ship) {
    return new Promise(res => {
      this.human = { ship, res };
      this.setView(ship);
      Sound.yourTurn();
      this.bannerText('ВАШ ХОД', 'good quick');
    });
  },
  aiPreview(ship, move) {
    this.bv.preview = move;
    return Clock.wait(260).then(() => { this.bv.preview = null; });
  },
  onGain(ship, res, g, cascade) {
    if (this.view !== ship) return;
    const types = [];
    res.counts.forEach((v, i) => { if (v) types.push(i); });
    if (types.length) Sound.pop(types, cascade);
    if (cascade >= 2) this.bv.text(this.bv.ox + this.bv.cs * 4, this.bv.oy + this.bv.cs * 0.8, `КАСКАД ×${cascade}`, '#ffe066', 0.9, 1 + cascade * 0.08);
    const parts = [];
    if (g.energy) parts.push(['+' + Math.round(g.energy), 0]);
    if (g.ammo) parts.push(['+' + Math.round(g.ammo), 1]);
    if (g.shield) parts.push(['+' + Math.round(g.shield), 2]);
    if (g.repair) parts.push(['+' + Math.round(g.repair), 3]);
    if (g.thrust) parts.push(['+' + U.r1(g.thrust), 4]);
    if (g.data) parts.push(['+' + U.r1(g.data), 5]);
    for (const [txt, i] of parts) {
      const el = document.querySelector(`[data-res="${i}"]`);
      if (!el) continue;
      const f = h('span', { class: 'gain', style: { color: BLOCKS[i].glow } }, txt);
      el.appendChild(f);
      setTimeout(() => f.remove(), 1200);
    }
  },
  banner(ship, txt, cls) {
    if (cls === 'good' && txt.startsWith('ФОРСАЖ')) Sound.extra();
    this.arena.banner(ship, txt, cls);
    if (this.view === ship) this.bannerText(txt, cls);
  },
  shoot(att, tgt, w, shot) { return this.arena.shoot(att, tgt, w, shot); },
  onHit(tgt, r, shot, w) { this.arena.hit(tgt, r, shot, w); },
  onEffect(tgt, e) { this.arena.effect(tgt, e); },
  onMove(ship) { return this.arena.moved(ship); },
  onEW(att, tgt, kind) { return this.arena.ew(att, tgt, kind); },
  onDeath(ship) {
    this.refresh();
    return this.arena.death(ship);
  },
  onDot(ship, dmg) { this.arena.dot(ship, dmg); },
  onHeal(ship, n) { this.arena.heal(ship, n); },
  boardEvent(ship, ev) { if (this.active && this.view === ship) this.bv.event(ev); },
  onJoin() { if (this.active) { this.buildPortraits(); this.arena.layout(); } },
  onEnd(b) {
    if (this.liveMode) return;
    this.bv.onMove = null;
    this.refresh();
    setTimeout(() => this.results(b), 1400);
  },

  results(b) {
    if (!this.active || b !== this.battle) return;
    const w = b.winner;
    const humanSide = Game.fleets.findIndex(f => f.ctrl === 'human');
    const bothHuman = Game.fleets.every(f => f.ctrl === 'human');
    let title = w < 0 ? 'НИЧЬЯ' : `ПОБЕДА: ${SIDE_NAMES[w].toUpperCase()}`;
    let cls = w < 0 ? '' : 'w' + w;
    if (humanSide >= 0 && !bothHuman && w >= 0) { title = w === humanSide ? 'ПОБЕДА!' : 'ПОРАЖЕНИЕ'; cls += w === humanSide ? ' win' : ' lose'; }
    const rows = b.ships.slice().sort((a, c) => a.side - c.side || c.st.dealt - a.st.dealt).map(s => h('tr', { class: 's' + s.side + (s.alive ? '' : ' dead') },
      h('td', null, h('img', { src: GFX.shipImage(s.hull.id, s.side, 80) })),
      h('td', null, h('b', null, s.name), h('div', { class: 'sub' }, s.hull.name)),
      h('td', null, Math.round(s.st.dealt)),
      h('td', null, Math.round(s.st.taken)),
      h('td', null, s.st.kills),
      h('td', null, s.st.shots ? Math.round(s.st.hits / s.st.shots * 100) + '%' : '—'),
      h('td', null, s.st.crits),
      h('td', null, s.st.blocks),
      h('td', null, s.alive ? `${Math.ceil(s.hp)}/${s.s.maxHp}` : '💥')));
    const mvp = b.ships.reduce((a, c) => (c.st.dealt + c.st.kills * 50 > a.st.dealt + a.st.kills * 50 ? c : a));
    const box = h('div', { class: 'results ' + cls },
      h('div', { class: 'res-title' }, title),
      h('div', { class: 'res-sub' }, `Раундов: ${b.round} · Лучший корабль: ${mvp.name}`),
      h('div', { class: 'res-table' }, h('table', null,
        h('thead', null, h('tr', null, ['', 'Корабль', 'Урон', 'Получено', 'Сбито', 'Точность', 'Криты', 'Блоков', 'Корпус'].map(x => h('th', null, x)))),
        h('tbody', null, rows))),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', onclick: () => { Modal.close(); this.stop(); this.build(); this.launch(this.lastCfg); } }, '↻ Реванш'),
        h('button', { class: 'btn', onclick: () => { Modal.close(); this.stop(); Game.randomize(); if (humanSide < 0) { Game.fleets[0].ctrl = 'ai'; } this.start(); } }, '🎲 Новая случайная битва'),
        h('button', { class: 'btn', onclick: () => { Modal.close(); this.stop(); Setup.open(); } }, '⚙ К подготовке'),
        h('button', { class: 'btn ghost', onclick: () => { Modal.close(); this.stop(); Menu.build(); Screens.show('scr-menu'); } }, 'В меню')));
    Modal.open(box, 'wide');
    Sound.stopDrone();
    Sound.victory(w >= 0 && (humanSide < 0 || bothHuman || w === humanSide));
  },
};
