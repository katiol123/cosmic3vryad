'use strict';
// ============================================================
//  Верфь: выбор корпуса и оборудования корабля
// ============================================================

const Editor = {
  active: false,
  side: 0, idx: 0, def: null,
  hullMaker: 'all',
  pick: null, // {cat, i}
  flt: { maker: 'all', tier: 0, sub: 'all', sort: 'tier' },
  t: 0,

  open(side, idx) {
    this.side = side; this.idx = idx;
    this.def = cloneDef(Game.fleets[side].ships[idx]);
    this.pick = null;
    this.build();
    Screens.show('scr-editor');
    this.active = true;
  },
  commit() {
    Game.fleets[this.side].ships[this.idx] = cloneDef(this.def);
    Game.save();
  },
  close() {
    this.commit();
    this.active = false;
    Setup.open();
  },

  build() {
    const el = document.getElementById('scr-editor');
    el.innerHTML = '';
    const nameIn = h('input', { class: 'name-in', value: this.def.name, maxlength: 28, oninput: e => { this.def.name = e.target.value || 'Без имени'; this.commit(); } });
    el.appendChild(h('div', { class: 'topbar' },
      h('button', { class: 'btn ghost', onclick: () => this.close() }, '← К флоту'),
      h('span', { class: `side-dot side${this.side}` }),
      nameIn,
      h('button', { class: 'ibtn', title: 'Случайное имя', onclick: () => { this.def.name = randomName(new Set(Setup.allNames())); nameIn.value = this.def.name; this.commit(); } }, '🎲'),
      h('div', { class: 'grow' }),
      h('div', { class: 'opt inline' }, h('label', null, 'ТУ'), seg([1, 2, 3, 4, 5].map(n => [n, U.roman(n)]), Game.tech, v => { Game.tech = v; Game.save(); }, 'small')),
      h('button', { class: 'btn', title: 'Заполнить пустые слоты подходящим оборудованием', onclick: () => { autoFill(this.def, Game.tech); this.changed(); } }, '⚡ Авто-сборка'),
      h('button', { class: 'btn', title: 'Полностью пересобрать', onclick: () => { const n = this.def.name; this.def = randomDef(Game.tech, null, this.def.hull); this.def.name = n; this.changed(); } }, '🎲 Пересобрать'),
      h('button', { class: 'btn ghost', onclick: () => { this.def = emptyDef(this.def.hull, this.def.name); this.changed(); } }, 'Снять всё'),
      h('button', { class: 'btn primary', onclick: () => this.close() }, '✔ Готово')));
    this.elHulls = h('div', { class: 'ed-hulls panel' });
    this.elCenter = h('div', { class: 'ed-center panel' });
    this.elRight = h('div', { class: 'ed-right panel' });
    el.appendChild(h('div', { class: 'editor' }, this.elHulls, this.elCenter, this.elRight));
    this.renderHulls();
    this.renderCenter();
    this.renderRight();
  },

  changed() {
    this.commit();
    this.renderHulls();
    this.renderCenter();
    this.renderRight();
  },

  renderHulls() {
    const el = this.elHulls;
    el.innerHTML = '';
    el.appendChild(h('div', { class: 'ph' }, 'Корпус'));
    el.appendChild(seg([['all', 'Все'], ...MAKERS.map(m => [m.id, m.code])], this.hullMaker, v => { this.hullMaker = v; this.renderHulls(); }, 'small tabs'));
    const list = h('div', { class: 'hull-list' });
    let lastCls = null;
    for (const hl of HULL_LIST) {
      if (this.hullMaker !== 'all' && hl.maker !== this.hullMaker) continue;
      if (hl.cls !== lastCls) { list.appendChild(h('div', { class: 'hl-cls' }, hl.clsName, h('span', null, ` ТУ ${U.roman(hl.tier)}+`))); lastCls = hl.cls; }
      const sel = hl.id === this.def.hull;
      const row = h('div', { class: 'hl-row' + (sel ? ' sel' : ''), onclick: () => { this.def = setHull(this.def, hl.id); this.trimMass(); this.changed(); } },
        h('img', { src: GFX.shipImage(hl.id, this.side, 96) }),
        h('div', null,
          h('div', { class: 'nm' }, hl.model, h('span', { style: { color: MAKER[hl.maker].color } }, ' · ' + MAKER[hl.maker].code)),
          h('div', { class: 'st' }, `♥${hl.hp} ⚖${hl.cap} укл.${hl.ev}%`),
          h('div', { class: 'sl' }, Info.slotsText(hl))));
      Tip.bind(row, () => Info.hullTooltip(hl));
      list.appendChild(row);
    }
    el.appendChild(list);
    const sel = list.querySelector('.sel');
    if (sel) requestAnimationFrame(() => sel.scrollIntoView({ block: 'nearest' }));
  },

  // при смене корпуса снимаем то, что не помещается по массе
  trimMass() {
    const cap = HULLS[this.def.hull].cap;
    const order = ['artifact', 'armor', 'ew', 'radar', 'computer', 'droid', 'arsenal', 'shield', 'weapon', 'reactor', 'engine'];
    for (const k of order) {
      for (let i = this.def.slots[k].length - 1; i >= 0; i--) {
        if (defMass(this.def) <= cap) return;
        if (this.def.slots[k][i]) this.def.slots[k][i] = null;
      }
    }
  },

  renderCenter() {
    const el = this.elCenter;
    el.innerHTML = '';
    const hl = HULLS[this.def.hull];
    const s = computeStats(this.def);
    this.prev = h('canvas', { class: 'ed-preview' });
    const massPct = Math.min(100, s.mass / s.cap * 100);
    el.append(
      h('div', { class: 'ph' }, hl.name, h('span', { style: { color: MAKER[hl.maker].color } }, ' · ' + MAKER[hl.maker].name)),
      h('div', { class: 'prev-wrap' }, this.prev, h('div', { class: 'prev-cls' }, hl.clsName.toUpperCase())),
      h('div', { class: 'mass' + (s.mass > s.cap ? ' over' : '') },
        h('div', { class: 'mass-l' }, 'Вместимость', h('b', null, `${s.mass} / ${s.cap}`)),
        h('div', { class: 'bar' }, h('i', { style: { width: massPct + '%' } }))),
      h('div', { class: 'ph sm' }, 'Частота блоков на поле'),
      h('div', { html: Info.biasBar(s.bias) }),
      h('div', { class: 'stats' }, Info.shipLines(s).map(([k, v]) => h('div', { class: 'st-row' }, h('span', null, k), h('b', { html: String(v) })))),
    );
  },

  renderRight() {
    if (this.pick) return this.renderPicker();
    const el = this.elRight;
    el.innerHTML = '';
    el.appendChild(h('div', { class: 'ph' }, 'Оборудование'));
    const wrap = h('div', { class: 'slots' });
    for (const k of SLOT_ORDER) {
      const arr = this.def.slots[k];
      if (!arr.length) continue;
      wrap.appendChild(h('div', { class: 'slot-h' }, SLOT_TYPES[k].icon + ' ' + SLOT_TYPES[k].plural));
      arr.forEach((id, i) => {
        const it = id ? ITEMS[id] : null;
        const row = h('div', { class: 'slot' + (it ? ' full' : ''), onclick: () => { this.pick = { cat: k, i }; this.flt.sub = 'all'; this.renderRight(); } },
          h('span', { class: 'slot-ico' }, SLOT_TYPES[k].icon),
          it ? h('div', { class: 'slot-b' },
            h('div', { class: 'nm' }, it.name, h('span', { class: 'tier' }, U.roman(it.tier))),
            h('div', { class: 'sh', style: it.cat === 'weapon' ? { color: DMG[it.dt].color } : null }, Info.short(it)))
            : h('div', { class: 'slot-b empty' }, '— пусто — нажмите, чтобы установить'),
          it ? h('span', { class: 'ms' }, '⚖' + it.mass) : null,
          it ? h('button', { class: 'ibtn danger', title: 'Снять', onclick: e => { e.stopPropagation(); this.def.slots[k][i] = null; this.changed(); } }, '✕') : null);
        if (it) Tip.bind(row, () => Info.tooltip(it));
        wrap.appendChild(row);
      });
    }
    el.appendChild(wrap);
  },

  renderPicker() {
    const el = this.elRight;
    el.innerHTML = '';
    const { cat, i } = this.pick;
    const cur = this.def.slots[cat][i] ? ITEMS[this.def.slots[cat][i]] : null;
    const free = HULLS[this.def.hull].cap - defMass(this.def) + (cur ? cur.mass : 0);
    const usedArt = new Set(this.def.slots.artifact.filter(Boolean));
    const f = this.flt;
    const subs = [...new Set(itemsFor(cat).map(it => it.base))];
    const head = h('div', { class: 'ph' },
      h('button', { class: 'ibtn', onclick: () => { this.pick = null; this.renderRight(); } }, '←'),
      ` ${SLOT_TYPES[cat].name}: выбор`, h('span', { class: 'free' }, `свободно ⚖${free}`));
    const sortOpts = [['tier', 'Техуровень'], ['price', 'Цена'], ['mass', 'Масса'], ['name', 'Название']];
    if (cat === 'weapon') sortOpts.push(['dmg', 'Урон'], ['range', 'Дальность']);
    const sel = (opts, val, on) => {
      const s = h('select', { onchange: e => on(e.target.value) }, opts.map(([v, l]) => h('option', { value: v, selected: v === val ? true : null }, l)));
      return s;
    };
    const filters = h('div', { class: 'filters' },
      cat !== 'artifact' ? sel([['all', 'Все производители'], ...MAKERS.map(m => [m.id, m.name])], f.maker, v => { f.maker = v; this.renderPicker(); }) : null,
      subs.length > 1 ? sel([['all', 'Все модели'], ...subs.map(s => [s, s])], f.sub, v => { f.sub = v; this.renderPicker(); }) : null,
      cat !== 'artifact' ? sel([['0', 'Любой ТУ'], ...[1, 2, 3, 4, 5].map(t => [String(t), 'ТУ ' + U.roman(t)])], String(f.tier), v => { f.tier = +v; this.renderPicker(); }) : null,
      sel(sortOpts, f.sort, v => { f.sort = v; this.renderPicker(); }));
    let list = itemsFor(cat).filter(it =>
      (cat === 'artifact' || f.maker === 'all' || it.maker === f.maker) && (f.sub === 'all' || it.base === f.sub) && (cat === 'artifact' || !f.tier || it.tier === f.tier));
    const dmg = it => (it.dmin + it.dmax) / 2 * it.shots * it.rof;
    const sorters = { tier: (a, b) => a.tier - b.tier || a.price - b.price, price: (a, b) => a.price - b.price, mass: (a, b) => a.mass - b.mass,
      name: (a, b) => a.name.localeCompare(b.name), dmg: (a, b) => dmg(b) - dmg(a), range: (a, b) => b.range - a.range };
    list.sort(sorters[f.sort] || sorters.tier);
    const box = h('div', { class: 'pick-list' });
    if (cur) box.appendChild(h('div', { class: 'pick-row remove', onclick: () => { this.def.slots[cat][i] = null; this.pick = null; this.changed(); } }, '✕ Снять установленное: ' + cur.name));
    list.slice(0, 400).forEach(it => {
      const heavy = it.mass > free;
      const dup = cat === 'artifact' && usedArt.has(it.id) && it.id !== (cur && cur.id);
      const m = MAKER[it.maker];
      const row = h('div', { class: 'pick-row' + (heavy || dup ? ' dis' : '') + (cur && cur.id === it.id ? ' cur' : ''),
        onclick: () => {
          if (heavy || dup) return;
          this.def.slots[cat][i] = it.id;
          this.pick = null;
          this.changed();
        } },
        h('span', { class: 'tier' }, cat === 'artifact' ? '✧' : U.roman(it.tier)),
        h('div', { class: 'pb' },
          h('div', { class: 'nm' }, it.name, m ? h('span', { style: { color: m.color } }, ' · ' + m.code) : null),
          h('div', { class: 'sh', style: it.cat === 'weapon' ? { color: DMG[it.dt].color } : null }, Info.short(it),
            it.eff && it.eff.length ? h('span', { class: 'effs' }, ' ' + it.eff.map(e => EFFECTS[e.k].icon).join('')) : null)),
        h('div', { class: 'pr' }, h('span', { class: heavy ? 'red' : '' }, '⚖' + it.mass), h('span', null, it.price + ' кр.')));
      Tip.bind(row, () => Info.tooltip(it));
      box.appendChild(row);
    });
    if (!list.length) box.appendChild(h('div', { class: 'empty-note' }, 'Ничего не найдено'));
    el.append(head, filters, h('div', { class: 'pick-count' }, `Моделей: ${list.length}`), box);
  },

  // анимированный голографический предпросмотр корабля
  renderPreview(dt) {
    if (!this.active || !this.prev || !this.prev.isConnected) return;
    this.t += dt;
    const cv = this.prev, d = Math.min(2, devicePixelRatio || 1);
    const r = cv.getBoundingClientRect();
    const W = Math.floor(r.width * d), H = Math.floor(r.height * d);
    if (!W || !H) return;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    const hl = HULLS[this.def.hull];
    const len = Math.round(Math.min(W * 0.62, H * 1.3) * (0.7 + hl.size * 0.2) / 8) * 8;
    const sp = GFX.ship(hl.id, this.side, len);
    const cx = W / 2, cy = H / 2 + Math.sin(this.t * 1.2) * 4 * d;
    // голо-платформа
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const pal = GFX.SIDE_PAL[this.side];
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = U.rgba(pal.accent, 0.18 - i * 0.04);
      ctx.lineWidth = 1.5 * d;
      ctx.beginPath(); ctx.ellipse(cx, H * 0.82, W * (0.3 + i * 0.08), H * (0.06 + i * 0.015), 0, 0, Math.PI * 2); ctx.stroke();
    }
    const beam = ctx.createLinearGradient(0, H * 0.82, 0, H * 0.2);
    beam.addColorStop(0, U.rgba(pal.accent, 0.12)); beam.addColorStop(1, U.rgba(pal.accent, 0));
    ctx.fillStyle = beam;
    ctx.beginPath(); ctx.moveTo(cx - W * 0.3, H * 0.82); ctx.lineTo(cx + W * 0.3, H * 0.82); ctx.lineTo(cx + W * 0.42, H * 0.1); ctx.lineTo(cx - W * 0.42, H * 0.1); ctx.fill();
    // пламя двигателей
    ctx.translate(cx, cy);
    for (const e of sp.meta.engines) {
      const fl = e.r * (3 + Math.sin(this.t * 30 + e.y) * 0.5 + Math.random() * 0.5);
      const g = ctx.createLinearGradient(e.x, 0, e.x - fl, 0);
      g.addColorStop(0, U.rgba(pal.flame[0], 0.9)); g.addColorStop(0.3, U.rgba(pal.flame[1], 0.7)); g.addColorStop(1, U.rgba(pal.flame[2], 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(e.x - fl / 2, e.y, fl / 2, e.r * 0.9, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    ctx.drawImage(sp.canvas, cx - sp.canvas.width / 2, cy - sp.canvas.height / 2);
    // сканирующая линия
    const sy = ((this.t * 0.35) % 1) * H;
    const sg = ctx.createLinearGradient(0, sy - 20 * d, 0, sy + 2);
    sg.addColorStop(0, U.rgba(pal.glow, 0)); sg.addColorStop(1, U.rgba(pal.glow, 0.25));
    ctx.fillStyle = sg; ctx.fillRect(0, sy - 20 * d, W, 20 * d);
  },
};
