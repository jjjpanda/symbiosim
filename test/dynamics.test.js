import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/engine.js';
import { depositCellulose, stepCellulose, stepPellicle } from '../src/sim/pellicle.js';
import { prepareTransport, transportScalar } from '../src/sim/transport.js';

const near = (a, b, epsilon = 1e-9) => assert.ok(Math.abs(a - b) < epsilon, `${a} differs from ${b}`);

test('limited transport retains a dye front while conserving inventory and positive concentrations', () => {
  // A closed rectangular conveyor has exactly cancelling divergence. Track a
  // pulse along its straight section against the previous donor-cell scheme.
  const nx = 32, ny = 8, nz = 1, sim = { nx, ny, nz };
  const faces = { fx: new Float64Array((nx + 1) * ny), fy: new Float64Array(nx * (ny + 1)), fz: new Float64Array(nx * ny * 2) };
  for (let x = 3; x <= 28; x++) { faces.fx[2 * (nx + 1) + x] = .5; faces.fx[5 * (nx + 1) + x] = -.5; }
  for (let y = 3; y <= 5; y++) { faces.fy[y * nx + 28] = 2; faces.fy[y * nx + 2] = -2; }
  const field = Array(nx * ny).fill(0), scratch = new Float64Array(field.length);
  for (let x = 5; x < 10; x++) field[2 * nx + x] = 1;
  let donor = [...field];
  const dt = .005;
  const transport = prepareTransport(sim, faces, dt);
  for (let step = 0; step < 60; step++) {
    const next = [...donor];
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const i = y * nx + x;
      const transfer = (j, speed) => { const flux = dt * (Math.max(speed, 0) * donor[i] + Math.min(speed, 0) * donor[j]); next[i] -= flux; next[j] += flux; };
      if (x + 1 < nx) transfer(i + 1, faces.fx[y * (nx + 1) + x + 1] * nx);
      if (y + 1 < ny) transfer(i + nx, faces.fy[(y + 1) * nx + x] * ny);
    }
    donor = next;
    transportScalar(field, scratch, transport, 0);
    near(field.reduce((a, b) => a + b), 5);
    assert.ok(field.every(v => Number.isFinite(v) && v >= -1e-12 && v <= 1 + 1e-12));
  }
  assert.ok(field.reduce((a, b) => a + b * b, 0) > donor.reduce((a, b) => a + b * b, 0) * 1.2, 'Resolved fronts must lose less variance than donor-cell advection');
});

test('sugar density sinks and thermal buoyancy rises in otherwise identical liquid', () => {
  const run = hot => {
    const sim = new Simulation({ width: 16, height: 24, depth: 3 });
    sim.agents = []; sim.vx.fill(0); sim.vy.fill(0); sim.vz.fill(0);
    for (let z = 0; z < sim.nz; z++) for (let y = 4; y < 15; y++) for (let x = 9; x < 12; x++) {
      const i = (z * sim.ny + y) * sim.nx + x;
      if (hot) sim.temperature[i] = 45;
      else sim.fields.sucrose[i] += 40;
    }
    for (let step = 0; step < 40; step++) sim.stepFluid(.002);
    return sim.velocity(.65, .4)[1];
  };
  assert.ok(run(false) > .001, 'A concentrated sugar plume must fall');
  assert.ok(run(true) < -.001, 'A warm plume must rise');
});

test('cellulose layers mature and spread while conserving material apart from explicit decay', () => {
  const sim = new Simulation({ width: 12, height: 16, depth: 3, starterFilm: false });
  const center = sim.surfaceIndex(.5, .5);
  depositCellulose(sim, center, .8);
  near(sim.membrane.layers[0][center], .8);
  for (let step = 0; step < 200; step++) stepCellulose(sim, .01, 4);
  near(sim.pellicle.reduce((a, b) => a + b), .8 * Math.exp(-2 * .0001));
  assert.ok(sim.membrane.layers[2].some(v => v > 0));
  assert.ok(sim.pellicle[center + sim.nx] > 0);
  for (let i = 0; i < sim.pellicle.length; i++) near(sim.pellicle[i], sim.membrane.layers.reduce((sum, layer) => sum + layer[i], 0));
  const restored = Simulation.restore(JSON.parse(JSON.stringify(sim.snapshot())));
  sim.step(.02); restored.step(.02); assert.deepEqual(restored.snapshot(), sim.snapshot());
  const corrupt = sim.snapshot(); corrupt.membrane.layers[0][0] += .1;
  assert.throws(() => Simulation.restore(corrupt), /cellulose layers/);
});

test('older cellulose spreads the same pressure load over a broader area', () => {
  const spread = layer => {
    const run = gas => {
      const sim = new Simulation({ width: 12, height: 16, depth: 7 });
      sim.pellicle.fill(.8); sim.membrane.layers.forEach(values => values.fill(0));
      sim.membrane.layers[layer].fill(.8);
      sim.vx.fill(0); sim.vy.fill(0); sim.vz.fill(0);
      const center = sim.surfaceIndex(.5, .5); sim.gas.pockets[center] = gas;
      for (let step = 0; step < 200; step++) stepPellicle(sim, .003);
      return [sim.membrane.displacement[center], sim.membrane.displacement[center + 2]];
    };
    const baseline = run(0), loaded = run(.8);
    return (baseline[1] - loaded[1]) / (baseline[0] - loaded[0]);
  };
  assert.ok(spread(2) > spread(0) + .05);
});

test('merging bubbles preserve sampled gas inventory and small bubbles entrain in a downward jet', () => {
  const sim = new Simulation(); sim.agents = []; sim.vx.fill(0); sim.vy.fill(0); sim.vz.fill(0);
  sim.gas.bubbles = [{ id: 1, x: .5, y: .5, z: .5, size: 1 }, { id: 2, x: .501, y: .501, z: .501, size: 1 }];
  sim.stepGas(.001, .001);
  assert.equal(sim.gas.bubbles.length, 1); near(sim.gas.bubbles[0].size ** 3, 2);
  sim.vy.fill(2);
  sim.gas.bubbles = [{ id: 3, x: .3, y: .5, z: .5, size: .65 }, { id: 4, x: .7, y: .5, z: .5, size: 1.8 }];
  sim.stepGas(.01, .01);
  assert.ok(sim.gas.bubbles[0].y > .5); assert.ok(sim.gas.bubbles[1].y < .5);
  const snapshot = sim.snapshot();
  assert.equal(Simulation.restore(snapshot).gas.bubbles[1].size, 1.8);
});
