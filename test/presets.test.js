import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, REGIMES } from '../src/engine.js';
import { moldCoverage } from '../src/sim/mold.js';

test('all six presets preserve vessel state and change only environmental and care settings', () => {
  const sim = new Simulation({ width: 12, height: 16, depth: 3 });
  sim.playing = false;
  sim.startTransfer('pour', .1, { temperature: 50, sugar: 100 });
  sim.gas.pockets.fill(.1); sim.mold.coverage[15] = .002;
  for (const [name, regime] of Object.entries(REGIMES)) {
    const before = sim.snapshot(), playing = sim.playing;
    sim.applyPreset(name);
    const after = sim.snapshot();
    // Only declared settings and care options may change. Keep transfer
    // progress, counters, incubation, RNG, chemistry and history intact.
    before.settings = after.settings;
    Object.assign(before.care, regime.care);
    assert.deepEqual(after, before, name);
    assert.equal(sim.playing, playing);
    assert.doesNotThrow(() => Simulation.restore(after));
  }
});

test('vinegar conditions encourage biological acid production without instant acid or dilution', () => {
  const sim = new Simulation({ width: 12, height: 16, depth: 3 });
  const acid = sim.mean('acetic'), sugar = sim.sugar(), volume = sim.volume, ph = sim.ph();
  sim.applyPreset('vinegar');
  assert.equal(sim.mean('acetic'), acid); assert.equal(sim.ph(), ph);
  assert.equal(sim.sugar(), sugar); assert.equal(sim.care.autoDrain, false); assert.equal(sim.care.teaMode, false);
  sim.step(.5);
  assert.ok(sim.mean('acetic') > acid, 'The existing bacteria produce acid over time');
  assert.ok(sim.sugar() < sugar, 'The existing yeast consume substrate');
  assert.ok(sim.ph() < ph); assert.equal(sim.volume, volume);
  assert.equal(sim.care.transfer, undefined);
});

test('mold conditions preserve natural incubation, arrivals and the protective effect of acidity', () => {
  for (const acidic of [false, true]) {
    const sim = new Simulation({ width: 12, height: 16, depth: 3 });
    if (acidic) sim.fields.acetic.fill(2);
    const before = structuredClone(sim.mold), counts = sim.counts(), ph = sim.ph();
    sim.applyPreset('mold');
    assert.deepEqual(sim.mold, before); assert.deepEqual(sim.counts(), counts); assert.equal(sim.ph(), ph);
    assert.equal(sim.care.autoDrain, true); assert.equal(sim.care.teaMode, true); assert.equal(sim.care.autoSkim, true);
    assert.equal(sim.care.temperature, 22); assert.equal(sim.care.sugar, 80);
    assert.equal(sim.care.harvestPh, 4.5); assert.equal(sim.care.fraction, .9);
    sim.step(.25);
    assert.equal(moldCoverage(sim), 0, 'Selecting conditions cannot bypass incubation or seed a colony');
    assert.equal(sim.mold.hazard, 0);
    if (acidic) assert.equal(sim.mold.exposure, 0, 'Acidic culture remains protective under the mold preset');
    assert.doesNotThrow(() => Simulation.restore(sim.snapshot()));
  }
});

test('mold preset raises pH through real exchanges and supports natural spore arrival and takeover', () => {
  // A reproducible rare early arrival; neither the preset nor this test seeds
  // contamination, edits chemistry, or advances the mold in isolation.
  const sim = new Simulation({ seed: 1680, width: 12, height: 16, depth: 3 });
  const before = sim.snapshot(); sim.applyPreset('mold');
  assert.deepEqual(sim.fields, before.fields); assert.deepEqual(sim.mold, before.mold);
  assert.equal(sim.day, 0);
  for (let day = 0; day < 30 && !sim.mold.failed; day++) sim.step(1);
  assert.ok(sim.care.exchanges > 0);
  assert.ok(sim.ph() > 4.5, 'Normal harvest/refill raises pH by diluting acids');
  assert.ok(Math.abs(sim.meanTemperature() - 22) < .2);
  assert.ok(moldCoverage(sim) > .01, 'Unmodified solver reaches the takeover threshold');
  assert.equal(sim.mold.failed, true);
  assert.ok(sim.day > 3, 'Incubation and local growth take time');
  assert.doesNotThrow(() => Simulation.restore(sim.snapshot()));
});

test('harvest pH remains configurable and old care snapshots retain the original threshold', () => {
  const sim = new Simulation(), snapshot = sim.snapshot();
  assert.equal(sim.care.harvestPh, 3.52);
  delete snapshot.care.harvestPh;
  assert.equal(Simulation.restore(snapshot).care.harvestPh, 3.52);
  for (const value of [NaN, 2, 5, '4.5']) {
    const invalid = sim.snapshot(); invalid.care.harvestPh = value;
    assert.throws(() => Simulation.restore(invalid), /Invalid automatic care/);
  }
});

test('no preset bypasses a failed vessel restart', () => {
  const sim = new Simulation({ width: 8, height: 8, depth: 1 });
  sim.mold.failed = true; sim.playing = false;
  const failed = sim.snapshot();
  for (const name of Object.keys(REGIMES)) {
    assert.throws(() => sim.applyPreset(name), /Start a new vessel/);
    assert.deepEqual(sim.snapshot(), failed);
  }
});
