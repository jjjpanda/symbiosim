import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/engine.js';
import { impulseSurface, stepSurface } from '../src/sim/surface.js';
import { stepPellicle } from '../src/sim/pellicle.js';

const near = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) < tolerance, `${a} differs from ${b}`);
const clear = sim => {
  sim.surface.velocity.fill(0); sim.surface.displacement.fill(0);
  sim.vx.fill(0); sim.vy.fill(0); sim.vz.fill(0);
};
const energy = sim => {
  const { nx, nz, surface: { displacement: d, velocity: v } } = sim;
  let sum = v.reduce((a, b) => a + b * b, 0);
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
    const i = z * nx + x;
    if (x + 1 < nx) sum += (1.8 * nx * (d[i + 1] - d[i])) ** 2;
    if (z + 1 < nz) sum += (1.8 * nz / .65 * (d[i + nx] - d[i])) ** 2;
  }
  return sum;
};

test('surface impulses spread in both axes, preserve volume, and decay without forcing', () => {
  for (const depth of [1, 4, 12]) {
    const sim = new Simulation({ width: depth === 12 ? 64 : 22, height: 8, depth, starterFilm: false });
    clear(sim);
    impulseSurface(sim, .5, .5, .15);
    const initial = energy(sim), far = sim.surfaceIndex(.8, .8);
    assert.equal(sim.surface.displacement[far], 0);
    for (let step = 0; step < 60; step++) stepSurface(sim, .01);
    assert.ok(Math.abs(sim.surface.displacement[far]) > 1e-7, 'An impulse must propagate beyond its source');
    assert.ok(energy(sim) < initial, 'Unforced waves must lose energy');
    for (let step = 0; step < 400; step++) stepSurface(sim, .01);
    assert.ok(energy(sim) < initial * .001);
    for (const values of Object.values(sim.surface)) {
      assert.ok(values.every(Number.isFinite)); near(values.reduce((a, b) => a + b), 0);
    }
    assert.ok(sim.surface.displacement.every(v => Math.abs(v) <= .025));
    assert.ok(sim.surface.velocity.every(v => Math.abs(v) <= .6));
    near(sim.volume, .72);
  }
});

test('mature cellulose damps waves and follows the liquid beneath the sheet', () => {
  const run = layer => {
    const sim = new Simulation({ starterFilm: false }); clear(sim);
    sim.pellicle.fill(.8); sim.membrane.layers[layer].fill(.8);
    impulseSurface(sim, .5, .5, .15);
    for (let i = 0; i < 30; i++) { stepSurface(sim, .005); stepPellicle(sim, .005); }
    assert.ok(sim.membrane.displacement.some(v => Math.abs(v) > 1e-5));
    return energy(sim);
  };
  assert.ok(run(2) < run(0) * .5);
});

test('pouring and gas venting excite the same surface without changing chemical inventory', () => {
  const sim = new Simulation({ starterFilm: false }); clear(sim);
  const fields = structuredClone(sim.fields);
  sim.startTransfer('pour', .15, { temperature: 85 });
  for (let i = 0; i < 25; i++) stepSurface(sim, .01);
  assert.ok(sim.surface.displacement[sim.surfaceIndex(.65, .38)] > .0001, 'Pour momentum must depress the impact patch');
  const before = [...sim.surface.velocity], column = sim.surfaceIndex(.3, .6);
  sim.gas.pockets[column] = 1;
  sim.releaseGas(column);
  assert.ok(sim.surface.velocity[column] < before[column], 'A release must lift the local surface');
  near(sim.surface.velocity.reduce((a, b) => a + b), 0);
  assert.deepEqual(sim.fields, fields);
});

test('surface snapshots are independent, continue deterministically, and migrate from version 8', () => {
  const sim = new Simulation(); sim.step(.08);
  const data = sim.snapshot(), expected = structuredClone(data);
  const restored = Simulation.restore(data);
  sim.step(.1); restored.step(.1);
  assert.deepEqual(restored.snapshot(), sim.snapshot()); assert.deepEqual(data, expected);
  for (const mutate of [d => { d.surface.velocity[0] = Infinity; }, d => { d.surface.displacement.pop(); }, d => { d.surface.displacement.fill(.01); }]) {
    const corrupt = sim.snapshot(); mutate(corrupt); assert.throws(() => Simulation.restore(corrupt), /liquid surface/);
  }
  data.version = 8; delete data.surface;
  const legacy = Simulation.restore(data);
  assert.ok(Object.values(legacy.surface).every(values => values.every(v => v === 0)));
  assert.deepEqual(legacy.fields, data.fields);
});

test('bubbles coalesce across grid boundaries and retain all candidates in a crowded bin', () => {
  const sim = new Simulation(); sim.agents = [];
  sim.vx.fill(0); sim.vy.fill(0); sim.vz.fill(0);
  for (const axis of ['x', 'y', 'z']) {
    sim.gas.bubbles = [
      { id: 1, x: .5, y: .5, z: .5, size: 1 },
      { id: 2, x: .5, y: .5, z: .5, size: 1 }
    ];
    sim.gas.bubbles[0][axis] -= .001; sim.gas.bubbles[1][axis] += .001;
    sim.stepGas(.001, 0);
    assert.equal(sim.gas.bubbles.length, 1, `Collision across ${axis} boundary`);
    near(sim.gas.bubbles[0].size ** 3, 2);
    near(sim.gas.bubbles[0][axis], .5);
  }
  sim.gas.bubbles = [
    { id: 1, x: .401, y: .5, z: .5, size: .65 },
    { id: 2, x: .499, y: .5, z: .5, size: .65 },
    { id: 3, x: .402, y: .5, z: .5, size: .65 }
  ];
  sim.stepGas(.001, 0);
  assert.equal(sim.gas.bubbles.length, 2, 'A later distant candidate must not hide an earlier colliding one');
  near(sim.gas.bubbles.reduce((a, b) => a + b.size ** 3, 0), 3 * .65 ** 3);
  // The first merge crosses the hash boundary; a third bubble must find its
  // moved center on the next collision, conserving the weighted centroid.
  sim.gas.bubbles = [
    { id: 1, x: .399, y: .5, z: .5, size: .65 },
    { id: 2, x: .41, y: .5, z: .5, size: .65 },
    { id: 3, x: .426, y: .5, z: .5, size: .65 }
  ];
  sim.stepGas(.001, 0);
  assert.equal(sim.gas.bubbles.length, 1);
  near(sim.gas.bubbles[0].x, (.399 + .41 + .426) / 3);
  near(sim.gas.bubbles[0].size ** 3, 3 * .65 ** 3);
});
