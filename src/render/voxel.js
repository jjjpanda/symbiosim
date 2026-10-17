import { clamp } from '../sim/constants.js';
import { phFromAcids } from '../sim/chemistry.js';
import { sampleFilm } from '../sim/film-body.js';
import { teaColor } from './objects.js';
import { reactionPackets } from '../metabolism.js';

const CUBE_CORNERS = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]
];
const CUBE_EDGES = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7]
];
const MAX_VOXEL_CELLS = 18;

export function pickVoxel(sim, current = null) {
  const counts = new Map();
  for (let i = 0; i < sim.agents.length; i++) {
    const a = sim.agents[i], idx = sim.index(a.x, a.y, a.z);
    let entry = counts.get(idx);
    if (!entry) counts.set(idx, entry = { yeast: 0, bacteria: 0 });
    if (a.type === 'yeast') entry.yeast++;
    else entry.bacteria++;
  }
  const currentIdx = current && Number.isInteger(current.gx)
    ? (current.gz * sim.ny + current.gy) * sim.nx + current.gx : -1;
  let bestIdx = -1, bestScore = -1;
  for (const [idx, c] of counts) {
    if (idx === currentIdx && counts.size > 1) continue;
    const gy = Math.floor(idx / sim.nx) % sim.ny;
    const score = c.yeast * 1.4 + c.bacteria * 1.8 + Math.min(c.yeast, c.bacteria) * 8 + (gy < 5 ? 1.2 : 0) + Math.random() * .4;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = idx;
    }
  }
  if (bestIdx < 0 && currentIdx >= 0) bestIdx = currentIdx;
  if (bestIdx >= 0) {
    const gx = bestIdx % sim.nx;
    const gy = Math.floor(bestIdx / sim.nx) % sim.ny;
    const gz = Math.floor(bestIdx / (sim.nx * sim.ny));
    return {
      x: (gx + .5) / sim.nx,
      y: (gy + .5) / sim.ny,
      z: (gz + .5) / sim.nz,
      gx, gy, gz,
      yaw: current?.yaw ?? .55,
      pitch: current?.pitch ?? .32
    };
  }
  const gx = Math.floor(sim.nx / 2), gy = Math.min(sim.ny - 1, 2), gz = Math.floor(sim.nz / 2);
  return { x: (gx + .5) / sim.nx, y: (gy + .5) / sim.ny, z: (gz + .5) / sim.nz, gx, gy, gz, yaw: .55, pitch: .32 };
}

export function renderVoxel(canvas, sim, voxel, dark = true, motion = true) {
  if (!canvas || !sim || !voxel) return null;
  const width = canvas.clientWidth || 260, height = canvas.clientHeight || 200;
  if (width < 10 || height < 10) return null;
  const ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
  const pw = Math.max(1, Math.round(width * ratio)), ph = Math.max(1, Math.round(height * ratio));
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw;
    canvas.height = ph;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx?.save) return null;
  ctx.save();
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const gx = clamp(Number.isInteger(voxel.gx) ? voxel.gx : Math.floor((voxel.x ?? .5) * sim.nx), 0, sim.nx - 1);
  const gy = clamp(Number.isInteger(voxel.gy) ? voxel.gy : Math.floor((voxel.y ?? .2) * sim.ny), 0, sim.ny - 1);
  const gz = clamp(Number.isInteger(voxel.gz) ? voxel.gz : Math.floor((voxel.z ?? .5) * sim.nz), 0, sim.nz - 1);
  const idx = (gz * sim.ny + gy) * sim.nx + gx;
  const vxCenter = (gx + .5) / sim.nx, vyCenter = (gy + .5) / sim.ny, vzCenter = (gz + .5) / sim.nz;
  const f = sim.fields;
  const localAcid = f.acetic[idx] + f.gluconic[idx];
  const localPh = phFromAcids(f.acetic[idx], f.gluconic[idx]);
  const localSugar = f.sucrose[idx] + f.glucose[idx] + f.fructose[idx];
  const localEtOH = f.ethanol[idx];
  const localO2 = f.oxygen[idx];
  const localCO2 = f.co2[idx];
  const localTemp = sim.temperature[idx];
  const [tr, tg, tb] = teaColor(localPh, localTemp - sim.settings.room, 'liquid');
  const flow = [0, 0, 0];
  sim.velocity(vxCenter, vyCenter, flow, vzCenter);

  // Subtle volumetric background glow matching the voxel's live pH color
  const cx = width * .5, cy = height * .52, scale = Math.min(width, height) * .34;
  const bgGrad = ctx.createRadialGradient(cx, cy, scale * .1, cx, cy, scale * 1.45);
  bgGrad.addColorStop(0, `rgba(${Math.round(tr * 255)}, ${Math.round(tg * 255)}, ${Math.round(tb * 255)}, ${dark ? .34 : .24})`);
  bgGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  const yaw = (voxel.yaw ?? .55) + (motion ? sim.day * 2.2 : 0);
  const pitch = voxel.pitch ?? .32;
  const cyaw = Math.cos(yaw), syaw = Math.sin(yaw);
  const cpitch = Math.cos(pitch), spitch = Math.sin(pitch);

  const project = (x, y, z) => {
    const rx = x * cyaw - z * syaw;
    const rz = x * syaw + z * cyaw;
    const ry = y * cpitch - rz * spitch;
    const tz = y * spitch + rz * cpitch;
    const perspective = 2.8 / (2.8 + tz * .55);
    return { x: cx + rx * scale * perspective, y: cy + ry * scale * perspective, z: tz, s: perspective };
  };

  const corners = CUBE_CORNERS.map(c => project(c[0], c[1], c[2]));
  const strokeColor = dark ? 'rgba(168, 224, 218, 0.24)' : 'rgba(45, 115, 120, 0.24)';

  // Draw back cube edges
  ctx.lineWidth = 1;
  ctx.strokeStyle = strokeColor;
  ctx.beginPath();
  for (const [a, b] of CUBE_EDGES) {
    if (corners[a].z > 0 || corners[b].z > 0) {
      ctx.moveTo(corners[a].x, corners[a].y);
      ctx.lineTo(corners[b].x, corners[b].y);
    }
  }
  ctx.stroke();

  // If near top surface, draw 3D cellulose fibril mesh at top of voxel (-y) using vessel-to-material mapping
  const filmDensity = gy === 0 ? sampleFilm(sim, sim.pellicle, vxCenter, vzCenter) : 0;
  if (filmDensity > .03) {
    ctx.strokeStyle = dark ? `rgba(235, 205, 145, ${clamp(filmDensity * .55, .12, .5)})` : `rgba(175, 125, 60, ${clamp(filmDensity * .55, .15, .5)})`;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    for (let i = -3; i <= 3; i++) {
      const u = i / 3.5;
      const p1 = project(u, -.88, -.9), p2 = project(u + .12 * Math.sin(i), -.84, .9);
      const q1 = project(-.9, -.86, u), q2 = project(.9, -.89, u - .12 * Math.cos(i));
      ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
      ctx.moveTo(q1.x, q1.y); ctx.lineTo(q2.x, q2.y);
    }
    ctx.stroke();
  }

  // Draw 3D local convective flow vector at center of voxel
  const speed = Math.hypot(flow[0], flow[1], flow[2]);
  if (speed > .002) {
    const dirScale = Math.min(.75, .22 + speed * 2.2) / speed;
    const p0 = project(-flow[0] * dirScale * .5, flow[1] * dirScale * .5, -flow[2] * dirScale * .5);
    const p1 = project(flow[0] * dirScale * .5, -flow[1] * dirScale * .5, flow[2] * dirScale * .5);
    ctx.strokeStyle = dark ? 'rgba(127, 209, 200, 0.42)' : 'rgba(45, 125, 130, 0.42)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
  }

  // Collect organisms strictly inside this solver voxel (gx, gy, gz), preserving species balance and order independence
  const yeastInVoxel = [], bacteriaInVoxel = [];
  for (const agent of sim.agents) {
    if (sim.index(agent.x, agent.y, agent.z) !== idx) continue;
    if (agent.type === 'yeast') yeastInVoxel.push(agent);
    else bacteriaInVoxel.push(agent);
  }
  yeastInVoxel.sort((a, b) => a.id - b.id);
  bacteriaInVoxel.sort((a, b) => a.id - b.id);
  const totalInVoxel = yeastInVoxel.length + bacteriaInVoxel.length;
  let yeastLimit = yeastInVoxel.length, bacteriaLimit = bacteriaInVoxel.length;
  if (totalInVoxel > MAX_VOXEL_CELLS) {
    if (yeastInVoxel.length > 0 && bacteriaInVoxel.length > 0) {
      const minEach = Math.min(4, yeastInVoxel.length, bacteriaInVoxel.length);
      yeastLimit = clamp(Math.round(MAX_VOXEL_CELLS * yeastInVoxel.length / totalInVoxel), minEach, MAX_VOXEL_CELLS - minEach);
      bacteriaLimit = MAX_VOXEL_CELLS - yeastLimit;
    } else {
      yeastLimit = Math.min(MAX_VOXEL_CELLS, yeastInVoxel.length);
      bacteriaLimit = Math.min(MAX_VOXEL_CELLS, bacteriaInVoxel.length);
    }
  }
  const selectedAgents = [...yeastInVoxel.slice(0, yeastLimit), ...bacteriaInVoxel.slice(0, bacteriaLimit)];
  const cells = [];
  for (const agent of selectedAgents) {
    const dx = clamp(((agent.x * sim.nx - gx) - .5) * 1.64, -.84, .84);
    const dy = clamp(((agent.y * sim.ny - gy) - .5) * 1.64, -.84, .84);
    const dz = clamp((((agent.z ?? .5) * sim.nz - gz) - .5) * 1.64, -.84, .84);
    cells.push({ agent, x: dx, y: dy, z: dz, proj: project(dx, dy, dz) });
  }

  // Ambient chemical molecules in the voxel (Sucrose, Glucose, O2, Ethanol, Acid, CO2)
  const phase = motion ? sim.day * 38 : 1.5;
  const molecules = [];
  const molSpecs = [
    { count: Math.min(8, Math.ceil(localSugar / 16)), color: '#e8a948', label: 'Suc', r: 3.1 },
    { count: Math.min(7, Math.ceil(localO2 * 14)), color: '#58b8e8', label: 'O₂', r: 2.6 },
    { count: Math.min(7, Math.ceil(localEtOH * 2.2)), color: '#f0803c', label: 'EtOH', r: 2.8 },
    { count: Math.min(8, Math.ceil(localAcid * 2.4)), color: '#46d8b8', label: 'H⁺', r: 2.5 },
    { count: Math.min(6, Math.ceil(localCO2 * 6)), color: '#c8f2ec', label: 'CO₂', r: 3.4, bubble: true }
  ];
  let mSeed = (gx * 73 + gy * 37 + gz * 19) | 0;
  for (const spec of molSpecs) {
    for (let k = 0; k < spec.count; k++) {
      mSeed = (mSeed * 1664525 + 1013904223) | 0;
      const h1 = ((mSeed >>> 0) % 1000) / 1000;
      const h2 = (((mSeed >>> 10) % 1000)) / 1000;
      const h3 = (((mSeed >>> 20) % 1000)) / 1000;
      const mx = ((h1 + flow[0] * phase * .08) % 1 + 1) % 1 * 1.68 - .84;
      const my = ((h2 - (spec.bubble ? phase * .06 : -flow[1] * phase * .08)) % 1 + 1) % 1 * 1.68 - .84;
      const mz = ((h3 + flow[2] * phase * .08) % 1 + 1) % 1 * 1.68 - .84;
      molecules.push({ ...spec, proj: project(mx, my, mz) });
    }
  }

  // Sort cells back-to-front by projected z
  cells.sort((a, b) => b.proj.z - a.proj.z);

  // Draw symbiotic cross-feeding bridges between metabolically active yeast and nearest bacteria
  for (let i = 0; i < cells.length; i++) {
    const a = cells[i];
    if (a.agent.type !== 'yeast') continue;
    const yFlux = a.agent.metabolism ? (a.agent.metabolism.ethanol ?? 0) : (localSugar > 1 ? .5 : 0);
    if (yFlux <= .005) continue;
    let bestB = null, bestD = 1.15;
    for (let j = 0; j < cells.length; j++) {
      const b = cells[j];
      if (b.agent.type === 'yeast') continue;
      const bFlux = b.agent.metabolism ? ((b.agent.metabolism.ethanol ?? 0) + (b.agent.metabolism.acid ?? 0)) : (localO2 > .02 ? .5 : 0);
      if (bFlux <= .005) continue;
      const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      if (d < bestD - 1e-9 || (Math.abs(d - bestD) <= 1e-9 && (!bestB || b.agent.id < bestB.agent.id))) {
        bestD = d;
        bestB = b;
      }
    }
    if (bestB) {
      const grad = ctx.createLinearGradient(a.proj.x, a.proj.y, bestB.proj.x, bestB.proj.y);
      grad.addColorStop(0, 'rgba(255, 184, 68, 0.65)');
      grad.addColorStop(.5, 'rgba(150, 242, 165, 0.78)');
      grad.addColorStop(1, 'rgba(48, 232, 198, 0.65)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      const mx = (a.proj.x + bestB.proj.x) * .5, my = (a.proj.y + bestB.proj.y) * .5 - 10;
      ctx.moveTo(a.proj.x, a.proj.y);
      ctx.quadraticCurveTo(mx, my, bestB.proj.x, bestB.proj.y);
      ctx.stroke();

      // Cross-feeding metabolite pulse along the bridge
      const t = ((phase * .35 + a.agent.id * .19) % 1 + 1) % 1;
      const px = (1 - t) * (1 - t) * a.proj.x + 2 * (1 - t) * t * mx + t * t * bestB.proj.x;
      const py = (1 - t) * (1 - t) * a.proj.y + 2 * (1 - t) * t * my + t * t * bestB.proj.y;
      ctx.fillStyle = '#9ef7b2';
      ctx.beginPath();
      ctx.arc(px, py, 2.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Draw ambient molecules
  for (const m of molecules) {
    const r = m.r * m.proj.s;
    ctx.beginPath();
    ctx.arc(m.proj.x, m.proj.y, r, 0, Math.PI * 2);
    if (m.bubble) {
      ctx.strokeStyle = 'rgba(210, 248, 244, 0.8)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = 'rgba(210, 248, 244, 0.22)';
      ctx.fill();
    } else {
      ctx.fillStyle = m.color;
      ctx.globalAlpha = .72;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // Draw zoomed-in microbes and their individual reaction packets
  for (const cell of cells) {
    const { agent, proj } = cell;
    const isYeast = agent.type === 'yeast';
    const r = (isYeast ? 8.5 : 7.5) * proj.s * (.9 + Math.min(.35, (agent.energy || .5) * .3));

    // Draw individual reaction packets streaming into/out of cell
    for (const pkt of reactionPackets(agent, motion)) {
      const span = pkt.intake ? 1 - pkt.phase : pkt.phase;
      const dist = r * (1.25 + span * 2.1);
      const px = proj.x + Math.cos(pkt.angle) * dist;
      const py = proj.y + Math.sin(pkt.angle) * dist * .82;
      const [cr, cg, cb] = pkt.color.map(c => Math.round(c * 255));
      ctx.strokeStyle = `rgba(${cr}, ${cg}, ${cb}, ${.25 + pkt.strength * .45})`;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(proj.x, proj.y);
      ctx.lineTo(px, py);
      ctx.stroke();
      ctx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, ${.55 + pkt.strength * .42})`;
      ctx.beginPath();
      ctx.arc(px, py, (2 + pkt.strength * 1.8) * proj.s, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.save();
    ctx.translate(proj.x, proj.y);
    if (isYeast) {
      // Budding yeast ovoid with cell membrane, cytoplasm gradient, and daughter bud
      const angle = (agent.id * 1.7) % (Math.PI * 2);
      ctx.rotate(angle);
      if ((agent.energy ?? .5) > .58) {
        ctx.fillStyle = 'rgba(255, 196, 88, 0.88)';
        ctx.beginPath();
        ctx.ellipse(r * .88, -r * .25, r * .46, r * .38, .2, 0, Math.PI * 2);
        ctx.fill();
      }
      const grad = ctx.createRadialGradient(-r * .25, -r * .25, r * .1, 0, 0, r);
      grad.addColorStop(0, '#fff4cf');
      grad.addColorStop(.55, '#f6b84c');
      grad.addColorStop(1, '#b86b1b');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(0, 0, r, r * .82, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 242, 200, 0.75)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    } else {
      // Acetobacter rod capsule with specular highlight
      const angle = (agent.id * 2.3 + flow[0] * 1.5) % (Math.PI * 2);
      ctx.rotate(angle);
      const len = r * 1.35, thick = r * .42;
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(20, 120, 110, 0.9)';
      ctx.lineWidth = thick * 2.2;
      ctx.beginPath();
      ctx.moveTo(-len, 0);
      ctx.lineTo(len, 0);
      ctx.stroke();
      ctx.strokeStyle = '#48f0d4';
      ctx.lineWidth = thick * 1.55;
      ctx.beginPath();
      ctx.moveTo(-len, 0);
      ctx.lineTo(len, 0);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(225, 255, 250, 0.85)';
      ctx.lineWidth = thick * .55;
      ctx.beginPath();
      ctx.moveTo(-len * .65, -thick * .22);
      ctx.lineTo(len * .55, -thick * .22);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Draw front cube edges
  ctx.lineWidth = 1.25;
  ctx.strokeStyle = dark ? 'rgba(180, 238, 232, 0.46)' : 'rgba(42, 118, 122, 0.42)';
  ctx.beginPath();
  for (const [a, b] of CUBE_EDGES) {
    if (corners[a].z <= 0 && corners[b].z <= 0) {
      ctx.moveTo(corners[a].x, corners[a].y);
      ctx.lineTo(corners[b].x, corners[b].y);
    }
  }
  ctx.stroke();
  ctx.restore();

  return {
    coords: `(${gx}, ${gy}, ${gz})`,
    summary: `pH ${localPh.toFixed(2)} · O₂ ${localO2.toFixed(2)} · ${Math.round(localSugar)} g/L`,
    ph: localPh,
    sugar: localSugar,
    o2: localO2,
    cells: cells.length,
    yeast: yeastLimit,
    bacteria: bacteriaLimit
  };
}
