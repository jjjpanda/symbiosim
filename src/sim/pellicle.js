import { INLET, INLET_DEPTH } from './exchange.js';
import { FILM_CUTOFF, clamp } from './constants.js';
import { createFilmBody, filmPoint, sampleFilm, stepFilmBody } from './film-body.js';
import { atRim, sampleSurface as sample } from './spatial.js';
import { pourImpact } from './transfer-clock.js';

export function createMembrane(width) {
  return {
    displacement: Array(width).fill(0), velocity: Array(width).fill(0),
    layers: Array.from({ length: 3 }, () => Array(width).fill(0)), body: createFilmBody(width)
  };
}

export const SKIM_THICKNESS = 2.1; // Illustrative mm, matching rendered thickness.
const thermalSoftening = temperature => clamp(1 - Math.max(0, temperature - 35) * .009, .45, 1);

export function pellicleStats(sim, out = {}) {
  let cells = 0, density = 0, mass = 0, depth = 0, gas = 0;
  const point = sim.statsFilmPoint ||= [0, 0];
  for (let i = 0; i < sim.pellicle.length; i++) {
    const value = sim.pellicle[i];
    mass += value;
    gas += sim.gas.pockets[i];
    if (value > 0) {
      const u = (i % sim.nx + .5) / sim.nx, v = (Math.floor(i / sim.nx) + .5) / sim.nz;
      filmPoint(sim, u, v, point);
      const localWater = sample(sim, sim.surface.displacement, point[0], point[1]);
      depth += (sim.membrane.displacement[i] - localWater) * value;
    }
    if (value >= FILM_CUTOFF) { cells++; density += value; }
  }
  out.area = cells / sim.pellicle.length;
  out.thickness = cells ? .7 + 1.7 * density / cells : 0;
  out.mass = mass;
  out.depth = mass ? depth / mass : 0;
  out.gasLift = mass ? Math.min(.18, 1.5 * gas / mass * (sim.nx * sim.nz / 88)) : 0;
  return out;
}

// New fibrils mature beneath the growing surface. Layers partition existing
// cellulose inventory; maturation changes its stiffness without making mass.
export function syncCellulose(sim, i) {
  const layers = sim.membrane.layers;
  const total = layers[0][i] + layers[1][i] + layers[2][i];
  const density = sim.pellicle[i];
  if (Math.abs(total - density) < 1e-12) return;
  if (total > 0) for (const layer of layers) layer[i] *= density / total;
  else { layers[0][i] = density * .2; layers[1][i] = density * .3; layers[2][i] = density * .5; }
}

export function depositCellulose(sim, i, amount) {
  syncCellulose(sim, i);
  const added = Math.min(1 - sim.pellicle[i], amount);
  sim.membrane.layers[0][i] += added;
  sim.pellicle[i] += added;
  return added;
}

export function stepCellulose(sim, dt, ph) {
  const layers = sim.membrane.layers, count = sim.pellicle.length;
  const previous = sim.pellicleBuffer ||= new Float64Array(count);
  for (let i = 0; i < count; i++) syncCellulose(sim, i);
  const decay = Math.exp(-dt * (ph < 2.8 ? .002 : .0001));
  for (const layer of layers) {
    previous.set(layer);
    for (let z = 0; z < sim.nz; z++) for (let x = 0; x < sim.nx; x++) {
      const i = z * sim.nx + x;
      const left = x ? i - 1 : i, right = x + 1 < sim.nx ? i + 1 : i;
      const back = z ? i - sim.nx : i, front = z + 1 < sim.nz ? i + sim.nx : i;
      layer[i] = (previous[i] + Math.min(.24, dt * .08) * (previous[left] + previous[right] + previous[back] + previous[front] - 4 * previous[i])) * decay;
    }
  }
  for (let i = 0; i < count; i++) {
    const forming = layers[0][i] * (1 - Math.exp(-dt * .65));
    const consolidating = layers[1][i] * (1 - Math.exp(-dt * .18));
    layers[0][i] -= forming; layers[1][i] += forming - consolidating; layers[2][i] += consolidating;
    sim.pellicle[i] = layers[0][i] + layers[1][i] + layers[2][i];
  }
}

export function celluloseStiffness(sim, i) {
  const layers = sim.membrane.layers;
  const z = Math.floor(i / sim.nx), x = i % sim.nx;
  const point = filmPoint(sim, (x + .5) / sim.nx, (z + .5) / sim.nz, sim.stiffnessPoint ||= [0, 0]);
  const temperature = sim.temperature[sim.index(point[0], sim.membrane.displacement[i] / sim.volume, point[1])];
  return (layers[0][i] * .3 + layers[1][i] * .65 + layers[2][i]) * thermalSoftening(temperature);
}

export function edgeSeal(sim, i, contact) {
  const x = (i % sim.nx + .5) / sim.nx, z = (Math.floor(i / sim.nx) + .5) / sim.nz;
  const layers = sim.membrane.layers;
  const stiffness = contact ? contact.stiffness[i]
    : sampleFilm(sim, layers[0], x, z) * .3 + sampleFilm(sim, layers[1], x, z) * .65 + sampleFilm(sim, layers[2], x, z);
  return .003 + .01 * stiffness * thermalSoftening(sim.temperature[sim.index(x, 0, z)]);
}

// A damped elastic sheet: neighboring cellulose shares tension, while gas
// pressure lifts it and inlet momentum depresses it. Units are vessel height.
export function stepPellicle(sim, dt) {
  const { displacement: d, velocity: v } = sim.membrane;
  for (let i = 0; i < d.length; i++) syncCellulose(sim, i);
  if (!(dt > 0)) return;
  const body = pellicleStats(sim, sim.membraneMetrics ||= {});
  const force = sim.membraneForce ||= new Float64Array(d.length);
  const minBounds = sim.membraneMinBounds ||= new Float64Array(d.length);
  const stiffnesses = sim.membraneStiffness ||= new Float64Array(d.length);
  const point = sim.membranePoint ||= [0, 0];
  const flow = sim.membraneFlow ||= [0, 0, 0];
  for (let i = 0; i < d.length; i++) stiffnesses[i] = celluloseStiffness(sim, i);
  stepFilmBody(sim, dt, stiffnesses);
  const impact = pourImpact(sim);
  const tensionX = (sim.nx / 22) ** 2, tensionZ = (sim.nz / 4) ** 2, pressureScale = sim.nx * sim.nz / 88;
  const bond = (i, j) => (d[j] - d[i]) * Math.min(stiffnesses[i], stiffnesses[j]);
  for (let z = 0; z < sim.nz; z++) for (let x = 0; x < sim.nx; x++) {
    const i = z * sim.nx + x;
    const left = z * sim.nx + Math.max(0, x - 1), right = z * sim.nx + Math.min(sim.nx - 1, x + 1);
    const back = Math.max(0, z - 1) * sim.nx + x, front = Math.min(sim.nz - 1, z + 1) * sim.nx + x;
    // Keep a physical tension scale when depth resolution changes. Without
    // spacing factors, a denser mesh artificially slows pressure propagation.
    const tension = ((bond(i, left) + bond(i, right)) * tensionX + (bond(i, back) + bond(i, front)) * tensionZ) * 210;
    filmPoint(sim, (x + .5) / sim.nx, (z + .5) / sim.nz, point);
    const water = sample(sim, sim.surface.displacement, ...point);
    const localGas = sample(sim, sim.gas.pockets, ...point);
    const pressure = sim.pellicle[i] <= 0 ? 0 : -Math.min(.14, localGas * .07 * pressureScale) / (1 + Math.max(0, d[i] - water) * 3);
    minBounds[i] = localGas > .005 ? Math.min(water - .08, -.08) : Math.min(0, water) - .006;
    const dx = (point[0] - INLET) / .12;
    const dz = (point[1] - INLET_DEPTH) / .2;
    const inlet = .28 * impact * sim.pellicle[i] * Math.exp(-dx * dx - dz * dz - Math.max(0, d[i] - water) * 8);
    const stiffness = stiffnesses[i], gap = water - d[i];
    const density = sim.pellicle[i];
    const temperature = sim.temperature[sim.index(point[0], Math.max(0, d[i] - water) / Math.max(.02, sim.volume - water), point[1])];
    const cool = Math.max(0, 24 - temperature);
    const mature = sim.membrane.layers[2][i];
    // Wet sheet load moves its resting depth below the surface.
    // Thickness, span and cooling add load; retained gas supports the body
    // up to the meniscus, never levitating the whole sheet in midair.
    const load = density * (.012 + .1 * density * body.area + .02 * body.area ** 2 + .003 * cool) + .012 * mature;
    const sink = density > 0 ? Math.max(.002 * density, load - body.gasLift * .82) : 0;
    const buoyancy = 82 / (1 + .8 * density * body.area + .03 * cool);
    const liquidDepth = clamp((d[i] - water) / Math.max(.02, sim.volume - water), 1 / sim.ny, .95);
    sim.velocity(point[0], liquidDepth, flow, point[1]);
    const slopeFlex = density * ((d[right] - d[left]) * flow[0] * sim.nx + (d[front] - d[back]) * flow[2] * sim.nz) * .28;
    const wet = Math.exp(-Math.max(0, gap) * 40);
    // A mature wet edge resists peeling from the glass. Once lifted above
    // the seal height it can release; settling restores contact with the wall.
    const pinning = atRim(sim, i) && gap < edgeSeal(sim, i) ? stiffness * .9 : 0;
    // Upward bulk currents cannot push the sheet above the free water surface;
    // if a non-blistered patch breaches the meniscus, gravity and surface tension arrest it.
    const verticalFlow = flow[1] < 0 && d[i] <= water + sink ? 0 : clamp(flow[1], -.25, .6);
    const airPull = d[i] < water + pressure ? (water + pressure - d[i]) * 220 : 0;
    const airBrake = d[i] < water + sink * .5 && v[i] < 0 && pressure > -.002 ? -v[i] * 28 : 0;
    force[i] = tension + (pressure + inlet + water + sink - d[i]) * buoyancy + airPull + airBrake
      + (water - d[i]) * 95 * pinning + (verticalFlow * (2.2 - .6 * mature) - slopeFlex) * wet - v[i] * 7.2;
  }
  for (let x = 0; x < d.length; x++) {
    const minD = minBounds[x];
    v[x] = clamp(v[x] + force[x] * dt, -.9, 1.5);
    d[x] = clamp(d[x] + v[x] * dt, minD, sim.volume * .78);
    if (d[x] <= minD && v[x] < 0) v[x] = 0;
  }
}
