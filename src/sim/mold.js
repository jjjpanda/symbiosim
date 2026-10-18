import { FILM_CUTOFF, clamp } from './constants.js';
import { phFromAcids } from './chemistry.js';
import { filmPoint } from './film-body.js';
import { sampleSurface } from './spatial.js';

export const MOLD_LIMIT = .01, MOLD_PPM = 10000;

// Illustrative Aspergillus / Penicillium surface particulate mechanics on the
// biological (days) clock. A separate RNG keeps rare arrivals from perturbing the culture.
function random(mold) {
  mold.seed = (Math.imul(mold.seed, 1664525) + 1013904223) >>> 0;
  return (mold.seed + .5) / 4294967296;
}

export function createMold(size, seed) {
  const mold = { coverage: Array(size).fill(0), exposure: 0, hazard: 0, seed: (seed ^ 0xa341316c) >>> 0, failed: false };
  mold.arrival = -Math.log(random(mold));
  return mold;
}

// Surface particulate fraction across existing pellicle (1.0 = 10,000 ppm; takeover > 100 ppm).
export function moldCoverage(sim) {
  let area = 0, occupied = 0;
  for (let i = 0; i < sim.pellicle.length; i++) {
    if (sim.pellicle[i] < FILM_CUTOFF) continue;
    area++;
    occupied += sim.mold.coverage[i];
  }
  return area ? occupied / area : 0;
}

export const moldPpm = sim => moldCoverage(sim) * MOLD_PPM;

export function checkMold(sim) {
  // Ignore rounding noise when an even 100 ppm spans many material cells.
  if (moldCoverage(sim) > MOLD_LIMIT + Number.EPSILON) {
    sim.mold.failed = true;
    sim.playing = false;
  }
  return sim.mold.failed;
}

export function stepMold(sim, dt) {
  const mold = sim.mold;
  if (!(dt > 0) || mold.failed) return;
  const rates = sim.moldRates ||= new Float64Array(sim.pellicle.length);
  const kills = sim.moldKills ||= new Float64Array(sim.pellicle.length);
  const indices = sim.moldIndices ||= new Int32Array(sim.pellicle.length);
  const previous = sim.moldPrevious ||= new Float64Array(sim.pellicle.length);
  const point = sim.moldPoint ||= [0, 0];
  let suitability = 0, area = 0, occupied = 0;
  for (let i = 0; i < rates.length; i++) {
    rates[i] = 0; kills[i] = 0;
    const hasFilm = sim.pellicle[i] >= FILM_CUTOFF;
    if (!hasFilm && !mold.coverage[i]) continue;
    filmPoint(sim, (i % sim.nx + .5) / sim.nx, (Math.floor(i / sim.nx) + .5) / sim.nz, point);
    const water = sampleSurface(sim, sim.surface.displacement, ...point);
    const submerged = Math.max(0, sim.membrane.displacement[i] - water);
    const index = indices[i] = sim.index(point[0], submerged / sim.volume, point[1]);
    const ph = phFromAcids(sim.fields.acetic[index], sim.fields.gluconic[index]);
    const ethanol = sim.fields.ethanol[index];
    kills[i] = Math.max(clamp((3.5 - ph) / .6, 0, 1), clamp((ethanol - 32) / 25, 0, 1));
    if (!hasFilm) continue;
    area++;
    occupied += mold.coverage[i];
    const temperature = sim.temperature[index];
    rates[i] = clamp((ph - 4.25) / .25, 0, 1)
      * clamp(Math.min((temperature - 15) / 6, (33 - temperature) / 6), 0, 1)
      * clamp(sim.fields.oxygen[index] / .15, 0, 1)
      * clamp((sim.fields.sucrose[index] + sim.fields.glucose[index] + sim.fields.fructose[index]) / 5, 0, 1)
      * clamp(1 - (ethanol - 32) / 25, 0, 1)
      * clamp(1 - submerged / .035, 0, 1);
    suitability += rates[i];
  }
  const favorable = area ? suitability / area : 0;
  // Brief high-pH episodes cannot spawn mold; sustained low-acid exposure
  // over the first few days lets airborne spores establish and spread.
  mold.exposure = clamp(mold.exposure + dt * (favorable > 0 ? Math.sqrt(favorable) : -1.5), 0, 3);
  if (!occupied && mold.exposure >= 3 && suitability > 0) {
    mold.hazard += dt * favorable * .4;
    if (mold.hazard >= mold.arrival) {
      let pick = random(mold) * suitability, chosen = -1;
      for (let i = 0; i < rates.length; i++) {
        if (!(rates[i] > 0)) continue;
        chosen = i;
        pick -= rates[i];
        if (pick <= 0) break;
      }
      if (chosen >= 0) mold.coverage[chosen] = .004;
      mold.hazard = 0;
      mold.arrival = -Math.log(random(mold));
    }
  }
  previous.set(mold.coverage);
  for (let i = 0; i < rates.length; i++) {
    if (kills[i] > 0 && previous[i] > 0) {
      mold.coverage[i] = previous[i] * Math.exp(-dt * kills[i] * .8);
      continue;
    }
    if (!rates[i]) continue;
    const x = i % sim.nx, z = Math.floor(i / sim.nx);
    const neighbors = (x ? previous[i - 1] : 0) + (x + 1 < sim.nx ? previous[i + 1] : 0)
      + (z ? previous[i - sim.nx] : 0) + (z + 1 < sim.nz ? previous[i + sim.nx] : 0);
    const growth = dt * rates[i] * (previous[i] * 2.6 + neighbors * .34) * (1 - previous[i]);
    if (growth > 0) {
      sim.fields.oxygen[indices[i]] = Math.max(0, sim.fields.oxygen[indices[i]] - growth * .002);
      mold.coverage[i] = clamp(previous[i] + growth, 0, 1);
    }
  }
  // Once takeover (> 100 ppm) occurs, mycotoxins latch failure permanently.
  checkMold(sim);
}
