// Interleaved vertices: position, normal, RGB, opacity, material, UV.
export const STRIDE = 13;
const ZERO_UV = [0, 0], normalScratch = [0, 0, 0];
export class Geometry {
  constructor(capacity = 50000) { this.vertices = new Float32Array(capacity * STRIDE); this.count = 0; }
  vertex(p, n, color, alpha = 1, material = 0, uv = ZERO_UV) {
    const i = this.count++ * STRIDE;
    if (i + STRIDE > this.vertices.length)
      throw new RangeError('Scene geometry capacity exceeded');
    this.vertices.set(p, i);
    this.vertices.set(n, i + 3);
    this.vertices.set(color, i + 6);
    this.vertices[i + 9] = alpha;
    this.vertices[i + 10] = material;
    this.vertices[i + 11] = uv[0];
    this.vertices[i + 12] = uv[1];
  }
  triangle(a, b, c, color, alpha = 1, material = 0, uvA, uvB, uvC) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) || 1;
    normalScratch[0] = nx / length;
    normalScratch[1] = ny / length;
    normalScratch[2] = nz / length;
    this.vertex(a, normalScratch, color, alpha, material, uvA);
    this.vertex(b, normalScratch, color, alpha, material, uvB);
    this.vertex(c, normalScratch, color, alpha, material, uvC);
  }
  // Revolved cross sections give the jar an inner wall, curved shoulder,
  // rolled mouth and heavy glass foot, rather than a projected outline.
  lathe(profile, color, alpha = 1, material = 0, segments = 72) {
    const p = [0, 0, 0], q = [0, 0, 0], r = [0, 0, 0], s = [0, 0, 0], na = [0, 0, 0], nb = [0, 0, 0];
    for (let row = 0; row < profile.length - 1; row++)
      for (let col = 0; col < segments; col++) {
        const a = col / segments * Math.PI * 2, b = (col + 1) / segments * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
        const r0 = profile[row][0], y0 = profile[row][1], r1 = profile[row + 1][0], y1 = profile[row + 1][1];
        p[0] = ca * r0; p[1] = y0; p[2] = sa * r0;
        q[0] = cb * r0; q[1] = y0; q[2] = sb * r0;
        r[0] = cb * r1; r[1] = y1; r[2] = sb * r1;
        s[0] = ca * r1; s[1] = y1; s[2] = sa * r1;
        const slope = y1 - y0, radial = r0 - r1, length = Math.hypot(slope, radial) || 1;
        na[0] = ca * slope / length; na[1] = radial / length; na[2] = sa * slope / length;
        nb[0] = cb * slope / length; nb[1] = radial / length; nb[2] = sb * slope / length;
        this.vertex(p, na, color, alpha, material);
        this.vertex(r, nb, color, alpha, material);
        this.vertex(q, nb, color, alpha, material);
        this.vertex(p, na, color, alpha, material);
        this.vertex(s, na, color, alpha, material);
        this.vertex(r, nb, color, alpha, material);
      }
  }
  tube(points, radii, color, material = 0, sides = 8, alpha = 1) {
    const axis = [0, 0, 0], u = [0, 0, 0], v = [0, 0, 0];
    const p = [0, 0, 0], q = [0, 0, 0], r = [0, 0, 0], s = [0, 0, 0], na = [0, 0, 0], nb = [0, 0, 0];
    const ring = (center, radius, ca, sa, out) => {
      for (let j = 0; j < 3; j++)
        out[j] = center[j] + radius * (u[j] * ca + v[j] * sa);
    };
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      axis[0] = b[0] - a[0]; axis[1] = b[1] - a[1]; axis[2] = b[2] - a[2];
      const length = Math.hypot(axis[0], axis[1], axis[2]) || 1;
      for (let j = 0; j < 3; j++)
        axis[j] /= length;
      if (Math.abs(axis[1]) < .9) {
        u[0] = -axis[2]; u[1] = 0; u[2] = axis[0];
      }
      else {
        u[0] = 0; u[1] = axis[2]; u[2] = -axis[1];
      }
      const ul = Math.hypot(u[0], u[1], u[2]) || 1;
      for (let j = 0; j < 3; j++)
        u[j] /= ul;
      v[0] = axis[1] * u[2] - axis[2] * u[1];
      v[1] = axis[2] * u[0] - axis[0] * u[2];
      v[2] = axis[0] * u[1] - axis[1] * u[0];
      const slope = (radii[i] - radii[i + 1]) / length, scale = Math.hypot(1, slope);
      for (let k = 0; k < sides; k++) {
        const aa = k / sides * Math.PI * 2, bb = (k + 1) / sides * Math.PI * 2;
        const ca = Math.cos(aa), sa = Math.sin(aa), cb = Math.cos(bb), sb = Math.sin(bb);
        ring(a, radii[i], ca, sa, p);
        ring(a, radii[i], cb, sb, q);
        ring(b, radii[i + 1], cb, sb, r);
        ring(b, radii[i + 1], ca, sa, s);
        for (let j = 0; j < 3; j++) {
          na[j] = (u[j] * ca + v[j] * sa + axis[j] * slope) / scale;
          nb[j] = (u[j] * cb + v[j] * sb + axis[j] * slope) / scale;
        }
        this.vertex(p, na, color, alpha, material);
        this.vertex(q, nb, color, alpha, material);
        this.vertex(r, nb, color, alpha, material);
        this.vertex(p, na, color, alpha, material);
        this.vertex(r, nb, color, alpha, material);
        this.vertex(s, na, color, alpha, material);
      }
    }
  }
}
