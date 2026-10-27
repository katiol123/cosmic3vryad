'use strict';
// ============================================================
//  Точка входа и главный цикл отрисовки
// ============================================================

(function main() {
  Tip.init();
  Overlay.init();
  Sound.init();
  BG.init();
  Game.load();
  Clock.speed = [0.5, 1, 2, 4, 8].includes(Store.get('speed', 1)) ? Store.get('speed', 1) : 1;
  if (!Game.fleets[0].ships.length || !Game.fleets[1].ships.length) Game.randomize();
  Menu.build();
  Screens.show('scr-menu');

  addEventListener('keydown', e => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    if (e.code === 'Space' && BattleUI.active) { e.preventDefault(); BattleUI.togglePause(); }
    if (e.code === 'Escape') Modal.close();
  });

  let last = performance.now();
  function frame(now) {
    const real = Math.min(50, now - last);
    last = now;
    const g = Clock.tick(real) / 1000;
    const inBattle = BattleUI.active && Screens.cur && Screens.cur.id === 'scr-battle';
    if (!inBattle && !GalaxyUI.active && !SectorUI.active) BG.render(real / 1000);
    if (SectorUI.active) SectorUI.frame(real / 1000);
    if (GalaxyUI.active) GalaxyUI.frame(real / 1000);
    if (BattleUI.active && BattleUI.bv) {
      BattleUI.bv.update(g);
      BattleUI.bv.render();
      BattleUI.arena.update(g);
      BattleUI.arena.render();
    }
    if (Editor.active) Editor.renderPreview(real / 1000);
    Overlay.update(g);
    Overlay.render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
