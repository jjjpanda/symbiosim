import { MIN_VOLUME } from './constants.js';
import { toDisc } from './domain.js';

const restPoint = [0, 0];
export const createVessel = () => ({ tilt: 0, tiltZ: 0, aspect: .75 });

// Keep the free plane clear of the bottom and rim. This model supports gentle
// tipping, not overturning or rim overflow; high fills allow less tilt.
export function vesselTilt(sim) {
  const { tilt, tiltZ = 0, aspect } = sim.vessel;
  const clearance = Math.max(0, Math.min(sim.volume - MIN_VOLUME, .98 - sim.volume) - .025);
  const limit = Math.min(12 * Math.PI / 180, Math.atan(2 * clearance / aspect));
  return Math.min(Math.hypot(tilt, tiltZ) * Math.PI / 180, limit) * (tilt < 0 ? -1 : 1);
}

export function vesselOrientation(sim) {
  const { tilt, tiltZ = 0 } = sim.vessel, length = Math.hypot(tilt, tiltZ);
  return { angle: Math.abs(vesselTilt(sim)), x: length ? tilt / length : 1, z: length ? tiltZ / length : 0 };
}

export function vesselGravity(sim) {
  const { angle, x, z } = vesselOrientation(sim), s = Math.sin(angle);
  return [x * s, Math.cos(angle), z * s];
}

export function surfaceRest(sim, x, z = .5) {
  // Positive displacement points downward in jar coordinates.
  const pose = vesselOrientation(sim), point = toDisc(x, z, restPoint);
  return -Math.tan(pose.angle) * (point[0] * pose.x + point[1] * pose.z) * sim.vessel.aspect;
}
