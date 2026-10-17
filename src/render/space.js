import { JAR_HEIGHT, LIQUID_RADIUS } from '../sim/constants.js';
import { toDisc, fromDisc } from '../sim/domain.js';
import { sampleSurface } from '../sim/spatial.js';
// One world space for every visible object: radius .5, bottom 0, mouth 4/3.
export const HEIGHT = JAR_HEIGHT;
const discPoint = [0, 0];
export function liquidPosition(sim, x, y, z, out = [0, 0, 0]) {
  toDisc(x, z, discPoint, LIQUID_RADIUS);
  out[0] = discPoint[0];
  out[2] = discPoint[1];
  const water = (sim.volume - sampleSurface(sim, sim.surface.displacement, x, z)) * HEIGHT;
  out[1] = water * (1 - y);
  return out;
}
export function discToMaterial(x, z, out = [0, 0]) {
  return fromDisc(x, z, out, LIQUID_RADIUS);
}
export function cameraMatrix(width, height, orbit = {}, tilt = 0) {
  const yaw = (orbit.yaw || 0) * Math.PI / 180, elevation = (orbit.elevation || 24) * Math.PI / 180;
  const distance = 3.1 * Math.max(1, height / width * .78) * (1 + .45 * Math.abs(Math.sin(tilt))), target = .72;
  const eye = [Math.sin(yaw) * Math.cos(elevation) * distance, target + Math.sin(elevation) * distance, Math.cos(yaw) * Math.cos(elevation) * distance];
  const z = [eye[0], eye[1] - target, eye[2]].map(v => v / distance);
  const x = [Math.cos(yaw), 0, -Math.sin(yaw)], y = [z[1] * x[2], z[2] * x[0] - z[0] * x[2], -z[1] * x[0]];
  const f = 1 / Math.tan(34 * Math.PI / 360), aspect = width / height, near = .05, far = 20;
  const project = (p, out = [0, 0, 0]) => {
    const c = Math.cos(tilt), s = Math.sin(tilt), px = p[0] * c + (p[1] - HEIGHT / 2) * s;
    const py = -p[0] * s + (p[1] - HEIGHT / 2) * c + HEIGHT / 2;
    const dx = px - eye[0], dy = py - eye[1], dz = p[2] - eye[2];
    const depth = -(dx * z[0] + dy * z[1] + dz * z[2]);
    out[0] = (1 + f / aspect * (dx * x[0] + dy * x[1] + dz * x[2]) / depth) * width / 2;
    out[1] = (1 - f * (dx * y[0] + dy * y[1] + dz * y[2]) / depth) * height / 2;
    out[2] = depth;
    return out;
  };
  const view = new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
  const projection = new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0]);
  return { matrix: multiply(projection, view), eye, project };
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function multiply(a, b) {
  const m = new Float32Array(16);
  for (let col = 0; col < 4; col++)
    for (let row = 0; row < 4; row++)
      for (let k = 0; k < 4; k++)
        m[col * 4 + row] += a[k * 4 + row] * b[col * 4 + k];
  return m;
}
