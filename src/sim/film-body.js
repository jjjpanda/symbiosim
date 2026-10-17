import { FILM_CUTOFF, clamp } from './constants.js';
import { atRim, sampleSurface as sample } from './spatial.js';
import { toDisc, fromDisc } from './domain.js';

export const createFilmPose = () => ({ x: 0, z: 0, angle: 0, vx: 0, vz: 0, spin: 0 });

// Cellulose lives in material coordinates. Liquid, oxygen and gas live in the
// vessel grid. Keeping the mapping explicit lets the sheet move without
// advecting (and numerically dissolving) its material inventory.
export function createFilmBody(size) {
  return {
    offsetX: Array(size).fill(0), offsetZ: Array(size).fill(0),
    velocityX: Array(size).fill(0), velocityZ: Array(size).fill(0),
    pose: createFilmPose()
  };
}

export function materialPoint(sim, x, z, out = [0, 0]) {
  const body = sim.membrane.body, pose = body.pose;
  const c = Math.cos(pose.angle), s = Math.sin(pose.angle);
  const disc = toDisc(x, z, out), px = disc[0] - pose.x, pz = disc[1] - pose.z;
  fromDisc(px * c + pz * s, -px * s + pz * c, out);
  const targetX = out[0], targetZ = out[1];
  let u = targetX, v = targetZ;
  for (let k = 0; k < 20; k++) {
    const nextU = targetX - sample(sim, body.offsetX, u, v);
    const nextV = targetZ - sample(sim, body.offsetZ, u, v);
    if (Math.abs(nextU - u) + Math.abs(nextV - v) < 1e-8) { u = nextU; v = nextV; break; }
    u = nextU; v = nextV;
  }
  out[0] = u; out[1] = v;
  return out;
}

export function filmPoint(sim, x, z, out = [0, 0]) {
  const body = sim.membrane.body, pose = body.pose;
  const c = Math.cos(pose.angle), s = Math.sin(pose.angle);
  toDisc(x + sample(sim, body.offsetX, x, z), z + sample(sim, body.offsetZ, x, z), out);
  const px = out[0], pz = out[1];
  return fromDisc(px * c - pz * s + pose.x, px * s + pz * c + pose.z, out);
}

export function sampleFilm(sim, field, x, z) {
  const p = materialPoint(sim, x, z, sim.filmSamplePoint ||= [0, 0]);
  if (p[0] < 0 || p[0] > 1 || p[1] < 0 || p[1] > 1) return 0;
  const value = sample(sim, field, p[0], p[1]);
  return Math.abs(value) < 1e-12 ? 0 : value;
}

// Reused Eulerian contact fields. Reading these does not alter the sheet or
// spend the biological RNG. Exact identity mapping preserves legacy snapshots.
export function worldFilm(sim) {
  const size = sim.pellicle.length, m = sim.membrane;
  const cache = sim.filmContact ||= {
    density: new Float64Array(size), displacement: new Float64Array(size),
    stiffness: new Float64Array(size), material: new Int16Array(size), point: [0, 0]
  };
  for (let i = 0; i < size; i++) {
    const x = (i % sim.nx + .5) / sim.nx, z = (Math.floor(i / sim.nx) + .5) / sim.nz;
    const p = materialPoint(sim, x, z, cache.point);
    const inside = p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= 1;
    cache.material[i] = inside ? sim.surfaceIndex(p[0], p[1]) : -1;
    const density = inside ? sample(sim, sim.pellicle, ...p) : 0;
    cache.density[i] = density < 1e-12 ? 0 : density;
    const disp = inside ? sample(sim, m.displacement, ...p) : sim.surface.displacement[i];
    cache.displacement[i] = Math.abs(disp) < 1e-12 ? 0 : disp;
    cache.stiffness[i] = inside ? sample(sim, m.layers[0], ...p) * .3 + sample(sim, m.layers[1], ...p) * .65 + sample(sim, m.layers[2], ...p) : 0;
  }
  return cache;
}

function stepRigidPose(sim, body, scratch, dt) {
  const { velocity, point } = scratch, arm = scratch.arm ||= [0, 0], pose = body.pose;
  let mass = 0, flowX = 0, flowZ = 0, torque = 0, inertia = 0;
  for (let z = 0; z < sim.nz; z++) for (let x = 0; x < sim.nx; x++) {
    const i = z * sim.nx + x, weight = sim.pellicle[i];
    if (weight < FILM_CUTOFF) continue;
    filmPoint(sim, (x + .5) / sim.nx, (z + .5) / sim.nz, point);
    sim.velocity(point[0], FILM_CUTOFF, velocity, point[1]);
    toDisc(point[0], point[1], arm);
    const rx = arm[0] - pose.x, rz = arm[1] - pose.z;
    mass += weight; flowX += velocity[0] * weight; flowZ += velocity[2] * weight;
    torque += (rx * (velocity[2] - pose.vz) - rz * (velocity[0] - pose.vx)) * weight;
    inertia += (rx * rx + rz * rz) * weight;
  }
  if (!(mass > 0)) return;
  const drag = -Math.expm1(-dt * 3);
  pose.vx += (flowX / mass * .55 - pose.vx) * drag;
  pose.vz += (flowZ / mass * .55 - pose.vz) * drag;
  pose.spin += (clamp(torque / Math.max(.001, inertia), -2, 2) - pose.spin) * drag;
  pose.x = clamp(pose.x + pose.vx * dt, -.35, .35);
  pose.z = clamp(pose.z + pose.vz * dt, -.35, .35);
  pose.angle = Math.atan2(Math.sin(pose.angle + pose.spin * dt), Math.cos(pose.angle + pose.spin * dt));
  // Resolve contact against the actual circular wall, without shrinking or
  // zeroing the entire body's motion whenever one corner reaches it.
  let wallX = 0, wallZ = 0, contacts = 0;
  for (let i = 0; i < sim.pellicle.length; i++) {
    if (sim.pellicle[i] < .06) continue;
    filmPoint(sim, (i % sim.nx + .5) / sim.nx, (Math.floor(i / sim.nx) + .5) / sim.nz, point);
    toDisc(point[0], point[1], point);
    const distance = Math.hypot(point[0], point[1]);
    if (distance <= .495) continue;
    const nx = point[0] / distance, nz = point[1] / distance, penetration = distance - .495;
    wallX += nx * penetration; wallZ += nz * penetration; contacts++;
    const outward = pose.vx * nx + pose.vz * nz;
    if (outward > 0) { pose.vx -= outward * nx; pose.vz -= outward * nz; pose.spin *= .98; }
  }
  // Resolve opposing contacts together; sequential corrections introduced
  // an ordering-dependent sideways drift even in a stationary full sheet.
  if (contacts) { pose.x -= wallX / contacts; pose.z -= wallZ / contacts; }
}

function addElasticForces(sim, body, stiffness, fx, fz) {
  fx.fill(0); fz.fill(0);
  const bond = (i, j, restX, restZ) => {
    if (Math.min(sim.pellicle[i], sim.pellicle[j]) < .004) return;
    const dx = restX + body.offsetX[j] - body.offsetX[i], dz = restZ + body.offsetZ[j] - body.offsetZ[i];
    const rest = Math.hypot(restX, restZ), distance = Math.hypot(dx, dz);
    const force = (distance - rest) / Math.max(1e-6, distance) * 150 * Math.min(stiffness[i], stiffness[j]);
    fx[i] += dx * force; fx[j] -= dx * force; fz[i] += dz * force; fz[j] -= dz * force;
  };
  for (let z = 0; z < sim.nz; z++) for (let x = 0; x < sim.nx; x++) {
    const i = z * sim.nx + x;
    if (x + 1 < sim.nx) bond(i, i + 1, 1 / sim.nx, 0);
    if (z + 1 < sim.nz) {
      bond(i, i + sim.nx, 0, 1 / sim.nz);
      if (x + 1 < sim.nx) {
        bond(i, i + sim.nx + 1, 1 / sim.nx, 1 / sim.nz);
        bond(i + 1, i + sim.nx, -1 / sim.nx, 1 / sim.nz);
      }
    }
  }
}

// Drag transfers horizontal current momentum to a separate elastic body.
// Pairwise stretch forces conserve internal momentum; a free sheet can drift
// and turn. A gently contracted rest metric gives it room to leave the wall.
export function stepFilmBody(sim, dt, stiffness) {
  const m = sim.membrane, body = m.body, size = sim.pellicle.length;
  const scratch = sim.filmBodyScratch ||= { fx: new Float64Array(size), fz: new Float64Array(size), velocity: [0, 0, 0], point: [0, 0] };
  const { fx, fz, velocity, point } = scratch;
  const pose = body.pose, c = Math.cos(pose.angle), s = Math.sin(pose.angle);
  stepRigidPose(sim, body, scratch, dt);
  addElasticForces(sim, body, stiffness, fx, fz);
  for (let z = 0; z < sim.nz; z++) for (let x = 0; x < sim.nx; x++) {
    const i = z * sim.nx + x;
    if (sim.pellicle[i] < .004) { body.velocityX[i] *= Math.exp(-dt * 8); body.velocityZ[i] *= Math.exp(-dt * 8); continue; }
    filmPoint(sim, (x + .5) / sim.nx, (z + .5) / sim.nz, point);
    const water = sample(sim, sim.surface.displacement, ...point);
    const gap = water - m.displacement[i];
    sim.velocity(point[0], clamp((m.displacement[i] - water) / (sim.volume - water), .02, .95), velocity, point[1]);
    const rx = velocity[0] - pose.vx, rz = velocity[2] - pose.vz;
    velocity[0] = rx * c + rz * s; velocity[2] = -rx * s + rz * c;
    const wet = Math.exp(-Math.max(0, gap) * 40);
    const attached = atRim(sim, i) && gap < .003 + .01 * stiffness[i] && Math.hypot(velocity[0], velocity[2]) < .2;
    const damping = Math.exp(-dt * (attached ? 28 : 5));
    body.velocityX[i] = clamp((body.velocityX[i] + (fx[i] + velocity[0] * 3 * wet - (attached ? body.offsetX[i] * stiffness[i] * 70 : 0)) * dt) * damping, -.35, .35);
    body.velocityZ[i] = sim.nz > 1 ? clamp((body.velocityZ[i] + (fz[i] + velocity[2] * 3 * wet - (attached ? body.offsetZ[i] * stiffness[i] * 70 : 0)) * dt) * damping, -.35, .35) : 0;
  }
  // Move all nodes together after evaluating forces from the same state.
  for (let z = 0; z < sim.nz; z++) for (let x = 0; x < sim.nx; x++) {
    const i = z * sim.nx + x, px = x === 0 ? 0 : x === sim.nx - 1 ? 1 : (x + .5) / sim.nx;
    const pz = z === 0 ? 0 : z === sim.nz - 1 ? 1 : (z + .5) / sim.nz;
    const dx = clamp(body.offsetX[i] + body.velocityX[i] * dt, Math.max(-.18, -px), Math.min(.18, 1 - px));
    const dz = clamp(body.offsetZ[i] + body.velocityZ[i] * dt, Math.max(-.18, -pz), Math.min(.18, 1 - pz));
    if (dx !== body.offsetX[i] + body.velocityX[i] * dt) body.velocityX[i] = 0;
    if (dz !== body.offsetZ[i] + body.velocityZ[i] * dt) body.velocityZ[i] = 0;
    body.offsetX[i] = dx; body.offsetZ[i] = dz;
  }
  // Keep the material map one-to-one. A bounded displacement gradient keeps
  // its inverse contractive, preventing overlapping/folded triangles and
  // ambiguous gas contact under sustained wall-directed currents.
  let gradient = .35;
  for (let z = 0; z < sim.nz; z++) for (let x = 0; x < sim.nx; x++) {
    const i = z * sim.nx + x;
    if (x + 1 < sim.nx) gradient = Math.max(gradient, Math.hypot(body.offsetX[i + 1] - body.offsetX[i], body.offsetZ[i + 1] - body.offsetZ[i]) * sim.nx);
    if (z + 1 < sim.nz) gradient = Math.max(gradient, Math.hypot(body.offsetX[i + sim.nx] - body.offsetX[i], body.offsetZ[i + sim.nx] - body.offsetZ[i]) * sim.nz);
  }
  if (gradient > .35) {
    const scale = .35 / gradient;
    for (let i = 0; i < size; i++) {
      body.offsetX[i] *= scale; body.offsetZ[i] *= scale;
      body.velocityX[i] *= scale; body.velocityZ[i] *= scale;
    }
  }
}
