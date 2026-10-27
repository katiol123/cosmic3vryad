'use strict';
// ============================================================
//  Общий интерфейс: экраны, подсказки, описание предметов,
//  модальные окна, летящие сферы ресурсов, фон
// ============================================================

const h = U.h;

// ---------- Экраны с переходами ----------
const Screens = {
  cur: null,
  show(id) {
    const next = document.getElementById(id);
    if (this.cur === next) return;
    const prev = this.cur;
    if (prev) {
      prev.classList.add('leaving');
      setTimeout(() => prev.classList.remove('active', 'leaving'), 380);
    }
    next.classList.add('active');
    this.cur = next;
    Tip.hide();
  },
};

// ---------- Всплывающие подсказки ----------
const Tip = {
  el: null,
  init() { this.el = document.getElementById('tooltip'); },
  bind(el, content) {
    el.addEventListener('mouseenter', e => this.show(typeof content === 'function' ? content() : content, e));
    el.addEventListener('mousemove', e => this.move(e));
    el.addEventListener('mouseleave', () => this.hide());
    return el;
  },
  show(html, e) {
    if (!html || matchMedia('(hover: none)').matches) return;
    this.el.innerHTML = '';
    if (typeof html === 'string') this.el.innerHTML = html; else this.el.appendChild(html);
    this.el.classList.add('show');
    this.move(e);
  },
  move(e) {
    if (!this.el.classList.contains('show')) return;
    const r = this.el.getBoundingClientRect();
    let x = e.clientX + 16, y = e.clientY + 14;
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 16;
    if (y + r.height > innerHeight - 8) y = Math.max(8, innerHeight - r.height - 8);
    this.el.style.transform = `translate(${x}px, ${y}px)`;
  },
  hide() { if (this.el) this.el.classList.remove('show'); },
};

// ---------- Описания предметов и кораблей ----------
const Info = {
  pct: v => Math.round(v * 100) + '%',
  dmgTag(dt) { return `<span class="dt" style="color:${DMG[dt].color}">${DMG[dt].name}</span>`; },
  resists(obj) {
    const e = Object.entries(obj || {}).filter(([, v]) => v > 0);
    return e.length ? e.map(([k, v]) => `<span style="color:${DMG[k].color}">${DMG[k].short} ${Info.pct(v)}</span>`).join(', ') : null;
  },
  lines(it) {
    const L = [];
    const add = (k, v) => { if (v != null && v !== '' && v !== 0) L.push([k, v]); };
    switch (it.cat) {
      case 'weapon':
        add('Урон', `${it.dmin}–${it.dmax}${it.shots > 1 ? ` × ${it.shots}` : ''}`);
        add('Тип урона', Info.dmgTag(it.dt));
        add('Дальность', it.range);
        add('Точность', it.acc + '%');
        add('Крит', it.crit + '%');
        add('Питание', `<span style="color:${RES[it.res].color}">${RES[it.res].name}</span> ${it.cost}/залп`);
        add('Вместимость', it.cap);
        add('Залпов за ход', it.rof);
        if (it.pierce) add('Пробой щита', Info.pct(it.pierce));
        if (it.armorPen >= 0.05) add('Бронебойность', Info.pct(it.armorPen));
        if (it.homing) add('Наведение', 'самонаводящиеся (уклонение ×0.5)');
        break;
      case 'shield':
        add('Ёмкость щита', it.max); add('Восст. за блок', it.regen); add('Восст. за ход', it.passive);
        add('Сопротивление', Info.resists(it.resist)); break;
      case 'engine':
        add('Манёвр за блок', it.thrust); add('Уклонение за блок', '+' + it.evade + '%');
        add('Инициатива', (it.init >= 0 ? '+' : '') + it.init); add('Базовое уклонение', (it.ev >= 0 ? '+' : '') + it.ev + '%'); break;
      case 'reactor':
        add('Энергия за блок', it.ePer); add('Накопитель', it.eCap); add('Энергия за ход', it.ePass);
        if (it.over) add('Сверхзаряд блоков', Info.pct(it.over)); break;
      case 'arsenal':
        add('Боеприпасы за блок', it.aPer); add('Арсенал', it.aCap); add('Боеприпасы за ход', it.aPass);
        if (it.critStar) add('Звёзды крита', '+' + Info.pct(it.critStar)); break;
      case 'droid':
        add('Ремонт за блок', it.rPer); add('Ремонт за ход', it.rPass); add('Очистка поля', it.cleanse ? `${it.cleanse} блок(а) за 3 блока ремонта` : null); break;
      case 'computer':
        add('Точность', '+' + it.acc + '%'); add('Крит', '+' + it.crit + '%'); add('Данные за блок', it.dPer); break;
      case 'radar':
        add('Дальность оружия', '+' + it.range); add('Точность', '+' + it.acc + '%'); add('Уклонение', it.ev ? '+' + it.ev + '%' : null); break;
      case 'ew':
        if (it.kind) {
          add('Атака', it.kind === 'siphon' ? `перехват ${it.power} энергии и боеприпасов` : `${EFFECTS[it.kind].name} ×${it.power} на поле врага`);
          add('Стоимость', `${it.cost} данных`);
        }
        add('Защита от взлома', Info.pct(it.ewRes)); break;
      case 'armor':
        add('Прочность корпуса', '+' + it.hp); add('Броня', '+' + Info.pct(it.armor)); add('Сопротивление', Info.resists(it.resist));
        add('Уклонение', it.ev ? it.ev + '%' : null); break;
      case 'artifact': add('Эффект', it.desc); break;
    }
    return L;
  },
  short(it) {
    switch (it.cat) {
      case 'weapon': return `${it.dmin}–${it.dmax}${it.shots > 1 ? '×' + it.shots : ''} · дал. ${it.range} · ${it.acc}% · ${RES[it.res].name.toLowerCase()} ${it.cost}`;
      case 'shield': return `щит ${it.max} · +${it.regen}/блок · +${it.passive}/ход`;
      case 'engine': return `манёвр ${it.thrust} · укл. +${it.evade}% · иниц. ${it.init >= 0 ? '+' : ''}${it.init}`;
      case 'reactor': return `${it.ePer}/блок · накоп. ${it.eCap}${it.ePass ? ' · +' + it.ePass + '/ход' : ''}`;
      case 'arsenal': return `${it.aPer}/блок · арсенал ${it.aCap}${it.aPass ? ' · +' + it.aPass + '/ход' : ''}`;
      case 'droid': return `ремонт ${it.rPer}/блок · ${it.rPass}/ход${it.cleanse ? ' · очистка ' + it.cleanse : ''}`;
      case 'computer': return `точн. +${it.acc}% · крит +${it.crit}% · данные ${it.dPer}`;
      case 'radar': return `дальн. +${it.range} · точн. +${it.acc}%`;
      case 'ew': return it.kind ? `${it.kind === 'siphon' ? 'перехват' : EFFECTS[it.kind].name} ×${it.power} · ${it.cost} данных` : `защита ${Info.pct(it.ewRes)}`;
      case 'armor': return `+${it.hp} HP · броня +${Info.pct(it.armor)}`;
      case 'artifact': return it.desc;
    }
    return '';
  },
  effectsHTML(it) {
    if (it.cat !== 'weapon' || !it.eff || !it.eff.length) return '';
    return `<div class="tt-eff">${it.eff.map(e => `<div>${EFFECTS[e.k].icon} <b>${EFFECTS[e.k].name}</b>: ${EFFECTS[e.k].d(e)}${e.ch < 1 ? ` <i>(${Info.pct(e.ch)})</i>` : ''}</div>`).join('')}</div>`;
  },
  tooltip(it) {
    const m = it.maker ? MAKER[it.maker] : null;
    return `<div class="tt">
      <div class="tt-title">${it.name}</div>
      <div class="tt-sub">${SLOT_TYPES[it.cat].name}${m ? ` · <span style="color:${m.color}">${m.name}</span>` : ' · древний артефакт'} · ТУ ${U.roman(it.tier)}</div>
      <table>${Info.lines(it).map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}
      <tr><td>Масса</td><td>${it.mass}</td></tr><tr><td>Цена</td><td>${it.price} кр.</td></tr></table>
      ${Info.effectsHTML(it)}
      ${m ? `<div class="tt-note">${m.desc}</div>` : ''}
    </div>`;
  },
  slotsText(hl) {
    return SLOT_ORDER.filter(k => hl.slots[k]).map(k => `${SLOT_TYPES[k].icon}${hl.slots[k] > 1 ? hl.slots[k] : ''}`).join(' ');
  },
  hullTooltip(hl) {
    const m = MAKER[hl.maker];
    return `<div class="tt">
      <div class="tt-title">${hl.name}</div>
      <div class="tt-sub">${hl.clsName} · <span style="color:${m.color}">${m.name}</span></div>
      <table>
        <tr><td>Прочность</td><td>${hl.hp}</td></tr>
        <tr><td>Броня</td><td>${Info.pct(hl.armor)}</td></tr>
        <tr><td>Вместимость</td><td>${hl.cap}</td></tr>
        <tr><td>Уклонение</td><td>${hl.ev}%</td></tr>
        <tr><td>Инициатива</td><td>${hl.init}</td></tr>
        ${hl.shield ? `<tr><td>Встроенный щит</td><td>${hl.shield}</td></tr>` : ''}
        ${Info.resists(hl.resist) ? `<tr><td>Сопротивление</td><td>${Info.resists(hl.resist)}</td></tr>` : ''}
        <tr><td>Слоты</td><td>${SLOT_ORDER.filter(k => hl.slots[k]).map(k => `${SLOT_TYPES[k].name} ×${hl.slots[k]}`).join('<br>')}</td></tr>
        <tr><td>Цена</td><td>${hl.price} кр.</td></tr>
      </table>
      <div class="tt-note">Частота блоков на поле:</div>${Info.biasBar(hl.bias)}
    </div>`;
  },
  biasBar(bias) {
    const sum = U.sum(bias);
    return `<div class="bias">${bias.map((v, i) => `<i style="flex:${v / sum};background:${BLOCKS[i].color}" title="${BLOCKS[i].name} ${Math.round(v / sum * 100)}%"></i>`).join('')}</div>`;
  },
  shipLines(s) {
    const dps = U.sum(s.weapons, weaponDps);
    return [
      ['Прочность', Math.round(s.maxHp)], ['Броня', Info.pct(s.armor)], ['Щит', s.maxShield ? `${s.maxShield} (+${s.shieldRegen}/блок)` : '—'],
      ['Уклонение', Math.round(s.evasion) + '%'], ['Инициатива', s.init], ['Масса', `${s.mass} / ${s.cap}`],
      ['Энергия/блок', s.ePer + ` (нак. ${s.eCap})`], ['Боеприпасы/блок', s.aPer + ` (арс. ${s.aCap})`],
      ['Ремонт/блок', s.rPer], ['Манёвр/блок', `${s.thrust} (+${s.evadePer}% укл.)`], ['Данные/блок', s.dPer],
      ['Точность', '+' + s.acc + '%'], ['Крит', s.crit + '%'], ['Дальность', '+' + s.range],
      ['РЭБ', s.ew ? `${s.ew.kind === 'siphon' ? 'перехват' : EFFECTS[s.ew.kind].name} ×${s.ew.power} за ${s.ew.cost} данных` : '—'],
      ['Защита от взлома', Info.pct(s.ewRes)], ['Потенциал урона', Math.round(dps) + '/ход'],
    ];
  },
};

// ---------- Модальные окна ----------
const Modal = {
  open(content, cls = '') {
    const root = document.getElementById('modal-root');
    const box = h('div', { class: 'modal ' + cls }, h('button', { class: 'modal-x', onclick: () => Modal.close() }, '✕'), content);
    const wrap = h('div', { class: 'modal-wrap', onclick: e => { if (e.target === wrap) Modal.close(); } }, box);
    root.innerHTML = '';
    root.appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add('show'));
    return box;
  },
  close() {
    const root = document.getElementById('modal-root');
    const w = root.firstChild;
    if (!w) return;
    w.classList.remove('show');
    setTimeout(() => { if (w.parentNode) w.parentNode.removeChild(w); }, 300);
  },
  help() {
    const blk = BLOCKS.map((b, i) => h('div', { class: 'help-block' },
      h('img', { src: GFX.block(i, 64).toDataURL() }), h('div', null, h('b', { style: { color: b.color } }, b.name), h('p', null, b.desc))));
    const spec = [
      ['Линия', 'Совпадение 4 в ряд. При взрыве уничтожает весь ряд или столбец.'],
      ['Бомба', 'Совпадение буквой Г или Т. Взрыв 3×3.'],
      ['Сверхновая', 'Совпадение 5 в ряд — даёт дополнительный ход. Поменяйте её с любым блоком, чтобы уничтожить все блоки этого цвета. Две сверхновые очищают поле.'],
      ['Комбо', 'Обмен двух спецблоков: линия+линия = крест, бомба+бомба = 5×5, линия+бомба = три ряда и три столбца. Сверхновая + спецблок превращает весь цвет в спецблоки!'],
      ['×2 — Сверхзаряд', 'Блок даёт двойной ресурс. Чаще появляется с мощным реактором.'],
      ['★ — Звезда крита', 'Следующий выстрел гарантированно критический.'],
      ['Каскад', 'Каждый следующий уровень каскада даёт +25% ресурсов.'],
    ];
    const bad = [
      ['Обломки', 'Нельзя двигать и собирать. Разрушаются при совпадении рядом или взрыве.'],
      ['Заморозка', 'Блок нельзя двигать, а при сборе он не даёт ресурса. Тает за 3 хода.'],
      ['Вирус', 'Не даёт ресурса, распространяется по полю и в начале хода крадёт энергию, боеприпасы и данные.'],
      ['Мина', 'Таймер на 3 хода. Взрывается — урон кораблю и обломки вокруг. Соберите её, чтобы обезвредить (+3 данных).'],
    ];
    const dt = DMG_KEYS.map(k => h('div', { class: 'help-dt' }, h('b', { style: { color: DMG[k].color } }, DMG[k].name), ' — ', DMG[k].desc));
    const box = h('div', { class: 'help' },
      h('h2', null, 'Справочник командира'),
      h('p', { class: 'lead' }, 'Каждый корабль сражается на своём поле «3 в ряд». Собранные блоки превращаются в энергию, боеприпасы, щиты, ремонт, манёвр и данные. После хода корабль автоматически манёвренирует и стреляет из всего заряженного оружия, которое достаёт до цели. Корабли ходят по очереди в порядке инициативы.'),
      h('h3', null, 'Блоки поля'), h('div', { class: 'help-grid' }, blk),
      h('h3', null, 'Спецблоки и бонусы'), h('div', { class: 'help-list' }, spec.map(([a, b]) => h('div', null, h('b', null, a), ' — ', b))),
      h('h3', null, 'Вредоносные блоки (от оружия и РЭБ врага)'), h('div', { class: 'help-list bad' }, bad.map(([a, b]) => h('div', null, h('b', null, a), ' — ', b))),
      h('h3', null, 'Типы урона'), h('div', { class: 'help-list' }, dt),
      h('h3', null, 'Дистанция и тактика'),
      h('p', null, 'Корабли стоят на одной оси. У каждого оружия своя дальность: дальше 55% дальности точность падает. Очки манёвра (блоки манёвра + 1 бесплатное за ход) тратятся на сближение или отход согласно тактике: «Авто» выбирает дистанцию, где ваш урон максимален, а урон врага минимален.'),
      h('h3', null, 'Управление'),
      h('p', null, 'Перетащите блок или щёлкните два соседних. Щелчок по кораблю в окне боя — выбрать цель (если это ваш корабль — переключиться на его поле). Щелчок по портрету — посмотреть поле любого корабля. Пробел — пауза.'),
    );
    Modal.open(box, 'wide');
  },
};

// ---------- Сферы ресурсов, летящие от поля к шкалам ----------
const Overlay = {
  cv: null, ctx: null, orbs: [], dpr: 1,
  init() {
    this.cv = document.getElementById('overlay');
    this.ctx = this.cv.getContext('2d');
    this.resize();
    addEventListener('resize', () => this.resize());
  },
  resize() {
    this.dpr = Math.min(2, devicePixelRatio || 1);
    this.cv.width = innerWidth * this.dpr; this.cv.height = innerHeight * this.dpr;
  },
  orb(x, y, t, mult = 1) {
    const el = document.querySelector(`[data-res="${t}"]`);
    if (!el || !el.offsetParent) return;
    const r = el.getBoundingClientRect();
    const x1 = r.left + r.width * U.rf(0.3, 0.7), y1 = r.top + r.height / 2;
    this.orbs.push({ x0: x, y0: y, x1, y1, cx: (x + x1) / 2 + U.rf(-120, 120), cy: Math.min(y, y1) - U.rf(40, 160),
      t: -U.rf(0, 0.12), d: U.rf(0.45, 0.7), col: BLOCKS[t].color, glow: BLOCKS[t].glow, el, mult, trail: [] });
  },
  update(dt) {
    for (const o of this.orbs) {
      o.t += dt;
      if (o.t < 0) continue;
      const u = U.ease.inQuad(Math.min(1, o.t / o.d));
      const a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, c = u * u;
      o.x = a * o.x0 + b * o.cx + c * o.x1; o.y = a * o.y0 + b * o.cy + c * o.y1;
      o.trail.push([o.x, o.y]);
      if (o.trail.length > 10) o.trail.shift();
      if (o.t >= o.d && !o.done) {
        o.done = true;
        o.el.classList.remove('pulse'); void o.el.offsetWidth; o.el.classList.add('pulse');
      }
    }
    this.orbs = this.orbs.filter(o => !o.done);
  },
  render() {
    const ctx = this.ctx, d = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.cv.width, this.cv.height);
    if (!this.orbs.length) return;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    for (const o of this.orbs) {
      if (o.t < 0 || o.x == null) continue;
      o.trail.forEach(([x, y], i) => {
        ctx.fillStyle = U.rgba(o.col, (i / o.trail.length) * 0.5);
        ctx.beginPath(); ctx.arc(x, y, 2 + i * 0.35, 0, Math.PI * 2); ctx.fill();
      });
      const r = 6 + o.mult * 2;
      const g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, r * 2);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.3, o.glow); g.addColorStop(1, U.rgba(o.col, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(o.x, o.y, r * 2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  },
};

// ---------- Фон: звёздное небо с метеорами ----------
const BG = {
  cv: null, ctx: null, layer: null, stars: [], meteors: [], t: 0,
  init() {
    this.cv = document.getElementById('bg');
    this.ctx = this.cv.getContext('2d');
    this.resize();
    addEventListener('resize', () => this.resize());
  },
  resize() {
    const d = Math.min(1.5, devicePixelRatio || 1);
    this.cv.width = innerWidth * d; this.cv.height = innerHeight * d;
    this.layer = GFX.starfield(this.cv.width * 1.2, this.cv.height * 1.2, 1977);
    this.stars = Array.from({ length: 160 }, () => ({ x: Math.random(), y: Math.random(), z: 0.2 + Math.random(), tw: Math.random() * 6 }));
  },
  render(dt) {
    this.t += dt;
    const ctx = this.ctx, W = this.cv.width, H = this.cv.height;
    const ox = Math.sin(this.t * 0.03) * W * 0.05 - W * 0.08, oy = Math.cos(this.t * 0.025) * H * 0.05 - H * 0.08;
    ctx.drawImage(this.layer, ox, oy);
    for (const s of this.stars) {
      s.x -= s.z * 0.004 * dt;
      if (s.x < 0) s.x += 1;
      const a = 0.4 + 0.4 * Math.sin(this.t * 2 + s.tw);
      ctx.fillStyle = `rgba(230,235,255,${a * s.z})`;
      ctx.fillRect(s.x * W, s.y * H, 1.6 * s.z, 1.6 * s.z);
    }
    if (Math.random() < dt * 0.4) this.meteors.push({ x: Math.random() * W, y: Math.random() * H * 0.5, vx: -U.rf(400, 800), vy: U.rf(150, 300), t: 0, d: U.rf(0.6, 1.2) });
    ctx.globalCompositeOperation = 'lighter';
    for (const m of this.meteors) {
      m.t += dt; m.x += m.vx * dt; m.y += m.vy * dt;
      const a = Math.sin((m.t / m.d) * Math.PI);
      const g = ctx.createLinearGradient(m.x, m.y, m.x - m.vx * 0.15, m.y - m.vy * 0.15);
      g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(1, 'rgba(120,180,255,0)');
      ctx.strokeStyle = g; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(m.x - m.vx * 0.15, m.y - m.vy * 0.15); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    this.meteors = this.meteors.filter(m => m.t < m.d);
  },
};

// ---------- Сохранение ----------
const Store = {
  get(k, def) { try { const v = localStorage.getItem('sc_' + k); return v ? JSON.parse(v) : def; } catch (e) { return def; } },
  set(k, v) { try { localStorage.setItem('sc_' + k, JSON.stringify(v)); } catch (e) { /* приватный режим */ } },
};
