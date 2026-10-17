import { Geometry } from './geometry.js';
import { HEIGHT, liquidPosition, discToMaterial } from './space.js';
import { FILM_CUTOFF, LIQUID_RADIUS, clamp } from '../sim/constants.js';
import { toDisc } from '../sim/domain.js';
import { sampleSurface } from '../sim/spatial.js';
import { filmPoint } from '../sim/film-body.js';
import { phFromAcids } from '../sim/chemistry.js';
import { SPOUT } from './streams.js';
import { CHEMICAL_COLORS } from '../metabolism.js';
const WATER_COLS = 64, WATER_LEVELS = 10;
const WATER_RIM = Array.from({ length: WATER_COLS + 1 }, (_, col) => {
  const angle = col / WATER_COLS * Math.PI * 2;
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const [u, v] = discToMaterial(ca * LIQUID_RADIUS, sa * LIQUID_RADIUS);
  const [x, z] = toDisc(u, v, [0, 0], LIQUID_RADIUS);
  return { x, z, u, v, normal: [ca, 0, sa] };
});
const WATER_MID_UV = Array.from({ length: WATER_COLS }, (_, col) => {
  const a = WATER_RIM[col], b = WATER_RIM[col + 1];
  return discToMaterial((a.x + b.x) / 2, (a.z + b.z) / 2);
});
const waterHeight = new Float64Array(WATER_COLS + 1);
// As pH drops from sweet black tea (~4.6) to tangy kombucha (~3.1), protonated
// tea polyphenols lighten from deep mahogany-russet into luminous golden-amber.
export function teaColor(ph, heat = 0, overlay = 'liquid', out = [0, 0, 0]) {
  if (overlay === 'temperature') {
    const t = clamp(heat * .5 + .5, 0, 1);
    out[0] = .12 + .86 * t * t;
    out[1] = .48 + .26 * Math.sin(t * Math.PI) - .14 * t;
    out[2] = .82 * (1 - t);
    return out;
  }
  const acid = clamp((4.55 - ph) / 1.35, 0, 1);
  const warm = clamp(heat, 0, 1);
  out[0] = clamp(.44 + .49 * acid + .08 * acid * acid + warm * .09, 0, 1);
  out[1] = clamp(.13 + .42 * acid + .15 * acid * acid + warm * .05, 0, 1);
  out[2] = clamp(.022 + .06 * acid + .12 * acid * acid * acid, 0, 1);
  return out;
}
export function createJar() {
  const jar = new Geometry(14000);
  jar.lathe([[.42, .012], [.48, .016], [.506, .055], [.509, 1.17], [.499, 1.235], [.465, 1.275],
    [.464, 1.31], [.48, 1.325], [.477, 1.342], [.46, 1.347], [.449, 1.332], [.449, 1.285],
    [.480, 1.23], [.490, .072], [.474, .046], [.42, .044], [0, .044], [0, .012], [.42, .012]], [.76, .88, .93], .06, 1);
  return jar;
}
export function createTap() {
  const tap = new Geometry(6000), metal = [.57, .43, .23];
  const [sx, sy, sz] = SPOUT;
  // Radial mounting through the wall; the final pipe segment is vertical,
  // sharing the exact mouth center and axis used by the discharged jet.
  tap.tube([[-.478, .19, sz], [-.535, .19, sz]], [.065, .065], metal, 0, 24);
  tap.tube([[-.51, .19, sz], [-.61, .19, sz], [sx, .16, sz], [sx, sy + .014, sz]], [.044, .044, .046, .046], metal, 0, 20);
  tap.tube([[-.565, .19, sz], [-.565, .28, sz]], [.018, .018], metal, 0, 12);
  tap.tube([[-.615, .28, sz], [-.515, .28, sz]], [.013, .013], [.68, .54, .30], 0, 12);
  // A dark open bore, surrounded by a beveled metal nozzle lip.
  const start = tap.count;
  tap.lathe([[.046, sy + .018], [.05, sy + .006], [.043, sy], [.042, sy + .008]], metal, 1, 0, 32);
  for (let i = start; i < tap.count; i++) {
    tap.vertices[i * 13] += SPOUT[0];
    tap.vertices[i * 13 + 2] += SPOUT[2];
  }
  const center = [sx, sy + .009, sz];
  for (let i = 0; i < 32; i++) {
    const a = i / 32 * Math.PI * 2, b = (i + 1) / 32 * Math.PI * 2;
    tap.triangle(center, [sx + Math.cos(a) * .042, center[1], sz + Math.sin(a) * .042], [sx + Math.cos(b) * .042, center[1], sz + Math.sin(b) * .042], [.055, .043, .028]);
  }
  return tap;
}
export function buildWater(mesh, sim, overlay = 'liquid') {
  mesh.count = 0;
  for (let col = 0; col <= WATER_COLS; col++) {
    const rim = WATER_RIM[col];
    waterHeight[col] = (sim.volume - sampleSurface(sim, sim.surface.displacement, rim.u, rim.v)) * HEIGHT;
  }
  const meanTemp = sim.meanTemperature();
  const p = [0, 0, 0], q = [0, 0, 0], r = [0, 0, 0], s = [0, 0, 0], color = [0, 0, 0];
  for (let row = 0; row < WATER_LEVELS; row++) {
    const y0 = 1 - row / WATER_LEVELS, y1 = 1 - (row + 1) / WATER_LEVELS, ym = (row + .5) / WATER_LEVELS;
    for (let col = 0; col < WATER_COLS; col++) {
      const a = WATER_RIM[col], b = WATER_RIM[col + 1], wa = waterHeight[col], wb = waterHeight[col + 1];
      p[0] = a.x; p[1] = wa * y0; p[2] = a.z;
      q[0] = b.x; q[1] = wb * y0; q[2] = b.z;
      r[0] = b.x; r[1] = wb * y1; r[2] = b.z;
      s[0] = a.x; s[1] = wa * y1; s[2] = a.z;
      const uv = WATER_MID_UV[col], field = sim.index(uv[0], ym, uv[1]);
      const localTemp = sim.temperature[field];
      const heat = clamp((localTemp - meanTemp) * .45 + (localTemp - sim.settings.room) / 22, -1, 1);
      const localPh = phFromAcids(sim.fields.acetic[field], sim.fields.gluconic[field]);
      teaColor(localPh, heat, overlay, color);
      mesh.vertex(p, a.normal, color, .14, 2);
      mesh.vertex(q, b.normal, color, .14, 2);
      mesh.vertex(r, b.normal, color, .14, 2);
      mesh.vertex(p, a.normal, color, .14, 2);
      mesh.vertex(r, b.normal, color, .14, 2);
      mesh.vertex(s, a.normal, color, .14, 2);
    }
  }
  const size = 32;
  for (let z = 0; z < size; z++)
    for (let x = 0; x < size; x++) {
      liquidPosition(sim, x / size, 0, z / size, p);
      liquidPosition(sim, (x + 1) / size, 0, z / size, q);
      liquidPosition(sim, (x + 1) / size, 0, (z + 1) / size, r);
      liquidPosition(sim, x / size, 0, (z + 1) / size, s);
      const field = sim.index((x + .5) / size, .04, (z + .5) / size);
      const localTemp = sim.temperature[field];
      const heat = clamp((localTemp - meanTemp) * .45 + (localTemp - sim.settings.room) / 22, -1, 1);
      const localPh = phFromAcids(sim.fields.acetic[field], sim.fields.gluconic[field]);
      teaColor(localPh, heat, overlay, color);
      color[0] = Math.min(1, color[0] * 1.12 + .04);
      color[1] = Math.min(1, color[1] * 1.12 + .03);
      color[2] = Math.min(1, color[2] * 1.10 + .02);
      mesh.triangle(p, r, q, color, .28, 2);
      mesh.triangle(p, s, r, color, .28, 2);
    }
}
const FILM_COLS = 36, FILM_ROWS = 28, FILM_STRIDE = FILM_COLS + 1;
const makeFilmVertex = () => ({ p: [0, 0, 0], top: [0, 0, 0], bottom: [0, 0, 0], u: 0, v: 0, uv: [0, 0], density: 0, mature: 0, blister: 0 });
const FILM_GRID = Array.from({ length: FILM_STRIDE * (FILM_ROWS + 1) }, makeFilmVertex);
const FILM_CLIP = Array.from({ length: 4 }, makeFilmVertex);
const FILM_TRI = [null, null, null], FILM_POLY = [], FILM_EDGE = [];
const WALL_COLOR_A = [.74, .61, .39], WALL_COLOR_B = [.83, .72, .49];

// Clip the actual material contour, giving patches a closed, thin, irregular
// edge. An empty material cell no longer makes an entire square slab.
export function buildFilm(mesh, sim) {
  mesh.count = 0;
  const cols = FILM_COLS, rows = FILM_ROWS, cut = FILM_CUTOFF, stride = FILM_STRIDE;
  const world = [0, 0], grid = FILM_GRID;
  const syncBounds = out => {
    const topLift = .002 + out.density * .0055 + out.mature * .0018;
    const bottomDrop = .0055 + out.density * .012;
    out.top[0] = out.p[0]; out.top[1] = out.p[1] + topLift; out.top[2] = out.p[2];
    out.bottom[0] = out.p[0]; out.bottom[1] = out.p[1] - bottomDrop; out.bottom[2] = out.p[2];
    return out;
  };
  for (let z = 0; z <= rows; z++)
    for (let x = 0; x <= cols; x++) {
      const u = x / cols, v = z / rows, out = grid[z * stride + x];
      out.u = u; out.v = v; out.uv[0] = u; out.uv[1] = v;
      out.density = sampleSurface(sim, sim.pellicle, u, v);
      out.mature = sampleSurface(sim, sim.membrane.layers[2], u, v);
      filmPoint(sim, u, v, world);
      out.blister = Math.min(1, sampleSurface(sim, sim.gas.pockets, world[0], world[1]) * 1.1);
      toDisc(world[0], world[1], out.p, LIQUID_RADIUS);
      out.p[2] = out.p[1];
      const disp = sampleSurface(sim, sim.membrane.displacement, u, v);
      out.p[1] = (sim.volume - disp) * HEIGHT + out.blister * .003;
      syncBounds(out);
    }
  let clipIndex = 0;
  const interpolate = (a, b) => {
    const out = FILM_CLIP[clipIndex++ & 3];
    const t = (cut - a.density) / (b.density - a.density);
    out.u = a.u + (b.u - a.u) * t; out.v = a.v + (b.v - a.v) * t;
    out.uv[0] = out.u; out.uv[1] = out.v;
    out.density = cut;
    out.mature = a.mature + (b.mature - a.mature) * t;
    out.blister = a.blister + (b.blister - a.blister) * t;
    out.p[0] = a.p[0] + (b.p[0] - a.p[0]) * t;
    out.p[1] = a.p[1] + (b.p[1] - a.p[1]) * t;
    out.p[2] = a.p[2] + (b.p[2] - a.p[2]) * t;
    return syncBounds(out);
  };
  const topColor = [0, 0, 0], bottomColor = [0, 0, 0];
  const wall = (a, b) => {
    mesh.triangle(a.top, a.bottom, b.bottom, WALL_COLOR_A, .96, 3, a.uv, a.uv, b.uv);
    mesh.triangle(a.top, b.bottom, b.top, WALL_COLOR_B, .96, 3, a.uv, b.uv, b.uv);
  };
  const emit = (v0, v1, v2) => {
    FILM_TRI[0] = v0; FILM_TRI[1] = v1; FILM_TRI[2] = v2;
    FILM_POLY.length = 0; FILM_EDGE.length = 0;
    clipIndex = 0;
    for (let i = 0; i < 3; i++) {
      const a = FILM_TRI[i], b = FILM_TRI[(i + 1) % 3], inside = a.density >= cut;
      if (inside)
        FILM_POLY.push(a);
      if (inside !== (b.density >= cut)) {
        const c = interpolate(a, b);
        FILM_POLY.push(c);
        FILM_EDGE.push(c);
      }
    }
    if (FILM_POLY.length < 3)
      return;
    for (let i = 1; i < FILM_POLY.length - 1; i++) {
      const a = FILM_POLY[0], b = FILM_POLY[i], c = FILM_POLY[i + 1];
      const density = (a.density + b.density + c.density) / 3;
      const matureRatio = clamp((a.mature + b.mature + c.mature) / Math.max(.02, density * 3), 0, 1);
      const blister = (a.blister + b.blister + c.blister) / 3;
      topColor[0] = clamp(.93 - matureRatio * .09 + blister * .04, 0, 1);
      topColor[1] = clamp(.87 - matureRatio * .13 + blister * .05, 0, 1);
      topColor[2] = clamp(.73 - matureRatio * .22 + blister * .08, 0, 1);
      bottomColor[0] = .64 - matureRatio * .10;
      bottomColor[1] = .46 - matureRatio * .09;
      bottomColor[2] = .24 - matureRatio * .06;
      mesh.triangle(a.top, c.top, b.top, topColor, Math.min(1, .68 + density * .9), 3, a.uv, c.uv, b.uv);
      mesh.triangle(a.bottom, b.bottom, c.bottom, bottomColor, 1, 3, a.uv, b.uv, c.uv);
    }
    if (FILM_EDGE.length === 2)
      wall(FILM_EDGE[0], FILM_EDGE[1]);
  };
  for (let z = 0; z < rows; z++)
    for (let x = 0; x < cols; x++) {
      const i = z * stride + x;
      const a = grid[i], b = grid[i + 1], c = grid[i + stride + 1], d = grid[i + stride];
      emit(a, b, c);
      emit(a, c, d);
    }
  // Material that grows all the way to the computational rim also needs a
  // closed edge; its top and underside must never become disconnected skins.
  for (let edge = 0; edge < 4; edge++) {
    const count = edge % 2 ? rows : cols;
    const at = i => edge === 0 ? grid[i] : edge === 1 ? grid[i * stride + cols] : edge === 2 ? grid[rows * stride + cols - i] : grid[(rows - i) * stride];
    for (let i = 0; i < count; i++) {
      let a = at(i), b = at(i + 1);
      if (Math.max(a.density, b.density) < cut)
        continue;
      if (Math.min(a.density, b.density) < cut) {
        clipIndex = 0;
        const p = interpolate(a, b);
        if (a.density < cut)
          a = p;
        else
          b = p;
      }
      wall(a, b);
    }
  }
}
export function fieldColor(sim, index, channel) {
  const f = sim.fields;
  if (channel === 0)
    return [(f.sucrose[index] + f.glucose[index] + f.fructose[index]) / 100, CHEMICAL_COLORS.sugar];
  if (channel === 1)
    return [f.oxygen[index] / .6, CHEMICAL_COLORS.oxygen];
  if (channel === 2)
    return [f.ethanol[index] / 8, CHEMICAL_COLORS.ethanol];
  if (channel === 3)
    return [(f.acetic[index] + f.gluconic[index]) / 3, CHEMICAL_COLORS.acid];
  return [f.co2[index] / 5, CHEMICAL_COLORS.co2];
}
