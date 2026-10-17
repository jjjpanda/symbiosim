import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, HARVEST_FRACTION, POPULATION_CAPACITY } from '../src/engine.js';

test('snapshots and restored vessels own independent state', () => {
  const original = new Simulation();
  original.step(.1);
  const snapshot = original.snapshot();
  const expected = structuredClone(snapshot);
  const restored = Simulation.restore(snapshot);
  original.step(.1); restored.step(.2);
  assert.deepEqual(snapshot, expected, 'Advancing either vessel must not mutate its source snapshot');
  snapshot.fields.sucrose[0] = 999;
  snapshot.agents[0].traits.rate = .55;
  assert.notEqual(restored.fields.sucrose[0], 999);
  assert.notEqual(original.fields.sucrose[0], 999);
});

test('invalid grids and malformed snapshot state are rejected before stepping', () => {
  for (const width of [0, 7, 65, 8.5, NaN]) assert.throws(() => new Simulation({ width }), /grid dimensions/);
  const mutations = [
    data => { data.agents[0].x = NaN; },
    data => { data.agents[0].traits = null; },
    data => { data.agents[1].id = data.agents[0].id; },
    data => { data.nextAgentId = 1; },
    data => { data.settings.room = Infinity; },
    data => { data.pellicle = []; },
    data => { data.history = []; },
    data => { data.day = -1; },
    data => { data.headspace.oxygen = -1; }
  ];
  for (const mutate of mutations) {
    const data = new Simulation().snapshot();
    mutate(data);
    assert.throws(() => Simulation.restore(data), /Invalid/);
  }
});

test('invalid tea recipes cannot poison the live chemistry', () => {
  const sim = new Simulation();
  const before = sim.snapshot();
  for (const recipe of [{ temperature: NaN }, { sugar: Infinity }, { sugar: -1 }]) {
    assert.throws(() => sim.pour(.1, recipe), /Tea recipe/);
    assert.deepEqual(sim.snapshot(), before);
  }
});

test('gas sampling follows yeast production without spending chemical mass or biological randomness', () => {
  const visible = new Simulation({ seed: 45 });
  visible.stepChemistry(.2, 0);
  const control = visible.snapshot();
  visible.stepGas(.2, .002);
  assert.ok(visible.gas.bubbles.length > 0);
  assert.deepEqual(visible.fields, control.fields);
  assert.deepEqual(visible.agents, control.agents);
  assert.equal(visible.seed, control.seed);
  const starved = new Simulation();
  for (const name of ['sucrose', 'glucose', 'fructose']) starved.fields[name].fill(0);
  starved.step(.1);
  assert.equal(starved.gas.bubbles.length, 0);
  assert.equal(starved.gas.released, 0);
});

test('bubbles collect beneath cellulose and skimming cannot release through the residual sheet', () => {
  const sim = new Simulation();
  sim.agents = []; sim.pellicle.fill(.9);
  const column = sim.surfaceIndex(.5, .5);
  const arrive = () => {
    sim.gas.bubbles.push({ id: 1, x: .5, y: .016, size: 1 });
    sim.stepGas(.01, .01);
    assert.equal(sim.gas.bubbles.length, 0);
  };
  arrive();
  assert.ok(sim.gas.pockets[column] > 0);
  assert.equal(sim.gas.released, 0);
  for (let i = 0; i < 5; i++) arrive();
  assert.equal(sim.gas.released, 0, 'Gas must lift the film before it can vent');
  sim.membrane.displacement[column] = -.05;
  sim.stepGas(0, 0);
  assert.ok(sim.gas.pockets[column] > 0);
  assert.equal(sim.gas.released, 0, 'Lifting the interior cannot create a hole');
  sim.skimPellicle();
  assert.ok(sim.gas.pockets[column] > 0);
  assert.equal(sim.gas.released, 0, 'Residual cellulose still holds the gas');
  near(sim.pellicle[column], .18);
  sim.pellicle[column + 1] = 0; sim.stepGas(0, 0);
  assert.equal(sim.gas.pockets[column], 0);
  assert.ok(sim.gas.released > 0, 'Gas can now reach an exposed side of the lifted sheet');
  sim.stepGas(.01, .4);
  assert.equal(sim.gas.bursts.length, 0, 'Ripples expire');
  const released = sim.gas.released;
  sim.pellicle.fill(0); sim.gas.pockets.fill(0); arrive();
  assert.equal(sim.gas.released, released + 1, 'Bare tea pops without accumulating a pocket');
});

test('gas effects remain bounded and round-trip while bubbles and pockets are active', () => {
  const sim = new Simulation();
  sim.pellicle.fill(1);
  sim.step(.5);
  const restored = Simulation.restore(JSON.parse(JSON.stringify(sim.snapshot())));
  sim.step(.1); restored.step(.1);
  assert.deepEqual(sim.snapshot(), restored.snapshot());
  for (let i = 0; i < 50; i++) sim.step(.1);
  assert.ok(sim.gas.bubbles.length <= 80 && sim.gas.bursts.length <= 12);
  assert.ok(sim.gas.pockets.every(v => Number.isFinite(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER));
  assert.ok(sim.gas.released > 0);
  const bad = JSON.parse(JSON.stringify(sim.snapshot()));
  bad.gas.pockets[0] = -1;
  assert.throws(() => Simulation.restore(bad), /gas tracers/);
});

const near = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≠ ${expected}`);

test('drain removes liquid and dissolved matter; pour mixes recipe without resetting the vessel', () => {
  const sim = new Simulation();
  const day = sim.day, before = sim.total('sucrose'), originalVolume = sim.volume;
  near(sim.drain(.2), .2);
  near(sim.total('sucrose'), before * sim.volume / originalVolume);
  const afterDrain = sim.total('sucrose');
  near(sim.pour(.1, { temperature: 34, sugar: 100 }), .1);
  near(sim.total('sucrose'), afterDrain + 8.5);
  near(sim.day, day);
  assert.ok(sim.meanTemperature() > 24);
  assert.ok(sim.surface.velocity.some(v => Math.abs(v) > 0));
});

test('fermentation runs in the intended direction and temperature creates circulation', () => {
  const sim = new Simulation();
  sim.care.autoDrain = sim.care.teaMode = false;
  const initialSugar = sim.sugar(), initialAcid = sim.mean('acetic');
  for (let i = 0; i < 20; i++) sim.step(.25);
  assert.ok(sim.sugar() < initialSugar - 2);
  assert.ok(sim.mean('ethanol') > .8);
  assert.ok(sim.mean('acetic') > initialAcid);
  assert.ok(sim.ph() < 4.45);
  assert.ok(sim.vy.some(v => Math.abs(v) > .15));
  assert.ok(sim.coverage() > 0);
});

test('seeded stepping and restored snapshots remain deterministic', () => {
  const one = new Simulation({ seed: 45, width: 12, height: 16 });
  const two = new Simulation({ seed: 45, width: 12, height: 16 });
  for (let i = 0; i < 8; i++) { one.step(.25); two.step(.25); }
  assert.deepEqual(one.snapshot(), two.snapshot());
  const restored = Simulation.restore(JSON.parse(JSON.stringify(one.snapshot())));
  assert.equal(restored.playing, false);
  one.step(.2);
  restored.step(.2);
  assert.deepEqual(restored.snapshot(), one.snapshot());
});

test('starter revives an extinct culture and a pour can break surface coverage', () => {
  const sim = new Simulation();
  sim.agents = [];
  const fill = sim.volume;
  sim.addStarter(.08, .5);
  assert.ok(sim.agents.some(a => a.type === 'yeast'));
  assert.ok(sim.agents.some(a => a.type === 'bacteria'));
  near(sim.volume, fill + .08);
  sim.pellicle.fill(.8);
  const before = sim.coverage();
  sim.pour(.15, { temperature: 20, sugar: 40 });
  assert.ok(sim.coverage() < before);
});

test('repeated starter additions and drains respect population capacity', () => {
  const sim = new Simulation({ seed: 45 });
  while (sim.agents.length < POPULATION_CAPACITY - 10) sim.addAgent('bacteria', .5, .05);
  sim.addStarter(.1, 0);
  assert.equal(sim.agents.length, POPULATION_CAPACITY, 'Starter additions saturate at the shared capacity');
  sim.drain(.1);
  for (let i = 0; i < 60; i++) {
    const before = sim.volume;
    near(sim.addStarter(.2, 0), .2);
    near(sim.volume, before + .2);
    assert.ok(sim.agents.length <= POPULATION_CAPACITY);
    sim.drain(.2);
  }
  sim.step(.01);
  assert.ok(sim.agents.length <= POPULATION_CAPACITY);
});

test('a sealed cover retains CO2 and reduces headspace oxygen', () => {
  const open = new Simulation({ seed: 12, width: 12, height: 16 });
  const sealed = new Simulation({ seed: 12, width: 12, height: 16 });
  open.settings.cover = 'open'; open.settings.permeability = 1;
  sealed.settings.cover = 'sealed'; sealed.settings.permeability = .005;
  for (let i = 0; i < 40; i++) { open.step(.25); sealed.step(.25); }
  assert.ok(sealed.headspace.oxygen < open.headspace.oxygen);
  assert.ok(sealed.headspace.co2 > open.headspace.co2);
});

test('organisms drift with the same vessel velocity on phone and desktop grids', () => {
  const positions = [];
  for (const [width, height] of [[16, 24], [22, 30]]) {
    const sim = new Simulation({ width, height });
    sim.agents = sim.agents.slice(0, 1);
    const agent = sim.agents[0];
    agent.x = agent.y = .5;
    sim.vx.fill(.4);
    sim.vy.fill(-.3);
    sim.seed = 123;
    const rx = sim.random(), ry = sim.random();
    sim.seed = 123;
    sim.stepChemistry(.02);
    near(agent.x, .508 + (rx - .5) * .028 * Math.sqrt(.02));
    near(agent.y, .494 + (ry - .5) * .028 * Math.sqrt(.02));
    positions.push([agent.x, agent.y]);
  }
  assert.deepEqual(positions[0], positions[1]);
});

test('a fresh vessel has visible drift even at one day per minute', () => {
  const sim = new Simulation();
  const positions = new Map(sim.agents.map(a => [a.id, [a.x, a.y]]));
  for (let i = 0; i < 125; i++) sim.step(.08 / 60);
  const distances = sim.agents.filter(a => positions.has(a.id)).map(a => {
    const [x, y] = positions.get(a.id);
    return Math.hypot((a.x - x) * 500, (a.y - y) * 300);
  });
  assert.ok(distances.filter(distance => distance > 5).length >= 5);
  near(sim.day, 10 / 60);
});

test('legacy snapshots retain their flow after velocity unit migration', () => {
  const sim = new Simulation({ depth: 1 });
  const legacy = JSON.parse(JSON.stringify(sim.snapshot()));
  legacy.version = 1;
  legacy.vx.fill(2);
  legacy.vy.fill(-1);
  const restored = Simulation.restore(legacy);
  near(restored.vx[0], 2 / sim.nx);
  near(restored.vy[0], -1 / sim.ny);
  assert.equal(restored.snapshot().version, 13);
  assert.equal(restored.playing, false);
  assert.deepEqual(restored.agents, legacy.agents);
});

test('flow transports dissolved matter without creating or losing it', () => {
  for (const [width, height] of [[16, 24], [22, 30]]) {
    const sim = new Simulation({ width, height });
    sim.agents = [];
    sim.fields.ethanol.fill(0);
    sim.fields.ethanol[sim.index(.5, .5)] = 100;
    sim.vx.fill(1);
    const before = sim.total('ethanol');
    for (let i = 0; i < 100; i++) { sim.stepFluid(.005); }
    near(sim.total('ethanol'), before);
    assert.ok(sim.fields.ethanol.every(value => value >= 0 && Number.isFinite(value)));
  }
});

test('default pace produces two days of visible culture change in ten seconds', () => {
  const sim = new Simulation({ seed: 1 });
  assert.equal(sim.speed, 12);
  const firstIds = new Set(sim.agents.map(a => a.id));
  for (let i = 0; i < 300; i++) sim.step(sim.speed / 60 / 30);
  near(sim.day, 2);
  assert.ok(sim.agents.some(a => !firstIds.has(a.id)));
  assert.ok(sim.sugar() < 87);
  assert.ok(sim.coverage() > .03);
});

test('older slow snapshots adopt the new default pace without losing the culture', () => {
  const legacy = JSON.parse(JSON.stringify(new Simulation({ depth: 1 }).snapshot()));
  legacy.version = 2;
  legacy.speed = 1;
  const restored = Simulation.restore(legacy);
  assert.equal(restored.speed, 12);
  assert.equal(restored.playing, false);
  assert.deepEqual(restored.agents, legacy.agents);
  assert.deepEqual(restored.fields, legacy.fields);
});

test('local acidity suppresses metabolism at the organism location', () => {
  const ethanolProduced = acid => {
    const sim = new Simulation({ seed: 10 });
    sim.agents = sim.agents.slice(0, 1);
    const agent = sim.agents[0];
    agent.x = (Math.floor(sim.nx / 2) + .5) / sim.nx;
    agent.y = (Math.floor(sim.ny / 2) + .5) / sim.ny;
    agent.traits = { rate: 1, tolerance: 1 };
    sim.temperature.fill(27);
    sim.vx.fill(0); sim.vy.fill(0);
    sim.fields.acetic[sim.index(.5, .5, agent.z)] = acid;
    const before = sim.total('ethanol');
    sim.stepChemistry(.01);
    return sim.total('ethanol') - before;
  };
  assert.ok(ethanolProduced(3) < ethanolProduced(.25) * .1);
});

test('automatic tea exchange preserves fill and accounts for dissolved mass', () => {
  const sim = new Simulation();
  sim.fields.acetic.fill(2);
  const before = sim.total('sucrose'), volume = sim.volume;
  sim.stepCare(.5);
  near(sim.volume, volume); // Only schedule the exchange at the check.
  sim.stepCare(.06);
  near(sim.volume, volume * (1 - HARVEST_FRACTION / 2));
  sim.stepCare(.06);
  near(sim.volume, volume * (1 - HARVEST_FRACTION));
  sim.stepCare(.06);
  near(sim.volume, volume * (1 - HARVEST_FRACTION / 2));
  sim.stepCare(.06);
  near(sim.volume, volume);
  near(sim.care.drained, volume * HARVEST_FRACTION);
  near(sim.care.added, sim.care.drained);
  near(sim.total('sucrose'), before * (1 - HARVEST_FRACTION) + volume * HARVEST_FRACTION * 80 * .85);
  assert.equal(sim.care.exchanges, 1);
});

test('auto drain and tea refill can each run independently or be disabled', () => {
  const sim = new Simulation();
  sim.care.autoDrain = sim.care.teaMode = false;
  sim.fields.acetic.fill(2);
  sim.stepCare(.5);
  near(sim.volume, .72);
  sim.care.autoDrain = true;
  sim.stepCare(.5);
  sim.stepCare(.12);
  near(sim.volume, .72 * (1 - HARVEST_FRACTION));
  sim.care.autoDrain = false;
  sim.care.teaMode = true;
  sim.stepCare(.5);
  sim.stepCare(.12);
  near(sim.volume, .72);
  assert.equal(sim.care.exchanges, 1);
});

test('automatic care never creates organisms or refills a healthy full vessel', () => {
  const sim = new Simulation();
  sim.agents = [];
  const before = sim.snapshot();
  sim.stepCare(.5);
  assert.deepEqual(sim.fields, before.fields);
  assert.equal(sim.care.exchanges, 0);
  sim.fields.acetic.fill(2);
  sim.stepCare(.5);
  assert.equal(sim.agents.length, 0);
  assert.equal(sim.care.exchanges, 1);
});

test('legacy saves receive automatic care defaults and invalid care is rejected', () => {
  const data = JSON.parse(JSON.stringify(new Simulation({ depth: 1 }).snapshot()));
  data.version = 3;
  delete data.care;
  const restored = Simulation.restore(data);
  assert.equal(restored.care.autoDrain, true);
  assert.equal(restored.care.teaMode, true);
  const invalid = JSON.parse(JSON.stringify(restored.snapshot()));
  invalid.care.interval = 0;
  assert.throws(() => Simulation.restore(invalid), /Invalid automatic care/);
});

test('both populations reproduce through a month of automatic care', () => {
  const sim = new Simulation({ seed: 45, width: 16, height: 24 });
  const original = new Set(sim.agents.map(a => a.id));
  for (let i = 0; i < 60; i++) {
    sim.step(.5);
    // Repeated harvests must retain both members of the culture.
    assert.ok(sim.counts().yeast > 0 && sim.counts().bacteria > 0);
  }
  for (const type of ['yeast', 'bacteria']) assert.ok(sim.agents.some(a => a.type === type && !original.has(a.id)));
  assert.ok(sim.care.exchanges > 0);
});

test('the same biomass consumes and produces the same total matter on each grid', () => {
  const results = [];
  for (const [width, height] of [[16, 24], [22, 30]]) {
    const sim = new Simulation({ seed: 45, width, height });
    sim.agents = [sim.agents.find(a => a.type === 'yeast'), sim.agents.find(a => a.type === 'bacteria')];
    sim.temperature.fill(27);
    sim.vx.fill(0); sim.vy.fill(0);
    for (const agent of sim.agents) { agent.x = .5; agent.y = .5; agent.traits = { rate: 1, tolerance: 1 }; }
    const sugar = sim.total('sucrose') + sim.total('glucose') + sim.total('fructose');
    const ethanol = sim.total('ethanol'), acid = sim.total('acetic');
    sim.stepChemistry(.01);
    results.push([sugar - sim.total('sucrose') - sim.total('glucose') - sim.total('fructose'), sim.total('ethanol') - ethanol, sim.total('acetic') - acid]);
  }
  results[0].forEach((value, i) => near(value, results[1][i]));
});

test('boundary flow conserves a uniform concentration and has no wall sinks', () => {
  const sim = new Simulation();
  sim.fields.ethanol.fill(3);
  sim.stepFluid(.003);
  for (let i = 0; i < sim.n; i++) near(sim.fields.ethanol[i], 3);
  for (const t of [.01, .25, .5, .75, .99]) {
    near(sim.velocity(0, t)[0], 0);
    near(sim.velocity(1, t)[0], 0, 1e-6);
    near(sim.velocity(t, 0)[1], 0);
    near(sim.velocity(t, 1)[1], 0, 1e-6);
  }
});

test('cells leave all four stagnant corners without sticking to a clamp', () => {
  const sim = new Simulation();
  // Isolate movement from random death/division during this short probe.
  const random = sim.random.bind(sim);
  sim.random = () => .01 + .98 * random();
  sim.agents = sim.agents.slice(0, 4);
  const corners = [[.015, .012], [.985, .012], [.015, .988], [.985, .988]];
  sim.vx.fill(0); sim.vy.fill(0);
  sim.agents.forEach((a, i) => { [a.x, a.y] = corners[i]; });
  const ids = sim.agents.map(a => a.id);
  for (let i = 0; i < 300; i++) sim.stepChemistry(.0001, .01);
  for (let i = 0; i < 4; i++) {
    const a = sim.agents.find(a => a.id === ids[i]);
    assert.ok(a && Math.hypot(a.x - corners[i][0], a.y - corners[i][1]) > .002);
    assert.ok(a.x > .015 && a.x < .985 && a.y > .012 && a.y < .988);
  }
});

test('visible metabolism accounts for the local products of an individual cell', () => {
  for (const type of ['yeast', 'bacteria']) {
    const sim = new Simulation();
    sim.agents = [sim.agents.find(a => a.type === type)];
    sim.agents[0].x = sim.agents[0].y = .5;
    const ethanol = sim.total('ethanol'), co2 = sim.total('co2'), acid = sim.total('acetic') + sim.total('gluconic');
    // Suppress gas ventilation to isolate this cell's actual reaction.
    sim.settings.permeability = 0;
    sim.stepChemistry(.01);
    const m = sim.agents[0].metabolism, mass = sim.volume / 1980 * .01;
    near(Math.abs(sim.total('ethanol') - ethanol), m.ethanol * mass);
    near(sim.total('co2') - co2, m.co2 * mass);
    near(sim.total('acetic') + sim.total('gluconic') - acid, m.acid * mass);
    assert.ok(m.turnover > 0);
  }
});

test('active gentle exchanges retain deterministic in-memory state and stop when their mode is disabled', () => {
  const sim = new Simulation();
  sim.fields.acetic.fill(2);
  sim.stepCare(.5); sim.stepCare(.04);
  const restored = Simulation.restore(JSON.parse(JSON.stringify(sim.snapshot())));
  sim.stepCare(.08); restored.stepCare(.08);
  sim.stepCare(.12); restored.stepCare(.12);
  assert.deepEqual(restored.snapshot(), sim.snapshot());
  near(sim.volume, .72);
  sim.stepCare(.5);
  sim.care.autoDrain = false;
  sim.stepCare(.01);
  assert.equal(sim.care.transfer, null);
  near(sim.volume, .72);
});

test('pellicle reduces oxygen transfer without sealing off the culture, and can be skimmed', () => {
  const run = film => {
    const sim = new Simulation();
    sim.agents = [];
    sim.pellicle.fill(film);
    sim.fields.oxygen.fill(0);
    sim.stepChemistry(.01);
    return sim;
  };
  const clear = run(0), covered = run(1);
  assert.ok(covered.mean('oxygen') > 0);
  near(covered.mean('oxygen') / clear.mean('oxygen'), .65, .0001);
  const volume = covered.volume, agents = covered.agents.length, coverage = covered.coverage();
  const fields = structuredClone(covered.fields);
  covered.skimPellicle();
  near(covered.coverage(), coverage * .2);
  near(covered.airAccess(), 1 - .35 * covered.coverage());
  near(covered.volume, volume);
  assert.equal(covered.agents.length, agents);
  assert.deepEqual(covered.fields, fields);
});

test('automatic inlet drives sustained circulation through projection with closed walls', () => {
  const sim = new Simulation();
  sim.settings.convection = 0;
  sim.vx.fill(0); sim.vy.fill(0);
  sim.fields.ethanol.fill(3);
  sim.care.transfer = { phase: 'pour', total: .6, remaining: .6, recipe: { temperature: 24, sugar: 80 } };
  for (let i = 0; i < 100; i++) { sim.stepFluid(.001); }
  assert.ok(sim.velocity(.65, .45)[1] > .3, 'Inlet must drive a downward jet');
  assert.ok(sim.vy.some(v => v < -.1), 'Jet must produce a return current');
  for (const t of [.1, .5, .9]) {
    near(sim.velocity(0, t)[0], 0); near(sim.velocity(1, t)[0], 0, 1e-6);
    near(sim.velocity(t, 0)[1], 0); near(sim.velocity(t, 1)[1], 0, 1e-6);
  }
  for (const value of sim.fields.ethanol) near(value, 3);
});

test('previous small-draw saves adopt batch harvest while preserving a pending exchange', () => {
  const sim = new Simulation({ depth: 1 });
  const data = JSON.parse(JSON.stringify(sim.snapshot()));
  data.version = 4; data.care.fraction = .18;
  data.care.transfer = { phase: 'pour', total: .12, remaining: .08, recipe: { temperature: 24, sugar: 80 } };
  const restored = Simulation.restore(data);
  near(restored.care.fraction, HARVEST_FRACTION);
  assert.deepEqual(restored.care.transfer, data.care.transfer);
});
