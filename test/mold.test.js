import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/engine.js';
import { createMold, stepMold, moldCoverage, checkMold, MOLD_LIMIT } from '../src/sim/mold.js';
import { updateMold } from '../src/mold-ui.js';

function favorable(seed = 42) {
  const sim = new Simulation({ seed, width: 8, height: 8, depth: 2 });
  sim.pellicle.fill(.6);
  sim.fields.acetic.fill(0); sim.fields.gluconic.fill(0);
  sim.temperature.fill(26); sim.fields.oxygen.fill(.4);
  sim.membrane.displacement.fill(0); sim.surface.displacement.fill(0);
  return sim;
}
function runMold(sim, days) {
  for (let i = 0; i < Math.round(days / .01); i++) stepMold(sim, .01);
}

test('mold requires sustained local warmth, high pH, air, food and exposed pellicle', () => {
  for (const change of [
    sim => sim.fields.acetic.fill(2),
    sim => sim.temperature.fill(14),
    sim => sim.temperature.fill(35),
    sim => sim.fields.oxygen.fill(0),
    sim => sim.membrane.displacement.fill(.1),
    sim => sim.pellicle.fill(0),
    sim => { for (const name of ['sucrose', 'glucose', 'fructose']) sim.fields[name].fill(0); }
  ]) {
    const sim = favorable(); change(sim);
    sim.mold.arrival = .00001;
    runMold(sim, 10);
    assert.equal(moldCoverage(sim), 0);
    assert.equal(sim.mold.hazard, 0);
    assert.equal(sim.mold.exposure, 0);
  }
  const sim = favorable(); sim.mold.arrival = .00001;
  runMold(sim, 2.9);
  assert.equal(moldCoverage(sim), 0, 'A transient favorable episode cannot trigger arrival');
  sim.fields.acetic.fill(2); runMold(sim, 2);
  assert.equal(sim.mold.exposure, 0, 'Adverse conditions reset the incubation');
  sim.fields.acetic.fill(0); runMold(sim, 3.1);
  assert.ok(moldCoverage(sim) > 0, 'A spore arrival can establish after incubation');
});

test('spore arrival is stochastic in ideal conditions and uses its own randomness', () => {
  let arrivals = 0;
  for (let i = 0; i < 100; i++) {
    const sim = favorable(Math.imul(i + 1, 2654435761) >>> 0), seed = sim.seed;
    // Ten ideal days (7 post-incubation) give an ~83% arrival chance while leaving some vessels clean.
    runMold(sim, 10);
    if (sim.mold.coverage.some(value => value > 0)) arrivals++;
    assert.equal(sim.seed, seed);
  }
  assert.ok(arrivals > 75 && arrivals < 99, `${arrivals}/100 arrivals should occur across ten ideal days`);
});

test('colonies feed on surface oxygen, decay in acid or ethanol before takeover, and fail strictly above 100 ppm', () => {
  const sim = favorable();
  sim.mold.coverage[5] = .01;
  const o2Before = sim.total('oxygen');
  const agents = structuredClone(sim.agents), seed = sim.seed;
  runMold(sim, .5);
  assert.ok(sim.mold.coverage[5] > .01);
  assert.ok(sim.mold.coverage[4] > 0 && sim.mold.coverage[6] > 0);
  assert.ok(sim.total('oxygen') < o2Before, 'Growing surface mold consumes local dissolved oxygen');
  assert.deepEqual(sim.agents, agents); assert.equal(sim.seed, seed);
  const colony = [...sim.mold.coverage];
  sim.fields.acetic.fill(2.5);
  runMold(sim, 1);
  assert.ok(sim.mold.coverage[5] < colony[5], 'Strong acid (low pH) kills pre-takeover mold');
  sim.fields.acetic.fill(0); sim.fields.ethanol.fill(50);
  const beforeEthanol = sim.mold.coverage[5];
  runMold(sim, 1);
  assert.ok(sim.mold.coverage[5] < beforeEthanol, 'High ethanol kills pre-takeover mold');
  sim.fields.ethanol.fill(0); sim.fields.acetic.fill(1);
  sim.mold.coverage.fill(MOLD_LIMIT);
  stepMold(sim, .01);
  assert.equal(sim.mold.failed, false, 'Exactly 100 ppm is below the takeover trigger');
  sim.mold.coverage[5] += .001;
  stepMold(sim, .01);
  assert.equal(sim.mold.failed, true); assert.equal(sim.playing, false);
  const stopped = sim.snapshot(); sim.step(1);
  assert.deepEqual(sim.snapshot(), stopped, 'A failed vessel cannot continue through the solver');
  sim.skimPellicle();
  assert.equal(sim.mold.failed, true, 'Skimming does not clear the restart requirement');
  sim.pellicle.fill(0); sim.pellicle[5] = .6;
  assert.equal(moldCoverage(sim), sim.mold.coverage[5], 'Use pellicle area as the denominator');
});

test('mold state round-trips deterministically and old snapshots start without contamination', () => {
  const sim = favorable(); sim.mold.arrival = .00001;
  runMold(sim, 3.1);
  const snapshot = sim.snapshot(), restored = Simulation.restore(snapshot);
  assert.deepEqual(restored.mold, sim.mold);
  runMold(sim, .4); runMold(restored, .4);
  assert.deepEqual(restored.mold, sim.mold);
  assert.notDeepEqual(sim.mold, snapshot.mold, 'Restoration must own its mold state');
  const legacy = structuredClone(snapshot); legacy.version = 13; delete legacy.mold;
  const old = Simulation.restore(legacy);
  assert.deepEqual(old.mold, createMold(old.pellicle.length, old.seed));
  for (const mutate of [
    mold => { mold.coverage = []; }, mold => { mold.coverage[0] = NaN; },
    mold => { mold.exposure = 4; }, mold => { mold.arrival = 0; },
    mold => { mold.hazard = -1; }, mold => { mold.seed = .5; },
    mold => { mold.failed = 'yes'; }, mold => { mold.coverage.fill(.02); }
  ]) {
    const invalid = structuredClone(snapshot); mutate(invalid.mold);
    assert.throws(() => Simulation.restore(invalid), /Invalid mold/);
  }
});

test('takeover checks tolerate exactly 1% on large grids and account for skimming the pellicle area', () => {
  const sim = new Simulation(); sim.pellicle.fill(.6); sim.mold.coverage.fill(.01);
  assert.equal(checkMold(sim), false);
  assert.doesNotThrow(() => Simulation.restore(sim.snapshot()));
  sim.mold.coverage.fill(0); sim.pellicle.fill(.04);
  sim.pellicle[5] = .6; sim.mold.coverage[5] = .1;
  assert.ok(moldCoverage(sim) < MOLD_LIMIT);
  sim.skimPellicle();
  assert.equal(sim.mold.failed, true, 'Removing clean fringe can raise the contaminated fraction above 1%');
  const stopped = sim.snapshot(); sim.stepCare(.5);
  assert.deepEqual(sim.snapshot(), stopped);
  assert.doesNotThrow(() => Simulation.restore(stopped));
});

test('mold takeover opens the restart modal once per vessel and permits paused inspection', () => {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { open: false, calls: 0,
      showModal() { this.open = true; this.calls++; }, close() { this.open = false; }, setAttribute() {} });
    return nodes.get(id);
  };
  const view = { sim: favorable(), $: node, pending: 1, swirlHold: {} };
  updateMold(view); assert.equal(node('#mold-dialog').calls, 0);
  assert.equal(node('#mold-status').hidden, true);
  view.sim.mold.failed = true; node('#panel').open = true;
  updateMold(view);
  assert.equal(node('#mold-dialog').calls, 1); assert.equal(node('#panel').open, false);
  assert.equal(view.sim.playing, false); assert.equal(view.pending, 0); assert.equal(view.swirlHold, null);
  node('#mold-dialog').close(); updateMold(view);
  assert.equal(node('#mold-dialog').calls, 1, 'Inspection must not immediately reopen the modal');
  view.sim = favorable(123); view.sim.mold.failed = true; updateMold(view);
  assert.equal(node('#mold-dialog').calls, 2, 'A later vessel has its own notice');
});
