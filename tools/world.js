// Прогон кампании без графики: node tools/world.js [дней] [зерно]
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.join(__dirname, '..');
for (const f of ['util', 'data', 'ship', 'board', 'ai', 'battle', 'world-data', 'world', 'world-player', 'quests'])
  vm.runInThisContext(fs.readFileSync(path.join(root, 'js', f + '.js'), 'utf8'), { filename: f + '.js' });
Clock.instant = true;
const DAYS = +process.argv[2] || 300, SEED = process.argv[3] != null ? +process.argv[3] : 12345;
const pad = (s, n) => String(s).padEnd(n), lpad = (s, n) => String(s).padStart(n);

function report(w) {
  console.log(`\n===== День ${w.day} =====  кораблей: ${w.agents.size}, идёт боёв: ${w.battles.length}`);
  console.log(pad('Фракция', 26) + lpad('план', 5) + lpad('насел', 7) + lpad('казна', 9) + lpad('ТУ', 4) + lpad('кор', 5) + lpad('торг', 9) + lpad('потери', 8) + lpad('от пир', 8) + lpad('миссии', 9) + '  войны');
  for (const r of w.summary()) {
    const f = r.f;
    console.log(pad((f.alive ? '' : '✝ ') + f.name, 26) + lpad(r.planets, 5) + lpad(r.pop.toFixed(1), 7) + lpad(Math.round(r.treasury), 9) + lpad(f.tech, 4) + lpad(r.ships, 5) +
      lpad(Math.round(f.st.trade), 9) + lpad(f.st.lost, 8) + lpad(f.st.lostToPirates, 8) + lpad(`${f.st.missionsOk}/${f.st.missionsFail}`, 9) + '  ' + r.wars.map(x => w.factions[x].short).join(', '));
  }
  const pir = [...w.agents.values()].filter(a => a.faction === PIRATE);
  console.log(`Пираты: баз ${w.bases.filter(b => b.alive).length}, кораблей ${pir.length}, богатство ${w.bases.filter(b => b.alive).map(b => Math.round(b.wealth)).join('/')}; добыча всего ${Math.round(w.stats.lootTotal)}, сбито пиратов ${w.stats.pirateKills}`);
  const pilots = [...w.agents.values()].filter(a => a.kind === 'pilot').sort((a, b) => b.credits - a.credits);
  console.log('Пилоты: ' + pilots.slice(0, 8).map(p => `${p.name}${p.member >= 0 ? '[' + w.factions[p.member].short + ']' : ''} ${Math.round(p.credits)}кр ${HULLS[p.def.hull].clsName} ☠${p.kills}`).join('; '));
  console.log(`Всего: боёв ${w.stats.battles}, уничтожено ${w.stats.destroyed}, захвачено планет ${w.stats.captured}, войн ${w.stats.wars}, миров ${w.stats.peaces}, торговая прибыль ${Math.round(w.stats.tradeTotal)}`);
}

(async () => {
  const t0 = Date.now();
  const w = new World({ seed: SEED });
  // что решают пилоты в зависимости от силы и кошелька
  const intents = {};
  for (let d = 0; d < DAYS; d++) {
    await w.tick();
    for (const a of w.agents.values()) {
      if (a.kind !== 'pilot' || !a.intent || a.ctrl === 'human') continue;
      const A = w.assess(a);
      const k = (A.weak ? 'слабый' : A.strong ? 'сильный' : 'средний') + '/' + (A.poor ? 'бедный' : A.rich ? 'богатый' : 'обычный');
      (intents[k] = intents[k] || {})[a.intent] = (intents[k][a.intent] || 0) + 1;
    }
    if (w.day % 100 === 1 && w.day > 1) report(w);
  }
  if (w.day % 100 !== 1) report(w);
  console.log('\nНамерения пилотов (сила/деньги → доли, %):');
  for (const k of Object.keys(intents).sort()) {
    const t = U.sum(Object.values(intents[k]));
    console.log('  ' + pad(k, 18) + lpad(t, 6) + '  ' + Object.entries(intents[k]).sort((x, y) => y[1] - x[1]).map(([n, c]) => `${n} ${Math.round(c / t * 100)}`).join(', '));
  }
  const pl = [...w.agents.values()].filter(a => a.kind === 'pilot' && a.ctrl !== 'human');
  console.log('Гибели пилотов: ' + pl.map(a => a.deaths || 0).join(' ') + ` (всего ${U.sum(pl, a => a.deaths || 0)})`);
  const qs = w.quests || [];
  const byT = {};
  for (const q of qs) { const k = q.type + ':' + q.status; byT[k] = (byT[k] || 0) + 1; }
  console.log('\nПоручения:', JSON.stringify(byT));
  console.log('Выполнили пилоты:', qs.filter(q => q.status === 'done' && q.winner).map(q => { const a = w.agents.get(q.winner); return (a ? a.name : '?') + ' — ' + q.title; }).slice(-10).join('; '));
  const types = {};
  for (const e of w.events) types[e.type] = (types[e.type] || 0) + 1;
  console.log('\nСобытия (последние 600 по типам):', JSON.stringify(types));
  console.log('Последние события:\n' + w.events.slice(-15).map(e => `  д${e.day}: ${e.text}`).join('\n'));
  console.log(`\nВремя: ${((Date.now() - t0) / 1000).toFixed(1)} с (${((Date.now() - t0) / DAYS).toFixed(0)} мс/день)`);
})();
