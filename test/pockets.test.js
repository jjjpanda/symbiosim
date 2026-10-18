import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/engine.js';
import { canopyGap, collectPockets, edgeSeal } from '../src/sim/pockets.js';
import { stepPellicle } from '../src/sim/pellicle.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} differs from ${b}`);

test('bare water and invisible cellulose traces release surface bubbles instead of trapping a grid', () => {
  for (const density of [0, 1e-12, .005, .0349]) {
    const sim = new Simulation({ starterFilm: false }); sim.agents = [];
    sim.pellicle.fill(density);
    sim.gas.pockets.fill(.1);
    sim.stepGas(0, 0);
    assert.ok(sim.gas.pockets.every(amount => amount === 0));
    assert.equal(collectPockets(sim).count, 0);
    // A rising bubble pops at its actual position, without snapping to a cell.
    sim.gas.bursts = [];
    sim.vx.fill(0); sim.vy.fill(0); sim.vz.fill(0);
    sim.gas.bubbles = [{ id: 1, x: .43, y: .02, z: .57, size: 1 }];
    sim.stepGas(0, .02);
    assert.equal(sim.gas.bubbles.length, 0);
    assert.ok(sim.gas.pockets.every(amount => amount === 0));
    assert.equal(sim.gas.bursts.length, 1);
    near(sim.gas.bursts[0].x, .43); near(sim.gas.bursts[0].z, .57);
    sim.stepGas(0, .33);
    assert.equal(sim.gas.bursts.length, 0, 'The pop disappears on the motion clock');
  }
});

test('under-film gas joins across width and depth without changing its inventory or centroid', () => {
  const sim = new Simulation(); sim.pellicle.fill(.8);
  const i = sim.surfaceIndex(.5, .5);
  sim.gas.pockets[i] = .4; sim.gas.pockets[i + 1] = .6; sim.gas.pockets[i + sim.nx] = .3;
  const before = sim.snapshot(), cache = collectPockets(sim);
  assert.equal(cache.count, 1);
  const region = cache.regions[0];
  assert.equal(region.end - region.start, 3); near(region.amount, 1.3);
  near(region.x, (.4 * (i % sim.nx + .5) + .6 * (i % sim.nx + 1.5) + .3 * (i % sim.nx + .5)) / sim.nx / 1.3);
  near(region.z, (.4 * (Math.floor(i / sim.nx) + .5) + .6 * (Math.floor(i / sim.nx) + .5) + .3 * (Math.floor(i / sim.nx) + 1.5)) / sim.nz / 1.3);
  assert.deepEqual(sim.snapshot(), before, 'Collecting a render footprint must not move or create gas');
  const labels = cache.labels, cells = cache.cells;
  assert.equal(collectPockets(sim).labels, labels); assert.equal(collectPockets(sim).cells, cells);
});

test('dry film, diagonal contact, faint diffusion tails and row boundaries do not join pockets', () => {
  const sim = new Simulation(); sim.pellicle.fill(.8);
  const i = sim.surfaceIndex(.5, .5);
  for (const bridge of [0, .01, .119].map(amount => amount * 88 / sim.pellicle.length)) {
    sim.gas.pockets.fill(0);
    sim.gas.pockets[i] = sim.gas.pockets[i + 2] = .5; sim.gas.pockets[i + 1] = bridge;
    assert.equal(collectPockets(sim).count, 2);
  }
  sim.gas.pockets[i + 1] = .5; sim.pellicle[i + 1] = 0;
  assert.equal(collectPockets(sim).count, 2, 'Gas cannot join through absent cellulose');
  sim.gas.pockets.fill(0); sim.pellicle.fill(.8);
  sim.gas.pockets[i] = sim.gas.pockets[i + sim.nx + 1] = .5;
  assert.equal(collectPockets(sim).count, 2, 'A diagonal is not a connected gas channel');
  sim.gas.pockets.fill(0); sim.gas.pockets[sim.nx - 1] = sim.gas.pockets[sim.nx] = .5;
  assert.equal(collectPockets(sim).count, 2, 'Opposite walls must not wrap together');
});

test('a lifted blister stays beneath intact cellulose and discharges around an actual free edge', () => {
  const sim = new Simulation(); sim.agents = []; sim.pellicle.fill(.9);
  const i = sim.surfaceIndex(.5, .5), weak = i + 1;
  sim.pellicle[weak] = .4;
  sim.gas.pockets[i] = .9; sim.gas.pockets[weak] = .5;
  const fields = structuredClone(sim.fields);
  sim.stepGas(.001, 0);
  assert.equal(sim.gas.released, 0, 'Size alone must not vent an undeformed sheet');
  sim.membrane.displacement[weak] = -.05;
  sim.stepGas(.001, 0);
  assert.equal(sim.gas.released, 0, 'Even a strongly lifted weak patch cannot release through cellulose');
  near(sim.gas.pockets.reduce((a, b) => a + b), 1.4);
  sim.pellicle[weak + 1] = 0;
  const material = [...sim.pellicle];
  sim.stepGas(0, 0);
  assert.equal(sim.gas.pockets[i], 0); assert.equal(sim.gas.pockets[weak], 0);
  assert.equal(sim.gas.released, 1); assert.equal(sim.gas.bursts.length, 1);
  near(sim.gas.bursts[0].x, (weak % sim.nx + 1) / sim.nx);
  near(sim.gas.bursts[0].strength, 1.4);
  assert.deepEqual(sim.pellicle, material); assert.deepEqual(sim.fields, fields);
});

test('connected pockets remain deterministic through snapshot continuation', () => {
  const sim = new Simulation(); sim.pellicle.fill(.8);
  const i = sim.surfaceIndex(.5, .5);
  sim.gas.pockets[i] = sim.gas.pockets[i + 1] = .6;
  const restored = Simulation.restore(sim.snapshot());
  collectPockets(sim); // Render scratch state must not affect future physics.
  sim.step(.1); restored.step(.1);
  assert.deepEqual(sim.snapshot(), restored.snapshot());
});

test('a large bubble lifts the pellicle, reaches an open jar edge, burps there and lets the sheet settle', () => {
  const sim = new Simulation(); sim.agents = []; sim.pellicle.fill(.8);
  sim.membrane.layers[2].fill(.8); sim.surface.velocity.fill(0);
  sim.vx.fill(0); sim.vy.fill(0); sim.vz.fill(0);
  const center = sim.surfaceIndex(.5, .5);
  sim.gas.pockets[center] = 6;
  sim.stepGas(0, 0);
  near(sim.gas.pockets.reduce((a, b) => a + b), 6);
  assert.ok(sim.gas.pockets.every(v => v <= 1.4));
  assert.equal(sim.gas.released, 0, 'An arriving large bubble cannot disappear before the film moves');
  const material = [...sim.pellicle];
  let opening = false, burst;
  // Vent most of the load; a heavier wet sheet can settle onto residual gas.
  for (let i = 0; i < 500 && sim.gas.pockets.reduce((a, b) => a + b) >= 1.2; i++) {
    stepPellicle(sim, .003);
    const regions = collectPockets(sim);
    opening ||= regions.regions.slice(0, regions.count).some(r => r.edge >= 0);
    sim.stepGas(.003, .003);
    burst ||= sim.gas.bursts[0];
  }
  assert.ok(opening, 'A gas-connected edge must lift above its seal height before escape');
  assert.ok(sim.gas.released > 0);
  assert.ok(burst, 'A large release must produce a visible burst');
  assert.ok(burst.x === 0 || burst.x === 1 || burst.z === 0 || burst.z === 1, 'Release belongs at the jar perimeter');
  assert.ok(sim.gas.pockets.reduce((a, b) => a + b) < 1.2, 'Most of the connected blister discharges at the opening');
  const lift = Math.max(...sim.membrane.displacement.map((_, i) => canopyGap(sim, i)));
  for (let i = 0; i < 1500; i++) stepPellicle(sim, .003);
  assert.ok(Math.max(...sim.membrane.displacement.map((_, i) => canopyGap(sim, i))) < lift * .3);
  assert.deepEqual(sim.pellicle, material);
});

test('mature wall contact holds gas until the actual edge opening clears its stronger seal', () => {
  for (const layer of [0, 2]) {
    const sim = new Simulation(); sim.agents = []; sim.pellicle.fill(.8);
    sim.membrane.layers[layer].fill(.8);
    const edge = sim.surfaceIndex(0, .5);
    sim.gas.pockets[edge] = .6; sim.membrane.displacement[edge] = -.007;
    assert.equal(canopyGap(sim, edge) > edgeSeal(sim, edge), layer === 0);
    sim.stepGas(0, 0);
    assert.equal(sim.gas.released, layer === 0 ? 1 : 0);
    if (layer === 2) {
      sim.membrane.displacement[edge] = -.014; sim.stepGas(0, 0);
      assert.equal(sim.gas.released, 1); assert.equal(sim.gas.bursts[0].x, 0);
    }
  }
});

test('lifted gas channels move inventory faster without leaking through a closed wall', () => {
  const run = lifted => {
    const sim = new Simulation(); sim.agents = []; sim.pellicle.fill(.8);
    sim.membrane.layers[2].fill(.8);
    const center = sim.surfaceIndex(.5, .5); sim.gas.pockets[center] = .7;
    if (lifted) sim.membrane.displacement.fill(-.008);
    sim.stepGas(.01, .01);
    near(sim.gas.pockets.reduce((a, b) => a + b), .7);
    assert.ok(sim.gas.pockets.every(v => v >= 0)); assert.equal(sim.gas.released, 0);
    return sim.gas.pockets[center + 1];
  };
  assert.ok(run(true) > run(false) * 10);
});

test('excess load stays under an isolated patch until that patch lifts at its side', () => {
  const sim = new Simulation({ starterFilm: false }); sim.agents = [];
  const center = sim.surfaceIndex(.5, .5); sim.pellicle[center] = .8;
  sim.gas.pockets[center] = 2;
  sim.stepGas(0, 0);
  near(sim.gas.pockets[center], 2);
  assert.equal(sim.gas.released, 0, 'Storage pressure cannot invent a hole through the sheet');
  assert.ok(sim.gas.pockets.every((v, i) => i === center || v === 0));
  for (let i = 0; i < 100 && sim.gas.released === 0; i++) { stepPellicle(sim, .003); sim.stepGas(.003, .003); }
  assert.equal(sim.gas.released, 1);
  near(sim.gas.pockets[center], 0);
  near(sim.gas.bursts[0].strength, 2);
  const burst = sim.gas.bursts[0];
  near(burst.x, (center % sim.nx) / sim.nx);
  near(burst.z, (Math.floor(center / sim.nx) + .5) / sim.nz);
  near(sim.pellicle[center], .8);
});

test('visible and heavily loaded intact sheets never vent through their interior or the public release method', () => {
  for (const density of [.035, .05, .4, 1]) {
    const sim = new Simulation(); sim.agents = []; sim.pellicle.fill(density);
    const center = sim.surfaceIndex(.5, .5);
    sim.gas.pockets[center] = 5; sim.membrane.displacement[center] = -.06;
    const material = [...sim.pellicle];
    sim.stepGas(0, 0); sim.releaseGas(center);
    near(sim.gas.pockets.reduce((a, b) => a + b), 5);
    assert.equal(sim.gas.released, 0); assert.equal(sim.gas.bursts.length, 0);
    assert.deepEqual(sim.pellicle, material);
  }
});

test('a thin sheet bends farther under the same gas load without losing its cellulose', () => {
  const lift = density => {
    const sim = new Simulation({ width: 12, height: 16, depth: 5 }); sim.agents = [];
    sim.pellicle.fill(density); sim.membrane.layers[2].fill(density);
    const center = sim.surfaceIndex(.5, .5); sim.gas.pockets[center] = .6;
    for (let i = 0; i < 150; i++) stepPellicle(sim, .003);
    assert.ok(sim.pellicle.every(v => v === density)); near(sim.gas.pockets[center], .6);
    return canopyGap(sim, center);
  };
  assert.ok(lift(.04) > lift(.8) * 1.5);
});

test('subvisual gas escapes only beside an exposed and lifted edge, without wrapping rows or crossing dry gaps', () => {
  const sim = new Simulation(); sim.agents = []; sim.pellicle.fill(.04);
  const center = sim.surfaceIndex(.5, .5); sim.gas.pockets[center] = .05;
  sim.membrane.displacement[center] = -.02;
  sim.stepGas(0, 0); assert.equal(sim.gas.released, 0);
  sim.pellicle[center + sim.nx + 1] = 0;
  sim.stepGas(0, 0); assert.equal(sim.gas.released, 0, 'Diagonal open water is not an outlet');
  sim.pellicle[center + sim.nx] = 0;
  sim.membrane.displacement[center] = 0;
  sim.stepGas(0, 0); assert.equal(sim.gas.released, 0, 'The free edge must actually lift');
  sim.membrane.displacement[center] = -.002;
  sim.stepGas(0, 0); assert.equal(sim.gas.released, 1);
  near(sim.gas.bursts[0].z, (Math.floor(center / sim.nx) + 1) / sim.nz);
  near(sim.gas.pockets[center], 0);
});

test('overloaded closed pockets round-trip and legacy version 9 remains readable', () => {
  const sim = new Simulation(); sim.pellicle.fill(.8); stepPellicle(sim, 0);
  const center = sim.surfaceIndex(.5, .5);
  sim.gas.pockets.fill(1.4); sim.gas.pockets[center] = 20;
  sim.stepGas(0, 0);
  assert.equal(sim.gas.released, 0);
  near(sim.gas.pockets[center], 20);
  const data = sim.snapshot(), restored = Simulation.restore(data);
  assert.equal(data.version, 14); assert.deepEqual(restored.snapshot(), data);
  for (const invalid of [-1, NaN, Infinity, Number.MAX_VALUE]) {
    const bad = structuredClone(data); bad.gas.pockets[center] = invalid;
    assert.throws(() => Simulation.restore(bad), /gas tracers/);
  }
  const legacy = structuredClone(data); legacy.version = 9; legacy.gas.pockets.fill(.8);
  assert.deepEqual(Simulation.restore(legacy).gas.pockets, legacy.gas.pockets);
  sim.step(.02); restored.step(.02); assert.deepEqual(restored.snapshot(), sim.snapshot());
});

test('an inflating edge blister continues deterministically after snapshot restoration', () => {
  const sim = new Simulation(); sim.agents = []; sim.pellicle.fill(.8);
  sim.membrane.layers[2].fill(.8); sim.surface.velocity.fill(0);
  sim.vx.fill(0); sim.vy.fill(0); sim.vz.fill(0);
  sim.gas.pockets[sim.surfaceIndex(.5, .5)] = 6;
  sim.stepGas(0, 0);
  for (let i = 0; i < 20; i++) { sim.stepGas(.003, .003); stepPellicle(sim, .003); }
  assert.equal(sim.gas.released, 0);
  const restored = Simulation.restore(JSON.parse(JSON.stringify(sim.snapshot())));
  for (let i = 0; i < 200; i++) {
    sim.stepGas(.003, .003); stepPellicle(sim, .003);
    restored.stepGas(.003, .003); stepPellicle(restored, .003);
  }
  assert.ok(sim.gas.released > 0, 'The blister and trailing gas leave through their opened edges');
  assert.deepEqual(sim.snapshot(), restored.snapshot());
});
