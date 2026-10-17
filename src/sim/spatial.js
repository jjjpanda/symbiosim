import { clamp, mix } from './constants.js';

export function sampleSurface(sim, field, x, z) {
  const gx = clamp(x * sim.nx - .5, 0, sim.nx - 1), gz = clamp(z * sim.nz - .5, 0, sim.nz - 1);
  const ix = Math.floor(gx), iz = Math.floor(gz), jx = Math.min(ix + 1, sim.nx - 1), jz = Math.min(iz + 1, sim.nz - 1);
  return mix(mix(field[iz * sim.nx + ix], field[iz * sim.nx + jx], gx - ix), mix(field[jz * sim.nx + ix], field[jz * sim.nx + jx], gx - ix), gz - iz);
}

// Layout: x varies fastest, then height, then depth. Surface arrays use x,z.
export function sampleVolume(sim, field, x, y, z = .5) {
  const gx = clamp(x * sim.nx - .5, 0, sim.nx - 1);
  const gy = clamp(y * sim.ny - .5, 0, sim.ny - 1);
  const gz = clamp(z * sim.nz - .5, 0, sim.nz - 1);
  const ix = Math.floor(gx), iy = Math.floor(gy), iz = Math.floor(gz);
  const jx = Math.min(ix + 1, sim.nx - 1), jy = Math.min(iy + 1, sim.ny - 1), jz = Math.min(iz + 1, sim.nz - 1);
  const plane = sim.nx * sim.ny;
  const a = iz * plane + iy * sim.nx, b = iz * plane + jy * sim.nx;
  const c = jz * plane + iy * sim.nx, d = jz * plane + jy * sim.nx;
  return mix(mix(mix(field[a + ix], field[a + jx], gx - ix), mix(field[b + ix], field[b + jx], gx - ix), gy - iy),
    mix(mix(field[c + ix], field[c + jx], gx - ix), mix(field[d + ix], field[d + jx], gx - ix), gy - iy), gz - iz);
}

export function surfaceIndex(sim, x, z = .5) {
  return clamp(Math.floor(z * sim.nz), 0, sim.nz - 1) * sim.nx + clamp(Math.floor(x * sim.nx), 0, sim.nx - 1);
}

export function atRim(sim, i) {
  const x = i % sim.nx, z = Math.floor(i / sim.nx);
  return x === 0 || x === sim.nx - 1 || (sim.nz > 1 && (z === 0 || z === sim.nz - 1));
}

// Agents, bubbles and field particles all sample the same vector lattice.
// Share the interpolation coordinates instead of finding eight corners three
// times per sample; the caller owns the output, keeping this allocation-free.
export function sampleVelocity(sim, x, y, z, out) {
  const gx = clamp(x * sim.nx - .5, 0, sim.nx - 1);
  const gy = clamp(y * sim.ny - .5, 0, sim.ny - 1);
  const gz = clamp(z * sim.nz - .5, 0, sim.nz - 1);
  const ix = Math.floor(gx), iy = Math.floor(gy), iz = Math.floor(gz);
  const jx = Math.min(ix + 1, sim.nx - 1), jy = Math.min(iy + 1, sim.ny - 1), jz = Math.min(iz + 1, sim.nz - 1);
  const tx = gx - ix, ty = gy - iy, tz = gz - iz, plane = sim.nx * sim.ny;
  const a = iz * plane + iy * sim.nx, b = iz * plane + jy * sim.nx;
  const c = jz * plane + iy * sim.nx, d = jz * plane + jy * sim.nx;
  for (let axis = 0; axis < 3; axis++) {
    const f = axis === 0 ? sim.vx : axis === 1 ? sim.vy : sim.vz;
    out[axis] = mix(mix(mix(f[a + ix], f[a + jx], tx), mix(f[b + ix], f[b + jx], tx), ty),
      mix(mix(f[c + ix], f[c + jx], tx), mix(f[d + ix], f[d + jx], tx), ty), tz);
  }
  return out;
}
