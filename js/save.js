'use strict';
// ============================================================
//  Сохранение и загрузка кампании: три слота и автосохранение.
//  Мир переводится в простой JSON: ссылки — номерами, множества —
//  массивами, вычисляемое (характеристики кораблей, пути) —
//  пересчитывается при загрузке. Идущие бои восстанавливаются
//  с теми же участниками и их текущим состоянием.
// ============================================================

const SAVE_VERSION = 1;
const SAVE_SLOTS = ['auto', '1', '2', '3'];

const SaveGame = {
  key: slot => 'sc_camp_' + slot,
  metaKey: slot => 'sc_campmeta_' + slot,

  serialize(w) {
    const skip = new Set(['hooks', 'battles', 'agents', 'player', 'D', 'H', 'N', 'sectors', 'factions']);
    const o = {};
    for (const k of Object.keys(w)) if (!skip.has(k) && !k.startsWith('_')) o[k] = w[k];
    o.sectors = w.sectors.map(s => Object.assign({}, s, { lanes: s.lanes.map(L => L.id) }));
    o.factions = w.factions.map(f => Object.assign({}, f, { wars: [...f.wars] }));
    o.agents = [...w.agents.values()].map(a => { const c = Object.assign({}, a); delete c.s; return c; });
    o.playerId = w.player ? w.player.id : null;
    o.battles = w.battles.filter(wb => !wb.closed && !wb.b.over).map(wb => ({
      id: wb.id, sector: wb.sector, day: wb.day, sx: wb.sx, sy: wb.sy,
      sides: [0, 1].map(sd => wb.b.ships.filter(sh => sh.alive && sh.side === sd).map(sh => sh.ref)),
    }));
    return JSON.stringify({ v: SAVE_VERSION, w: o });
  },

  deserialize(str) {
    const { v, w: o } = JSON.parse(str);
    if (v !== SAVE_VERSION) throw new Error('несовместимая версия сохранения');
    const w = Object.create(World.prototype);
    Object.assign(w, o);
    delete w.playerId;
    w.sectors = o.sectors.map(s => Object.assign({}, s, { lanes: s.lanes.map(id => w.lanes[id]) }));
    w.factions = o.factions.map(f => Object.assign({}, f, { wars: new Set(f.wars) }));
    w.calcPaths();
    w.agents = new Map();
    for (const a of o.agents) { w.agents.set(a.id, a); a.battle = null; w.refresh(a); }
    w.player = o.playerId != null ? w.agents.get(o.playerId) || null : null;
    w.hooks = {};
    // бои: те же участники с текущим корпусом и щитом
    w.battles = [];
    for (const B of o.battles || []) {
      const sides = B.sides.map(ids => ids.map(id => w.agents.get(id)).filter(a => a && a.alive));
      if (sides[0].length && sides[1].length) w.startBattle(B.sector, sides[0], sides[1], B);
    }
    return w;
  },

  meta(w) {
    const p = w.player;
    return { name: p ? p.name : '—', day: w.day, credits: p ? Math.round(p.credits) : 0, sector: p && p.loc != null ? w.sectors[p.loc].name : '', rank: p && w.pilotTitle ? w.pilotTitle(p) : '', face: p ? p.face : null, at: Date.now() };
  },

  save(w, slot) {
    try {
      const data = this.serialize(w);
      localStorage.setItem(this.key(slot), data);
      localStorage.setItem(this.metaKey(slot), JSON.stringify(this.meta(w)));
      return null;
    } catch (e) {
      return e && e.name === 'QuotaExceededError' ? 'Не хватает места в хранилище браузера' : 'Не удалось сохранить: ' + (e.message || e);
    }
  },
  load(slot) {
    const data = localStorage.getItem(this.key(slot));
    if (!data) return null;
    return this.deserialize(data);
  },
  info(slot) { try { return JSON.parse(localStorage.getItem(this.metaKey(slot)) || 'null'); } catch (e) { return null; } },
  remove(slot) { try { localStorage.removeItem(this.key(slot)); localStorage.removeItem(this.metaKey(slot)); } catch (e) { /* нет хранилища */ } },
  // самое свежее сохранение
  latest() {
    let best = null;
    for (const s of SAVE_SLOTS) { const m = this.info(s); if (m && (!best || m.at > best.m.at)) best = { slot: s, m }; }
    return best;
  },
};

// окно сохранения и загрузки
const SaveUI = {
  open(mode) {
    const canSave = mode === 'game' && SectorUI.world && SectorUI.world.player;
    const list = h('div', { class: 'sv-list' });
    const fill = () => {
      list.innerHTML = '';
      for (const slot of SAVE_SLOTS) {
        const m = SaveGame.info(slot);
        const title = slot === 'auto' ? 'Автосохранение' : `Слот ${slot}`;
        const row = h('div', { class: 'sv-row' + (m ? '' : ' empty') },
          m && m.face ? h('img', { class: 'sv-face', src: FACE.url(m.face, 64) }) : h('div', { class: 'sv-face none' }, slot === 'auto' ? '⟳' : slot),
          h('div', { class: 'sv-b' },
            h('div', { class: 'sv-t' }, title),
            m ? h('div', { class: 'fs' }, `${m.name}${m.rank ? ' · ' + m.rank : ''} · день ${m.day} · ${m.credits.toLocaleString('ru')} кр.${m.sector ? ' · ' + m.sector : ''}`) : h('div', { class: 'fs dim' }, 'пусто'),
            m ? h('div', { class: 'fs dim' }, new Date(m.at).toLocaleString('ru')) : null),
          h('div', { class: 'row' },
            canSave && slot !== 'auto' ? h('button', { class: 'btn', onclick: () => {
              if (SectorUI.world.player.battle) { SectorUI.toast('Во время боя сохраняться нельзя', 'bad'); return; }
              const err = SaveGame.save(SectorUI.world, slot);
              SectorUI.toast(err || `Сохранено: ${title}`, err ? 'bad' : 'me');
              fill();
            } }, '💾 Сохранить') : null,
            m ? h('button', { class: 'btn primary', onclick: () => SaveUI.loadSlot(slot) }, '📂 Загрузить') : null,
            m && slot !== 'auto' ? h('button', { class: 'ibtn danger', title: 'Удалить', onclick: () => { SaveGame.remove(slot); fill(); } }, '✕') : null));
        list.appendChild(row);
      }
    };
    fill();
    Modal.open(h('div', { class: 'sv-modal' },
      h('h3', null, canSave ? 'Сохранение и загрузка' : 'Загрузить кампанию'),
      list,
      h('div', { class: 'fs dim' }, 'Автосохранение — каждые 5 дней. Сохранения хранятся в этом браузере.')));
  },
  loadSlot(slot) {
    let w;
    try { w = SaveGame.load(slot); } catch (e) { alert('Сохранение повреждено: ' + e.message); return; }
    if (!w) return;
    Modal.close();
    SectorUI.loadWorld(w);
  },
};
