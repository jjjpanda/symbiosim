import { FILM_CUTOFF, clamp } from './constants.js';
import { impulseSurface } from './surface.js';
import { canopyGap, collectPockets, pocketOutlet, spreadPocketLoad } from './pockets.js';
import { worldFilm } from './film-body.js';
import { vesselGravity } from './vessel.js';

export function releaseGas(sim, column) {
  if (worldFilm(sim).density[column] >= FILM_CUTOFF) return;
  const amount = sim.gas.pockets[column];
  if (amount <= 0) return;
  sim.gas.pockets[column] = 0;
  ventGas(sim, column, amount);
}

function ventGas(sim, column, amount, x = (column % sim.nx + .5) / sim.nx, z = (Math.floor(column / sim.nx) + .5) / sim.nz) {
  sim.gas.released++;
  // Faint tails can leave the same real opening after the main blister.
  // They must not each generate a full-size splash and a pair of beads.
  if (amount < .025) return;
  impulseSurface(sim, x, z, -Math.min(.18, amount * .07));
  sim.gas.bursts.push({ x, z, age: 0, strength: clamp(amount, .25, 2) });
  if (sim.gas.bursts.length > 12) sim.gas.bursts.shift();
}

export function stepGas(sim, dt, motionDt) {
  const gas = sim.gas;
  const contact = worldFilm(sim);
  for (const burst of gas.bursts) burst.age += motionDt;
  let survivingBursts = 0;
  for (const burst of gas.bursts) if (burst.age < .32) gas.bursts[survivingBursts++] = burst;
  gas.bursts.length = survivingBursts;
  for (const agent of sim.agents) {
    if (agent.type !== 'yeast') continue;
    gas.credit += (agent.metabolism?.co2 || 0) * dt / 1980;
    if (gas.credit >= .018) {
      gas.credit %= .018;
      if (gas.bubbles.length < 80) {
        const id = gas.nextId++;
        gas.bubbles.push({ id, x: agent.x, y: agent.y, z: agent.z, size: .65 + (id * .618034 % 1) * .7 });
      }
    }
  }
  let rising = 0;
  const [gravityX, gravityY, gravityZ] = vesselGravity(sim);
  const velocity = sim.gasVelocity ||= [0, 0, 0];
  for (const bubble of gas.bubbles) {
    const previousY = bubble.y;
    const [vx, vy, vz] = sim.velocity(bubble.x, bubble.y, velocity, bubble.z);
    const rise = .4 + .7 * bubble.size * bubble.size;
    bubble.x = clamp(bubble.x + (vx * .35 - gravityX * rise) * motionDt, .015, .985);
    bubble.z = clamp((bubble.z ?? .5) + (vz * .35 - gravityZ * rise) * motionDt, .015, .985);
    // Small bubbles can be entrained by the inlet; larger merged bubbles
    // escape faster. Size is a tracer radius, not a thermodynamic gas mass.
    bubble.y += (vy * .75 - gravityY * rise) * motionDt;
    const column = sim.surfaceIndex(bubble.x, bubble.z);
    const water = sim.surface.displacement[column];
    const filmDepth = clamp((contact.displacement[column] - water) / Math.max(.02, sim.volume - water), 0, .95);
    const covered = contact.density[column] >= FILM_CUTOFF;
    const hitsFilm = covered && previousY >= filmDepth - .005 && bubble.y <= filmDepth + .015;
    if (!hitsFilm && bubble.y > .015) {
      bubble.y = Math.min(.985, bubble.y);
      gas.bubbles[rising++] = bubble;
      continue;
    }
    const amount = .28 * bubble.size ** 3;
    if (!hitsFilm) ventGas(sim, column, amount, bubble.x, bubble.z);
    else gas.pockets[column] += amount;
  }
  gas.bubbles.length = rising;
  coalesceBubbles(sim);
  spreadPocketLoad(sim, contact);
  // Gas migrates beneath connected fibers toward regions of lower pressure.
  // Pairwise flux conserves the pocket inventory, including at both walls.
  const previous = sim.gasBuffer ||= new Float64Array(gas.pockets.length);
  previous.set(gas.pockets);
  const migrate = (i, j) => {
    if (Math.min(contact.density[i], contact.density[j]) < FILM_CUTOFF) return;
    // Lifted cellulose opens a much more mobile gas channel. A closed sheet
    // retains the slow baseline migration, with symmetric conservative flux.
    const opening = Math.min(1, Math.min(canopyGap(sim, i, contact), canopyGap(sim, j, contact)) / .008);
    const flux = (previous[i] - previous[j]) * Math.min(.2, motionDt * (.5 + 25 * opening ** 3));
    gas.pockets[i] -= flux; gas.pockets[j] += flux;
  };
  for (let z = 0; z < sim.nz; z++) for (let x = 0; x < sim.nx; x++) {
    const i = z * sim.nx + x;
    if (x + 1 < sim.nx) migrate(i, i + 1);
    if (z + 1 < sim.nz) migrate(i, i + sim.nx);
  }
  for (let x = 0; x < gas.pockets.length; x++) {
    // Unconnected traces below the visible film contour cannot trap gas.
    if (gas.pockets[x] > 0 && contact.density[x] < FILM_CUTOFF) {
      const amount = gas.pockets[x]; gas.pockets[x] = 0; ventGas(sim, x, amount);
    }
  }
  const { regions, cells, labels, count } = collectPockets(sim, contact);
  for (let i = 0; i < count; i++) {
    const region = regions[i];
    if (region.edge < 0) continue;
    for (let j = region.start; j < region.end; j++) gas.pockets[cells[j]] = 0;
    ventGas(sim, region.edge, region.amount, region.outletX, region.outletZ);
  }
  // Subvisual gas cannot join distant blisters through faint diffusion tails,
  // but can still leave when it reaches its own lifted, exposed edge.
  const outlet = sim.smallPocketOutlet ||= {};
  for (let i = 0; i < gas.pockets.length; i++) {
    if (labels[i] >= 0 || gas.pockets[i] <= 0 || contact.density[i] < FILM_CUTOFF) continue;
    outlet.edge = -1; outlet.opening = 0; pocketOutlet(sim, i, outlet, contact);
    if (outlet.edge < 0) continue;
    const amount = gas.pockets[i]; gas.pockets[i] = 0;
    ventGas(sim, i, amount, outlet.outletX, outlet.outletZ);
  }
}

const bubbleBin = b => (Math.min(9, Math.floor(b.z * 10)) * 10 + Math.min(9, Math.floor(b.y * 10))) * 10 + Math.min(9, Math.floor(b.x * 10));

// A fixed spatial hash is independent of chemistry resolution. Its .1-wide
// bins exceed the maximum collision distance (.018 * 4.8); 27 neighbors suffice.
// Linked lists retain every candidate, including several in the same bin.
function coalesceBubbles(sim) {
  const bubbles = sim.gas.bubbles;
  if (bubbles.length < 2) return;
  const bins = sim.bubbleBins ||= new Int16Array(1000);
  const links = sim.bubbleLinks ||= new Int16Array(80);
  bins.fill(-1);
  let count = 0;
  for (const bubble of bubbles) {
    const x = Math.floor(bubble.x * 10), y = Math.floor(bubble.y * 10), z = Math.floor(bubble.z * 10);
    let closest = -1, distance = Infinity;
    for (let iz = Math.max(0, z - 1); iz <= Math.min(9, z + 1); iz++) {
      for (let iy = Math.max(0, y - 1); iy <= Math.min(9, y + 1); iy++) {
        for (let ix = Math.max(0, x - 1); ix <= Math.min(9, x + 1); ix++) {
          for (let j = bins[(iz * 10 + iy) * 10 + ix]; j >= 0; j = links[j]) {
            const other = bubbles[j];
            if (bubble.size ** 3 + other.size ** 3 > 2.4 ** 3) continue;
            const d = (bubble.x - other.x) ** 2 + (bubble.y - other.y) ** 2 + (bubble.z - other.z) ** 2;
            if (d < (.018 * (bubble.size + other.size)) ** 2 && d < distance) { closest = j; distance = d; }
          }
        }
      }
    }
    if (closest < 0) {
      const cell = bubbleBin(bubble);
      links[count] = bins[cell]; bins[cell] = count;
      bubbles[count++] = bubble;
      continue;
    }
    const other = bubbles[closest], oldBin = bubbleBin(other);
    const volume = bubble.size ** 3 + other.size ** 3, weight = bubble.size ** 3 / volume;
    other.x += (bubble.x - other.x) * weight; other.y += (bubble.y - other.y) * weight; other.z += (bubble.z - other.z) * weight;
    other.size = Math.cbrt(volume);
    const newBin = bubbleBin(other);
    if (newBin !== oldBin) {
      // The merged center may cross a bin boundary. Move its list entry so
      // subsequent collisions use its new position in this same substep.
      if (bins[oldBin] === closest) bins[oldBin] = links[closest];
      else {
        let previous = bins[oldBin];
        while (links[previous] !== closest) previous = links[previous];
        links[previous] = links[closest];
      }
      links[closest] = bins[newBin]; bins[newBin] = closest;
    }
  }
  bubbles.length = count;
}
