import { POPULATION_CAPACITY, clamp } from './constants.js';
import { depositCellulose, stepCellulose } from './pellicle.js';
import { worldFilm } from './film-body.js';

const reflect = (value, lo, hi) => {
  const span = hi - lo, phase = ((value - lo) % (2 * span) + 2 * span) % (2 * span);
  return lo + (phase <= span ? phase : 2 * span - phase);
};

export const phFromAcids = (acetic, gluconic) => clamp(4.65 - .8 * acetic - .25 * gluconic, 2.4, 4.8);

export function stepChemistry(sim, dt, motionDt = dt) {
  const ph = sim.ph(), counts = sim.counts();
  const contact = worldFilm(sim);
  const perm = Number.isFinite(sim.settings.permeability) ? sim.settings.permeability : .45;
  const oxygenExchange = perm * (sim.settings.cover === 'sealed' ? .015 : 1);
  const surfaceCo2 = sim.mean('co2');
  sim.headspace.co2 = clamp(sim.headspace.co2 + (surfaceCo2 - sim.headspace.co2) * dt * .04 - oxygenExchange * dt * .02 * sim.headspace.co2, 0, 10);
  sim.headspace.oxygen = clamp(sim.headspace.oxygen + (.21 - sim.headspace.oxygen) * dt * oxygenExchange * 2, 0, .21);
  for (let z = 0; z < sim.nz; z++) for (let x = 0; x < sim.nx; x++) {
    const i = z * sim.nx * sim.ny + x;
    sim.fields.oxygen[i] += (sim.headspace.oxygen * 3 - sim.fields.oxygen[i]) * dt * oxygenExchange * 2 * (1 - .35 * contact.density[z * sim.nx + x]);
    sim.fields.co2[i] *= Math.max(0, 1 - dt * oxygenExchange * .7);
  }
  let survivors = 0;
  const newborns = sim.newbornBuffer ||= []; newborns.length = 0;
  // Each organism is a resolution-independent concentration sample; a grid
  // cell's share of the current liquid domain is 1/n, so total inventory change scales with sim.volume.
  const cellScale = sim.n / 1980;
  // Bulk gas transfer represents unresolved vertical mixing. Sealed vessels
  // still exhaust finite oxygen; only ventilation replenishes the headspace.
  const airAccess = sim.airAccess();
  for (let i = 0; i < sim.n; i++) {
    sim.fields.oxygen[i] += (sim.headspace.oxygen * 3 - sim.fields.oxygen[i]) * dt * oxygenExchange * .8 * airAccess;
    sim.fields.co2[i] *= Math.exp(-dt * oxygenExchange * .3);
  }
  let oxygenUsed = 0;
  const jitter = .028 * Math.sqrt(motionDt);
  const velocity = sim.chemistryVelocity ||= [0, 0, 0];
  for (const agent of sim.agents) {
    const [vx, vy, vz] = sim.velocity(agent.x, agent.y, velocity, agent.z);
    // Reflect rather than clamp at the wall. Bilinear sampling avoids a
    // whole grid cell of zero velocity; diffusion releases stagnant corners.
    agent.x = reflect(agent.x + vx * motionDt + (sim.random() - .5) * jitter, .015, .985);
    agent.y = reflect(agent.y + vy * motionDt + (sim.random() - .5) * jitter, .012, .988);
    agent.z = reflect(agent.z + vz * motionDt + (sim.random() - .5) * jitter, .015, .985);
    const i = sim.index(agent.x, agent.y, agent.z);
    const t = sim.temperature[i], ethanol = sim.fields.ethanol[i];
    const heat = clamp(1 - Math.abs(t - 27) / 15, 0, 1.2);
    const localPh = phFromAcids(sim.fields.acetic[i], sim.fields.gluconic[i]);
    const acidPenalty = clamp((localPh - 2.5) / 1.4 * agent.traits.tolerance, .04, 1);
    // Acetic acid bacteria oxidize ethanol as fuel and tolerate ~8-12% ABV
    // (65-100 g/L), whereas kombucha yeasts slow and die above ~4-6% ABV.
    const ethanolLimit = (agent.type === 'yeast' ? 32 : 70) * agent.traits.tolerance;
    const ethanolPenalty = ethanol > ethanolLimit ? clamp(1 - (ethanol - ethanolLimit) / (agent.type === 'yeast' ? 20 : 45), .04, 1) : 1;
    const activity = heat * acidPenalty * ethanolPenalty * agent.traits.rate;
    agent.age += dt;
    // Rates are actual local reactions per unit biomass, not decorative
    // clocks. Integrated turnover drives the visible molecule transport.
    const metabolism = agent.metabolism ||= { turnover: 0 };
    metabolism.sugar = metabolism.oxygen = metabolism.ethanol = metabolism.co2 = metabolism.acid = 0;
    let food = 0;
    if (agent.type === 'yeast') {
      const split = Math.min(sim.fields.sucrose[i], 20 * activity * dt * cellScale);
      sim.fields.sucrose[i] -= split;
      sim.fields.glucose[i] += split * .52;
      sim.fields.fructose[i] += split * .48;
      const use = Math.min(sim.fields.glucose[i] + sim.fields.fructose[i], 25 * activity * dt * cellScale);
      const ratio = sim.fields.glucose[i] / Math.max(.00001, sim.fields.glucose[i] + sim.fields.fructose[i]);
      sim.fields.glucose[i] = Math.max(0, sim.fields.glucose[i] - use * ratio);
      sim.fields.fructose[i] = Math.max(0, sim.fields.fructose[i] - use * (1 - ratio));
      sim.fields.ethanol[i] += use * .48;
      sim.fields.co2[i] += use * .46;
      food = use / cellScale;
      metabolism.sugar = food / dt;
      metabolism.ethanol = metabolism.sugar * .48;
      metabolism.co2 = metabolism.sugar * .46;
    } else {
      const budget = Math.min(sim.fields.oxygen[i], .08 * activity * dt * cellScale);
      const useEthanol = Math.min(sim.fields.ethanol[i], budget * 90, 7 * activity * dt * cellScale);
      sim.fields.ethanol[i] -= useEthanol;
      sim.fields.acetic[i] += useEthanol * .85;
      const useGlucose = Math.min(sim.fields.glucose[i], Math.max(0, budget - useEthanol / 90) * 12, 1.2 * activity * dt * cellScale);
      sim.fields.glucose[i] -= useGlucose;
      sim.fields.gluconic[i] += useGlucose * .9;
      const oxygen = useEthanol / 90 + useGlucose / 12;
      sim.fields.oxygen[i] = Math.max(0, sim.fields.oxygen[i] - oxygen);
      oxygenUsed += oxygen;
      food = (useEthanol + useGlucose) / cellScale;
      metabolism.sugar = useGlucose / cellScale / dt;
      metabolism.oxygen = oxygen / cellScale / dt;
      metabolism.ethanol = useEthanol / cellScale / dt;
      metabolism.acid = (useEthanol * .85 + useGlucose * .9) / cellScale / dt;
      if (agent.y < .15 && oxygen > 0) {
        const worldColumn = sim.surfaceIndex(agent.x, agent.z);
        const column = contact.material[worldColumn];
        // Cellulose has a carbon cost and requires an active aerobic cell.
        const yieldScale = .72 * sim.nx * sim.nz / 22;
        const cellulose = column < 0 ? 0 : Math.min(sim.fields.glucose[i], dt * activity * .25 * cellScale, (1 - sim.pellicle[column]) * cellScale / yieldScale);
        sim.fields.glucose[i] -= cellulose;
        metabolism.sugar += cellulose / cellScale / dt;
        if (cellulose > 0) depositCellulose(sim, column, cellulose / cellScale * yieldScale);
      }
    }
    metabolism.turnover += food;
    agent.energy = clamp(agent.energy + food * .2 - dt * (agent.type === 'yeast' ? .078 : .025), 0, 2);
    const lifespan = agent.type === 'yeast' ? 24 : 36;
    // Thermal injury is local and cumulative; a hot plume can kill cells
    // while the cooler culture survives. Rates remain illustrative.
    const thermalInjury = t > 42 ? Math.min(500, .15 * Math.expm1((t - 42) * .19)) : 0;
    const ethanolInjury = ethanol > ethanolLimit ? Math.min(500, .08 * Math.expm1((ethanol - ethanolLimit) * .12)) : 0;
    const hazard = .008 + Math.max(0, agent.age - lifespan) * .003 + (1 - heat) * .08 + thermalInjury + ethanolInjury;
    const death = agent.energy <= 0 || sim.random() < -Math.expm1(-dt * hazard);
    if (death) continue;
    const reproduction = agent.type === 'yeast' ? clamp((sim.fields.glucose[i] + sim.fields.fructose[i] + sim.fields.sucrose[i] * .16) / 12, 0, 1) * .64 : clamp(sim.fields.ethanol[i] / 2, 0, 1) * clamp(sim.fields.oxygen[i] / .2, 0, 1) * .65;
    const capacity = POPULATION_CAPACITY * (agent.type === 'yeast' ? .55 : .45);
    const crowding = clamp(1 - counts[agent.type] / capacity, 0, 1);
    if (agent.energy > (agent.type === 'yeast' ? .68 : .55) && sim.agents.length + newborns.length < POPULATION_CAPACITY && sim.random() < dt * activity * reproduction * crowding) {
      agent.energy *= .53;
      newborns.push({ type: agent.type, x: clamp(agent.x + (sim.random() - .5) * .015, .01, .99), y: clamp(agent.y + (sim.random() - .5) * .015, .01, .99), parent: agent });
    }
    sim.agents[survivors++] = agent;
  }

  sim.agents.length = survivors;
  sim.headspace.oxygen = Math.max(0, sim.headspace.oxygen - oxygenUsed / sim.n * .12);
  for (const child of newborns) sim.addAgent(child.type, child.x, child.y, child.parent);
  newborns.length = 0;
  stepCellulose(sim, dt, ph);
}
