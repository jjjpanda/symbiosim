import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/engine.js';
import { advanceParticles } from '../src/render/particles.js';
import { sampleVelocity, sampleVolume } from '../src/sim/spatial.js';

test('shared vector sampling agrees with scalar interpolation throughout the volume and at walls', () => {
  for (const depth of [1, 4]) {
    const sim = new Simulation({ width: 8, height: 12, depth });
    for (let i = 0; i < sim.n; i++) { sim.vx[i] = Math.sin(i); sim.vy[i] = Math.cos(i); sim.vz[i] = i / sim.n; }
    const out = [0, 0, 0];
    for (const x of [-.1, 0, .13, .5, .96, 1.1]) for (const y of [0, .37, 1]) for (const z of [0, .24, .8, 1]) {
      assert.equal(sampleVelocity(sim, x, y, z, out), out);
      for (const [axis, field] of [sim.vx, sim.vy, sim.vz].entries()) assert.equal(out[axis], sampleVolume(sim, field, x, y, z));
    }
  }
});

test('midpoint particles retain a circular flow without spiraling outward or consuming simulation randomness', () => {
  const view = { motion: true, sim: {
    nx: 22,
    random() { throw new Error('Visual tracers must not use the biological RNG'); },
    velocity(x, y, out) { out[0] = -(y - .5) * 5; out[1] = (x - .5) * 5; out[2] = 0; return out; }
  } };
  advanceParticles(view, 0);
  const positions = view.particles, previous = view.particlePrevious;
  for (let i = 0; i < positions.length; i += 3) { positions[i] = .6; positions[i + 1] = positions[i + 2] = .5; }
  for (let step = 0; step < 100; step++) advanceParticles(view, .01);
  assert.ok(Math.abs(Math.hypot(positions[0] - .5, positions[1] - .5) - .1) < .0001);
  assert.equal(view.particles, positions); assert.equal(view.particlePrevious, previous);
  view.motion = false; const frozen = positions.slice(); advanceParticles(view, 1);
  assert.deepEqual(positions, frozen);
});
