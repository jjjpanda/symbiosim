import { validateSnapshot } from './sim/snapshot.js';
// A deliberately small, illustrative model. Concentrations are g/L equivalents,
// not measurements suitable for planning a real fermentation.
import { FIELDS, PRESETS, REGIMES, POPULATION_CAPACITY, MIN_VOLUME, HARVEST_FRACTION, TRANSFER_DAYS, clamp } from './sim/constants.js';
export { FIELDS, PRESETS, REGIMES, POPULATION_CAPACITY, MIN_VOLUME, HARVEST_FRACTION, TRANSFER_DAYS } from './sim/constants.js';
import { stepFluid } from './sim/fluid.js';
import { phFromAcids, stepChemistry } from './sim/chemistry.js';
import { releaseGas, stepGas } from './sim/gas.js';
import { exchangeLiquid, startTransfer, validateRecipe, INLET, INLET_DEPTH } from './sim/exchange.js';
import { createMembrane, stepPellicle, syncCellulose, pellicleStats, SKIM_THICKNESS } from './sim/pellicle.js';
import { sampleVelocity, surfaceIndex } from './sim/spatial.js';
import { createSurface, impulseSurface, stepSurface } from './sim/surface.js';
import { createFilmBody, createFilmPose, filmPoint, sampleFilm } from './sim/film-body.js';
import { createVessel } from './sim/vessel.js';

const meanOf = values => {
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i];
  return sum / values.length;
};

export class Simulation {
  constructor({ seed = 81241, width = 22, height = 30, depth = 8, starterFilm = true } = {}) {
    if (![width, height].every(size => Number.isInteger(size) && size >= 8 && size <= 64)) {
      throw new RangeError('Vessel grid dimensions must be integers from 8 to 64');
    }
    if (!Number.isInteger(depth) || depth < 1 || depth > 12) throw new RangeError('Vessel depth must be an integer from 1 to 12');
    this.seed = seed >>> 0;
    this.nx = width;
    this.ny = height;
    this.nz = depth;
    this.n = width * height * depth;
    this.day = 0;
    this.volume = .72;
    this.vessel = createVessel();
    this.playing = true;
    this.speed = 12;
    this.settings = { room: 24, swing: 4, cover: 'breathable', permeability: .45, convection: 1, variation: .08 };
    this.care = { autoDrain: true, teaMode: true, autoSkim: true, skims: 0, skimmed: 0, interval: .5, fraction: HARVEST_FRACTION, sugar: 80, temperature: 24, elapsed: 0, exchanges: 0, drained: 0, added: 0 };
    this.headspace = { oxygen: .21, co2: .001 };
    this.fields = {};
    for (const name of FIELDS) this.fields[name] = Array(this.n).fill(0);
    this.temperature = Array(this.n).fill(24);
    this.vx = Array(this.n).fill(0);
    this.vy = Array(this.n).fill(0);
    this.vz = Array(this.n).fill(0);
    this.pellicle = Array(width * depth).fill(0);
    this.membrane = createMembrane(width * depth);
    // A starter culture commonly includes a mother. Begin with a free-edged
    // raft, leaving room for currents and new cellulose around its perimeter.
    // This initial material is explicit; growth still pays its glucose cost.
    if (starterFilm) for (let z = 0; z < depth; z++) for (let x = 0; x < width; x++) {
      const dx = ((x + .5) / width - .48) / .39, dz = ((z + .5) / depth - .5) / .43;
      const angle = Math.atan2(dz, dx), radius = Math.hypot(dx, dz);
      const edge = 1 + .045 * Math.sin(angle * 3) + .025 * Math.cos(angle * 5);
      const i = z * width + x;
      this.pellicle[i] = .62 * clamp((edge - radius) / .18, 0, 1);
      syncCellulose(this, i);
    }
    this.surface = createSurface(width * depth);
    // Gas tracers sample actual yeast output without duplicating CO2 mass or
    // consuming the biological RNG. Pockets and releases use the motion clock.
    this.gas = { credit: 0, nextId: 1, bubbles: [], pockets: Array(width * depth).fill(0), bursts: [], released: 0 };
    this.history = [];
    this.agents = [];
    this.nextAgentId = 1;
    for (let i = 0; i < this.n; i++) {
      this.fields.sucrose[i] = 77;
      this.fields.glucose[i] = 7;
      this.fields.fructose[i] = 7;
      this.fields.oxygen[i] = .4;
      this.fields.ethanol[i] = .8;
      this.fields.acetic[i] = .25;
    }
    for (let i = 0; i < 480; i++) this.addAgent(i < 270 ? 'yeast' : 'bacteria', .08 + .84 * this.random(), .04 + .9 * this.random());
    this.disturb(.08);
    this.record();
  }

  random() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  addAgent(type, x, y, parent) {
    const variation = this.settings.variation;
    const traits = parent ? {
      rate: clamp(parent.traits.rate + (this.random() - .5) * variation, .55, 1.5),
      tolerance: clamp(parent.traits.tolerance + (this.random() - .5) * variation, .55, 1.5)
    } : { rate: .85 + .3 * this.random(), tolerance: .85 + .3 * this.random() };
    const z = this.nz === 1 ? .5 : parent ? clamp(parent.z + (this.random() - .5) * .025, .015, .985) : .04 + this.random() * .92;
    this.agents.push({ id: this.nextAgentId++, type, x, y, z, age: 0, energy: .65 + this.random() * .35, traits });
  }

  index(x, y, z = .5) { return Math.floor(clamp(z, 0, 1 - 1e-12) * this.nz) * this.nx * this.ny + clamp(Math.floor(y * this.ny), 0, this.ny - 1) * this.nx + clamp(Math.floor(x * this.nx), 0, this.nx - 1); }
  surfaceIndex(x, z = .5) { return surfaceIndex(this, x, z); }
  velocity(x, y, result = [0, 0, 0], z = .5) {
    sampleVelocity(this, x, y, z, result);
    // Cell-centered interpolation tapers to impermeable walls.
    result[0] *= Math.max(0, Math.min(1, x * this.nx * 2, (1 - x) * this.nx * 2));
    result[1] *= Math.max(0, Math.min(1, y * this.ny * 2, (1 - y) * this.ny * 2));
    result[2] *= Math.max(0, Math.min(1, z * this.nz * 2, (1 - z) * this.nz * 2));
    return result;
  }
  ambient() { return this.settings.room + this.settings.swing * Math.sin(this.day * Math.PI * 2 - Math.PI / 2); }
  total(name) { return this.mean(name) * this.volume; }
  mean(name) { return meanOf(this.fields[name]); }
  meanTemperature() { return meanOf(this.temperature); }
  sugar() { return this.mean('sucrose') + this.mean('glucose') + this.mean('fructose'); }
  ph() { return phFromAcids(this.mean('acetic'), this.mean('gluconic')); }
  counts() {
    const counts = { yeast: 0, bacteria: 0 };
    for (const agent of this.agents) counts[agent.type]++;
    return counts;
  }
  coverage() { return meanOf(this.pellicle); }
  airAccess() { return 1 - .35 * this.coverage(); }

  applySettings(patch = {}) {
    if (!patch || typeof patch !== 'object') throw new TypeError('Settings patch must be an object');
    const bounds = { room: [15, 35], swing: [0, 12], permeability: [0, 1], convection: [0, 2.5], variation: [0, .3] };
    if (patch.cover !== undefined) {
      if (!Object.hasOwn(PRESETS, patch.cover)) throw new RangeError(`Unsupported vessel cover: ${patch.cover}`);
    }
    for (const [key, [lo, hi]] of Object.entries(bounds)) {
      if (patch[key] !== undefined && !Number.isFinite(patch[key])) throw new RangeError(`Invalid setting ${key}`);
      if (patch[key] !== undefined) this.settings[key] = clamp(patch[key], lo, hi);
    }
    if (patch.cover !== undefined) {
      this.settings.cover = patch.cover;
      if (patch.permeability === undefined) this.settings.permeability = PRESETS[patch.cover];
    }
    return this.settings;
  }

  applyPreset(name) {
    const regime = REGIMES[name];
    if (!regime) throw new RangeError(`Unknown preset: ${name}`);
    this.applySettings(regime);
    return regime;
  }

  skimPellicle() {
    const removed = this.coverage() * .8;
    for (let i = 0; i < this.pellicle.length; i++) {
      syncCellulose(this, i);
      this.pellicle[i] *= .2;
      for (const layer of this.membrane.layers) layer[i] *= .2;
    }
    if (removed > 0) { this.care.skims++; this.care.skimmed += removed; }
    // Removing most material makes the residual sheet easier to lift. Gas
    // still needs a real exposed edge; skimming cannot vent through the film.
    this.stepGas(0, 0);
    this.record();
    return removed;
  }

  releaseGas(column) { return releaseGas(this, column); }

  stepGas(dt, motionDt) { return stepGas(this, dt, motionDt); }

  stepFluid(dt) { return stepFluid(this, dt); }

  stepChemistry(dt, motionDt = dt) { return stepChemistry(this, dt, motionDt); }

  startTransfer(phase, amount, recipe) { return startTransfer(this, phase, amount, recipe); }

  step(dt, motionDt = dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    if (!Number.isFinite(motionDt) || motionDt <= 0) return;
    // Mechanics and reactions have a fixed bounded clock. Scalar transport
    // subcycles to its own measured CFL limit, so quiet liquid does not pay
    // for a worst-case jet at every biological and mechanical substep.
    const count = Math.ceil(Math.max(dt, motionDt) / .01);
    for (let k = 0; k < count; k++) {
      const sub = dt / count;
      this.stepFluid(motionDt / count);
      this.stepChemistry(sub, motionDt / count);
      this.stepGas(sub, motionDt / count);
      stepSurface(this, motionDt / count);
      stepPellicle(this, motionDt / count);
      this.day += sub;
      this.stepCare(sub);
      if (this.day - this.history.at(-1).day >= .08) this.record();
    }
  }

  stepCare(dt) {
    const care = this.care;
    if (care.autoSkim && pellicleStats(this, this.careFilmStats ||= {}).thickness >= SKIM_THICKNESS) this.skimPellicle();
    // Finish a lower-outlet draw before replacing it. Each phase takes .12
    // simulated days; the same gradual transfer runs in the UI and headless.
    if (care.transfer) {
      const transfer = care.transfer;
      if (!transfer.manual && ((transfer.phase === 'drain' && !care.autoDrain) || (transfer.phase === 'pour' && !care.teaMode))) { care.transfer = null; return; }
      const amount = Math.min(transfer.remaining, transfer.total * dt / TRANSFER_DAYS);
      const actual = transfer.phase === 'drain' ? this.drain(amount, true) : this.pour(amount, transfer.recipe, true);
      if (transfer.phase === 'drain') care.drained += actual;
      else care.added += actual;
      transfer.remaining = actual > 0 ? Math.max(0, transfer.remaining - actual) : 0;
      if (transfer.remaining < 1e-10) {
        if (!transfer.manual && transfer.phase === 'drain' && care.teaMode) care.transfer = { ...transfer, phase: 'pour', remaining: transfer.total };
        else care.transfer = null;
      }
      return;
    }
    care.elapsed += dt;
    if (care.elapsed + 1e-10 < care.interval) return;
    care.elapsed = Math.max(0, care.elapsed - care.interval);
    let amount = 0, phase = 'pour';
    if (care.autoDrain && (this.ph() < 3.52 || this.sugar() < 40)) {
      amount = Math.max(0, Math.min(this.volume * care.fraction, this.volume - MIN_VOLUME));
      phase = 'drain';
      if (amount) care.exchanges++;
    } else if (care.teaMode) {
      amount = Math.max(0, .72 - this.volume);
    }
    if (amount > 1e-10) care.transfer = { phase, total: amount, remaining: amount, recipe: { temperature: care.temperature, sugar: care.sugar } };
  }

  drain(amount, automatic = false) {
    const reserved = !automatic && this.care.transfer?.phase === 'drain' ? this.care.transfer.remaining : 0;
    const removed = clamp(Number(amount) || 0, 0, Math.max(0, this.volume - MIN_VOLUME - reserved));
    if (!removed) return 0;
    const probability = removed / this.volume;
    // Attached surface bacteria and pellicle-tethered yeast stay in place during a lower-outlet draw.
    let retained = 0;
    for (const agent of this.agents) {
      const tethered = (agent.type === 'bacteria' && agent.y < .15)
        || (automatic && agent.type === 'yeast' && agent.y < .11 && sampleFilm(this, this.pellicle, agent.x, agent.z) > .2);
      if (tethered || this.random() >= probability) this.agents[retained++] = agent;
    }
    this.agents.length = retained;
    exchangeLiquid(this, -removed);
    if (!automatic) this.record();
    return removed;
  }

  pour(amount, { temperature = 24, sugar = 80 } = {}, automatic = false) {
    validateRecipe(temperature, sugar);
    const reserved = !automatic && this.care.transfer?.phase === 'pour' ? this.care.transfer.remaining : 0;
    const added = clamp(Number(amount) || 0, 0, Math.max(0, .95 - this.volume - reserved));
    if (!added) return 0;
    const recipe = { sucrose: sugar * .85, glucose: sugar * .075, fructose: sugar * .075, ethanol: 0, oxygen: .4, acetic: 0, gluconic: 0, co2: 0 };
    exchangeLiquid(this, added, recipe, temperature);
    // Impact erodes young fibrils over its footprint rather than deleting one
    // grid patch. Mature layers resist the same local impulse more strongly.
    const layers = this.membrane.layers;
    for (let z = 0; z < this.nz; z++) for (let x = 0; x < this.nx; x++) {
      const i = z * this.nx + x;
      syncCellulose(this, i);
      const point = filmPoint(this, (x + .5) / this.nx, (z + .5) / this.nz, this.pourFilmPoint ||= [0, 0]);
      const dx = (point[0] - INLET) / .1, dz = this.nz > 1 ? (point[1] - INLET_DEPTH) / .24 : 0;
      const impact = added * 12 * Math.exp(-dx * dx - dz * dz);
      for (let layer = 0; layer < 3; layer++) layers[layer][i] *= Math.exp(-impact / (1 + layer * 2));
      this.pellicle[i] = layers[0][i] + layers[1][i] + layers[2][i];
    }
    if (!automatic) {
      this.disturb(added);
      this.record();
    }
    return added;
  }

  addStarter(amount, balance = .5) {
    const reserved = this.care.transfer?.phase === 'pour' ? this.care.transfer.remaining : 0;
    const added = clamp(Number(amount) || 0, 0, Math.max(0, .95 - this.volume - reserved));
    if (!added) return 0;
    const recipe = { sucrose: 12, glucose: 2, fructose: 2, ethanol: 3, oxygen: .3, acetic: 3, gluconic: 1.5, co2: .3 };
    exchangeLiquid(this, added, recipe, this.meanTemperature());
    const count = Math.min(POPULATION_CAPACITY - this.agents.length, Math.max(2, Math.round(added * 450)));
    for (let i = 0; i < count; i++) this.addAgent(this.random() < balance ? 'yeast' : 'bacteria', .3 + this.random() * .4, .03 + this.random() * .14);
    this.disturb(added);
    this.record();
    return added;
  }

  disturb(amount) {
    impulseSurface(this, INLET, INLET_DEPTH, Math.min(.2, amount * .8));
    const vortices = Array.from({ length: 3 }, () => ({ x: .15 + this.random() * .7, y: .12 + this.random() * .65, radius: .12 + this.random() * .16, spin: this.random() < .5 ? -1 : 1 }));
    const inlet = .3 + this.random() * .4;
    for (let z = 0; z < this.nz; z++) for (let y = 0; y < this.ny; y++) for (let x = 0; x < this.nx; x++) {
      const i = (z * this.ny + y) * this.nx + x;
      const px = x / (this.nx - 1), py = y / (this.ny - 1);
      for (const vortex of vortices) {
        const dx = (px - vortex.x) / vortex.radius, dy = (py - vortex.y) / vortex.radius;
        const strength = Math.exp(-(dx * dx + dy * dy) * 2) * amount * 18 * vortex.spin;
        this.vx[i] -= dy * strength;
        this.vy[i] += dx * strength;
      }
      this.vy[i] += Math.exp(-(((px - inlet) / .09) ** 2) - py * 4) * amount * 5;
      this.vz[i] += Math.sin(Math.PI * (z + .5) / this.nz) * Math.sin(py * Math.PI * 2) * amount * 2;
      if (x === 0 || x === this.nx - 1) this.vx[i] = 0;
      if (y === 0 || y === this.ny - 1) this.vy[i] = 0;
    }
  }

  stir(strength = 1) {
    if (!Number.isFinite(strength)) return;
    strength = clamp(strength, -1, 1);
    // Curl of a wall-vanishing vector potential in the horizontal plane.
    // Stronger near the surface, with no scalar or biomass injection.
    for (let z = 0; z < this.nz; z++) for (let y = 0; y < this.ny; y++) for (let x = 0; x < this.nx; x++) {
      const px = (x + .5) / this.nx, py = (y + .5) / this.ny, pz = (z + .5) / this.nz;
      const i = (z * this.ny + y) * this.nx + x;
      const force = strength * .85 * Math.exp(-py * 1.6);
      this.vx[i] = clamp(this.vx[i] - force * Math.sin(Math.PI * px) * Math.cos(Math.PI * pz), -2, 2);
      this.vz[i] = this.nz > 1 ? clamp(this.vz[i] + force * Math.cos(Math.PI * px) * Math.sin(Math.PI * pz), -2, 2) : 0;
    }
  }

  record() {
    const { yeast, bacteria } = this.counts();
    this.history.push({ day: this.day, sugar: this.sugar(), ph: this.ph(), yeast, bacteria, temperature: this.meanTemperature() });
    if (this.history.length > 240) this.history.shift();
  }

  snapshot() {
    const { seed, nx, ny, nz, day, volume, speed, settings, care, headspace, fields, temperature, vx, vy, vz, pellicle, membrane, surface, gas, agents, nextAgentId, history } = this;
    for (let i = 0; i < pellicle.length; i++) syncCellulose(this, i);
    return structuredClone({ version: 13, vessel: this.vessel, seed, nx, ny, nz, day, volume, speed, settings, care, headspace, fields, temperature, vx, vy, vz, pellicle, membrane, surface, gas, agents, nextAgentId, history });
  }

  static restore(data) {
    validateSnapshot(data);
    const sim = new Simulation({ seed: data.seed, width: data.nx, height: data.ny, depth: data.version >= 7 ? data.nz : 1 });
    // A restored vessel owns its state, even when given an in-memory snapshot.
    const { seed, day, volume, speed, settings: restoredSettings, care, headspace, fields, temperature, vx, vy, pellicle, gas, agents, nextAgentId, history } = structuredClone(data);
    Object.assign(sim, { seed, day, volume, speed, settings: restoredSettings, headspace, fields, temperature, vx, vy, pellicle, agents, nextAgentId, history });
    if (care !== undefined) sim.care = { ...sim.care, ...care };
    if (gas !== undefined) sim.gas = gas;
    if (data.version >= 6) sim.membrane = structuredClone(data.membrane);
    if (data.version < 11) sim.membrane.body = createFilmBody(sim.pellicle.length);
    if (data.version < 12) sim.membrane.body.pose = createFilmPose();
    if (data.version >= 11) sim.vessel = { tiltZ: 0, ...structuredClone(data.vessel) };
    sim.surface = data.version >= 9 ? structuredClone(data.surface) : createSurface(sim.pellicle.length);
    if (data.version < 8) {
      sim.membrane.layers = createMembrane(sim.pellicle.length).layers;
      for (let i = 0; i < sim.pellicle.length; i++) syncCellulose(sim, i);
    }
    if (data.version >= 7) {
      sim.vz = [...data.vz];
    } else {
      // Old snapshots retain their exact single-slice chemistry. The render
      // projection still accepts their centered organisms and gas samples.
      for (const agent of sim.agents) agent.z = .5;
      for (const bubble of sim.gas.bubbles) bubble.z = .5;
      for (const burst of sim.gas.bursts) burst.z = .5;
    }
    // Retain enabled modes and pending exchanges; future batches use the
    // new harvest ratio instead of the previous small continuous draws.
    if (data.version < 5) sim.care = { ...sim.care, fraction: HARVEST_FRACTION };
    if (data.version === 1) { sim.vx = sim.vx.map(v => v / sim.nx); sim.vy = sim.vy.map(v => v / sim.ny); }
    sim.speed = data.version < 3 && data.speed <= 1 ? 12 : clamp(data.speed || 12, 1, 60);
    sim.playing = false;
    return sim;
  }
}
