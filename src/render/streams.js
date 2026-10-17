import { GRAVITY, OUTLET_RADIUS, VESSEL_CAPACITY, transferDuration, outletSpeed, SPOUT } from '../sim/transfer-clock.js';
import { FILM_CUTOFF, clamp } from '../sim/constants.js';
import { INLET, INLET_DEPTH } from '../sim/exchange.js';
import { vesselTilt } from '../sim/vessel.js';
import { HEIGHT, liquidPosition } from './space.js';
import { sampleFilm } from '../sim/film-body.js';
import { teaColor } from './objects.js';
export { SPOUT } from '../sim/transfer-clock.js';
const smooth = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
const STREAM_POINTS = Array.from({ length: 33 }, () => [0, 0, 0]);
const STREAM_RADII = new Float64Array(33);
const GLOBULE_POINTS = Array.from({ length: 7 }, () => [0, 0, 0]);
const GLOBULE_RADII = new Float64Array(7);
const sampleScratch = {}, sprayPoint = [0, 0, 0], streamColor = [0, 0, 0], dropColor = [0, 0, 0];
export function streamState(sim) {
  const transfer = sim.care.transfer;
  if (!transfer)
    return null;
  const duration = transferDuration(sim), progress = 1 - transfer.remaining / transfer.total, time = progress * duration;
  const gate = smooth(time / .16) * smooth((duration - time) / .2);
  const tilt = vesselTilt(sim), gravity = [Math.sin(tilt) * GRAVITY, -Math.cos(tilt) * GRAVITY, 0];
  const impact = liquidPosition(sim, INLET, 0, INLET_DEPTH);
  const film = sampleFilm(sim, sim.pellicle, INLET, INLET_DEPTH);
  if (film > FILM_CUTOFF) {
    const height = (sim.volume - sampleFilm(sim, sim.membrane.displacement, INLET, INLET_DEPTH)) * HEIGHT + .004 + film * .009;
    impact[1] = Math.max(impact[1], height);
  }
  const pour = transfer.phase === 'pour';
  const origin = pour ? [impact[0] - .18, HEIGHT + .18, impact[2] - .06] : [...SPOUT];
  let velocity, flight;
  if (pour) {
    const speed = 8;
    flight = (Math.sqrt(speed * speed + 2 * -gravity[1] * (origin[1] - impact[1])) - speed) / -gravity[1];
    velocity = [(impact[0] - origin[0] - gravity[0] * flight * flight / 2) / flight, -speed, (impact[2] - origin[2]) / flight];
  }
  else {
    const speed = outletSpeed(sim.volume);
    velocity = [0, -speed, 0];
    flight = .18;
  }
  const speed = Math.hypot(...velocity);
  const flow = pour ? transfer.total * VESSEL_CAPACITY / duration * gate
    : Math.PI * OUTLET_RADIUS ** 2 * speed * gate;
  const radius = Math.sqrt(flow / (Math.PI * speed));
  const breakup = pour ? flight : Math.min(.075, .022 + radius * .85);
  return { origin, velocity, gravity, flow, radius, flight, breakup, time, impact, pour, gate,
    temperature: transfer.recipe.temperature, ph: pour ? 4.6 : sim.ph() };
}
export function sampleStream(state, age, out = {}) {
  const { origin, velocity, gravity, time } = state;
  const speed = Math.hypot(velocity[0] + gravity[0] * age, velocity[1] + gravity[1] * age, velocity[2]);
  const emitted = time - age;
  // Nozzle vena contracta and two-harmonic Plateau-Rayleigh capillary waves
  // grow into varicose necks near breakup without wagging the stream axis.
  const phase = emitted * Math.PI * 2 / .031;
  const harmonic = .78 * Math.sin(phase) + .22 * Math.sin(2 * phase - .6);
  const neck = state.pour ? .032 * (1 + .8 * (age / Math.max(.01, state.flight))) : .42 * Math.min(1, (age / state.breakup) ** 1.85);
  const collar = state.pour ? 1 : 1 + .16 * Math.exp(-age / .004);
  const pinch = !state.pour && age <= state.breakup
    ? 1 - .38 * clamp((age - state.breakup * .78) / (state.breakup * .22), 0, 1) ** 2
    : 1;
  const ripple = Math.max(.18, (1 + neck * harmonic) * collar * pinch);
  out.x = origin[0] + velocity[0] * age + gravity[0] * age * age / 2;
  out.y = origin[1] + velocity[1] * age + gravity[1] * age * age / 2;
  out.z = origin[2] + velocity[2] * age;
  out.radius = Math.sqrt(state.flow / (Math.PI * speed)) * ripple;
  out.speed = speed;
  return out;
}
export function buildStreams(geometry, sim, addPoint) {
  const state = streamState(sim);
  if (!state || state.gate < .005)
    return state;
  const heat = clamp((state.temperature - 24) / 35, -1, 1);
  teaColor(state.ph ?? sim.ph(), heat, 'liquid', streamColor);
  dropColor[0] = Math.min(1, streamColor[0] * 1.25 + .12);
  dropColor[1] = Math.min(1, streamColor[1] * 1.25 + .10);
  dropColor[2] = Math.min(1, streamColor[2] * 1.2 + .06);
  const end = Math.min(state.pour ? state.flight : state.breakup, state.time);
  for (let i = 0; i <= 32; i++) {
    sampleStream(state, end * i / 32, sampleScratch);
    const point = STREAM_POINTS[i];
    point[0] = sampleScratch.x;
    point[1] = sampleScratch.y;
    point[2] = sampleScratch.z;
    STREAM_RADII[i] = sampleScratch.radius;
  }
  geometry.tube(STREAM_POINTS, STREAM_RADII, streamColor, 5, 14, .78);
  if (!state.pour) {
    const period = .029, dropVolume = state.flow * period, radius = Math.cbrt(dropVolume * 3 / (4 * Math.PI));
    // First three detaching parcels render as 3D pinched liquid globules
    // before transitioning into primary and satellite drops.
    for (let g = 0; g < 3; g++) {
      const centerAge = state.breakup + ((state.time % period) + g * period) * .65;
      if (centerAge > state.time || centerAge > .15)
        continue;
      const span = .0045, aspect = 1 + .28 * Math.cos((centerAge - state.breakup) * 180 + g);
      for (let k = 0; k <= 6; k++) {
        const u = k / 6 * 2 - 1;
        sampleStream(state, Math.max(0, centerAge + u * span), sampleScratch);
        GLOBULE_POINTS[k][0] = sampleScratch.x;
        GLOBULE_POINTS[k][1] = sampleScratch.y;
        GLOBULE_POINTS[k][2] = sampleScratch.z;
        GLOBULE_RADII[k] = radius * 1.05 * Math.sqrt(Math.max(.04, 1 - u * u)) / Math.sqrt(aspect);
      }
      geometry.tube(GLOBULE_POINTS, GLOBULE_RADII, streamColor, 5, 10, .82);
    }
    for (let i = 0; i < 16; i++) {
      const age = state.breakup + ((state.time % period) + i * period);
      if (age > state.time || age > .24)
        continue;
      sampleStream(state, age, sampleScratch);
      const wobble = (age - state.breakup) * .045;
      sprayPoint[0] = sampleScratch.x + Math.cos(i * 2.4 + state.time * 18) * wobble;
      sprayPoint[1] = sampleScratch.y;
      sprayPoint[2] = sampleScratch.z + Math.sin(i * 2.4 + state.time * 18) * wobble;
      addPoint(sprayPoint, dropColor, .92, Math.max(4.5, radius * 720), 1);
      // Plateau-Rayleigh ligament pinch-off produces a smaller satellite drop between primary drops.
      const satAge = age + period * .46;
      if (satAge <= state.time && satAge <= .24) {
        sampleStream(state, satAge, sampleScratch);
        sprayPoint[0] = sampleScratch.x - Math.sin(i * 1.7) * wobble * .6;
        sprayPoint[1] = sampleScratch.y;
        sprayPoint[2] = sampleScratch.z + Math.cos(i * 1.7) * wobble * .6;
        addPoint(sprayPoint, dropColor, .82, Math.max(2.6, radius * 410), 1);
      }
    }
  }
  else {
    // Plunging meniscus collar and 3D crown splash at the inlet impact patch.
    if (state.time >= state.flight) {
      sampleStream(state, state.flight, sampleScratch);
      const baseR = sampleScratch.radius;
      for (let k = 0; k <= 6; k++) {
        const t = k / 6;
        GLOBULE_POINTS[k][0] = state.impact[0] * t + sampleScratch.x * (1 - t);
        GLOBULE_POINTS[k][1] = state.impact[1] + (1 - t) * .024;
        GLOBULE_POINTS[k][2] = state.impact[2] * t + sampleScratch.z * (1 - t);
        GLOBULE_RADII[k] = baseR * (1 + 1.45 * t * t);
      }
      geometry.tube(GLOBULE_POINTS, GLOBULE_RADII, streamColor, 5, 12, .58);
    }
    for (let i = 0; i < 28; i++) {
      const age = (state.time + i * .0145) % .22;
      if (state.time < state.flight || age > state.time - state.flight)
        continue;
      const angle = i * 2.39996, speed = .68 + (i % 5) * .18;
      sprayPoint[0] = state.impact[0] + Math.cos(angle) * speed * age;
      sprayPoint[1] = state.impact[1] + speed * age * 1.1 - GRAVITY * age * age / 2;
      sprayPoint[2] = state.impact[2] + Math.sin(angle) * speed * age;
      if (sprayPoint[1] >= state.impact[1]) {
        addPoint(sprayPoint, dropColor, .74, 3.2 + i % 3, 1);
      } else if (i % 2 === 0) {
        // Entrained bubbles and plunging droplets carried down by the pouring jet.
        sprayPoint[0] = state.impact[0] + Math.cos(angle) * (.015 + age * .18);
        sprayPoint[1] = Math.max(.04, state.impact[1] - age * 1.15);
        sprayPoint[2] = state.impact[2] + Math.sin(angle) * (.015 + age * .18);
        addPoint(sprayPoint, [.88, .95, .92], .78, 3.4 + (i % 3) * .8, 1);
      }
    }
  }
  return state;
}
