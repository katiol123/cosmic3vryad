'use strict';
// ============================================================
//  Список наёмников (как в «Рейнджерах») и досье пилота
// ============================================================

const MercUI = {
  sort: 'rating',
  SORTS: [
    ['rating', 'Рейтинг'], ['power', 'Боевая мощь'], ['worth', 'Состояние'], ['kills', 'Сбито'], ['medals', 'Награды'], ['rank', 'Звание'],
  ],
  world() { return SectorUI.world || GalaxyUI.world; },
  value(a, k) {
    const w = this.world();
    switch (k) {
      case 'power': return w.strength(a);
      case 'worth': return w.pilotWorth(a);
      case 'kills': return a.kills || 0;
      case 'medals': return (a.honors || []).length;
      case 'rank': return a.member >= 0 ? w.rankIdx(a, a.member) * 1e6 + w.meritOf(a, a.member) : -1;
      default: return w.pilotRating(a);
    }
  },
  raceName(a) { return a.face && RACES[a.face.race] ? RACES[a.face.race].name : ''; },

  open() {
    const w = this.world();
    if (!w) return;
    const body = h('div', { class: 'mc-list' });
    const seg0 = seg(this.SORTS, this.sort, v => { this.sort = v; fill(); }, 'small');
    const fill = () => {
      body.innerHTML = '';
      const pilots = [...w.agents.values()].filter(a => a.kind === 'pilot').sort((x, y) => this.value(y, this.sort) - this.value(x, this.sort));
      const maxPow = Math.max(1, ...pilots.map(a => w.strength(a)));
      pilots.forEach((a, i) => body.appendChild(this.row(a, i + 1, maxPow)));
    };
    fill();
    Modal.open(h('div', { class: 'mc' },
      h('h2', null, '★ Наёмники галактики'),
      h('div', { class: 'mc-sort' }, h('span', { class: 'fs dim' }, 'Сортировать по:'), seg0),
      h('div', { class: 'mc-head' }, h('span', null, '№'), h('span', null, ''), h('span', null, 'Пилот'), h('span', null, 'Корабль'), h('span', null, 'Боевая мощь'), h('span', null, 'Состояние'), h('span', null, 'Сбито'), h('span', null, 'Награды')),
      body), 'wide');
  },
  row(a, place, maxPow) {
    const w = this.world(), me = a.ctrl === 'human';
    const pow = w.strength(a);
    const F = a.member >= 0 ? w.factions[a.member] : null;
    const medals = (a.honors || []).slice(-6).map(m => h('span', { class: 'mc-medal', title: `${MEDALS[m.id].name} — ${w.factions[m.f].short}`, style: { color: MEDALS[m.id].color } }, MEDALS[m.id].icon));
    const r = h('div', { class: 'mc-row' + (me ? ' me' : ''), onclick: () => this.dossier(a) },
      h('span', { class: 'mc-place' }, place),
      h('img', { class: 'mc-face', src: FACE.url(a.face, 64) }),
      h('div', { class: 'mc-who' },
        h('div', { class: 'mc-name' }, a.name, me ? h('span', { class: 'gold' }, ' (вы)') : null),
        h('div', { class: 'fs' }, `${this.raceName(a)} · ${w.pilotTitle(a)} (${w.pilotRating(a)})`),
        h('div', { class: 'fs', style: { color: F ? F.color : '#9aa6bf' } }, F ? `${w.rankName(a)} · ${F.short}` : 'свободный наёмник')),
      h('div', { class: 'mc-ship' }, h('img', { src: GFX.shipImage(a.def.hull, 0, 80) }), h('div', { class: 'fs' }, `${HULLS[a.def.hull].clsName} · ТУ ${w.shipTier(a).toFixed(1)}`)),
      h('div', { class: 'mc-pow' }, h('div', { class: 'mc-bar' }, h('i', { style: { width: Math.round(pow / maxPow * 100) + '%' } })), h('span', { class: 'fs' }, Math.round(pow))),
      h('span', { class: 'fs' }, `${w.pilotWorth(a).toLocaleString('ru')} кр.`),
      h('span', { class: 'fs' }, a.kills || 0),
      h('div', { class: 'mc-medals' }, medals.length ? medals : h('span', { class: 'fs dim' }, '—')));
    return r;
  },

  // досье пилота
  dossier(a) {
    const w = this.world();
    if (!a || !w) return;
    const me = a.ctrl === 'human', cs = a.cs || {};
    const F = a.member >= 0 ? w.factions[a.member] : null;
    const st = a.s || computeStats(a.def);
    const stat = (k, v) => h('div', { class: 'ds-stat' }, h('b', null, v), h('span', null, k));
    const repTop = Object.entries(a.rep || {}).filter(([, v]) => Math.abs(v) >= 5).sort((x, y) => y[1] - x[1]).slice(0, 6);
    const merits = Object.entries(a.merit && typeof a.merit === 'object' ? a.merit : {}).filter(([, v]) => v > 0).sort((x, y) => y[1] - x[1]).slice(0, 4);
    const box = h('div', { class: 'ds' },
      h('div', { class: 'ds-top' },
        h('img', { class: 'ds-face', src: FACE.url(a.face, 192) }),
        h('div', { class: 'ds-id' },
          h('h2', null, a.name, me ? h('span', { class: 'gold' }, ' (вы)') : null),
          h('div', { class: 'fs' }, `${this.raceName(a)} · ${me ? 'рейнджер' : 'наёмник'} · ${w.pilotTitle(a)}`),
          h('div', { class: 'ds-rating' }, `Рейтинг ${w.pilotRating(a)} · место ${w.pilotPlace(a)} из ${[...w.agents.values()].filter(x => x.kind === 'pilot').length}`),
          h('div', { class: 'fs', style: { color: F ? F.color : '#9aa6bf' } }, F ? `На службе: ${F.name} — ${w.rankName(a)} (заслуги ${w.meritOf(a, F.idx)}), жалованье ${w.salary(a)} кр./день` : 'Свободный наёмник'),
          !me && a.intent ? h('div', { class: 'fs dim' }, '🧠 ' + a.intent) : null,
          h('div', { class: 'fs dim' }, GalaxyUI.taskText.call({ world: w }, a)))),
      h('div', { class: 'ds-stats' },
        stat('боевая мощь', Math.round(w.strength(a))), stat('состояние', w.pilotWorth(a).toLocaleString('ru')), stat('сбито кораблей', a.kills || 0),
        stat('из них пиратов', cs.pirates || 0), stat('поручений', cs.quests || 0), stat('потерял кораблей', a.deaths || 0)),
      h('h3', null, 'Корабль'),
      h('div', { class: 'ds-ship' }, h('img', { src: GFX.shipImage(a.def.hull, 0, 160) }),
        h('div', null, h('div', { class: 'mc-name' }, `${HULLS[a.def.hull].name}`), h('div', { class: 'fs' }, `ТУ ${w.shipTier(a).toFixed(1)} · корпус ${Math.round(a.hp)}/${a.maxHp} · щит ${st.maxShield} · скорость ${Math.round(a.speed)}`),
          h('div', { class: 'ds-items' }, defItems(a.def).map(it => h('img', { class: 'gimg', src: GFX.itemIcon(it, 48), title: it.name }))))),
      h('h3', null, `Ордена и медали (${(a.honors || []).length})`),
      (a.honors || []).length ? h('div', { class: 'ds-medals' }, a.honors.map(m => h('div', { class: 'ds-medal', style: { '--mc': MEDALS[m.id].color } },
        h('span', { class: 'ds-mi' }, MEDALS[m.id].icon), h('div', null, h('b', null, MEDALS[m.id].name), h('div', { class: 'fs dim' }, `${w.factions[m.f].short} · день ${m.day} · ${MEDALS[m.id].desc}`))))) : h('div', { class: 'fs dim' }, 'Наград пока нет.'),
      merits.length ? h('h3', null, 'Заслуги перед фракциями') : null,
      merits.length ? h('div', { class: 'ds-rep' }, merits.map(([f, v]) => h('div', { class: 'fs' }, h('span', { style: { color: w.factions[f].color } }, w.factions[f].short), ` — ${Math.round(v)} (${RANKS[w.rankIdx(a, +f)].name})`))) : null,
      repTop.length ? h('h3', null, 'Репутация') : null,
      repTop.length ? h('div', { class: 'ds-rep' }, repTop.map(([f, v]) => h('div', { class: 'fs' }, h('span', { style: { color: w.factions[f].color } }, w.factions[f].short), ` ${v > 0 ? '+' : ''}${Math.round(v)}`))) : null,
      h('div', { class: 'row', style: { marginTop: '14px' } },
        h('button', { class: 'btn', onclick: () => this.open() }, '← К списку наёмников')));
    Modal.open(box, 'wide');
  },
};
