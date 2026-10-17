import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, FIELDS } from '../src/engine.js';
import { projectPressure } from '../src/sim/pressure.js';
import { confineVolumeVorticity } from '../src/sim/vorticity.js';
import { celluloseStiffness, stepPellicle } from '../src/sim/pellicle.js';

const near = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) < tolerance, `${a} differs from ${b}`);

test('full-volume pressure removes divergence and gradient forces without opening a wall', () => {
  for (const [nx, ny, nz] of [[8, 12, 1], [16, 24, 3], [22, 30, 4], [64, 8, 12]]) {
    const sim = { nx, ny, nz, n: nx * ny * nz }, plane = nx * ny;
    const faces = { fx: new Float64Array((nx + 1) * ny * nz), fy: new Float64Array(nx * (ny + 1) * nz), fz: new Float64Array(nx * ny * (nz + 1)) };
    const potential = Float64Array.from({ length: sim.n }, (_, i) => Math.sin(i * .73));
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const i = (z * ny + y) * nx + x;
      if (x + 1 < nx) faces.fx[(z * ny + y) * (nx + 1) + x + 1] = (potential[i + 1] - potential[i]) * nx;
      if (y + 1 < ny) faces.fy[(z * (ny + 1) + y + 1) * nx + x] = (potential[i + nx] - potential[i]) * ny;
      if (z + 1 < nz) faces.fz[i + plane] = (potential[i + plane] - potential[i]) * nz;
    }
    projectPressure(sim, faces);
    for (const f of Object.values(faces)) for (const v of f) near(v, 0, 1e-10);
    // Repeat with a rotational component, which pressure must preserve.
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      if (x) faces.fx[(z * ny + y) * (nx + 1) + x] = Math.sin(x * 1.7 + y * .3 + z);
      if (y) faces.fy[(z * (ny + 1) + y) * nx + x] = Math.cos(x + y * 1.3 + z * .4);
      if (z) faces.fz[(z * ny + y) * nx + x] = Math.sin(x + y * .7 + z);
    }
    const buffers = sim.pressureBuffers;
    projectPressure(sim, faces);
    assert.equal(sim.pressureBuffers, buffers);
    assert.ok(faces.fx.some(v => Math.abs(v) > .01));
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const i = (z * ny + y) * nx + x, a = (z * ny + y) * (nx + 1) + x, b = (z * (ny + 1) + y) * nx + x;
      near(nx * (faces.fx[a + 1] - faces.fx[a]) + ny * (faces.fy[b + nx] - faces.fy[b]) + nz * (faces.fz[i + plane] - faces.fz[i]), 0, 1e-10);
      if (!x) near(faces.fx[a], 0); if (x === nx - 1) near(faces.fx[a + 1], 0);
      if (!y) near(faces.fy[b], 0); if (y === ny - 1) near(faces.fy[b + nx], 0);
      if (!z) near(faces.fz[i], 0); if (z === nz - 1) near(faces.fz[i + plane], 0);
    }
  }
});

test('horizontal depth vortices retain momentum without manufacturing vertical circulation', () => {
  const sim = new Simulation({ width: 8, height: 8, depth: 8 });
  sim.settings.convection = 0; sim.vy.fill(0);
  for (let z = 0; z < 8; z++) for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const i = (z * 8 + y) * 8 + x, px = (x + .5) / 8, pz = (z + .5) / 8;
    sim.vx[i] = Math.sin(Math.PI * px) * Math.cos(Math.PI * pz);
    sim.vz[i] = -Math.cos(Math.PI * px) * Math.sin(Math.PI * pz);
  }
  const energy = () => sim.vx.reduce((sum, v, i) => sum + v * v + sim.vz[i] ** 2, 0);
  const before = energy();
  for (let i = 0; i < 20; i++) sim.stepFluid(.001);
  assert.ok(energy() > before * .9, 'Small time steps must not repeatedly blur cell momentum');
  assert.ok(sim.vy.every(v => Math.abs(v) < 1e-8));
  assert.ok(sim.velocity(.5, .5, [], .15)[0] > .5);
  assert.ok(sim.velocity(.5, .5, [], .85)[0] < -.5);
  const still = { nx: 8, ny: 8, nz: 8, n: 512 }, velocity = { vx: new Float64Array(512), vy: new Float64Array(512), vz: new Float64Array(512) };
  confineVolumeVorticity(still, velocity, .01);
  assert.ok(Object.values(velocity).every(f => f.every(v => v === 0)));
});

test('small hot additions form a bounded local depth plume and conserve every inventory', () => {
  for (const [width, height, depth] of [[8, 8, 1], [16, 24, 3], [22, 30, 4]]) {
    const sim = new Simulation({ width, height, depth });
    const mass = FIELDS.map(name => sim.total(name)), heat = sim.meanTemperature() * sim.volume;
    sim.pour(.003, { temperature: 95, sugar: 160 }, true);
    const concentrations = { sucrose: 136, glucose: 12, fructose: 12, oxygen: .4 };
    FIELDS.forEach((name, i) => near(sim.total(name), mass[i] + .003 * (concentrations[name] || 0)));
    near(sim.meanTemperature() * sim.volume, heat + .003 * 95);
    const inlet = sim.temperature[sim.index(.65, .08, .38)], remote = sim.temperature[sim.index(.08, .08, .9)];
    assert.ok(inlet > remote + .05, 'Heat must enter beneath the inlet rather than uniformly along the surface');
    assert.ok(sim.temperature.every(v => v >= 24 - 1e-10 && v <= 95 + 1e-10));
    assert.ok(Object.values(sim.fields).every(f => f.every(v => v >= -1e-10)));
  }
});

test('hot tea softens local wet film and injures only the exposed organisms', () => {
  const sim = new Simulation({ width: 16, height: 24, depth: 3 });
  sim.vx.fill(0); sim.vy.fill(0); sim.vz.fill(0); sim.temperature.fill(27); sim.pellicle.fill(.8);
  const column = sim.surfaceIndex(.65, .38), volume = sim.index(.65, .02, .38);
  const coldStiffness = celluloseStiffness(sim, column);
  // Synchronize material before comparing stiffness.
  stepPellicle(sim, 0);
  const matureStiffness = celluloseStiffness(sim, column);
  assert.ok(matureStiffness > coldStiffness);
  sim.temperature[volume] = 85;
  assert.ok(celluloseStiffness(sim, column) < matureStiffness * .6);
  const exposed = sim.agents.slice(0, 100), protectedCells = sim.agents.slice(100, 200);
  for (const a of exposed) { a.x = .65; a.y = .02; a.z = .38; }
  for (const a of protectedCells) { a.x = .2; a.y = .8; a.z = .8; }
  sim.agents = [...exposed, ...protectedCells];
  const hotIds = new Set(exposed.map(a => a.id)), coldIds = new Set(protectedCells.map(a => a.id));
  sim.stepChemistry(.03, 0);
  assert.ok(sim.agents.filter(a => hotIds.has(a.id)).length < 10);
  assert.ok(sim.agents.filter(a => coldIds.has(a.id)).length > 90);
  assert.ok(sim.agents.filter(a => coldIds.has(a.id)).some(a => a.metabolism.co2 > 0));
});

test('surface motion feeds bulk circulation without spending scalar inventory', () => {
  const sim = new Simulation({ width: 12, height: 16, depth: 4 });
  sim.vx.fill(0); sim.vy.fill(0); sim.vz.fill(0); sim.settings.convection = 0;
  for (let z = 0; z < sim.nz; z++) for (let x = 0; x < sim.nx; x++) sim.surface.displacement[z * sim.nx + x] = .005 * Math.cos((x + .5) / sim.nx * Math.PI * 2);
  const before = sim.total('sucrose');
  sim.stepFluid(.01);
  near(sim.total('sucrose'), before);
  assert.ok(sim.vx.some(v => Math.abs(v) > .001));
});
