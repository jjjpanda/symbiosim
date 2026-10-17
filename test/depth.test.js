import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, FIELDS } from '../src/engine.js';
import { stepPellicle } from '../src/sim/pellicle.js';

const near = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) < tolerance, `${a} differs from ${b}`);

test('depth changes local chemistry and transports dissolved matter between volume layers', () => {
  const sim = new Simulation({ width: 12, height: 16, depth: 4 });
  sim.care.autoDrain = sim.care.teaMode = false;
  sim.settings.permeability = 0;
  const agent = sim.agents[0]; sim.agents = [agent];
  sim.vx.fill(0); sim.vy.fill(0); sim.vz.fill(0);
  agent.x = 6.5 / sim.nx; agent.y = 8.5 / sim.ny; agent.z = .125;
  for (const field of ['sucrose', 'glucose', 'fructose']) sim.fields[field].fill(0);
  sim.fields.glucose[sim.index(agent.x, agent.y, .875)] = 10;
  sim.stepChemistry(.001, 0);
  near(agent.metabolism.sugar, 0);
  agent.z = .875;
  sim.stepChemistry(.001, 0);
  assert.ok(agent.metabolism.sugar > 0, 'An organism must consume from its own depth, not a shared 2D field');
  sim.agents = [];
  const before = sim.total('glucose');
  const target = sim.index(.5, .5, .625);
  sim.startTransfer('pour', .1);
  for (let i = 0; i < 50; i++) sim.stepFluid(.002);
  near(sim.total('glucose'), before);
  assert.ok(sim.fields.glucose[target] > 0);
  assert.ok(sim.vz.some(v => Math.abs(v) > .01), 'The inlet must generate depth velocity');
});

test('three-dimensional face fluxes conserve every scalar and preserve uniform concentrations', () => {
  for (const depth of [1, 3, 6]) {
    const sim = new Simulation({ width: 8, height: 10, depth });
    sim.agents = [];
    sim.startTransfer('pour', .1);
    for (const field of FIELDS) sim.fields[field].fill(3);
    for (let i = 0; i < 20; i++) sim.stepFluid(.003);
    for (const field of FIELDS) for (const value of sim.fields[field]) near(value, 3);
    for (const field of FIELDS) sim.fields[field][sim.index(.5, .5, .25)] = 20;
    const inventory = FIELDS.map(f => sim.total(f));
    for (let i = 0; i < 50; i++) sim.stepFluid(.003);
    FIELDS.forEach((f, i) => { near(sim.total(f), inventory[i]); assert.ok(sim.fields[f].every(v => v >= 0 && Number.isFinite(v))); });
    near(sim.velocity(.5, .5, [], 0)[2], 0);
    near(sim.velocity(.5, .5, [], 1)[2], 0);
  }
});

test('cellulose and gas couple across both axes of the surface plane', () => {
  const sim = new Simulation({ width: 12, height: 16, depth: 5 });
  sim.vx.fill(0); sim.vy.fill(0); sim.vz.fill(0);
  sim.agents = []; sim.pellicle.fill(.8);
  for (let i = 0; i < 700; i++) stepPellicle(sim, .003);
  const rest = [...sim.membrane.displacement];
  const center = sim.surfaceIndex(.5, .5);
  sim.gas.pockets[center] = .7;
  for (let i = 0; i < 250; i++) stepPellicle(sim, .003);
  for (const neighbor of [center - 1, center + 1, center - sim.nx, center + sim.nx]) {
    assert.ok(sim.membrane.displacement[neighbor] < rest[neighbor] - .0005, `Pressure must bend neighbor ${neighbor} above its unloaded depth`);
  }
  for (let i = 0; i < 30; i++) sim.stepGas(.01, .01);
  near(sim.gas.pockets.reduce((a, b) => a + b), .7);
  assert.ok(sim.gas.pockets[center + sim.nx] > 0, 'Trapped gas must migrate through depth');
  const restored = Simulation.restore(JSON.parse(JSON.stringify(sim.snapshot())));
  sim.step(.02); restored.step(.02);
  assert.deepEqual(restored.snapshot(), sim.snapshot());
});

test('organisms and bubbles advect through depth and snapshot validation rejects corrupt depth state', () => {
  const sim = new Simulation();
  sim.agents = [sim.agents[0]];
  const agent = sim.agents[0]; agent.x = agent.y = agent.z = .5;
  sim.vx.fill(0); sim.vy.fill(0); sim.vz.fill(.7);
  sim.stepChemistry(.0001, .05);
  assert.ok(agent.z > .53);
  sim.gas.bubbles = [{ id: 1, x: .5, y: .7, z: .5, size: 1 }];
  sim.stepGas(.0001, .05);
  assert.ok(sim.gas.bubbles[0].z > .51);
  for (const mutate of [d => { d.nz = 0; }, d => { d.vz[0] = NaN; }, d => { d.agents[0].z = 2; }, d => { d.gas.bubbles[0].z = -1; }]) {
    const data = sim.snapshot(); mutate(data); assert.throws(() => Simulation.restore(data), /Invalid/);
  }
});
