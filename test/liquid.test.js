import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/engine.js';
import { advanceParticles } from '../src/render/particles.js';
import { stepSurface } from '../src/sim/surface.js';
import { stepPellicle } from '../src/sim/pellicle.js';

test('new cultures contain an explicit layered, free-edged mother and can still start without one', () => {
  const sim = new Simulation();
  assert.ok(sim.coverage() > .1 && sim.coverage() < .4);
  assert.ok(sim.pellicle[sim.surfaceIndex(.5, .5)] > .5);
  assert.equal(sim.pellicle[0], 0);
  for (let i = 0; i < sim.pellicle.length; i++) assert.ok(Math.abs(sim.pellicle[i] - sim.membrane.layers.reduce((a, layer) => a + layer[i], 0)) < 1e-12);
  assert.equal(new Simulation({ starterFilm: false }).coverage(), 0);
});

test('swirling changes three-dimensional momentum without creating chemical inventory or using biological randomness', () => {
  const sim = new Simulation(), before = sim.snapshot();
  sim.stir();
  assert.deepEqual(sim.fields, before.fields); assert.deepEqual(sim.temperature, before.temperature);
  assert.deepEqual(sim.pellicle, before.pellicle); assert.deepEqual(sim.agents, before.agents);
  assert.equal(sim.seed, before.seed); assert.equal(sim.day, before.day);
  assert.ok(sim.vx.some((v, i) => Math.abs(v - before.vx[i]) > .2));
  assert.ok(sim.vz.some((v, i) => Math.abs(v - before.vz[i]) > .2));
  sim.step(.1);
  assert.ok(sim.membrane.body.offsetX.some(d => Math.abs(d) > .0001));
});

test('rising bubbles transfer buoyant momentum into a wake with surrounding return flow', () => {
  const sim = new Simulation({ width: 16, height: 24, depth: 4, starterFilm: false });
  sim.agents = []; sim.vx.fill(0); sim.vy.fill(0); sim.vz.fill(0); sim.surface.displacement.fill(0);
  sim.settings.convection = 0;
  sim.gas.bubbles = [{ id: 1, x: .5, y: .5, z: .5, size: 1.5 }];
  const fields = structuredClone(sim.fields);
  for (let i = 0; i < 30; i++) sim.stepFluid(.005);
  assert.ok(sim.velocity(.5, .56, [0, 0, 0], .5)[1] < -.005);
  assert.ok(sim.vy.some(v => v > .001));
  for (const name of Object.keys(fields)) assert.ok(Math.abs(sim.total(name) - fields[name].reduce((a, b) => a + b, 0) / sim.n * sim.volume) < 1e-8);
});

test('a spatial upper current drives waves and the independent sheet even without an active pour', () => {
  const sim = new Simulation();
  sim.surface.displacement.fill(0); sim.surface.velocity.fill(0);
  sim.vx.fill(0); sim.vy.fill(0); sim.vz.fill(0);
  for (let z = 0; z < sim.nz; z++) for (let y = 0; y < 3; y++) for (let x = 8; x < 14; x++) sim.vy[(z * sim.ny + y) * sim.nx + x] = .6;
  for (let i = 0; i < 100; i++) { stepSurface(sim, .005); stepPellicle(sim, .005); }
  assert.ok(sim.surface.displacement[sim.surfaceIndex(.5, .5)] > .0001);
  assert.ok(sim.membrane.displacement[sim.surfaceIndex(.5, .5)] > .001);
  assert.ok(Math.abs(sim.surface.displacement.reduce((a, b) => a + b)) < 1e-10);
});
