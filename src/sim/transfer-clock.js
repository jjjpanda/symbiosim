import { TRANSFER_DAYS, JAR_HEIGHT, LIQUID_RADIUS } from './constants.js';
export { JAR_HEIGHT } from './constants.js';

export const GRAVITY = 98.1; // A world unit represents ten centimetres.
export const OUTLET_RADIUS = .04;
export const SPOUT = [-.66, .11, 0];
export const VESSEL_CAPACITY = Math.PI * LIQUID_RADIUS ** 2 * JAR_HEIGHT;

export const outletHead = volume => Math.max(.02, volume * JAR_HEIGHT - SPOUT[1]);
export const outletSpeed = volume => .65 * Math.sqrt(2 * GRAVITY * outletHead(volume));

// Compress the displayed event while retaining differences in amount/head.
// This clock controls playback, independently of biological pace and jet speed.
export function transferDuration(sim, transfer = sim.care.transfer) {
  if (!transfer) return 0;
  if (transfer.phase === 'pour') return 1.2 + transfer.total * 2.2;
  const start = sim.volume + transfer.total - transfer.remaining, end = start - transfer.total;
  const jarArea = Math.PI * LIQUID_RADIUS ** 2, outletArea = Math.PI * OUTLET_RADIUS ** 2;
  const seconds = 2 * jarArea * (Math.sqrt(outletHead(start)) - Math.sqrt(outletHead(end))) / (.65 * outletArea * Math.sqrt(2 * GRAVITY));
  return Math.min(2.8, .65 + seconds * .13);
}

export function exchangeSpeed(sim) {
  return TRANSFER_DAYS * 60 / transferDuration(sim);
}

// A brief loading ramp excites the sheet's own inertia; unloading leaves it
// free to rebound. No random forcing or cellulose inventory changes.
export function pourImpact(sim) {
  const t = sim.care.transfer;
  if (t?.phase !== 'pour' || !(t.total > 0)) return 0;
  const progress = 1 - t.remaining / t.total;
  const gate = Math.min(1, (progress + .025) / .12, (1 - progress) / .08);
  return Math.min(2.4, Math.sqrt(t.total / .08)) * Math.max(0, gate);
}
