// Restore small swirls lost to coarse-grid velocity advection. Confinement
// acts normal to |curl| gradients; it has no source in a uniform curl field.
// The full 3D N cross curl force is projected through the closed-wall solve.
export function confineVolumeVorticity(sim, velocity, dt) {
  const { nx, ny, nz, n } = sim, plane = nx * ny;
  const b = sim.vorticityBuffers ||= {
    x: new Float64Array(n), y: new Float64Array(n), z: new Float64Array(n), magnitude: new Float64Array(n)
  };
  const { vx, vy, vz } = velocity;
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const i = z * plane + y * nx + x;
    const l = x ? i - 1 : i, r = x + 1 < nx ? i + 1 : i;
    const u = y ? i - nx : i, d = y + 1 < ny ? i + nx : i;
    const a = z ? i - plane : i, c = z + 1 < nz ? i + plane : i;
    b.x[i] = (vz[d] - vz[u]) * ny * .5 - (vy[c] - vy[a]) * nz * .5;
    b.y[i] = (vx[c] - vx[a]) * nz * .5 - (vz[r] - vz[l]) * nx * .5;
    b.z[i] = (vy[r] - vy[l]) * nx * .5 - (vx[d] - vx[u]) * ny * .5;
    b.magnitude[i] = Math.hypot(b.x[i], b.y[i], b.z[i]);
  }
  const strength = dt * 1.35 / Math.max(nx, ny, nz), m = b.magnitude;
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const i = z * plane + y * nx + x;
    const gx = (m[x + 1 < nx ? i + 1 : i] - m[x ? i - 1 : i]) * nx;
    const gy = (m[y + 1 < ny ? i + nx : i] - m[y ? i - nx : i]) * ny;
    const gz = (m[z + 1 < nz ? i + plane : i] - m[z ? i - plane : i]) * nz;
    const length = Math.hypot(gx, gy, gz);
    if (length < 1e-9) continue;
    vx[i] += strength * (gy * b.z[i] - gz * b.y[i]) / length;
    vy[i] += strength * (gz * b.x[i] - gx * b.z[i]) / length;
    vz[i] += strength * (gx * b.y[i] - gy * b.x[i]) / length;
  }
}
