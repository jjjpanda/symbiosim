import { INLET, INLET_DEPTH } from './exchange.js';
import { pourImpact } from './transfer-clock.js';
import { worldFilm } from './film-body.js';
import { surfaceRest } from './vessel.js';

// Small-amplitude waves on the x/z plane, in vessel-height units. Pairwise
// forces reflect at walls. Removing the uniform mode preserves liquid volume.
export function createSurface(size) {
  return { displacement: Array(size).fill(0), velocity: Array(size).fill(0) };
}

export function impulseSurface(sim, x, z, strength, radius = .08) {
  const weights = sim.surfaceWeights ||= new Float64Array(sim.nx * sim.nz);
  let mean = 0;
  for (let iz = 0; iz < sim.nz; iz++) for (let ix = 0; ix < sim.nx; ix++) {
    const dx = ((ix + .5) / sim.nx - x) / radius;
    const dz = sim.nz > 1 ? ((iz + .5) / sim.nz - z) * .65 / radius : 0;
    const i = iz * sim.nx + ix;
    mean += weights[i] = Math.exp(-.5 * (dx * dx + dz * dz));
  }
  mean /= weights.length;
  const velocity = sim.surface.velocity;
  for (let i = 0; i < weights.length; i++) velocity[i] += (weights[i] - mean) * strength;
  // Skimming can vent gas while paused; bound the whole mode uniformly.
  let peak = .6;
  for (const value of velocity) peak = Math.max(peak, Math.abs(value));
  if (peak > .6) for (let i = 0; i < velocity.length; i++) velocity[i] *= .6 / peak;
}

export function stepSurface(sim, dt) {
  if (!(dt > 0)) return;
  const { nx, nz, surface } = sim, d = surface.displacement, v = surface.velocity;
  const force = sim.surfaceForce ||= new Float64Array(d.length);
  const stiffness = sim.surfaceStiffness ||= new Float64Array(d.length);
  const rest = sim.surfaceRest ||= new Float64Array(d.length);
  const current = sim.surfaceCurrent ||= new Float64Array(d.length * 3);
  let bound = .025, flowRate = 0;
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
    const i = z * nx + x;
    rest[i] = surfaceRest(sim, (x + .5) / nx, (z + .5) / nz); bound = Math.max(bound, Math.abs(rest[i]) + .025);
    // Sample the upper liquid, below the impermeable projection boundary.
    // These velocities carry wave fronts and exert a spatial pressure head.
    const cell = (z * sim.ny + 1) * nx + x;
    current[i * 3] = sim.vx[cell]; current[i * 3 + 1] = sim.vy[cell]; current[i * 3 + 2] = sim.vz[cell];
    flowRate = Math.max(flowRate, Math.abs(sim.vx[cell]) * nx + Math.abs(sim.vz[cell]) * nz);
  }
  stiffness.set(worldFilm(sim).stiffness);
  // CFL substeps also handle the maximum grid and direct headless calls.
  const c = 1.8, zz = nz > 1 ? (nz / .65) ** 2 : 0;
  const count = Math.max(1, Math.ceil(dt * (c * Math.sqrt(nx * nx + zz) + flowRate) / .4));
  const sub = dt / count, transfer = sim.care.transfer;
  const pouring = transfer?.phase === 'pour';
  const momentum = 1.2 * pourImpact(sim);
  for (let step = 0; step < count; step++) {
    force.fill(0);
    for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
      const i = z * nx + x;
      if (x + 1 < nx) {
        const j = i + 1, f = (d[j] - rest[j] - d[i] + rest[i]) * c * c * nx * nx;
        force[i] += f; force[j] -= f;
      }
      force[i] += (rest[i] - d[i]) * 32;
      const u = current[i * 3], down = current[i * 3 + 1], w = current[i * 3 + 2];
      force[i] += down * 2.4 + (u * u + w * w) * .035;
      if (z + 1 < nz) {
        const j = i + nx, f = (d[j] - rest[j] - d[i] + rest[i]) * c * c * zz;
        force[i] += f; force[j] -= f;
      }
      if (pouring) {
        const dx = ((x + .5) / nx - INLET) / .075;
        const dz = nz > 1 ? ((z + .5) / nz - INLET_DEPTH) / .23 : 0;
        force[i] += momentum * Math.exp(-dx * dx - dz * dz);
      } else if (transfer) {
        const dx = (x + .5) / nx / .22;
        const dz = nz > 1 ? ((z + .5) / nz - .5) / .35 : 0;
        force[i] += .42 * Math.min(2, Math.sqrt(transfer.total / .15)) * Math.exp(-dx * dx - dz * dz);
      }
    }
    let meanV = 0, meanD = 0;
    for (let i = 0; i < d.length; i++) {
      // Consolidated cellulose absorbs motion more strongly than bare tea.
      v[i] = (v[i] + force[i] * sub) * Math.exp(-sub * (2.2 + 20 * stiffness[i]));
      meanV += v[i];
    }
    meanV /= d.length;
    // Upwind wave transport uses a frozen displacement field per substep.
    // The gravity-rest plane is excluded so a tipped, settled jar stays still.
    force.set(d);
    for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
      const i = z * nx + x, u = current[i * 3], w = current[i * 3 + 2];
      const ix = u > 0 ? Math.max(0, x - 1) : Math.min(nx - 1, x + 1);
      const iz = w > 0 ? Math.max(0, z - 1) : Math.min(nz - 1, z + 1);
      const j = z * nx + ix, k = iz * nx + x;
      const advect = Math.abs(u) * nx * ((force[i] - rest[i]) - (force[j] - rest[j]))
        + Math.abs(w) * nz * ((force[i] - rest[i]) - (force[k] - rest[k]));
      v[i] -= meanV; d[i] += (v[i] - advect) * sub; meanD += d[i];
    }
    meanD /= d.length;
    let peakD = bound, peakV = .6;
    for (let i = 0; i < d.length; i++) {
      d[i] -= meanD;
      peakD = Math.max(peakD, Math.abs(d[i])); peakV = Math.max(peakV, Math.abs(v[i]));
    }
    const scale = Math.min(bound / peakD, .6 / peakV);
    if (scale < 1) for (let i = 0; i < d.length; i++) { d[i] *= scale; v[i] *= scale; }
  }
}
