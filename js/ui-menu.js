'use strict';
// ============================================================
//  Главное меню и подготовка флотов
// ============================================================

const SIDE_NAMES = ['Синий флот', 'Красный флот'];
const DIFFS = { easy: 'Новичок', normal: 'Ветеран', hard: 'Ас' };

const Game = {
  fleets: [
    { ctrl: 'human', diff: 'normal', ships: [] },
    { ctrl: 'ai', diff: 'normal', ships: [] },
  ],
  tech: 3,
  size: 3,
  mode: 'play',
  load() {
    const f = Store.get('fleets', null);
    if (f && Array.isArray(f) && f.length === 2) {
      f.forEach((fl, i) => {
        const ships = (fl.ships || []).filter(d => d && HULLS[d.hull]).map(d => {
          const nd = setHull({ name: d.name, hull: d.hull, slots: {} }, d.hull);
          for (const k of SLOT_ORDER) (d.slots[k] || []).forEach((id, j) => { if (j < nd.slots[k].length && ITEMS[id] && ITEMS[id].cat === k) nd.slots[k][j] = id; });
          return nd;
        });
        this.fleets[i] = { ctrl: fl.ctrl === 'human' ? 'human' : 'ai', diff: DIFFS[fl.diff] ? fl.diff : 'normal', ships };
      });
    }
    const o = Store.get('opts', null);
    if (o) { this.tech = U.clamp(o.tech | 0 || 3, 1, 5); this.size = U.clamp(o.size | 0 || 3, 1, 6); this.mode = o.mode === 'watch' ? 'watch' : 'play'; }
  },
  save() {
    Store.set('fleets', this.fleets);
    Store.set('opts', { tech: this.tech, size: this.size, mode: this.mode });
  },
  randomize() {
    const [a, b] = randomFleets(this.size, this.tech);
    this.fleets[0].ships = a;
    this.fleets[1].ships = b;
    this.fleets[0].ctrl = this.mode === 'watch' ? 'ai' : 'human';
    this.fleets[1].ctrl = 'ai';
    this.save();
  },
  problems() {
    const out = [];
    this.fleets.forEach((f, i) => {
      if (!f.ships.length) out.push(`${SIDE_NAMES[i]}: нет кораблей`);
      f.ships.forEach(d => {
        if (defMass(d) > HULLS[d.hull].cap) out.push(`«${d.name}»: перегруз`);
        if (!d.slots.weapon.some(Boolean)) out.push(`«${d.name}»: нет оружия`);
      });
    });
    return out;
  },
};

function seg(options, value, onChange, cls = '') {
  const el = h('div', { class: 'seg ' + cls });
  options.forEach(([v, label]) => {
    const b = h('button', { class: v === value ? 'on' : '', onclick: () => {
      el.querySelectorAll('button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      onChange(v);
    } }, label);
    el.appendChild(b);
  });
  return el;
}

// ---------- Главное меню ----------
const Menu = {
  build() {
    const el = document.getElementById('scr-menu');
    el.innerHTML = '';
    const parade = h('div', { class: 'parade' });
    const pick = HULL_LIST.filter((_, i) => i % 3 === 0);
    for (let i = 0; i < 9; i++) {
      const hl = pick[(i * 5) % pick.length];
      const side = i % 2;
      parade.appendChild(h('img', { class: 'pship s' + side, src: GFX.shipImage(hl.id, side, 160),
        style: { top: (8 + (i * 10.5) % 84) + '%', animationDelay: (-i * 3.7) + 's', animationDuration: (22 + (i % 4) * 6) + 's',
          width: (60 + hl.size * 50) + 'px' } }));
    }
    const logo = h('div', { class: 'logo' },
      h('div', { class: 'logo-top' }, 'ЗВЁЗДНЫЙ'),
      h('div', { class: 'logo-main', 'data-text': 'КАСКАД' }, 'КАСКАД'),
      h('div', { class: 'logo-sub' }, 'Битва флотов · Тактика «три в ряд»'));

    const custom = h('div', { class: 'mcard' },
      h('div', { class: 'mcard-ico' }, '⚙'),
      h('h3', null, 'Конструктор боя'),
      h('p', null, 'Соберите оба флота сами: выберите корпуса и установите оружие, щиты, двигатели, реакторы, дроидов, РЭБ и древние артефакты.'),
      h('div', { class: 'feats' }, [`${HULL_LIST.length} корпусов`, `${itemsFor('weapon').length} моделей оружия`, `${Object.keys(ITEMS).length} единиц оборудования`,
        '7 типов урона', '15 боевых эффектов', '5 производителей', 'до 6 кораблей на сторону', 'Игрок или ИИ за каждую сторону'].map(t => h('span', null, t))),
      h('button', { class: 'btn primary', onclick: () => { Setup.open(); } }, 'Открыть верфь'));

    const rnd = h('div', { class: 'mcard accent' },
      h('div', { class: 'mcard-ico' }, '🎲'),
      h('h3', null, 'Случайная битва'),
      h('p', null, 'Игра сама соберёт две равные эскадры. Сражайтесь за синих или наблюдайте за битвой ИИ.'),
      h('div', { class: 'opt' }, h('label', null, 'Кораблей с каждой стороны'),
        seg([1, 2, 3, 4, 5, 6].map(n => [n, String(n)]), Game.size, v => { Game.size = v; Game.save(); })),
      h('div', { class: 'opt' }, h('label', null, 'Технологический уровень'),
        seg([1, 2, 3, 4, 5].map(n => [n, U.roman(n)]), Game.tech, v => { Game.tech = v; Game.save(); })),
      h('div', { class: 'opt' }, h('label', null, 'Режим'),
        seg([['play', '🎮 Играть'], ['watch', '👁 Наблюдать']], Game.mode, v => { Game.mode = v; Game.save(); })),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary big', onclick: () => { Game.randomize(); BattleUI.start(); } }, 'В бой!'),
        h('button', { class: 'btn', onclick: () => { Game.randomize(); Setup.open(); } }, 'Показать флоты')));

    const foot = h('div', { class: 'menu-foot' },
      h('button', { class: 'btn ghost', onclick: () => Modal.help() }, '📖 Справочник'),
      h('button', { class: 'btn ghost', onclick: () => Catalog.open() }, '🛰 Каталог оборудования'),
      h('button', { class: 'btn ghost', onclick: e => { const on = Sound.toggle(); e.currentTarget.textContent = on ? '🔊 Звук: вкл' : '🔇 Звук: выкл'; } }, Sound.on ? '🔊 Звук: вкл' : '🔇 Звук: выкл'),
      h('span', { class: 'stat' }, `${HULL_LIST.length} корпусов · ${Object.keys(ITEMS).length} моделей оборудования`));

    const camp = h('div', { class: 'mcard wide camp' },
      h('div', { class: 'mcard-ico' }, '🌌'),
      h('div', null,
        h('h3', null, 'Кампания: живая галактика ', h('span', { class: 'beta' }, 'наблюдение')),
        h('p', null, '30 секторов, 12 фракций, пиратские базы. Торговцы, дипломаты, патрули, военные флоты и свободные пилоты-наёмники летают с миссиями; бои длятся несколько дней, к ним присоединяются подкрепления. Мир живёт пошагово по дням.')),
      h('button', { class: 'btn primary big', onclick: () => GalaxyUI.open(false) }, 'Открыть галактику'));
    el.append(parade, h('div', { class: 'menu-inner' }, logo, h('div', { class: 'mcards' }, custom, rnd, camp), foot));
  },
};

// ---------- Подготовка флотов ----------
const Setup = {
  open() {
    this.build();
    Screens.show('scr-setup');
  },
  build() {
    const el = document.getElementById('scr-setup');
    el.innerHTML = '';
    const probs = Game.problems();
    const head = h('div', { class: 'topbar' },
      h('button', { class: 'btn ghost', onclick: () => { Menu.build(); Screens.show('scr-menu'); } }, '← Меню'),
      h('h2', null, 'Подготовка к битве'),
      h('div', { class: 'grow' }),
      h('div', { class: 'opt inline' }, h('label', null, 'ТУ генерации'),
        seg([1, 2, 3, 4, 5].map(n => [n, U.roman(n)]), Game.tech, v => { Game.tech = v; Game.save(); }, 'small')),
      h('button', { class: 'btn', onclick: () => { const c = [Game.fleets[0].ctrl, Game.fleets[1].ctrl]; Game.randomize(); Game.fleets[0].ctrl = c[0]; Game.fleets[1].ctrl = c[1]; Game.save(); this.build(); } }, '🎲 Случайные флоты'),
      h('button', { class: 'btn primary big', disabled: probs.length ? true : null, onclick: () => BattleUI.start(),
        title: probs.join('\n') }, '▶ Начать бой'));
    const cols = h('div', { class: 'fleets' }, this.fleetCol(0), h('div', { class: 'vs' }, 'VS'), this.fleetCol(1));
    el.append(head, cols);
    if (probs.length) el.appendChild(h('div', { class: 'warnbar' }, '⚠ ', probs.slice(0, 4).join(' · ')));
  },
  fleetCol(side) {
    const f = Game.fleets[side];
    const total = U.sum(f.ships, defPrice);
    const col = h('div', { class: `fleet side${side}` });
    col.appendChild(h('div', { class: 'fleet-head' },
      h('h3', null, SIDE_NAMES[side]),
      h('div', { class: 'fleet-meta' }, `${f.ships.length} кор. · ${total.toLocaleString('ru')} кр.`),
      h('div', { class: 'grow' }),
      seg([['human', '🎮 Игрок'], ['ai', '🤖 ИИ']], f.ctrl, v => { f.ctrl = v; Game.save(); this.build(); }, 'small'),
      f.ctrl === 'ai' ? seg(Object.entries(DIFFS), f.diff, v => { f.diff = v; Game.save(); }, 'small') : null));
    const list = h('div', { class: 'ship-list' });
    f.ships.forEach((d, i) => list.appendChild(this.shipCard(d, side, i)));
    if (f.ships.length < 6) {
      list.appendChild(h('div', { class: 'ship-add' },
        h('button', { class: 'btn', onclick: () => { f.ships.push(emptyDef('hull_corvette_terra', randomName(new Set(this.allNames())))); Game.save(); Editor.open(side, f.ships.length - 1); } }, '+ Новый корабль'),
        h('button', { class: 'btn ghost', onclick: () => { f.ships.push(randomDef(Game.tech, new Set(this.allNames()))); Game.save(); this.build(); } }, '🎲 Случайный')));
    }
    col.appendChild(list);
    return col;
  },
  allNames() { return Game.fleets.flatMap(f => f.ships.map(d => d.name)); },
  shipCard(d, side, i) {
    const s = computeStats(d);
    const hl = HULLS[d.hull];
    const f = Game.fleets[side];
    const over = s.mass > s.cap;
    const card = h('div', { class: 'ship-card' + (over ? ' bad' : ''), style: { animationDelay: i * 0.06 + 's' } },
      h('div', { class: 'sc-img' }, h('img', { src: GFX.shipImage(d.hull, side, 160) })),
      h('div', { class: 'sc-body' },
        h('div', { class: 'sc-name' }, d.name),
        h('div', { class: 'sc-hull' }, `${hl.name} · `, h('span', { style: { color: MAKER[hl.maker].color } }, MAKER[hl.maker].name)),
        h('div', { class: 'chips' },
          Info.helpBind(h('span', { class: 'chip hp' }, '♥ ' + s.maxHp), 'Прочность'),
          s.maxShield ? Info.helpBind(h('span', { class: 'chip sh' }, '⬡ ' + s.maxShield), 'Щит') : null,
          Info.helpBind(h('span', { class: 'chip' }, '➤ ' + s.init), 'Инициатива'),
          Info.helpBind(h('span', { class: 'chip' }, '⟳ ' + s.turn + '°'), 'Поворот'),
          Info.helpBind(h('span', { class: 'chip' }, '⚔ ' + Math.round(U.sum(s.weapons, weaponDps)) + '/ход'), 'Потенциал урона'),
          Info.helpBind(h('span', { class: 'chip' + (over ? ' red' : '') }, `⚖ ${s.mass}/${s.cap}`), 'Масса')),
        h('div', { class: 'sc-weap' }, s.weapons.map(w => h('span', { style: { color: DMG[w.dt].color } }, w.it.base)).reduce((a, x, k) => (k ? a.concat([' · ', x]) : [x]), []))),
      h('div', { class: 'sc-act' },
        h('button', { class: 'ibtn', title: 'Изменить', onclick: () => Editor.open(side, i) }, '✎'),
        f.ships.length < 6 ? h('button', { class: 'ibtn', title: 'Копия', onclick: () => { const c = cloneDef(d); c.name = randomName(new Set(this.allNames())); f.ships.splice(i + 1, 0, c); Game.save(); this.build(); } }, '⧉') : null,
        h('button', { class: 'ibtn', title: 'Пересобрать случайно', onclick: () => { f.ships[i] = randomDef(Game.tech, new Set(this.allNames())); Game.save(); this.build(); } }, '🎲'),
        h('button', { class: 'ibtn danger', title: 'Удалить', onclick: () => { f.ships.splice(i, 1); Game.save(); this.build(); } }, '✕')));
    Tip.bind(card.querySelector('.sc-img'), () => Info.hullTooltip(hl));
    card.querySelector('.sc-img').addEventListener('click', () => Editor.open(side, i));
    return card;
  },
};

// ---------- Каталог оборудования (просмотр) ----------
const Catalog = {
  open() {
    let cat = 'weapon';
    const body = h('div', { class: 'catalog-body' });
    const render = () => {
      body.innerHTML = '';
      const list = cat === 'hull' ? HULL_LIST : itemsFor(cat);
      const tbl = h('div', { class: 'cat-list' });
      for (const it of list) {
        const isHull = cat === 'hull';
        const m = MAKER[it.maker];
        const row = h('div', { class: 'cat-row' },
          h('span', { class: 'tier' }, U.roman(it.tier)),
          h('span', { class: 'nm' }, it.name),
          h('span', { class: 'mk', style: { color: m ? m.color : '#c77dff' } }, m ? m.name : 'Древние'),
          h('span', { class: 'sh' }, isHull ? `♥${it.hp} · броня ${Math.round(it.armor * 100)}% · ⚖${it.cap} · ${Info.slotsText(it)}` : Info.short(it)),
          h('span', { class: 'ms' }, isHull ? '' : '⚖' + it.mass),
          h('span', { class: 'pr' }, it.price + ' кр.'));
        Tip.bind(row, () => (isHull ? Info.hullTooltip(it) : Info.tooltip(it)));
        tbl.appendChild(row);
      }
      body.appendChild(tbl);
    };
    const tabs = seg([['hull', 'Корпуса'], ...SLOT_ORDER.map(k => [k, SLOT_TYPES[k].plural])], cat, v => { cat = v; render(); }, 'tabs');
    render();
    Modal.open(h('div', { class: 'catalog' }, h('h2', null, 'Каталог верфи'), tabs, body), 'wide');
  },
};
