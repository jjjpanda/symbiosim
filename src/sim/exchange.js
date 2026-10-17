import { FIELDS, MIN_VOLUME, clamp } from './constants.js';
import { filmPoint, sampleFilm } from './film-body.js';
import { sampleSurface } from './spatial.js';

export const INLET = .65;
export const INLET_DEPTH = .38;
const LIQUID_FIELDS = [...FIELDS, 'temperature'];

// Finite-volume remapping of a moving liquid domain. Integrate overlaps rather
// than sampling: a thin incoming layer must retain all of its heat and solute.
function remap(source, nx, ny, nz, scale, offset, incoming, target) {
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) {
    const lo = y / ny, hi = (y + 1) / ny;
    for (let x = 0; x < nx; x++) {
      let value = incoming * Math.max(0, Math.min(hi, offset) - lo);
      const first = Math.max(0, Math.floor((lo - offset) / scale * ny));
      const last = Math.min(ny - 1, Math.floor((hi - offset) / scale * ny));
      for (let row = first; row <= last; row++) {
        const overlap = Math.max(0, Math.min(hi, offset + (row + 1) / ny * scale) - Math.max(lo, offset + row / ny * scale));
        value += source[(z * ny + row) * nx + x] * overlap;
      }
      target[(z * ny + y) * nx + x] = value * ny;
    }
  }
}

// Move incoming parcels from the spreading surface layer into a local inlet
// plume, exchanging equal volumes of resident tea back toward the surface.
// Each pair is applied to all species and heat. Disjoint source/donor rows
// and a bounded donor budget keep this conservative and positivity preserving.
function inletPlan(sim, offset) {
  const { nx, ny, nz, n } = sim;
  const b = sim.inletBuffers ||= {
    // Every pair exhausts a source or donor; their disjoint rows total <= n.
    from: new Uint16Array(n), to: new Uint16Array(n), fraction: new Float64Array(n),
    donors: new Uint16Array(n), available: new Float64Array(n), count: 0
  };
  let donors = 0;
  const first = Math.ceil(offset * ny);
  for (let y = first; y < ny; y++) for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
    const dx = ((x + .5) / nx - INLET) / .13, dz = nz > 1 ? ((z + .5) / nz - INLET_DEPTH) / .24 : 0;
    const py = (y + .5) / ny - offset;
    const weight = .85 * Math.exp(-dx * dx - dz * dz - py * 9);
    if (weight < .0001) continue;
    b.donors[donors] = (z * ny + y) * nx + x;
    b.available[donors++] = weight;
  }
  let donor = 0, count = 0;
  for (let y = 0; y < first && donor < donors; y++) for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
    const dx = ((x + .5) / nx - INLET) / .13, dz = nz > 1 ? ((z + .5) / nz - INLET_DEPTH) / .24 : 0;
    // Leave the arriving surface parcel at the impact itself.
    let remaining = Math.min(1, Math.max(0, offset * ny - y)) * (1 - Math.exp(-dx * dx - dz * dz));
    while (remaining > 1e-14 && donor < donors) {
      const fraction = Math.min(remaining, b.available[donor]);
      b.from[count] = (z * ny + y) * nx + x; b.to[count] = b.donors[donor]; b.fraction[count++] = fraction;
      remaining -= fraction; b.available[donor] -= fraction;
      if (b.available[donor] < 1e-14) donor++;
    }
  }
  b.count = count;
  return b;
}

export function exchangeLiquid(sim, amount, recipe, temperature) {
  const old = sim.volume, next = old + amount;
  const offset = amount > 0 ? amount / next : 0;
  const scale = old / next;
  const target = sim.exchangeBuffer ||= new Float64Array(sim.n);
  const plan = amount > 0 ? inletPlan(sim, offset) : null;
  for (const name of LIQUID_FIELDS) {
    const source = name === 'temperature' ? sim.temperature : sim.fields[name];
    const incoming = name === 'temperature' ? temperature ?? 0 : recipe?.[name] || 0;
    remap(source, sim.nx, sim.ny, sim.nz, scale, offset, incoming, target);
    for (let i = 0; i < sim.n; i++) source[i] = target[i];
    if (plan) for (let k = 0; k < plan.count; k++) {
      const i = plan.from[k], j = plan.to[k], flux = plan.fraction[k] * (incoming - target[j]);
      source[i] -= flux; source[j] += flux;
    }
  }
  // Existing organisms retain their position in the liquid as the surface
  // rises. Outlet entrainment is sampled by drain() before this remap.
  for (const agent of sim.agents) {
    // Draining already samples entrainment statistically. Compressing those
    // survivors a second time pins most of a harvest's cells to the floor.
    if (amount < 0) continue;
    if (agent.type === 'bacteria' && agent.y < .15 && sampleFilm(sim, sim.pellicle, agent.x, agent.z) > .08) continue;
    agent.y = clamp(offset + agent.y * scale, .012, .988);
  }
  if (amount > 0) for (const bubble of sim.gas.bubbles) bubble.y = clamp(offset + bubble.y * scale, 0, 1);
  // When pouring (amount > 0), rising liquid submerges the existing sheet until
  // buoyancy lifts it. When draining (amount < 0), the floating sheet rides down
  // with the local meniscus while preserving continuity on tilted waterlines.
  const point = sim.exchangeFilmPoint ||= [0, 0];
  for (let i = 0; i < sim.membrane.displacement.length; i++) {
    const d = sim.membrane.displacement[i];
    const u = (i % sim.nx + .5) / sim.nx, v = (Math.floor(i / sim.nx) + .5) / sim.nz;
    filmPoint(sim, u, v, point);
    const localWater = sampleSurface(sim, sim.surface.displacement, point[0], point[1]);
    sim.membrane.displacement[i] = clamp(d + amount, Math.min(d, localWater), next * .75);
  }
  sim.volume = next;
}

export function validateRecipe(temperature, sugar) {
  if (!Number.isFinite(temperature) || temperature < 10 || temperature > 95 || !Number.isFinite(sugar) || sugar < 0 || sugar > 160) {
    throw new RangeError('Tea recipe is outside the supported range');
  }
}

export function startTransfer(sim, phase, amount, { temperature = 24, sugar = 80 } = {}) {
  if (!['drain', 'pour'].includes(phase)) throw new RangeError('Unknown transfer phase');
  validateRecipe(temperature, sugar);
  // An active exchange owns the inlet/outlet until it completes.
  if (sim.care.transfer) return 0;
  const total = clamp(Number(amount) || 0, 0, phase === 'pour' ? .95 - sim.volume : sim.volume - MIN_VOLUME);
  if (total) sim.care.transfer = { phase, total, remaining: total, recipe: { temperature, sugar }, manual: true };
  return total;
}
