import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/engine.js';
import { stepPellicle, pellicleStats } from '../src/sim/pellicle.js';
import { filmPoint, materialPoint, sampleFilm, worldFilm } from '../src/sim/film-body.js';
import { surfaceRest, vesselTilt } from '../src/sim/vessel.js';
import { stepSurface } from '../src/sim/surface.js';
import { sampleSurface } from '../src/sim/spatial.js';
import { defaultCamera, turnCamera, bindCamera } from '../src/render/camera.js';

const near = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) < tolerance, `${a} differs from ${b}`);
function sheet() {
  const sim = new Simulation({ width: 16, height: 16, depth: 4 });
  sim.agents = []; sim.pellicle.fill(.8); sim.vx.fill(0); sim.vy.fill(0); sim.vz.fill(0);
  sim.surface.displacement.fill(0); sim.surface.velocity.fill(0); stepPellicle(sim, 0);
  return sim;
}

test('dragging rotates, shift-dragging tips, and clicking never opens a zoom overlay', () => {
  let inspections = 0, captured;
  const controls = new Map();
  const view = { sim: sheet(), camera: defaultCamera(), updateCamera() {}, draw() {}, setLens() { inspections++; },
    $: id => { if (!controls.has(id)) controls.set(id, {}); return controls.get(id); },
    canvas: { focus() {}, setPointerCapture(id) { captured = id; }, hasPointerCapture: id => captured === id,
      releasePointerCapture() { captured = undefined; }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 500, height: 600 }) } };
  bindCamera(view);
  const down = shiftKey => view.canvas.onpointerdown({ button: 0, pointerId: 1, clientX: 50, clientY: 50, shiftKey });
  const move = () => view.canvas.onpointermove({ pointerId: 1, clientX: 150, clientY: 10 });
  const click = () => view.canvas.onclick?.({ clientX: 150, clientY: 10 });
  down(false); move(); view.canvas.onpointerup({ pointerId: 1, type: 'pointerup' }); click();
  near(view.camera.yaw, 45); assert.equal(inspections, 0);
  down(true); move(); view.canvas.onpointerup({ pointerId: 1, type: 'pointerup' }); click();
  near(view.sim.vessel.tilt, 8); near(view.camera.yaw, 45); assert.equal(inspections, 0);
  down(false); view.canvas.onpointercancel({ pointerId: 1, type: 'pointercancel' }); click(); assert.equal(inspections, 0);
  down(false); view.canvas.onpointerup({ pointerId: 1, type: 'pointerup' }); click(); assert.equal(inspections, 0);
  controls.get('#upright-jar').onclick(); near(view.sim.vessel.tilt, 0);
});

test('a floating sheet drifts with currents, retains momentum, and preserves each material layer', () => {
  const sim = sheet(), before = structuredClone(sim.membrane.layers), seed = sim.seed;
  sim.vx.fill(.5); sim.vz.fill(.25);
  for (let i = 0; i < 100; i++) stepPellicle(sim, .005);
  const center = sim.surfaceIndex(.5, .5), body = sim.membrane.body;
  assert.ok(body.offsetX[center] > .01 && body.offsetZ[center] > .005);
  assert.ok(body.velocityX[center] > .01);
  const oldX = body.offsetX[center]; sim.vx.fill(0); sim.vz.fill(0); stepPellicle(sim, .005);
  assert.ok(body.offsetX[center] > oldX, 'Stopping the liquid does not teleport or stop the sheet');
  assert.deepEqual(sim.membrane.layers, before); assert.equal(sim.seed, seed);
  const p = filmPoint(sim, .5, .5), inverse = materialPoint(sim, ...p);
  near(inverse[0], .5, 1e-5); near(inverse[1], .5, 1e-5);
});

test('moving cellulose changes the oxygen and gas contact footprint without moving its material inventory', () => {
  const sim = sheet(); sim.pellicle.fill(0);
  const i = sim.surfaceIndex(.4, .5); sim.pellicle[i] = .8; stepPellicle(sim, 0);
  sim.membrane.body.offsetX.fill(2 / sim.nx);
  const contact = worldFilm(sim);
  near(contact.density[i], 0); near(contact.density[i + 2], .8);
  near(sampleFilm(sim, sim.pellicle, (i % sim.nx + 2.5) / sim.nx, (Math.floor(i / sim.nx) + .5) / sim.nz), .8);
  near(sim.pellicle[i], .8); near(sim.pellicle[i + 2], 0);
});

test('sustained wall-directed flow cannot fold the material map or invalidate its inverse', () => {
  const sim = sheet(); sim.vx.fill(2); sim.vz.fill(1);
  const before = structuredClone(sim.membrane.layers);
  for (let i = 0; i < 1000; i++) stepPellicle(sim, .005);
  for (let z = .05; z < 1; z += .1) for (let x = .05; x < 1; x += .05) {
    const p = filmPoint(sim, x, z), inverse = materialPoint(sim, ...p);
    assert.ok(p.every(v => v >= 0 && v <= 1));
    near(inverse[0], x, 1e-6); near(inverse[1], z, 1e-6);
  }
  assert.deepEqual(sim.membrane.layers, before);
});

test('pouring raises the water around an independent sheet, which submerges then recovers under buoyancy without jumping into air or floating on drain', () => {
  const sim = sheet(), absolute = sim.membrane.displacement[0] - sim.volume;
  sim.pour(.15);
  near(sim.membrane.displacement[0] - sim.volume, absolute);
  assert.ok(sim.membrane.displacement[0] > .1);
  let minDisplacement = Infinity;
  for (let i = 0; i < 400; i++) {
    stepPellicle(sim, .005);
    minDisplacement = Math.min(minDisplacement, sim.membrane.displacement[0]);
  }
  assert.ok(minDisplacement > -.006, 'Rebounding sheet must never jump out of the liquid into midair');
  assert.ok(sim.membrane.displacement[0] > .005 && sim.membrane.displacement[0] < .1, "A wet sheet settles below the surface");
  assert.ok(Math.abs(sim.membrane.velocity[0]) < .002);
  sim.drain(.15);
  assert.ok(sim.membrane.displacement[0] >= 0 && sim.membrane.displacement[0] < .1, 'Draining lowers the sheet with the water surface rather than leaving it floating in midair');
});

test('a small tea jet dents the mother, rebounds after unloading, and retains its material inventory', () => {
  for (const depth of [1, 5, 8, 12]) {
    const sim = new Simulation({ depth });
    sim.vx.fill(0); sim.vy.fill(0); sim.vz.fill(0);
    for (let i = 0; i < 700; i++) stepPellicle(sim, .005);
    const rest = sampleFilm(sim, sim.membrane.displacement, .65, .38);
    const layers = structuredClone(sim.membrane.layers), seed = sim.seed;
    sim.startTransfer('pour', .08, { temperature: 70 });
    sim.care.transfer.remaining *= .75;
    let peak = 0;
    for (let i = 0; i < 80; i++) {
      stepPellicle(sim, .005);
      peak = Math.max(peak, sampleFilm(sim, sim.membrane.displacement, .65, .38) - rest);
    }
    assert.ok(peak > .04 && peak < .15, `Depth ${depth}: impact must make a bounded visible dent (${peak})`);
    sim.care.transfer = null;
    let rebound = 0;
    for (let i = 0; i < 350; i++) {
      stepPellicle(sim, .005);
      rebound = Math.min(rebound, sampleFilm(sim, sim.membrane.displacement, .65, .38) - rest);
    }
    assert.ok(rebound < -.005, 'Unloading must let the mother rise past its resting position');
    assert.ok(Math.abs(sampleFilm(sim, sim.membrane.displacement, .65, .38) - rest) < .001);
    assert.deepEqual(sim.membrane.layers, layers);
    assert.equal(sim.seed, seed);
  }
});

test('physical tilt drives bulk sloshing rather than changing only the image', () => {
  const sim = sheet(); sim.settings.convection = 0; sim.vessel.tilt = 12;
  const totals = Object.keys(sim.fields).map(name => sim.total(name));
  sim.stepFluid(.01);
  assert.ok(Math.max(...sim.vx.map(Math.abs)) > .01);
  for (const [i, name] of Object.keys(sim.fields).entries()) near(sim.total(name), totals[i]);
});

test('thicker, broader and cooler mothers sit deeper, while retained gas supports them', () => {
  const run = ({ temperature = 24, density = .8, small = false, gas = 0 } = {}) => {
    const sim = sheet();
    sim.temperature.fill(temperature);
    sim.pellicle.fill(density);
    if (small) for (let i = 0; i < sim.pellicle.length; i++) {
      const x = (i % sim.nx + .5) / sim.nx, z = (Math.floor(i / sim.nx) + .5) / sim.nz;
      if (Math.hypot(x - .5, z - .5) > .25) sim.pellicle[i] = 0;
    }
    sim.gas.pockets.fill(gas);
    const layers = structuredClone(sim.snapshot().membrane.layers);
    for (let i = 0; i < 700; i++) stepPellicle(sim, .005);
    assert.deepEqual(sim.membrane.layers, layers);
    near(sim.membrane.body.pose.x, 0, 1e-10);
    near(sim.membrane.body.pose.z, 0, 1e-10);
    return { sim, depth: sampleFilm(sim, sim.membrane.displacement, .5, .5) };
  };
  const ordinary = run();
  assert.ok(run({ temperature: 16 }).depth > ordinary.depth + .005);
  assert.ok(run({ density: .3 }).depth < ordinary.depth - .02);
  assert.ok(run({ small: true }).depth < ordinary.depth - .02);
  const lifted = run({ gas: .08 });
  assert.ok(lifted.depth < ordinary.depth - .04);
  lifted.sim.gas.pockets.fill(0);
  for (let i = 0; i < 700; i++) stepPellicle(lifted.sim, .005);
  near(sampleFilm(lifted.sim, lifted.sim.membrane.displacement, .5, .5), ordinary.depth, .001);
});

test('rising bubbles meet a submerged mother and bubbles already above it escape', () => {
  const sim = sheet(), column = sim.surfaceIndex(.5, .5);
  sim.membrane.displacement.fill(.12);
  sim.gas.bubbles = [{ id: 1, x: .5, y: .18, z: .5, size: 1 }];
  sim.stepGas(0, .02);
  assert.equal(sim.gas.bubbles.length, 0);
  assert.ok(sim.gas.pockets[column] > 0);
  sim.gas.pockets.fill(0);
  sim.gas.bubbles = [{ id: 2, x: .5, y: .05, z: .5, size: 1 }];
  sim.stepGas(0, .05);
  assert.equal(sim.gas.bubbles.length, 0);
  near(sim.gas.pockets.reduce((a, b) => a + b), 0);
  assert.ok(sim.gas.released > 0);
});

test('automatic skimming exports excess material once, leaves regrowth, respects its switch and migrates saves', () => {
  const sim = sheet();
  sim.pellicle.fill(.95);
  const fields = structuredClone(sim.fields), volume = sim.volume, agents = structuredClone(sim.agents);
  sim.stepCare(.001);
  assert.equal(sim.care.skims, 1);
  near(sim.care.skimmed, .76);
  assert.ok(sim.pellicle.every(density => Math.abs(density - .19) < 1e-9));
  for (let i = 0; i < 50; i++) sim.stepCare(.001);
  assert.equal(sim.care.skims, 1);
  assert.deepEqual(sim.fields, fields);
  assert.deepEqual(sim.agents, agents);
  near(sim.volume, volume);
  sim.care.autoSkim = false; sim.pellicle.fill(.95); sim.stepCare(.001);
  assert.equal(sim.care.skims, 1);
  const data = sim.snapshot(), restored = Simulation.restore(data);
  assert.equal(restored.care.autoSkim, false);
  restored.care.autoSkim = true; restored.stepCare(.001);
  assert.equal(restored.care.skims, 2);
  const legacy = structuredClone(data); legacy.version = 12;
  delete legacy.care.autoSkim; delete legacy.care.skims; delete legacy.care.skimmed;
  const migrated = Simulation.restore(legacy);
  assert.equal(migrated.care.autoSkim, true); assert.equal(migrated.care.skims, 0);
  for (const mutate of [c => { c.autoSkim = 'yes'; }, c => { c.skims = -1; }, c => { c.skimmed = NaN; }]) {
    const invalid = structuredClone(data); mutate(invalid.care);
    assert.throws(() => Simulation.restore(invalid), /pellicle care/);
  }
});

test('floating body and jar orientation round-trip, continue deterministically, and migrate older saves', () => {
  const sim = sheet(); sim.vessel.tilt = 9; sim.step(.05);
  const data = sim.snapshot(), restored = Simulation.restore(data);
  sim.step(.05); restored.step(.05); assert.deepEqual(restored.snapshot(), sim.snapshot());
  const legacy = structuredClone(data); legacy.version = 10; delete legacy.vessel; delete legacy.membrane.body;
  const migrated = Simulation.restore(legacy);
  near(migrated.vessel.tilt, 0); assert.ok(migrated.membrane.body.offsetX.every(v => v === 0));
  for (const mutate of [d => { d.membrane.body.offsetX[0] = Infinity; }, d => { d.vessel.tilt = 90; }]) {
    const corrupt = structuredClone(data); mutate(corrupt); assert.throws(() => Simulation.restore(corrupt));
  }
});

test('moved pellicle retains attached organisms at its current vessel footprint and reports zero depth on a tilted waterline', () => {
  const sim = new Simulation({ width: 16, height: 16, depth: 4 });
  sim.pellicle.fill(0);
  for (const layer of sim.membrane.layers) layer.fill(0);
  // Place a small material patch around material u=.35, v=.5
  for (let z = 1; z <= 2; z++) for (let x = 5; x <= 6; x++) {
    const i = z * sim.nx + x;
    sim.pellicle[i] = .8;
    sim.membrane.layers[2][i] = .8;
  }
  // Translate the pellicle body +0.22 in disc X so its vessel footprint moves to ~x=.66
  sim.membrane.body.pose.x = .22;
  const movedVessel = filmPoint(sim, 6 / 16, .5, [0, 0]);
  assert.ok(sampleFilm(sim, sim.pellicle, movedVessel[0], movedVessel[1]) > .5, 'Film density is present at moved vessel position');
  assert.equal(sampleFilm(sim, sim.pellicle, 6 / 16, .5), 0, 'Former material coordinates have zero film in vessel space');

  // Place one bacterium at the moved vessel footprint and one at the former position, then pour tea
  sim.agents = [
    { id: 1, type: 'bacteria', x: movedVessel[0], y: .05, z: movedVessel[1], age: 0, energy: 1, traits: { rate: 1, tolerance: 1 } },
    { id: 2, type: 'bacteria', x: 6 / 16, y: .05, z: .5, age: 0, energy: 1, traits: { rate: 1, tolerance: 1 } }
  ];
  sim.pour(.15, { temperature: 24, sugar: 80 }, true);
  assert.equal(sim.agents[0].y, .05, 'Bacterium under moved pellicle remains attached at y=.05 during refill');
  assert.ok(sim.agents[1].y > .15, 'Bacterium at former footprint is pushed down with bulk liquid');

  // Meniscus bound responds to gas beneath the moved material patch's vessel position, not its material index
  sim.surface.displacement.fill(0);
  sim.membrane.displacement.fill(-.05);
  sim.membrane.velocity.fill(0);
  const movedIdx = Math.floor(movedVessel[1] * sim.nz) * sim.nx + Math.floor(movedVessel[0] * sim.nx);
  const oldIdx = 2 * sim.nx + 6;
  sim.gas.pockets.fill(0);
  sim.gas.pockets[oldIdx] = 1.0;
  stepPellicle(sim, .001);
  assert.ok(sim.membrane.displacement[oldIdx] > -.01, 'Without gas at its moved vessel location, displacement is clamped near meniscus (0)');

  sim.membrane.displacement.fill(-.05);
  sim.membrane.velocity.fill(0);
  sim.gas.pockets.fill(0);
  sim.gas.pockets[movedIdx] = 1.0;
  // Also fill neighbor cells around movedVessel so bilinear sample sees gas
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const gx = Math.min(sim.nx - 1, Math.max(0, Math.floor(movedVessel[0] * sim.nx) + dx));
    const gz = Math.min(sim.nz - 1, Math.max(0, Math.floor(movedVessel[1] * sim.nz) + dz));
    sim.gas.pockets[gz * sim.nx + gx] = 1.0;
  }
  stepPellicle(sim, .001);
  assert.ok(sim.membrane.displacement[oldIdx] < -.04, 'Gas beneath the moved vessel position allows negative displacement');

  // Tilted waterline immersion depth & tiny-transfer continuity test
  sim.gas.pockets.fill(0);
  sim.membrane.body.pose.x = 0;
  sim.pellicle.fill(.8);
  sim.membrane.layers[2].fill(.8);
  sim.vessel.tilt = 10;
  for (let i = 0; i < sim.surface.displacement.length; i++) {
    const x = (i % sim.nx + .5) / sim.nx, z = (Math.floor(i / sim.nx) + .5) / sim.nz;
    sim.surface.displacement[i] = surfaceRest(sim, x, z);
  }
  for (let i = 0; i < sim.pellicle.length; i++) {
    const u = (i % sim.nx + .5) / sim.nx, v = (Math.floor(i / sim.nx) + .5) / sim.nz;
    const p = filmPoint(sim, u, v, [0, 0]);
    sim.membrane.displacement[i] = sampleSurface(sim, sim.surface.displacement, p[0], p[1]);
  }
  const stats = pellicleStats(sim);
  assert.ok(Math.abs(stats.depth) < .002, `Film resting on tilted waterline should report near-zero immersion depth, got ${stats.depth}`);

  const beforeDisp = Float64Array.from(sim.membrane.displacement);
  sim.drain(1e-9, true);
  for (let i = 0; i < beforeDisp.length; i++) {
    assert.ok(Math.abs(sim.membrane.displacement[i] - beforeDisp[i]) < 1e-6, 'Tiny drain must not jump tilted pellicle displacement');
  }
  sim.pour(1e-9, { temperature: 24, sugar: 80 }, true);
  for (let i = 0; i < beforeDisp.length; i++) {
    assert.ok(Math.abs(sim.membrane.displacement[i] - beforeDisp[i]) < 1e-6, 'Tiny pour must not jump tilted pellicle displacement');
  }
});

