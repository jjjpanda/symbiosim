import { MIN_VOLUME, clamp } from './constants.js';
import { toDisc } from './domain.js';

const restPoint = [0, 0];
export const createVessel = () => ({ tilt: 0, aspect: .75 });

// Keep the free plane clear of the bottom and rim. This model supports gentle
// tipping, not overturning or rim overflow; high fills allow less tilt.
export function vesselTilt(sim) {
  const { tilt, aspect } = sim.vessel;
  const clearance = Math.max(0, Math.min(sim.volume - MIN_VOLUME, .98 - sim.volume) - .025);
  const limit = Math.min(12 * Math.PI / 180, Math.atan(2 * clearance / aspect));
  return clamp(tilt * Math.PI / 180, -limit, limit);
}

export function surfaceRest(sim, x, z = .5) {
  // Positive displacement points downward in jar coordinates.
  return -Math.tan(vesselTilt(sim)) * toDisc(x, z, restPoint)[0] * sim.vessel.aspect;
}
