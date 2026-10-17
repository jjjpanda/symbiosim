// Conservative MUSCL transport. A shared compact face plan amortizes indexing
// and Courant calculations across eight dissolved species and temperature.
const slope = (a, b) => a * b > 0 ? (a > 0 ? Math.min(a, b) : Math.max(a, b)) : 0;

export function prepareTransport(sim, faces, dt) {
  const { nx, ny, nz } = sim, plane = nx * ny;
  let plan = sim.transportPlan;
  if (!plan) {
    const count = (nx - 1) * ny * nz + nx * (ny - 1) * nz + nx * ny * (nz - 1);
    plan = sim.transportPlan = {
      // Maximum supported grid is 64*64*12; all offsets fit in 16 bits.
      from: new Uint16Array(count), to: new Uint16Array(count), before: new Uint16Array(count), after: new Uint16Array(count),
      face: new Uint16Array(count), axis: new Uint8Array(count), courant: new Float64Array(count), correction: new Float64Array(count)
    };
    let edge = 0;
    const add = (i, j, before, after, face, axis) => {
      plan.from[edge] = i; plan.to[edge] = j; plan.before[edge] = before; plan.after[edge] = after;
      plan.face[edge] = face; plan.axis[edge++] = axis;
    };
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const i = z * plane + y * nx + x;
      if (x + 1 < nx) add(i, i + 1, x ? i - 1 : i, x + 2 < nx ? i + 2 : i + 1, (z * ny + y) * (nx + 1) + x + 1, 0);
      if (y + 1 < ny) add(i, i + nx, y ? i - nx : i, y + 2 < ny ? i + 2 * nx : i + nx, (z * (ny + 1) + y + 1) * nx + x, 1);
      if (z + 1 < nz) add(i, i + plane, z ? i - plane : i, z + 2 < nz ? i + 2 * plane : i + plane, i + plane, 2);
    }
  }
  const { axis, face, courant, correction } = plan;
  for (let e = 0; e < courant.length; e++) {
    const value = dt * (axis[e] === 0 ? faces.fx[face[e]] * nx : axis[e] === 1 ? faces.fy[face[e]] * ny : faces.fz[face[e]] * nz);
    courant[e] = value; correction[e] = .5 * (1 - Math.abs(value));
  }
  return plan;
}

export function transportScalar(source, target, plan, diffusion) {
  const { from, to, before, after, courant, correction } = plan;
  target.set(source);
  for (let e = 0; e < from.length; e++) {
    const i = from[e], j = to[e], left = source[i], right = source[j], speed = courant[e];
    // The multidimensional CFL limit reserves enough donor inventory for all
    // outgoing faces, including reconstruction and explicit diffusion.
    const face = speed >= 0
      ? left + correction[e] * slope(left - source[before[e]], right - left)
      : right - correction[e] * slope(right - left, source[after[e]] - right);
    const flux = speed * face + diffusion * (left - right);
    target[i] -= flux; target[j] += flux;
  }
  for (let i = 0; i < source.length; i++) source[i] = target[i];
}
