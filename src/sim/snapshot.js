import { FIELDS, PRESETS, MIN_VOLUME } from './constants.js';

const finite = (value, lo, hi = Infinity) => Number.isFinite(value) && value >= lo && value <= hi;

export function validateSnapshot(data) {
  if (!data || !Number.isInteger(data.version) || data.version < 1 || data.version > 13 ||
    !Number.isInteger(data.nx) || !Number.isInteger(data.ny) || data.nx < 8 || data.nx > 64 || data.ny < 8 || data.ny > 64) {
    throw new Error('Unsupported vessel snapshot');
  }
  const nz = data.version >= 7 ? data.nz : 1;
  if (!Number.isInteger(nz) || nz < 1 || nz > 12) throw new Error('Invalid vessel depth');
  const n = data.nx * data.ny * nz, surface = data.nx * nz;
  for (const name of FIELDS) {
    if (!Array.isArray(data.fields?.[name]) || data.fields[name].length !== n || data.fields[name].some(v => !finite(v, 0))) {
      throw new Error('Invalid vessel field');
    }
  }
  for (const key of ['temperature', 'vx', 'vy']) {
    if (!Array.isArray(data[key]) || data[key].length !== n || data[key].some(v => !Number.isFinite(v))) throw new Error('Invalid vessel grid');
  }
  if (data.version >= 7 && (!Array.isArray(data.vz) || data.vz.length !== n || data.vz.some(v => !Number.isFinite(v)))) {
    throw new Error('Invalid depth flow');
  }
  if (!Array.isArray(data.agents) || data.agents.length > 2000 || !finite(data.volume, MIN_VOLUME, .95)) throw new Error('Invalid vessel state');
  const ids = new Set();
  if (data.version >= 9) {
    const dispBound = data.version >= 11 ? .475001 : .025001;
    if (!data.surface || ['displacement', 'velocity'].some(key =>
      !Array.isArray(data.surface[key]) || data.surface[key].length !== surface ||
      data.surface[key].some(v => !finite(v, key === 'velocity' ? -.600001 : -dispBound, key === 'velocity' ? .600001 : dispBound)) ||
      Math.abs(data.surface[key].reduce((a, b) => a + b, 0) / surface) > 1e-8)) throw new Error('Invalid liquid surface');
  }
  for (const agent of data.agents) {
    if (!agent || !Number.isInteger(agent.id) || agent.id < 1 || ids.has(agent.id) ||
      !['yeast', 'bacteria'].includes(agent.type) || !finite(agent.x, 0, 1) || !finite(agent.y, 0, 1) ||
      (data.version >= 7 && !finite(agent.z, 0, 1)) || !finite(agent.age, 0) || !finite(agent.energy, 0, 2) ||
      !finite(agent.traits?.rate, .55, 1.5) || !finite(agent.traits?.tolerance, .55, 1.5)) throw new Error('Invalid vessel organism');
    if (agent.metabolism && ['sugar', 'oxygen', 'ethanol', 'co2', 'acid', 'turnover'].some(key => !finite(agent.metabolism[key], 0))) {
      throw new Error('Invalid organism metabolism');
    }
    ids.add(agent.id);
  }
  if (!finite(data.day, 0) || !Number.isInteger(data.seed) || data.seed < 0 || data.seed > 0xffffffff ||
    !Number.isInteger(data.nextAgentId) || data.nextAgentId <= Math.max(0, ...ids) ||
    (data.wave !== undefined && !finite(data.wave, 0)) || !finite(data.speed, 0, 60)) throw new Error('Invalid vessel clock');
  if (!Array.isArray(data.pellicle) || data.pellicle.length !== surface || data.pellicle.some(value => !finite(value, 0, 1))) throw new Error('Invalid pellicle');
  if (data.version >= 6 && (!data.membrane || ['displacement', 'velocity'].some(key =>
    !Array.isArray(data.membrane[key]) || data.membrane[key].length !== surface ||
    data.membrane[key].some(value => !finite(value, key === 'velocity' ? -2 : -.6, key === 'velocity' ? 2 : .76))))) throw new Error('Invalid cellulose membrane');
  if (data.version >= 11) {
    if (!data.vessel || !finite(data.vessel.tilt, -12, 12) ||
      (data.vessel.tiltZ !== undefined && !finite(data.vessel.tiltZ, -12, 12)) ||
      !finite(data.vessel.aspect, .2, 5)) throw new Error('Invalid vessel orientation');
    const body = data.membrane.body;
    if (!body || ['offsetX', 'offsetZ', 'velocityX', 'velocityZ'].some(key => !Array.isArray(body[key]) || body[key].length !== surface ||
      body[key].some(v => !finite(v, key.startsWith('offset') ? -.18 : -.35, key.startsWith('offset') ? .18 : .35)))) throw new Error('Invalid floating cellulose body');
    if (data.version >= 12 && (!body.pose || ['x', 'z', 'angle', 'vx', 'vz', 'spin'].some(key => !finite(body.pose[key], key === 'angle' ? -Math.PI : -2, key === 'angle' ? Math.PI : 2)))) {
      throw new Error('Invalid cellulose pose');
    }
  }
  if (data.version >= 8) {
    const layers = data.membrane.layers;
    if (!Array.isArray(layers) || layers.length !== 3 || layers.some(layer => !Array.isArray(layer) || layer.length !== surface || layer.some(v => !finite(v, 0, 1))) ||
      data.pellicle.some((density, i) => Math.abs(density - layers[0][i] - layers[1][i] - layers[2][i]) > 1e-8)) throw new Error('Invalid cellulose layers');
  }
  const settings = data.settings;
  if (!settings || !Object.hasOwn(PRESETS, settings.cover) ||
    !finite(settings.room, 15, 35) || !finite(settings.swing, 0, 12) || !finite(settings.permeability, 0, 1) ||
    !finite(settings.convection, 0, 2.5) || !finite(settings.variation, 0, .3)) throw new Error('Invalid vessel settings');
  if (!finite(data.headspace?.oxygen, 0, .21) || !finite(data.headspace?.co2, 0, 10)) throw new Error('Invalid headspace');
  if (!Array.isArray(data.history) || !data.history.length || data.history.length > 240 || data.history.some((point, index) =>
    !point || !finite(point.day, 0, data.day) || (index > 0 && point.day < data.history[index - 1].day) ||
    ['sugar', 'ph', 'yeast', 'bacteria', 'temperature'].some(key => !finite(point[key], 0)) ||
    ['oxygen', 'co2', 'ethanol', 'acid'].some(key => point[key] !== undefined && !finite(point[key], 0)))) throw new Error('Invalid vessel history');
  if (data.gas !== undefined) {
    const g = data.gas;
    if (!g || !finite(g.credit, 0, .018) || !Number.isInteger(g.nextId) || g.nextId < 1 ||
      !Number.isInteger(g.released) || g.released < 0 ||
      !Array.isArray(g.pockets) || g.pockets.length !== surface || g.pockets.some(v => !finite(v, 0, data.version >= 10 ? Number.MAX_SAFE_INTEGER : 1.45)) ||
      !Array.isArray(g.bubbles) || g.bubbles.length > 80 || g.bubbles.some(b => !b || !Number.isInteger(b.id) || !finite(b.x, 0, 1) || !finite(b.y, 0, 1) || (data.version >= 7 && !finite(b.z, 0, 1)) || !finite(b.size, .65, data.version >= 8 ? 2.4 : 1.35)) ||
      !Array.isArray(g.bursts) || g.bursts.length > 12 || g.bursts.some(b => !b || !finite(b.x, 0, 1) || (data.version >= 7 && !finite(b.z, 0, 1)) || !finite(b.age, 0, .32) || !finite(b.strength, .25, 2))) {
      throw new Error('Invalid gas tracers');
    }
  }
  if (data.version >= 4) {
    const c = data.care;
    if (data.version >= 13 && (!c || typeof c.autoSkim !== 'boolean' || !Number.isInteger(c.skims) || c.skims < 0 || !finite(c.skimmed, 0))) {
      throw new Error('Invalid pellicle care');
    }
    if (!c || typeof c.autoDrain !== 'boolean' || typeof c.teaMode !== 'boolean' ||
      !finite(c.interval, .1, 30) || !finite(c.fraction, 1e-12, .95) ||
      !finite(c.sugar, 0, 160) || !finite(c.temperature, 10, 95) ||
      !finite(c.elapsed, 0) || c.elapsed >= c.interval ||
      ['exchanges', 'drained', 'added'].some(key => !finite(c[key], 0))) throw new Error('Invalid automatic care');
    const t = c.transfer;
    if (t != null && (!['drain', 'pour'].includes(t.phase) || (t.manual !== undefined && typeof t.manual !== 'boolean') ||
      !finite(t.total, 1e-12, .95) || !finite(t.remaining, 0, t.total) ||
      !finite(t.recipe?.sugar, 0, 160) || !finite(t.recipe?.temperature, 10, 95))) {
      throw new Error('Invalid automatic transfer');
    }
  }
}
