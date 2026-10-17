import { performance } from 'node:perf_hooks';
import { Simulation } from '../src/engine.js';

function scratchBytes(sim) {
  const buffers = new Set(), visited = new Set();
  const visit = value => {
    if (!value || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);
    if (ArrayBuffer.isView(value)) { buffers.add(value.buffer); return; }
    for (const child of Object.values(value)) visit(child);
  };
  visit(sim);
  return [...buffers].reduce((sum, buffer) => sum + buffer.byteLength, 0);
}

for (const [label, width, height] of [['desktop', 22, 30], ['phone', 16, 24]]) {
  const sim = new Simulation({ width, height, depth: label === 'phone' ? 5 : 8 });
  const start = performance.now();
  for (let i = 0; i < 600; i++) sim.step(1 / 60);
  const elapsed = performance.now() - start;
  console.log(`${label}: ${elapsed.toFixed(0)} ms for 10 simulated days (${sim.agents.length} agents)`);
  sim.care.autoDrain = sim.care.teaMode = false;
  sim.care.transfer = null; sim.drain(.2); sim.pellicle.fill(.6);
  sim.startTransfer('pour', .15, { temperature: 85, sugar: 100 });
  const hotStart = performance.now();
  for (let frame = 0; frame < 120; frame++) sim.step(.001, .005);
  console.log(`${label}: ${(performance.now() - hotStart).toFixed(0)} ms for 120 hot-pour updates; ${(scratchBytes(sim) / 1024).toFixed(0)} KiB typed solver scratch`);
}
