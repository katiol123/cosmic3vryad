// Безголовая симуляция боёв для проверки баланса: node tools/sim.js [бои] [кораблей] [техуровень]
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.join(__dirname, '..');
for (const f of ['util', 'data', 'ship', 'board', 'ai', 'battle'])
  vm.runInThisContext(fs.readFileSync(path.join(root, 'js', f + '.js'), 'utf8'), { filename: f + '.js' });
Clock.instant = true;
const N = +process.argv[2] || 20, n = +process.argv[3] || 3, tier = +process.argv[4] || 3;
(async () => {
  let rounds = 0, turns = 0, wins = [0, 0, 0], t0 = Date.now(), timeouts = 0;
  for (let i = 0; i < N; i++) {
    const [a, b] = randomFleets(n, tier);
    const bt = new Battle({ fleets: [{ ctrl: 'ai', ships: a }, { ctrl: 'ai', ships: b }] });
    const w = await bt.run();
    wins[w < 0 ? 2 : w]++;
    rounds += bt.round;
    if (bt.round >= MAX_ROUNDS) timeouts++;
    turns += bt.ships.reduce((s, x) => s + x.st.turns, 0);
  }
  console.log(`battles=${N} ships=${n}v${n} tier=${tier} avgRounds=${(rounds / N).toFixed(1)} avgTurns=${(turns / N).toFixed(0)} wins=${wins} timeouts=${timeouts} ms/battle=${((Date.now() - t0) / N).toFixed(0)}`);
})();
