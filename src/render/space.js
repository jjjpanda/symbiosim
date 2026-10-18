import { JAR_HEIGHT, LIQUID_RADIUS } from '../sim/constants.js';
import { toDisc, fromDisc } from '../sim/domain.js';
import { sampleSurface } from '../sim/spatial.js';
// One world space for every visible object: radius .5, bottom 0, mouth 4/3.
export const HEIGHT = JAR_HEIGHT;
const discPoint = [0, 0];
// Shared with the jar mesh: the inner wall narrows at the foot and shoulder.
export const INNER_WALL = [[.474,.046],[.490,.072],[.480,1.23],[.449,1.285],[.449,1.332]];
export function interiorRadius(height) {
  for(let i=1;i<INNER_WALL.length;i++) {
    const [r0,y0]=INNER_WALL[i-1],[r1,y1]=INNER_WALL[i];
    if(height<=y1) return r0+(r1-r0)*Math.max(0,(height-y0)/(y1-y0));
  }
  return INNER_WALL.at(-1)[0];
}
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
// Visual offsets and extrapolated trails need their own bounds: the solver's
// bounded material coordinates do not contain those renderer-only excursions.
export function containInLiquid(sim, point, margin = .012, out = point) {
  out[0]=point[0]; out[1]=point[1]; out[2]=point[2];
  for(let pass=0;pass<2;pass++) {
    const uv=discToMaterial(out[0],out[2],discPoint);
    const water=(sim.volume-sampleSurface(sim,sim.surface.displacement,uv[0],uv[1]))*HEIGHT;
    out[1]=Math.max(.046+margin,Math.min(water-margin,out[1]));
    const radius=Math.max(.01,Math.min(interiorRadius(out[1]-margin),interiorRadius(out[1]+margin))-margin);
    const distance=Math.hypot(out[0],out[2]);
    if(distance>radius) { out[0]*=radius/distance; out[2]*=radius/distance; }
  }
  return out;
}
export function cameraMatrix(width, height, orbit = {}, tilt = 0) {
  const pose = typeof tilt === 'number' ? { angle: tilt, x: 1, z: 0 } : tilt;
  const c = Math.cos(pose.angle), s = Math.sin(pose.angle);
  const yaw = (orbit.yaw || 0) * Math.PI / 180, elevation = (orbit.elevation || 24) * Math.PI / 180;
  const zoom = Math.max(1, Math.min(3, orbit.zoom || 1));
  // Ease the aim from the overview into the lower third as the view magnifies.
  const focus = (zoom - 1) / 2;
  const distance = 3.1 * Math.max(1, height / width * .78) * (1 + .45 * Math.abs(s)), target = .72 + (HEIGHT * .29 - .72) * focus;
  const eye = [Math.sin(yaw) * Math.cos(elevation) * distance, target + Math.sin(elevation) * distance, Math.cos(yaw) * Math.cos(elevation) * distance];
  const z = [eye[0], eye[1] - target, eye[2]].map(v => v / distance);
  const x = [Math.cos(yaw), 0, -Math.sin(yaw)], y = [z[1] * x[2], z[2] * x[0] - z[0] * x[2], -z[1] * x[0]];
  const f = zoom / Math.tan(34 * Math.PI / 360), aspect = width / height, near = .05, far = 20;
  const project = (p, out = [0, 0, 0]) => {
    const along = p[0] * pose.x + p[2] * pose.z, up = p[1] - HEIGHT / 2;
    const offset = along * (c - 1) + up * s;
    const px = p[0] + pose.x * offset, pz = p[2] + pose.z * offset;
    const py = -along * s + up * c + HEIGHT / 2;
    const dx = px - eye[0], dy = py - eye[1], dz = pz - eye[2];
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
