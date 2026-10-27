'use strict';
// ============================================================
//  Процедурный звук на Web Audio: всё синтезируется на лету
// ============================================================

const Sound = {
  ctx: null, master: null, sfx: null, music: null, noiseBuf: null,
  on: true, musicOn: true, vol: 0.7,
  last: new Map(),
  drone: null,

  init() {
    const s = Store.get('sound', null);
    if (s) { this.on = s.on !== false; this.musicOn = s.music !== false; this.vol = typeof s.vol === 'number' ? s.vol : 0.7; }
    // браузер разрешает звук только после действия пользователя
    const unlock = () => {
      this.ensure();
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    };
    addEventListener('pointerdown', unlock, { capture: true });
    addEventListener('keydown', unlock, { capture: true });
    // щелчки по кнопкам
    document.addEventListener('click', e => {
      const b = e.target.closest && e.target.closest('button, .slot, .pick-row, .hl-row, .portrait');
      if (b) this.click();
    }, true);
  },
  save() { Store.set('sound', { on: this.on, music: this.musicOn, vol: this.vol }); },
  ensure() {
    if (this.ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try { this.ctx = new AC(); } catch (e) { return false; }
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = this.on ? this.vol : 0;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(c.destination);
    this.sfx = c.createGain(); this.sfx.gain.value = 0.9; this.sfx.connect(this.master);
    this.music = c.createGain(); this.music.gain.value = this.musicOn ? 0.35 : 0; this.music.connect(this.master);
    const len = c.sampleRate;
    this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return true;
  },
  ready() { return this.on && this.ctx && this.ctx.state === 'running'; },
  toggle() {
    this.on = !this.on;
    this.ensure();
    if (this.master) this.master.gain.setTargetAtTime(this.on ? this.vol : 0, this.ctx.currentTime, 0.05);
    this.save();
    return this.on;
  },
  toggleMusic() {
    this.musicOn = !this.musicOn;
    this.ensure();
    if (this.music) this.music.gain.setTargetAtTime(this.musicOn ? 0.35 : 0, this.ctx.currentTime, 0.2);
    this.save();
    return this.musicOn;
  },
  // не даём одинаковым звукам наслаиваться слишком плотно
  gate(key, ms) {
    const now = performance.now(), t = this.last.get(key) || 0;
    if (now - t < ms) return false;
    this.last.set(key, now);
    return true;
  },

  // ---------- примитивы ----------
  tone({ type = 'sine', f = 440, f2 = null, t = 0.2, a = 0.005, v = 0.3, delay = 0, dest = null, q = null, filt = null }) {
    const c = this.ctx, t0 = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t0);
    if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t0 + t);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(v, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + t);
    let node = o;
    if (filt) {
      const bq = c.createBiquadFilter();
      bq.type = filt; bq.frequency.value = q || 1200;
      o.connect(bq); node = bq;
    }
    node.connect(g); g.connect(dest || this.sfx);
    o.start(t0); o.stop(t0 + t + 0.05);
  },
  noise({ t = 0.3, v = 0.3, type = 'lowpass', f = 1200, f2 = null, q = 1, a = 0.003, delay = 0, dest = null }) {
    const c = this.ctx, t0 = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const bq = c.createBiquadFilter();
    bq.type = type; bq.Q.value = q;
    bq.frequency.setValueAtTime(f, t0);
    if (f2) bq.frequency.exponentialRampToValueAtTime(Math.max(30, f2), t0 + t);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(v, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + t);
    src.connect(bq); bq.connect(g); g.connect(dest || this.sfx);
    src.start(t0, Math.random() * 0.5); src.stop(t0 + t + 0.05);
  },

  // ---------- игровые звуки ----------
  click() { if (!this.ready() || !this.gate('click', 40)) return; this.tone({ type: 'triangle', f: 1400, f2: 900, t: 0.06, v: 0.08 }); },
  swap() { if (!this.ready() || !this.gate('swap', 60)) return; this.tone({ type: 'sine', f: 520, f2: 780, t: 0.12, v: 0.12 }); },
  bad() { if (!this.ready() || !this.gate('bad', 120)) return; this.tone({ type: 'square', f: 140, f2: 110, t: 0.18, v: 0.08, filt: 'lowpass', q: 800 }); },

  // сбор блоков: тон зависит от цвета, каскад поднимает высоту
  pop(types, cascade) {
    if (!this.ready() || !this.gate('pop', 70)) return;
    const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
    const base = 392 * Math.pow(2, Math.min(cascade - 1, 6) * 2 / 12);
    const uniq = [...new Set(types)].slice(0, 3);
    uniq.forEach((t, i) => {
      const f = base * Math.pow(2, scale[(t + i) % scale.length] / 12);
      this.tone({ type: 'triangle', f, t: 0.28, v: 0.13, delay: i * 0.035 });
      this.tone({ type: 'sine', f: f * 2, t: 0.18, v: 0.05, delay: i * 0.035 });
    });
    this.noise({ t: 0.08, v: 0.05, type: 'highpass', f: 5000 });
  },
  special(kind) {
    if (!this.ready() || !this.gate('sp' + kind, 90)) return;
    if (kind === 'line') { this.noise({ t: 0.35, v: 0.22, type: 'bandpass', f: 600, f2: 6000, q: 3 }); this.tone({ type: 'sawtooth', f: 300, f2: 1400, t: 0.3, v: 0.06, filt: 'lowpass', q: 2500 }); }
    else if (kind === 'bomb') { this.tone({ type: 'sine', f: 160, f2: 40, t: 0.45, v: 0.45 }); this.noise({ t: 0.4, v: 0.25, f: 1800, f2: 200 }); }
    else if (kind === 'nova') {
      [523, 659, 784, 1047].forEach((f, i) => this.tone({ type: 'sine', f, t: 0.9, v: 0.1, delay: i * 0.05 }));
      this.noise({ t: 0.8, v: 0.15, type: 'bandpass', f: 8000, f2: 1500, q: 2 });
    } else if (kind === 'make') { this.tone({ type: 'sine', f: 880, f2: 1760, t: 0.25, v: 0.12 }); this.tone({ type: 'triangle', f: 1320, t: 0.3, v: 0.06, delay: 0.06 }); }
    else if (kind === 'inject') { this.tone({ type: 'square', f: 220, f2: 90, t: 0.3, v: 0.08, filt: 'lowpass', q: 1200 }); this.noise({ t: 0.2, v: 0.08, type: 'bandpass', f: 2500, q: 6 }); }
    else if (kind === 'cleanse') { this.tone({ type: 'sine', f: 660, f2: 990, t: 0.3, v: 0.08 }); }
    else if (kind === 'shuffle') { for (let i = 0; i < 6; i++) this.tone({ type: 'triangle', f: 300 + Math.random() * 600, t: 0.08, v: 0.06, delay: i * 0.04 }); }
  },

  shot(fx) {
    if (!this.ready() || !this.gate('shot' + fx, fx === 'tracer' || fx === 'flak' || fx === 'swarm' ? 45 : 70)) return;
    switch (fx) {
      case 'beam': this.tone({ type: 'sawtooth', f: 1800, f2: 400, t: 0.18, v: 0.07, filt: 'lowpass', q: 3500 }); break;
      case 'bigbeam': this.tone({ type: 'sawtooth', f: 120, f2: 260, t: 0.5, v: 0.12, filt: 'lowpass', q: 1500 }); this.tone({ type: 'square', f: 900, f2: 300, t: 0.6, v: 0.05, delay: 0.3, filt: 'lowpass', q: 2500 }); break;
      case 'bolt': this.tone({ type: 'square', f: 1200, f2: 300, t: 0.12, v: 0.06, filt: 'lowpass', q: 3000 }); break;
      case 'plasma': this.tone({ type: 'sawtooth', f: 260, f2: 90, t: 0.35, v: 0.12, filt: 'lowpass', q: 900 }); this.noise({ t: 0.25, v: 0.08, f: 900 }); break;
      case 'flame': this.noise({ t: 0.5, v: 0.18, type: 'bandpass', f: 700, f2: 300, q: 0.8 }); break;
      case 'arc': this.noise({ t: 0.3, v: 0.15, type: 'bandpass', f: 4000, q: 4 }); this.tone({ type: 'square', f: 60, t: 0.3, v: 0.05 }); break;
      case 'wave': this.tone({ type: 'sine', f: 90, f2: 600, t: 0.4, v: 0.15 }); break;
      case 'tracer': this.noise({ t: 0.07, v: 0.16, type: 'bandpass', f: 1800, q: 1.5 }); this.tone({ type: 'square', f: 110, f2: 60, t: 0.06, v: 0.06 }); break;
      case 'rail': this.noise({ t: 0.12, v: 0.3, type: 'highpass', f: 3000 }); this.tone({ type: 'sawtooth', f: 3000, f2: 200, t: 0.35, v: 0.08, filt: 'lowpass', q: 5000 }); this.tone({ type: 'sine', f: 80, f2: 40, t: 0.3, v: 0.25 }); break;
      case 'flak': this.noise({ t: 0.12, v: 0.2, f: 2500, f2: 600 }); break;
      case 'slug': this.tone({ type: 'sine', f: 140, f2: 50, t: 0.25, v: 0.3 }); this.noise({ t: 0.15, v: 0.15, f: 1500 }); break;
      case 'missile': case 'swarm': this.noise({ t: fx === 'swarm' ? 0.3 : 0.6, v: fx === 'swarm' ? 0.07 : 0.14, type: 'bandpass', f: 600, f2: 2400, q: 1.2 }); break;
      case 'torpedo': this.tone({ type: 'sine', f: 70, f2: 140, t: 0.8, v: 0.25 }); this.noise({ t: 0.7, v: 0.1, type: 'bandpass', f: 400, f2: 900, q: 1 }); break;
      case 'grav': this.tone({ type: 'sine', f: 55, f2: 35, t: 0.6, v: 0.35 }); this.tone({ type: 'triangle', f: 220, f2: 110, t: 0.5, v: 0.05 }); break;
      case 'nano': for (let i = 0; i < 4; i++) this.tone({ type: 'sine', f: 2000 + Math.random() * 2000, t: 0.08, v: 0.03, delay: i * 0.04 }); break;
      case 'drain': this.tone({ type: 'sawtooth', f: 600, f2: 150, t: 0.5, v: 0.08, filt: 'lowpass', q: 1800 }); break;
      case 'quake': this.tone({ type: 'sine', f: 50, t: 0.5, v: 0.3 }); this.noise({ t: 0.4, v: 0.1, f: 300 }); break;
      case 'anti': this.tone({ type: 'sawtooth', f: 80, f2: 400, t: 0.45, v: 0.12, filt: 'lowpass', q: 2000 }); this.tone({ type: 'sine', f: 1200, f2: 200, t: 0.8, v: 0.1, delay: 0.4 }); this.noise({ t: 0.6, v: 0.2, f: 3000, f2: 300, delay: 0.4 }); break;
      default: this.tone({ type: 'square', f: 800, f2: 200, t: 0.12, v: 0.05 });
    }
  },
  hit(kind, big) {
    if (!this.ready() || !this.gate('hit' + kind, 50)) return;
    if (kind === 'shield') { this.tone({ type: 'sine', f: 900, f2: 300, t: 0.25, v: 0.09 }); this.noise({ t: 0.18, v: 0.08, type: 'bandpass', f: 3000, q: 2 }); }
    else if (kind === 'hull') { this.noise({ t: big ? 0.45 : 0.22, v: big ? 0.35 : 0.2, f: big ? 1400 : 2200, f2: 200 }); this.tone({ type: 'sine', f: 120, f2: 50, t: 0.25, v: big ? 0.3 : 0.15 }); }
    else if (kind === 'crit') { this.tone({ type: 'triangle', f: 1600, f2: 1200, t: 0.4, v: 0.1 }); this.tone({ type: 'sine', f: 2400, t: 0.3, v: 0.05, delay: 0.03 }); }
    else if (kind === 'miss') this.noise({ t: 0.15, v: 0.04, type: 'highpass', f: 4000 });
  },
  boom(big) {
    if (!this.ready() || !this.gate('boom' + (big ? 1 : 0), big ? 200 : 90)) return;
    this.noise({ t: big ? 1.8 : 0.6, v: big ? 0.55 : 0.25, f: big ? 2500 : 1600, f2: 60, a: 0.01 });
    this.tone({ type: 'sine', f: big ? 90 : 120, f2: 25, t: big ? 1.4 : 0.5, v: big ? 0.6 : 0.25 });
    if (big) this.noise({ t: 1.2, v: 0.15, type: 'bandpass', f: 500, f2: 120, q: 1, delay: 0.15 });
  },
  hack() {
    if (!this.ready() || !this.gate('hack', 150)) return;
    for (let i = 0; i < 8; i++) this.tone({ type: 'square', f: [880, 1320, 660, 1760][i % 4] * (1 + Math.random() * 0.1), t: 0.05, v: 0.04, delay: i * 0.045, filt: 'lowpass', q: 3000 });
  },
  effect() { if (!this.ready() || !this.gate('fx', 120)) return; this.tone({ type: 'triangle', f: 500, f2: 250, t: 0.2, v: 0.06 }); },
  move() { if (!this.ready() || !this.gate('move', 200)) return; this.noise({ t: 0.5, v: 0.06, type: 'bandpass', f: 300, f2: 900, q: 1 }); },
  turn() { if (!this.ready() || !this.gate('turn', 300)) return; this.tone({ type: 'sine', f: 660, t: 0.12, v: 0.06 }); this.tone({ type: 'sine', f: 990, t: 0.18, v: 0.05, delay: 0.08 }); },
  yourTurn() {
    if (!this.ready()) return;
    [523, 659, 784].forEach((f, i) => this.tone({ type: 'triangle', f, t: 0.3, v: 0.12, delay: i * 0.09 }));
  },
  extra() { if (!this.ready()) return; [784, 988, 1175, 1568].forEach((f, i) => this.tone({ type: 'triangle', f, t: 0.25, v: 0.1, delay: i * 0.06 })); },
  intro() {
    if (!this.ready()) return;
    this.tone({ type: 'sawtooth', f: 55, f2: 110, t: 1.6, v: 0.18, filt: 'lowpass', q: 600 });
    [220, 330, 440].forEach((f, i) => this.tone({ type: 'sawtooth', f, t: 1.2, v: 0.06, delay: 0.5 + i * 0.12, filt: 'lowpass', q: 1800 }));
    this.noise({ t: 1.5, v: 0.12, type: 'bandpass', f: 200, f2: 3000, q: 1, delay: 0.2 });
  },
  victory(win) {
    if (!this.ready()) return;
    const notes = win ? [523, 659, 784, 1047, 784, 1047] : [440, 415, 392, 330];
    notes.forEach((f, i) => {
      this.tone({ type: 'triangle', f, t: win ? 0.45 : 0.6, v: 0.13, delay: i * (win ? 0.14 : 0.25) });
      this.tone({ type: 'sine', f: f / 2, t: win ? 0.45 : 0.6, v: 0.07, delay: i * (win ? 0.14 : 0.25) });
    });
  },

  // Тихий космический эмбиент во время боя
  startDrone() {
    if (!this.ensure() || this.drone) return;
    const c = this.ctx, g = c.createGain();
    g.gain.value = 0.0001;
    g.gain.setTargetAtTime(0.12, c.currentTime, 2);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500; lp.Q.value = 4;
    const lfo = c.createOscillator(), lfoG = c.createGain();
    lfo.frequency.value = 0.06; lfoG.gain.value = 300;
    lfo.connect(lfoG); lfoG.connect(lp.frequency);
    const oscs = [55, 82.4, 110, 164.8].map((f, i) => {
      const o = c.createOscillator();
      o.type = i % 2 ? 'sawtooth' : 'triangle';
      o.frequency.value = f; o.detune.value = (Math.random() - 0.5) * 12;
      o.connect(lp); o.start();
      return o;
    });
    lp.connect(g); g.connect(this.music);
    lfo.start();
    this.drone = { g, oscs, lfo };
  },
  stopDrone() {
    if (!this.drone) return;
    const d = this.drone, c = this.ctx;
    d.g.gain.setTargetAtTime(0.0001, c.currentTime, 0.6);
    setTimeout(() => { d.oscs.forEach(o => o.stop()); d.lfo.stop(); }, 3000);
    this.drone = null;
  },
};
