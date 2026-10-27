// Балансировочный стенд: зеркальные бои, одна сторона получает прибавку к одной характеристике,
// равную примерно тому, что даёт ~10 единиц массы оборудования ТУ III.
// node tools/balance.js [боёв на характеристику] [кораблей] [техуровень] [ключи характеристик через запятую]
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.join(__dirname, '..');
for (const f of ['util', 'data', 'ship', 'board', 'ai', 'battle'])
  vm.runInThisContext(fs.readFileSync(path.join(root, 'js', f + '.js'), 'utf8'), { filename: f + '.js' });
Clock.instant = true;

const ws = (sh, res) => sh.weapons.some(w => w.res === res);
const injects = sh => !!sh.s.ew || sh.weapons.some(w => (w.eff || []).some(e => e.k !== 'shred' && e.k !== 'leech'));
const BOOSTS = {
  hp:      { name: 'Прочность +100', f: sh => { sh.s.maxHp += 100; sh.hp += 100; } },
  armor:   { name: 'Броня +10%', f: sh => { sh.s.armor += 0.1; } },
  shield:  { name: 'Щит (ёмкость) +80', f: sh => { sh.s.maxShield += 80; sh.shield += 80; }, rel: sh => sh.s.maxShield > 0 },
  sregen:  { name: 'Щит за блок +8', f: sh => { sh.s.shieldRegen += 8; }, rel: sh => sh.s.maxShield > 0 },
  evasion: { name: 'Уклонение +10', f: sh => { sh.s.evasion += 10; } },
  init:    { name: 'Инициатива +6', f: sh => { sh.s.init += 6; } },
  turn:    { name: 'Поворот +15°', f: sh => { sh.s.turn += 15; } },
  ePer:    { name: 'Энергия за блок +2', f: sh => { sh.s.ePer += 2; }, rel: sh => ws(sh, 'energy') },
  aPer:    { name: 'Боеприпасы за блок +2', f: sh => { sh.s.aPer += 2; }, rel: sh => ws(sh, 'ammo') },
  rPer:    { name: 'Ремонт за блок +6', f: sh => { sh.s.rPer += 6; } },
  thrust:  { name: 'Манёвр за блок +0.8 (+1.5% укл.)', f: sh => { sh.s.thrust += 0.8; sh.s.evadePer += 1.5; } },
  dPer:    { name: 'Данные за блок +1.5', f: sh => { sh.s.dPer += 1.5; } },
  acc:     { name: 'Точность +12', f: sh => { sh.s.acc += 12; } },
  crit:    { name: 'Крит +12', f: sh => { sh.s.crit += 12; } },
  range:   { name: 'Дальность +3', f: sh => { sh.s.range += 3; sh.weapons.forEach(w => { w.range += 3; }); } },
  ewRes:   { name: 'Защита систем +40%', f: sh => { sh.s.ewRes += 0.4; }, relEnemy: injects },
  ewPow:   { name: 'Мощность РЭБ +3', f: sh => { sh.s.ew.power += 3; }, rel: sh => !!sh.s.ew },
};

// Модули для проверки «пользы на единицу массы»: ставятся одной стороне в пустой слот
const ITEM_TESTS = {
  shield: { id: 'shield_std_terra_3' },
  engine: { id: 'engine_ion_terra_3' },
  reactor: { id: 'reactor_fusion_terra_3', rel: sh => ws(sh, 'energy') },
  arsenal: { id: 'arsenal_mag_terra_3', rel: sh => ws(sh, 'ammo') },
  droid: { id: 'droid_basic_terra_3' },
  computer: { id: 'computer_tgt_terra_3' },
  radar: { id: 'radar_std_terra_3' },
  ew: { id: 'ew_jam_terra_3' },
  wall: { id: 'ew_wall_terra_3', cat: 'ew', relEnemy: injects },
  armor: { id: 'armor_comp_terra_3' },
};

async function itemTrial(key, n, tier) {
  const T = ITEM_TESTS[key], it = ITEMS[T.id], cat = T.cat || key;
  let fleet;
  for (let k = 0; k < 200; k++) {
    fleet = randomFleet(n, tier, new Set());
    fleet.forEach(d => { d.slots[cat] = d.slots[cat].map(() => null); });
    const probe = fleet.map(d => new Ship(d, 0, 0));
    if (T.rel && !probe.some(T.rel)) continue;
    if (T.relEnemy && !probe.some(T.relEnemy)) continue;
    break;
  }
  const side = Math.random() < 0.5 ? 0 : 1;
  const boosted = fleet.map(d => {
    const c = cloneDef(d);
    if (!T.rel || T.rel(new Ship(d, 0, 0))) { if (!c.slots[cat].length) c.slots[cat].push(null); c.slots[cat][0] = it.id; }
    return c;
  });
  const fl = side === 0 ? [boosted, fleet] : [fleet, boosted];
  const bt = new Battle({ fleets: [{ ctrl: 'ai', ships: fl[0] }, { ctrl: 'ai', ships: fl[1] }] });
  const w = await bt.run();
  return w < 0 ? 0.5 : w === side ? 1 : 0;
}

async function trial(key, n, tier) {
  const B = BOOSTS[key];
  let fleet;
  for (let k = 0; k < 200; k++) {
    fleet = randomFleet(n, tier, new Set());
    const probe = fleet.map(d => new Ship(d, 0, 0));
    if (B.rel && !probe.some(B.rel)) continue;
    if (B.relEnemy && !probe.some(B.relEnemy)) continue;
    break;
  }
  const side = Math.random() < 0.5 ? 0 : 1;
  const bt = new Battle({ fleets: [{ ctrl: 'ai', ships: fleet }, { ctrl: 'ai', ships: fleet.map(cloneDef) }] });
  for (const sh of bt.ships) if (sh.side === side && (!B.rel || B.rel(sh))) B.f(sh);
  const w = await bt.run();
  return w < 0 ? 0.5 : w === side ? 1 : 0;
}

(async () => {
  const mode = process.argv[2] === 'items' ? 'items' : 'stats';
  const a = process.argv.slice(mode === 'items' || process.argv[2] === 'stats' ? 3 : 2);
  const N = +a[0] || 200, n = +a[1] || 3, tier = +a[2] || 3;
  const table = mode === 'items' ? ITEM_TESTS : BOOSTS;
  const keys = a[3] ? a[3].split(',') : Object.keys(table);
  for (const key of keys) {
    let s = 0;
    for (let i = 0; i < N; i++) s += await (mode === 'items' ? itemTrial(key, n, tier) : trial(key, n, tier));
    const p = s / N, ci = 1.96 * Math.sqrt(p * (1 - p) / N);
    if (mode === 'items') {
      const it = ITEMS[table[key].id];
      console.log(`${key.padEnd(9)} ${it.name.padEnd(34)} масса ${String(it.mass).padStart(2)}  победы ${(p * 100).toFixed(1)}% ±${(ci * 100).toFixed(1)}  прирост на 10 массы ${((p - 0.5) * 1000 / it.mass).toFixed(1)}%`);
    } else console.log(`${key.padEnd(8)} ${table[key].name.padEnd(34)} победы ${(p * 100).toFixed(1)}% ±${(ci * 100).toFixed(1)}`);
  }
})();
