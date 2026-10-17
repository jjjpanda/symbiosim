import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, FIELDS } from '../src/engine.js';
import { stepPellicle } from '../src/sim/pellicle.js';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} differs from ${expected}`);

test('a hot refill conserves every dissolved species and thermal inventory while retaining a mixing front', () => {
  for (const [width, height] of [[16, 24], [22, 30], [8, 8]]) {
    const sim = new Simulation({ width, height });
    for (const name of FIELDS) for (let i = 0; i < sim.n; i++) sim.fields[name][i] += i / sim.n;
    const before = Object.fromEntries(FIELDS.map(name => [name, sim.total(name)]));
    const heat = sim.meanTemperature() * sim.volume;
    const recipe = { sucrose: 85, glucose: 7.5, fructose: 7.5, oxygen: .4 };
    sim.pour(.15, { temperature: 85, sugar: 100 });
    for (const name of FIELDS) near(sim.total(name), before[name] + .15 * (recipe[name] || 0));
    near(sim.meanTemperature() * sim.volume, heat + .15 * 85);
    assert.ok(sim.temperature[sim.index(.65, .02)] > sim.temperature[sim.index(.65, .9)] + 30);
    near(sim.temperature.at(-1), 24);
    // Repeated tiny additions exercise partial-cell overlap and roundoff.
    sim.drain(.1);
    const mass = sim.total('sucrose');
    for (let i = 0; i < 100; i++) sim.pour(.0002, { temperature: 70, sugar: 100 }, true);
    near(sim.total('sucrose'), mass + .02 * 85);
    assert.ok(sim.temperature.every(t => Number.isFinite(t) && t >= 24 - 1e-8 && t <= 85 + 1e-8));
  }
});

test('a lower outlet removes the bottom chemistry instead of uniformly diluting the vessel', () => {
  const sim = new Simulation({ width: 16, height: 24 });
  sim.volume = .8;
  sim.fields.sucrose.fill(10);
  for (let z = 0; z < sim.nz; z++) for (let y = 18; y < 24; y++) for (let x = 0; x < 16; x++) sim.fields.sucrose[(z * 24 + y) * 16 + x] = 100;
  const before = sim.total('sucrose');
  near(sim.drain(.2), .2);
  near(before - sim.total('sucrose'), .2 * 100);
  near(sim.mean('sucrose'), 10);
});

test('a deep harvest does not collapse surviving organisms against the floor', () => {
  const sim = new Simulation();
  sim.agents.forEach((agent, index) => { agent.y = .02 + .95 * index / sim.agents.length; });
  sim.drain(.6);
  assert.ok(sim.agents.length > 20, 'Exercise a surviving culture');
  const atFloor = sim.agents.filter(agent => agent.y > .97).length;
  assert.ok(atFloor < sim.agents.length * .1, 'Statistical outlet removal must not force the remaining cells onto a boundary');
});

test('bacteria share one oxygen budget between ethanol and glucose oxidation', () => {
  const sim = new Simulation();
  sim.agents = [sim.agents.find(a => a.type === 'bacteria')];
  const agent = sim.agents[0];
  agent.x = agent.y = .5;
  sim.settings.permeability = 0;
  sim.temperature.fill(27); sim.vx.fill(0); sim.vy.fill(0);
  sim.fields.oxygen.fill(.00001);
  const oxygen = sim.total('oxygen');
  const ethanol = sim.total('ethanol'), glucose = sim.total('glucose');
  sim.stepChemistry(.02, 0);
  const used = (ethanol - sim.total('ethanol')) / 90 + (glucose - sim.total('glucose')) / 12;
  near(oxygen - sim.total('oxygen'), used);
  assert.ok(sim.fields.oxygen.every(value => value >= 0));
  assert.ok(used > 0);
});

test('cellulose requires glucose even when surface bacteria can oxidize ethanol', () => {
  const sim = new Simulation({ starterFilm: false });
  sim.agents = [sim.agents.find(a => a.type === 'bacteria')];
  sim.agents[0].x = .5; sim.agents[0].y = .05;
  sim.vx.fill(0); sim.vy.fill(0);
  sim.fields.glucose.fill(0);
  sim.stepChemistry(.01, 0);
  assert.equal(sim.coverage(), 0);
  assert.ok(sim.agents[0].metabolism.acid > 0);
  sim.fields.glucose.fill(5);
  const sugar = sim.total('glucose');
  sim.stepChemistry(.01, 0);
  assert.ok(sim.coverage() > 0);
  assert.ok(sim.total('glucose') < sugar);
});

test('a connected cellulose sheet transmits gas deformation and relaxes after its loaded patch is removed', () => {
  const sim = new Simulation();
  sim.vx.fill(0); sim.vy.fill(0); sim.vz.fill(0);
  sim.pellicle.fill(.8);
  for (let i = 0; i < 700; i++) stepPellicle(sim, .003);
  const rest = [...sim.membrane.displacement];
  const center = Math.floor(sim.nx / 2);
  sim.gas.pockets[center] = 1;
  for (let i = 0; i < 200; i++) stepPellicle(sim, .003);
  assert.ok(sim.membrane.displacement[center] < rest[center] - .005);
  assert.ok(sim.membrane.displacement[center - 1] < rest[center - 1] - .001);
  const lift = rest[center] - sim.membrane.displacement[center];
  sim.pellicle[center] = 0; sim.releaseGas(center);
  for (let i = 0; i < 1500; i++) stepPellicle(sim, .003);
  assert.ok(Math.abs(sim.membrane.displacement[center]) < lift * .01);
  const data = sim.snapshot();
  data.membrane.velocity[0] = Infinity;
  assert.throws(() => Simulation.restore(data), /cellulose membrane/);
});

test('gas spreads under connected cellulose without creating pocket inventory', () => {
  const sim = new Simulation();
  sim.agents = []; sim.pellicle.fill(.8);
  const center = Math.floor(sim.nx / 2);
  sim.gas.pockets[center] = .7;
  for (let i = 0; i < 30; i++) sim.stepGas(.01, .01);
  near(sim.gas.pockets.reduce((a, b) => a + b, 0), .7);
  assert.ok(sim.gas.pockets[center - 1] > 0);
  assert.ok(sim.gas.pockets[center] < .7);
  assert.equal(sim.gas.released, 0);
});

test('manual exchanges respect capacity, run with automatic care disabled, and retain snapshot continuity', () => {
  const sim = new Simulation();
  sim.care.autoDrain = sim.care.teaMode = false;
  assert.equal(sim.startTransfer('pour', .1, { temperature: 85 }), .1);
  assert.equal(sim.startTransfer('drain', .1), 0, 'Two exchanges cannot own the outlet/inlet together');
  sim.stepCare(.03);
  near(sim.volume, .745);
  const restored = Simulation.restore(sim.snapshot());
  sim.stepCare(.09); restored.stepCare(.09);
  near(sim.volume, .82);
  assert.equal(sim.care.transfer, null);
  assert.deepEqual(sim.snapshot(), restored.snapshot());
  for (const recipe of [{ temperature: NaN }, { temperature: 100 }, { sugar: -1 }]) assert.throws(() => sim.startTransfer('pour', .1, recipe), /Tea recipe/);
});
