import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { parseSoakArgs } from './soak-options.js';
import { Simulation, FIELDS, POPULATION_CAPACITY, HARVEST_FRACTION } from '../src/engine.js';
import { exchangeSpeed } from '../src/sim/transfer-clock.js';

// Exercise the same fluid, chemistry and care steps as the live vessel.
const { days, playback } = parseSoakArgs(process.argv.slice(2));
// Mirror the browser's independent motion clock during exchanges. Retain the
// original headless stepping by default for reproducibility and comparison.
function advance(sim, days) {
  if (!playback) return sim.step(days);
  let remaining = days;
  while (remaining > 1e-10) {
    const exchanging = Boolean(sim.care.transfer);
    const dt = Math.min(remaining, exchanging ? .001 : .02);
    const motionScale = exchanging ? Math.max(12, sim.speed) / exchangeSpeed(sim) : 1;
    sim.step(dt, dt * motionScale);
    remaining -= dt;
  }
}
const results = [];
for (const [grid, width, height] of [['desktop', 22, 30], ['phone', 16, 24]]) {
  for (const seed of [1, 45, 81241]) {
    let sim = new Simulation({ seed, width, height, depth: grid === 'phone' ? 5 : 8 });
    const initialIds = new Set(sim.agents.map(a => a.id));
    const min = { yeast: Infinity, bacteria: Infinity, ph: Infinity, sugar: Infinity };
    const max = { yeast: 0, bacteria: 0, ph: 0, sugar: 0 };
    const start = performance.now();
    for (let day = 1; day <= days; day++) {
      advance(sim, 1);
      const readings = { ...sim.counts(), ph: sim.ph(), sugar: sim.sugar() };
      const context = `${grid}, seed ${seed}, day ${day}`;
      assert.ok(readings.yeast > 0 && readings.bacteria > 0, `Culture extinction: ${context}`);
      assert.ok(sim.agents.length <= POPULATION_CAPACITY, `Population bound: ${context}`);
      assert.ok(sim.volume >= .72 * (1 - HARVEST_FRACTION) - 1e-9 && sim.volume <= .72 + 1e-9, `Volume drift: ${context}`);
      if (!sim.care.transfer) assert.ok(Math.abs(sim.volume - .72) < 1e-9, `Incomplete exchange: ${context}`);
      assert.ok(readings.ph >= 3.1 && readings.ph <= 4.8, `Acid runaway: ${context}`);
      assert.ok(readings.sugar > 5 && readings.sugar < 100, `Resource runaway: ${context}`);
      for (const field of FIELDS) assert.ok(sim.fields[field].every(v => Number.isFinite(v) && v >= 0 && v < 1000), `Invalid ${field}: ${context}`);
      for (const key of ['vx', 'vy', 'vz', 'temperature', 'pellicle']) assert.ok(sim[key].every(Number.isFinite), `Invalid ${key}: ${context}`);
      assert.ok(sim.agents.every(a => Number.isFinite(a.z) && a.z >= 0 && a.z <= 1), `Organism depth: ${context}`);
      assert.ok(sim.temperature.every(t => t >= 10 && t <= 40), `Temperature runaway: ${context}`);
      assert.ok(sim.pellicle.every(v => v >= 0 && v <= 1), `Pellicle bound: ${context}`);
      for (const layer of sim.membrane.layers) assert.ok(layer.every(v => Number.isFinite(v) && v >= 0 && v <= 1), `Cellulose layer bound: ${context}`);
      assert.ok(sim.pellicle.every((v, i) => Math.abs(v - sim.membrane.layers[0][i] - sim.membrane.layers[1][i] - sim.membrane.layers[2][i]) < 1e-8), `Cellulose inventory: ${context}`);
      assert.ok(sim.membrane.displacement.every(v => Number.isFinite(v) && v >= -.6 && v <= sim.volume * .8 + 1e-9), `Membrane displacement: ${context}`);
      assert.ok(sim.membrane.velocity.every(v => Number.isFinite(v) && Math.abs(v) <= 2), `Membrane velocity: ${context}`);
      for (const [key, values] of Object.entries(sim.membrane.body)) if (Array.isArray(values)) assert.ok(values.every(v => Number.isFinite(v) && Math.abs(v) <= (key.startsWith('offset') ? .18 : .35)), `Floating body ${key}: ${context}`);
      assert.ok(Object.values(sim.membrane.body.pose).every(Number.isFinite), `Floating body pose: ${context}`);
      for (const [key, bound] of [['displacement', .025001], ['velocity', .600001]]) {
        assert.ok(sim.surface[key].every(v => Number.isFinite(v) && Math.abs(v) <= bound), `Surface ${key}: ${context}`);
        assert.ok(Math.abs(sim.surface[key].reduce((a, b) => a + b, 0)) < 1e-8, `Surface volume mode: ${context}`);
      }
      assert.ok(sim.gas.bubbles.length <= 80 && sim.gas.bursts.length <= 12, `Gas effect bound: ${context}`);
      assert.ok(sim.gas.pockets.every(v => Number.isFinite(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER), `Gas pocket bound: ${context}`);
      assert.ok(sim.gas.bubbles.every(b => Number.isFinite(b.x) && b.x >= 0 && b.x <= 1 && Number.isFinite(b.y) && b.y >= 0 && b.y <= 1), `Gas transport: ${context}`);
      assert.ok(sim.gas.bubbles.every(b => Number.isFinite(b.z) && b.z >= 0 && b.z <= 1), `Gas depth: ${context}`);
      assert.ok(sim.gas.bubbles.every(b => b.size >= .65 && b.size <= 2.4), `Bubble coalescence: ${context}`);
      for (const [key, value] of Object.entries(readings)) { min[key] = Math.min(min[key], value); max[key] = Math.max(max[key], value); }
      if (day === Math.floor(days / 2)) {
        const restored = Simulation.restore(JSON.parse(JSON.stringify(sim.snapshot())));
        advance(sim, .125); advance(restored, .125);
        assert.deepEqual(restored.snapshot(), sim.snapshot(), `Restore continuity: ${context}`);
        sim = restored;
      }
    }
    if (days >= 30) {
      assert.ok(sim.care.exchanges > 0, 'Automatic exchange must actually run');
      assert.ok(sim.agents.some(a => !initialIds.has(a.id)), 'Culture must produce descendants');
    }
    const result = { grid, seed, days, playback, min, max, final: sim.counts(), exchanges: sim.care.exchanges, seconds: +((performance.now() - start) / 1000).toFixed(1) };
    results.push(result);
    console.log(JSON.stringify(result));
  }
}
console.log(`PASS: ${results.length} headless runs, ${days} days each; no reseeding or starter additions.`);
