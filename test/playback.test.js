import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, HARVEST_FRACTION, PRESETS, REGIMES } from '../src/engine.js';
import { pellicleStats } from '../src/sim/pellicle.js';
import { transferDuration, exchangeSpeed } from '../src/sim/transfer-clock.js';
import { chartSeries } from '../src/charts.js';
import { validateSnapshot } from '../src/sim/snapshot.js';

// Exercise the component's frame loop without a browser or canvas.
globalThis.HTMLElement = class {
  addEventListener() {}
  hasAttribute() { return false; }
  attachShadow() {
    const nodes = new Map();
    return this.shadowRoot = {
      querySelector(selector) {
        if (!nodes.has(selector)) nodes.set(selector, { getContext: () => ({}), setAttribute() {}, viewBox: { baseVal: { width: 240, height: 90 } } });
        return nodes.get(selector);
      },
      querySelectorAll: () => []
    };
  }
};
globalThis.customElements = { get: () => true };
globalThis.document = { hidden: false };
globalThis.requestAnimationFrame = () => 0;
const { SymbiosimVessel } = await import('../src/main.js');
test('reconnection resets frame timing and observes motion changes without leaking listeners', () => {
  const previousObserver = globalThis.ResizeObserver;
  const previousCancel = globalThis.cancelAnimationFrame;
  const previousDocument = globalThis.document;
  const listeners = new Map();
  const media = () => ({
    matches: false,
    addEventListener: (event, handler) => listeners.set(handler, event),
    removeEventListener: (event, handler) => listeners.delete(handler)
  });
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  globalThis.cancelAnimationFrame = () => {};
  globalThis.document = { addEventListener() {}, removeEventListener() {} };
  try {
    const view = Object.assign(Object.create(SymbiosimVessel.prototype), {
      dark: media(), reducedMotion: media(), motion: true,
      canvas: {}, lastFrame: 999, pending: .05,
      readPalette() {}, updateControls() {}, draw() {}
    });
    view.connectedCallback();
    assert.equal(view.lastFrame, 0);
    assert.equal(view.pending, 0);
    assert.equal(listeners.size, 2);
    view.reducedMotion.matches = true;
    view.motionHandler();
    assert.equal(view.motion, false);
    view.disconnectedCallback();
    assert.equal(listeners.size, 0);
    view.connectedCallback(); view.disconnectedCallback();
    assert.equal(listeners.size, 0);
  } finally {
    globalThis.ResizeObserver = previousObserver;
    globalThis.cancelAnimationFrame = previousCancel;
    globalThis.document = previousDocument;
  }
});

test('each component starts fresh without accessing storage and selects the live phone grid', () => {
  const previousMedia = globalThis.matchMedia;
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true, get() { throw new Error('Storage must never be accessed'); }
  });
  try {
    for (const phone of [false, true]) {
      globalThis.matchMedia = query => ({ matches: query === '(max-width: 640px)' && phone });
      const first = new SymbiosimVessel();
      first.sim.day = 100;
      first.sim.agents = [];
      const reloaded = new SymbiosimVessel();
      assert.equal(reloaded.sim.day, 0);
      assert.equal(reloaded.sim.playing, true);
      assert.equal(reloaded.sim.agents.length, 480);
      assert.equal(reloaded.sim.nx, phone ? 16 : 22);
      assert.equal(reloaded.sim.ny, phone ? 24 : 30);
      assert.equal(reloaded.sim.nz, phone ? 5 : 8);
      assert.notEqual(first.sim, reloaded.sim);
      reloaded.draw = () => {};
      reloaded.updateReadings = () => {};
      reloaded.advance = () => {};
      reloaded.frame(10000);
      reloaded.frame(30000); // Cross the former autosave interval.
    }
  } finally {
    globalThis.matchMedia = previousMedia;
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
    else delete globalThis.localStorage;
  }
});

test('exchange display time follows hydraulic head and amount independently of biological speed', () => {
  for (const speed of [1, 12, 60]) {
    const sim = new Simulation();
    sim.speed = speed; sim.fields.acetic.fill(2); sim.stepCare(.5);
    const view = Object.assign(Object.create(SymbiosimVessel.prototype), {
      sim, advance: days => sim.stepCare(days),
      draw() {}, updateReadings() {}
    });
    let now = 10000;
    view.frame(now);
    const start = now;
    const drainSeconds=transferDuration(sim);
    while (sim.care.transfer?.phase === 'drain') { now += 1000 / 60; view.frame(now); }
    const drained = now;
    assert.ok(Math.abs((drained - start) / 1000 - drainSeconds) < .1);
    assert.ok(Math.abs(sim.volume - .72 * (1 - HARVEST_FRACTION)) < 1e-9);
    const pourSeconds=transferDuration(sim);
    while (sim.care.transfer) { now += 1000 / 60; view.frame(now); }
    assert.ok(Math.abs((now - drained) / 1000 - pourSeconds) < .1);
    assert.ok(Math.abs(sim.volume - .72) < 1e-9);
    let resumed;
    view.advance = days => { resumed = days; };
    for (let i = 0; i < 3; i++) { now += 1000 / 60; view.frame(now); }
    assert.ok(Math.abs(resumed - (1 / 30) * speed / 60) < 1e-9);
  }
});

test('real frame loop keeps cells moving and drives evolving currents during both exchange phases', () => {
  for (const phase of ['drain', 'pour']) {
    for (const speed of [1, 12, 60]) {
      const sim = new Simulation({ width: 16, height: 24 });
      sim.speed = speed; sim.settings.convection = 0;
      sim.vx.fill(0); sim.vy.fill(0);
      if (phase === 'pour') sim.drain(.72 * HARVEST_FRACTION);
      sim.care.transfer = { phase, total: .72 * HARVEST_FRACTION, remaining: .72 * HARVEST_FRACTION, recipe: { sugar: 80, temperature: 24 } };
      const before = new Map(sim.agents.map(a => [a.id, { x: a.x, y: a.y }]));
      const view = Object.assign(Object.create(SymbiosimVessel.prototype), {
        sim, draw() {}, updateReadings() {}
      });
      let now = 10000; view.frame(now);
      const expectedDay=exchangeSpeed(sim)/60;
      for (let i = 0; i < 60; i++) { now += 1000 / 60; view.frame(now); }
      const distances = sim.agents.filter(a => before.has(a.id)).map(a => Math.hypot(a.x - before.get(a.id).x, a.y - before.get(a.id).y));
      const mean = distances.reduce((a, b) => a + b, 0) / distances.length;
      assert.ok(mean > .025, `${phase} at speed ${speed}: cells must visibly move, measured ${mean}`);
      assert.equal(sim.care.transfer.phase, phase, 'Motion must occur during the exchange');
      assert.ok(Math.abs(sim.day - expectedDay) < .001, 'Movement must not accelerate biological aging or the transfer');
      if (phase === 'pour') {
        assert.ok(sim.velocity(.65, .45)[1] > .3, 'Downward jet must develop within the first second');
        const flow = sim.vx.slice();
        for (let i = 0; i < 60; i++) { now += 1000 / 60; view.frame(now); }
        assert.ok(flow.some((v, i) => Math.abs(v - sim.vx[i]) > .1), 'Pour must produce changing eddies');
      }
      sim.playing = false;
      const paused = structuredClone(sim.snapshot());
      for (let i = 0; i < 60; i++) { now += 1000 / 60; view.frame(now); }
      assert.deepEqual(sim.snapshot(), paused, 'Pause must freeze both clocks');
    }
  }
});

test('population chart caches unchanged readings and redraws on paused interventions or bounded-history appends', () => {
  const previousMedia = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: false });
  try {
    const view = new SymbiosimVessel();
    view.draw = () => {};
    view.palette = { fg: '#111', warm: '#a74', cool: '#487' };
    view.sim.playing = false;
    let redraws = 0;
    const baseChart = view.chart.bind(view);
    view.chart = (svg, kind, window) => {
      if (kind === 'culture') redraws++;
      return baseChart(svg, kind, window);
    };

    view.updateReadings();
    assert.equal(redraws, 1);
    const initialChart = view.$('#culture-chart').innerHTML;
    const initialCounts = view.$('#counts').innerHTML;

    view.updateReadings();
    assert.equal(redraws, 1, 'Unchanged readings must skip rebuilding the population chart');

    view.$('#starter-amount').value = '10';
    view.$('#starter-balance').value = '100';
    view.$('#starter').onclick();
    assert.equal(view.sim.day, 0);
    assert.equal(redraws, 2, 'Adding starter while paused must redraw the population chart');
    assert.notEqual(view.$('#counts').innerHTML, initialCounts);
    assert.notEqual(view.$('#culture-chart').innerHTML, initialChart);

    view.updateReadings();
    assert.equal(redraws, 2);

    while (view.sim.history.length < 240) view.sim.record();
    view.updateReadings();
    assert.equal(view.sim.history.length, 240);
    assert.equal(redraws, 3);
    const fullHistoryChart = view.$('#culture-chart').innerHTML;

    for (let i = 0; i < 25; i++) view.sim.addAgent('bacteria', .5, .1);
    view.sim.record();
    assert.equal(view.sim.history.length, 240, 'History remains at its bounded length limit');
    view.updateReadings();
    assert.equal(redraws, 4, 'Appending a sample at the history length limit must redraw the chart');
    assert.notEqual(view.$('#culture-chart').innerHTML, fullHistoryChart);
  } finally {
    globalThis.matchMedia = previousMedia;
  }
});

test('manual pellicle skimming remains enabled for thin material below the visual cutoff and disables when empty', () => {
  const previousMedia = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: false });
  try {
    const view = new SymbiosimVessel();
    view.draw = () => {};
    view.palette = { fg: '#111', warm: '#a74', cool: '#487' };

    view.sim.pellicle.fill(.01);
    view.sim.membrane.layers[0].fill(.01);
    view.sim.membrane.layers[1].fill(0);
    view.sim.membrane.layers[2].fill(0);
    assert.equal(pellicleStats(view.sim).area, 0, 'Thin pellicle is below the visual area cutoff');
    assert.ok(view.sim.coverage() >= .001);

    view.updateReadings();
    assert.equal(view.$('#skim').disabled, false, 'Thin pellicle must remain manually skimmable');

    view.$('#skim').onclick();
    assert.equal(view.sim.care.skims, 1);
    assert.ok(Math.abs(view.sim.coverage() - .002) < 1e-12);
    assert.equal(view.$('#skim').disabled, false);

    view.sim.pellicle.fill(0);
    for (const layer of view.sim.membrane.layers) layer.fill(0);
    view.updateReadings();
    assert.equal(view.$('#skim').disabled, true, 'Empty pellicle must disable the skim button');
  } finally {
    globalThis.matchMedia = previousMedia;
  }
});

test('all presets apply valid covers, keep simulation state finite, and reject invalid settings', () => {
  const sim = new Simulation();
  for (const name of Object.keys(REGIMES)) {
    const regime = sim.applyPreset(name);
    assert.ok(Object.hasOwn(PRESETS, sim.settings.cover), `Preset ${name} must use a valid cover`);
    assert.ok(Number.isFinite(sim.settings.permeability) && sim.settings.permeability > 0);
    assert.equal(sim.settings.room, regime.room);
    sim.step(.05);
    assert.doesNotThrow(() => validateSnapshot(sim.snapshot()));
    assert.ok(Number.isFinite(sim.headspace.oxygen) && Number.isFinite(sim.meanTemperature()));
  }
  assert.throws(() => sim.applySettings({ cover: 'cloth' }), RangeError);
  assert.throws(() => sim.applySettings({ cover: 'loose' }), RangeError);
  assert.throws(() => sim.applySettings({ room: NaN }), RangeError);
  assert.throws(() => sim.applyPreset('nonexistent'), RangeError);
});

test('active pour transfer reserves vessel capacity against starter additions and sugar chart adapts above 120 g/L', () => {
  const sim = new Simulation();
  sim.volume = .70;
  const scheduled = sim.startTransfer('pour', .20, { temperature: 26, sugar: 160 });
  assert.ok(Math.abs(scheduled - .20) < 1e-9);
  // Only .05 capacity remains unreserved (.95 - .70 - .20 = .05).
  const starterAdded = sim.addStarter(.25, .5);
  assert.ok(Math.abs(starterAdded - .05) < 1e-9, 'Starter must not consume capacity reserved by an active pour');
  while (sim.care.transfer) sim.stepCare(.04);
  assert.ok(Math.abs(sim.volume - .95) < 1e-9, 'Scheduled pour delivers its full promised amount');
  assert.ok( Math.abs(sim.care.added - .20) < 1e-9);

  // High-sugar refill exceeding 120 g/L adapts the chemistry chart scale instead of clipping.
  const simHigh = new Simulation();
  simHigh.drain(.6, false);
  simHigh.pour(.6, { temperature: 24, sugar: 160 }, false);
  assert.ok(simHigh.sugar() > 130);
  const series = chartSeries(simHigh.history, 'chemistry');
  const sugarAxis = series.find(([key]) => key === 'sugar');
  assert.ok(sugarAxis[2] >= 140 && sugarAxis[2] >= simHigh.sugar(), 'Sugar chart upper bound adapts above 120 g/L');
});

