// Exact Neumann pressure projection on the closed volume. A separable cosine
// basis diagonalizes the finite-volume Laplacian, including boundary rows.
// Fixed scratch storage avoids iterative tolerances and mass drift.
function basis(size) {
  const forward = new Float64Array(size * size), inverse = new Float64Array(size * size);
  for (let k = 0; k < size; k++) for (let x = 0; x < size; x++) {
    const value = Math.sqrt((k ? 2 : 1) / size) * Math.cos(Math.PI * (x + .5) * k / size);
    forward[k * size + x] = inverse[x * size + k] = value;
  }
  return { forward, inverse };
}

function transform(source, target, matrix, size, stride, length) {
  if (stride === 1) {
    for (let block = 0; block < length; block += size) {
      for (let k = 0; k < size; k++) {
        let sum = 0;
        const row = k * size;
        for (let j = 0; j < size; j++) sum += source[block + j] * matrix[row + j];
        target[block + k] = sum;
      }
    }
    return;
  }
  for (let block = 0; block < length; block += size * stride) for (let offset = 0; offset < stride; offset++) {
    const start = block + offset;
    for (let k = 0; k < size; k++) {
      let sum = 0;
      const row = k * size;
      for (let j = 0; j < size; j++) sum += source[start + j * stride] * matrix[row + j];
      target[start + k * stride] = sum;
    }
  }
}

export function projectPressure(sim, faces) {
  const { nx, ny, nz, n } = sim, plane = nx * ny;
  const b = sim.pressureBuffers ||= {
    a: new Float64Array(n), b: new Float64Array(n),
    axes: [basis(nx), basis(ny), basis(nz)], eigen: new Float64Array(n)
  };
  if (!b.ready) {
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const eigen = 4 * ((nx * Math.sin(Math.PI * x / (2 * nx))) ** 2
        + (ny * Math.sin(Math.PI * y / (2 * ny))) ** 2 + (nz * Math.sin(Math.PI * z / (2 * nz))) ** 2);
      b.eigen[z * plane + y * nx + x] = eigen ? -1 / eigen : 0;
    }
    b.ready = true;
  }
  const { fx, fy, fz } = faces;
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const i = z * plane + y * nx + x, a = (z * ny + y) * (nx + 1) + x, c = (z * (ny + 1) + y) * nx + x;
    b.a[i] = (fx[a + 1] - fx[a]) * nx + (fy[c + nx] - fy[c]) * ny + (fz[i + plane] - fz[i]) * nz;
  }
  transform(b.a, b.b, b.axes[0].forward, nx, 1, n);
  transform(b.b, b.a, b.axes[1].forward, ny, nx, n);
  transform(b.a, b.b, b.axes[2].forward, nz, plane, n);
  for (let i = 0; i < n; i++) b.b[i] *= b.eigen[i];
  transform(b.b, b.a, b.axes[2].inverse, nz, plane, n);
  transform(b.a, b.b, b.axes[1].inverse, ny, nx, n);
  transform(b.b, b.a, b.axes[0].inverse, nx, 1, n);
  const p = b.a;
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const i = z * plane + y * nx + x;
    if (x + 1 < nx) fx[(z * ny + y) * (nx + 1) + x + 1] -= (p[i + 1] - p[i]) * nx;
    if (y + 1 < ny) fy[(z * (ny + 1) + y + 1) * nx + x] -= (p[i + nx] - p[i]) * ny;
    if (z + 1 < nz) fz[i + plane] -= (p[i + plane] - p[i]) * nz;
  }
}
