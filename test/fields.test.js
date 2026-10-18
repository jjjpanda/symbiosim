import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/engine.js';
import { CHEMICAL_FIELDS, fieldRange, fieldFraction, formatFieldValue } from '../src/fields.js';
import { temperatureRange, temperatureColor } from '../src/render/palette.js';

test('each chemical scale follows its measured range regardless of the concentration baseline', () => {
  const sim = new Simulation({ width: 8, height: 12, depth: 4 });
  for (const { id } of CHEMICAL_FIELDS) {
    for (const field of Object.values(sim.fields)) field.fill(0);
    const values = sim.fields[id === 'sugar' ? 'sucrose' : id === 'acidity' ? 'acetic' : id];
    for (const baseline of [.01, 10, 100]) {
      values.fill(baseline + 1); values[0] = baseline; values[sim.n - 1] = baseline + 2;
      const before = sim.snapshot(), range = fieldRange(sim, id);
      assert.equal(range.low, baseline);
      assert.equal(range.high, baseline + 2);
      assert.ok(Math.abs(fieldFraction(baseline + 1, range) - .5) < 1e-10);
      assert.equal(fieldFraction(baseline, range), 0);
      assert.equal(fieldFraction(baseline + 2, range), 1);
      assert.deepEqual(sim.snapshot(), before, 'Calculating the range must not alter state or RNG');
    }
  }
});

test('absent, uniform and nearly uniform fields have finite ranges without exaggerating noise', () => {
  const sim = new Simulation({ width: 8, height: 12, depth: 4 });
  sim.fields.ethanol.fill(0);
  const empty = fieldRange(sim, 'ethanol');
  assert.ok(empty.span > 0); assert.equal(fieldFraction(0, empty), 0);
  sim.fields.ethanol.fill(2);
  const uniform = fieldRange(sim, 'ethanol');
  assert.ok(Math.abs(fieldFraction(2, uniform) - .5) < 1e-10);
  sim.fields.ethanol[0] += 1e-12;
  const near = fieldRange(sim, 'ethanol');
  assert.ok(Math.abs(fieldFraction(sim.fields.ethanol[0], near) - .5) < 1e-6);
  assert.notEqual(formatFieldValue(near.low, near.span), formatFieldValue(near.high, near.span));
});

test('circulation scales solver speed and temperature follows actual deviation from room', () => {
  const sim = new Simulation({ width: 8, height: 12, depth: 4 });
  sim.vx.fill(.3); sim.vy.fill(.4); sim.vz.fill(0);
  assert.ok(Math.abs(fieldFraction(.5, fieldRange(sim, 'flow')) - .5) < 1e-10);
  sim.vx[0] = .6; sim.vy[0] = .8;
  const flow = fieldRange(sim, 'flow');
  assert.equal(flow.low, .5); assert.equal(flow.high, 1);
  sim.temperature.fill(24); sim.temperature[0] = 23.75; sim.temperature[1] = 24.25;
  assert.deepEqual(temperatureRange(sim), { low: 23.75, high: 24.25, centre: 24, extent: .25 });
  assert.deepEqual(fieldRange(sim, 'temperature'), { low: 23.75, high: 24.25, centre: 24, extent: .25, span: .5 });
  const cold = temperatureColor(-1);
  assert.ok(cold[2] > cold[1] && cold[1] > cold[0], 'Cold is blue rather than violet');
});
