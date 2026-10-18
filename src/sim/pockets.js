// Connected under-film gas shares a lens. Ignore the faint diffusion tail so
// a trace of gas cannot join every pocket in the vessel. Bare film breaks it.
import { edgeSeal } from './pellicle.js';
import { sampleFilm, worldFilm } from './film-body.js';
import { atRim } from './spatial.js';
import { FILM_CUTOFF } from './constants.js';
export { edgeSeal } from './pellicle.js';
export { atRim } from './spatial.js';

export const POCKET_EDGE = .12;

const neighbor = (sim, i, x, z, axis) => axis === 0 ? (x ? i - 1 : -1)
  : axis === 1 ? (x + 1 < sim.nx ? i + 1 : -1)
  : axis === 2 ? (z ? i - sim.nx : -1)
  : (z + 1 < sim.nz ? i + sim.nx : -1);

export function canopyGap(sim, i, contact) {
  const film = contact ? contact.displacement[i]
    : sampleFilm(sim, sim.membrane.displacement, (i % sim.nx + .5) / sim.nx, (Math.floor(i / sim.nx) + .5) / sim.nz);
  return Math.max(0, sim.surface.displacement[i] - film);
}

// Opening a gap beneath a sheet is not a hole through that sheet. An outlet
// exists only where the lifted canopy meets bare water or the jar perimeter.
export function pocketOutlet(sim, i, outlet, contact = worldFilm(sim)) {
  const gap = canopyGap(sim, i, contact), x = i % sim.nx, z = Math.floor(i / sim.nx);
  if (atRim(sim, i)) {
    const rimOpening = gap - edgeSeal(sim, i, contact);
    if (rimOpening > outlet.opening) {
      outlet.edge = i; outlet.opening = rimOpening;
      outlet.outletX = x === 0 ? 0 : x === sim.nx - 1 ? 1 : (x + .5) / sim.nx;
      outlet.outletZ = x === 0 || x === sim.nx - 1 ? (z + .5) / sim.nz : z === 0 ? 0 : 1;
    }
  }
  // A free edge has no wall attachment. Wet contact still needs clearance;
  // material stiffness controls how readily the mechanical sheet lifts.
  const opening = gap - .001;
  if (opening <= outlet.opening) return;
  for (let axis = 0; axis < 4; axis++) {
    const j = neighbor(sim, i, x, z, axis);
    if (j < 0 || contact.density[j] >= FILM_CUTOFF) continue;
    outlet.edge = i; outlet.opening = opening;
    outlet.outletX = (x + .5 + (axis === 0 ? -.5 : axis === 1 ? .5 : 0)) / sim.nx;
    outlet.outletZ = (z + .5 + (axis === 2 ? -.5 : axis === 3 ? .5 : 0)) / sim.nz;
    break;
  }
}

export function collectPockets(sim, contact = worldFilm(sim)) {
  const n = sim.pellicle.length;
  // Pockets store inventory, not density. A finer surface cell holds less
  // gas at the same pressure and must use a proportionally smaller cutoff.
  const threshold = POCKET_EDGE * 88 / n;
  const density = contact.density;
  const cache = sim.pocketRegions ||= {
    labels: new Int16Array(n), cells: new Int16Array(n), regions: [], count: 0
  };
  const { labels, cells, regions } = cache, gas = sim.gas.pockets;
  labels.fill(-1);
  let count = 0, end = 0;
  for (let seed = 0; seed < n; seed++) {
    if (labels[seed] >= 0 || gas[seed] < threshold || density[seed] < FILM_CUTOFF) continue;
    const region = regions[count] ||= {};
    region.start = end; region.amount = region.x = region.z = 0;
    region.edge = -1; region.opening = 0;
    cells[end++] = seed; labels[seed] = count;
    for (let head = region.start; head < end; head++) {
      const i = cells[head], x = i % sim.nx, z = Math.floor(i / sim.nx);
      const amount = gas[i];
      region.amount += amount;
      region.x += amount * (x + .5) / sim.nx; region.z += amount * (z + .5) / sim.nz;
      pocketOutlet(sim, i, region, contact);
      // Four surface neighbors; no diagonal bridge across a dry film gap.
      for (let axis = 0; axis < 4; axis++) {
        const j = neighbor(sim, i, x, z, axis);
        if (j < 0 || labels[j] >= 0 || gas[j] < threshold || density[j] < FILM_CUTOFF) continue;
        labels[j] = count; cells[end++] = j;
      }
    }
    region.end = end; region.x /= region.amount; region.z /= region.amount;
    count++;
  }
  cache.count = count;
  return cache;
}

// A large arriving bubble loads several patches while the sheet responds.
// Spread only excess inventory through connected cellulose, preserving mass
// and retaining any remainder when all connected patches are loaded. Storage
// pressure must never create an outlet through intact cellulose.
export function spreadPocketLoad(sim, contact = worldFilm(sim)) {
  const gas = sim.gas.pockets, n = gas.length;
  const capacity = 1.4 * 88 / n;
  const density = contact.density;
  let queue, visited;
  for (let seed = 0; seed < n; seed++) {
    if (gas[seed] <= capacity || density[seed] < FILM_CUTOFF) continue;
    queue ||= sim.pocketLoadQueue ||= new Int16Array(n);
    visited ||= sim.pocketLoadVisited ||= new Uint8Array(n);
    visited.fill(0); visited[seed] = 1; queue[0] = seed;
    let excess = gas[seed] - capacity, end = 1;
    gas[seed] = capacity;
    for (let head = 0; head < end && excess > 1e-12; head++) {
      const i = queue[head], x = i % sim.nx, z = Math.floor(i / sim.nx);
      for (let axis = 0; axis < 4 && excess > 1e-12; axis++) {
        const j = neighbor(sim, i, x, z, axis);
        if (j < 0 || visited[j] || density[j] < FILM_CUTOFF) continue;
        visited[j] = 1; queue[end++] = j;
        const amount = Math.min(excess, Math.max(0, capacity - gas[j]));
        gas[j] += amount; excess -= amount;
      }
    }
    gas[seed] += excess;
  }
}
