import { FIELDS, clamp } from './constants.js';
import { atRim, sampleVelocity } from './spatial.js';
import { INLET, INLET_DEPTH } from './exchange.js';
import { prepareTransport, transportScalar } from './transport.js';
import { projectPressure } from './pressure.js';
import { confineVolumeVorticity } from './vorticity.js';
import { worldFilm } from './film-body.js';
import { surfaceRest, vesselGravity } from './vessel.js';

// All momentum components share a full-volume pressure projection. Jets,
// density fronts and cross-depth vortices evolve without circulation planes.
export function stepFluid(sim, dt) {
  if (!(dt > 0)) return;
  const { nx, ny, nz, n } = sim, plane = nx * ny;
  const contact = worldFilm(sim);
  const [gravityX, gravityY, gravityZ] = vesselGravity(sim);
  const rest = sim.fluidRestSurface ||= new Float64Array(nx * nz);
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) rest[z * nx + x] = surfaceRest(sim, (x + .5) / nx, (z + .5) / nz);
  const b = sim.fluidBuffers ||= {
    vx: new Float64Array(n), vy: new Float64Array(n), vz: new Float64Array(n), next: new Float64Array(n),
    fx: new Float64Array((nx + 1) * ny * nz), fy: new Float64Array(nx * (ny + 1) * nz), fz: new Float64Array(nx * ny * (nz + 1)),
    velocity: [0, 0, 0], midpoint: [0, 0, 0]
  };
  const ambient = sim.ambient(), meanTemperature = sim.meanTemperature(), gas = sim.mean('co2'), sugar = sim.sugar();
  const damp = Math.exp(-dt * .24), transfer = sim.care.transfer, pouring = transfer?.phase === 'pour';
  const strength = transfer ? clamp(Math.sqrt(transfer.total / .15), .2, 2) : 0;
  const phase = transfer ? (1 - transfer.remaining / transfer.total) * Math.PI * 5 : 0;
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const i = z * plane + y * nx + x, px = (x + .5) / nx, py = (y + .5) / ny, pz = (z + .5) / nz;
    const v = sampleVelocity(sim, px, py, pz, b.velocity);
    const m = sampleVelocity(sim, px - v[0] * dt * .5, py - v[1] * dt * .5, pz - v[2] * dt * .5, b.midpoint);
    sampleVelocity(sim, px - m[0] * dt, py - m[1] * dt, pz - m[2] * dt, v);
    const localSugar = sim.fields.sucrose[i] + sim.fields.glucose[i] + sim.fields.fructose[i];
    const thermalDelta = sim.temperature[i] - meanTemperature;
    const buoyancy = (-thermalDelta * 7.8 + (localSugar - sugar) * .06
      - (sim.fields.co2[i] - gas) * .12) * sim.settings.convection;
    b.vx[i] = v[0] * damp + buoyancy * gravityX * dt;
    b.vy[i] = v[1] * damp + buoyancy * gravityY * dt; b.vz[i] = v[2] * damp + buoyancy * gravityZ * dt;
    if (pouring) {
      const dx = (px - INLET - .018 * Math.sin(phase - py * 8)) / (.085 + py * .16);
      const dz = nz > 1 ? (pz - INLET_DEPTH) / (.19 + py * .12) : 0;
      const jet = Math.exp(-dx * dx - dz * dz - py * 1.1);
      // Pressure supplies the return current around the entraining jet.
      b.vy[i] += dt * 160 * strength * jet;
      b.vx[i] += dt * 22 * strength * jet * Math.sin(phase + py * 15 + pz * 4);
      b.vz[i] += dt * 14 * strength * jet * Math.cos(phase * .83 + py * 11 + px * 3);
    } else if (transfer) {
      const dx = px / .36, dy = (py - .84) / .34, dz = nz > 1 ? (pz - .5) / .5 : 0;
      const jet = dt * 105 * strength * Math.exp(-dx * dx - dy * dy - dz * dz);
      b.vx[i] -= jet; b.vy[i] += jet * (.45 - dy * .32);
      if (nz > 1) b.vz[i] -= jet * .25 * dz;
    }
    // Surface and film slopes transfer momentum back into the upper liquid.
    const column = z * nx + x, surface = sim.surface.displacement, film = contact.displacement;
    const left = x ? column - 1 : column, right = x + 1 < nx ? column + 1 : column;
    const back = z ? column - nx : column, front = z + 1 < nz ? column + nx : column;
    const coupled = dt * Math.exp(-py * 15) * 14;
    const restSlope = rest[right] - rest[left], restDepth = rest[front] - rest[back];
    const wet = Math.min(contact.density[column], 1) * Math.exp(-Math.abs(film[column] - surface[column]) * 30);
    b.vx[i] += coupled * nx * (surface[right] - surface[left] - restSlope + .2 * wet * (film[right] - film[left] - restSlope));
    b.vz[i] += coupled * nz * (surface[front] - surface[back] - restDepth + .2 * wet * (film[front] - film[back] - restDepth));
  }
  addBubbleWakes(sim, b, dt, gravityX, gravityY, gravityZ);
  confineVolumeVorticity(sim, b, dt);
  b.fx.fill(0); b.fy.fill(0); b.fz.fill(0);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const i = z * plane + y * nx + x;
    if (x + 1 < nx) b.fx[(z * ny + y) * (nx + 1) + x + 1] = (b.vx[i] + b.vx[i + 1]) * .5;
    if (y + 1 < ny) b.fy[(z * (ny + 1) + y + 1) * nx + x] = (b.vy[i] + b.vy[i + nx]) * .5;
    if (z + 1 < nz) b.fz[i + plane] = (b.vz[i] + b.vz[i + plane]) * .5;
  }
  projectPressure(sim, b);
  let peak = 5;
  for (const field of [b.fx, b.fy, b.fz]) {
    for (let i = 0; i < field.length; i++) {
      const abs = Math.abs(field[i]);
      if (abs > peak) peak = abs;
    }
  }
  const pressure = sim.pressureBuffers.a;
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const i = z * plane + y * nx + x;
    // Apply the projected pressure impulse to the advected cell momentum.
    // Averaging faces back into cells would blur vortices once per step,
    // regardless of elapsed time, and make slow playback artificially viscous.
    sim.vx[i] = b.vx[i] - (pressure[x + 1 < nx ? i + 1 : i] - pressure[x ? i - 1 : i]) * nx * .5;
    sim.vy[i] = b.vy[i] - (pressure[y + 1 < ny ? i + nx : i] - pressure[y ? i - nx : i]) * ny * .5;
    sim.vz[i] = nz > 1 ? b.vz[i] - (pressure[z + 1 < nz ? i + plane : i] - pressure[z ? i - plane : i]) * nz * .5 : 0;
    peak = Math.max(peak, Math.abs(sim.vx[i]), Math.abs(sim.vy[i]), Math.abs(sim.vz[i]));
  }
  const scale = 5 / peak;
  for (const field of [b.fx, b.fy, b.fz, sim.vx, sim.vy, sim.vz]) for (let i = 0; i < field.length; i++) field[i] *= scale;
  // Use measured outgoing flux, reserving the MUSCL donor multiplier and
  // diffusion. This subcycles scalars without slowing momentum or biology.
  let rate = 0;
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const i = z * plane + y * nx + x, a = (z * ny + y) * (nx + 1) + x, c = (z * (ny + 1) + y) * nx + x;
    const outgoing = nx * (Math.max(0, b.fx[a + 1]) + Math.max(0, -b.fx[a]))
      + ny * (Math.max(0, b.fy[c + nx]) + Math.max(0, -b.fy[c]))
      + nz * (Math.max(0, b.fz[i + plane]) + Math.max(0, -b.fz[i]));
    rate = Math.max(rate, 1.5 * outgoing + .96);
  }
  const substeps = Math.max(1, Math.ceil(dt * rate / .8)), sub = dt / substeps;
  const transport = prepareTransport(sim, b, sub);
  for (let k = 0; k < substeps; k++) {
    for (const name of FIELDS) transportScalar(sim.fields[name], b.next, transport, sub * .06);
    transportScalar(sim.temperature, b.next, transport, sub * .13);
  }
  const evapCooling = .45 * sim.airAccess() * sim.settings.permeability;
  const baseWarmth = .4 * Math.min(1.5, sim.settings.convection);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const i = z * plane + y * nx + x;
    const wall = atRim(sim, z * nx + x);
    const target = y === 0 ? ambient - evapCooling : y === ny - 1 ? ambient + baseWarmth : ambient;
    const exchangeRate = wall ? 2.3 : y === 0 ? 1.15 : y === ny - 1 ? .95 : .035;
    sim.temperature[i] += (target - sim.temperature[i]) * (1 - Math.exp(-dt * exchangeRate));
  }
}


// Buoyant bubbles transfer momentum to the liquid they displace. The closed
// pressure solve supplies the surrounding return flow and interacting wakes.
// Scatter only into nearby cells; work is bounded by the 80-bubble pool.
function addBubbleWakes(sim, velocity, dt, gx, gy, gz) {
  const { nx, ny, nz } = sim;
  for (const bubble of sim.gas.bubbles) {
    const radius = .055 + bubble.size * .014;
    const cx = bubble.x + gx * radius, cy = bubble.y + gy * radius, cz = bubble.z + gz * radius;
    const minX = Math.max(0, Math.floor((cx - radius * 2) * nx)), maxX = Math.min(nx - 1, Math.ceil((cx + radius * 2) * nx));
    const minY = Math.max(0, Math.floor((cy - radius * 2) * ny)), maxY = Math.min(ny - 1, Math.ceil((cy + radius * 2) * ny));
    const minZ = Math.max(0, Math.floor((cz - radius * 2) * nz)), maxZ = Math.min(nz - 1, Math.ceil((cz + radius * 2) * nz));
    for (let z = minZ; z <= maxZ; z++) for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const dx = ((x + .5) / nx - cx) / radius, dy = ((y + .5) / ny - cy) / radius;
      const dz = nz > 1 ? ((z + .5) / nz - cz) / Math.max(radius, .5 / nz) : 0;
      const impulse = dt * 3.5 * bubble.size ** 2 * Math.exp(-2 * (dx * dx + dy * dy + dz * dz));
      const i = (z * ny + y) * nx + x;
      velocity.vx[i] -= gx * impulse; velocity.vy[i] -= gy * impulse; velocity.vz[i] -= gz * impulse;
    }
  }
}
