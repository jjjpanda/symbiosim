import { CHEMICAL_COLORS } from './metabolism.js';
import { FLOW_COLOR, MOLD_COLOR, SPECIES_COLORS, THERMAL_COLORS, cssColor, scalarColor, temperatureColor, temperatureRange } from './render/palette.js';
import { FILM_CUTOFF } from './sim/constants.js';
import { MOLD_PPM } from './sim/mold.js';

// One source for the chooser, captions, and quantitative field legend.
export const FIELD_VIEWS = [
  { id: 'liquid', history: 'culture', name: 'Living tea', color: cssColor(SPECIES_COLORS.yeast), note: 'Yeast, bacteria, bubbles and the cellulose pellicle in circulating tea.', key: 'Muted yellow yeast · blue bacteria · pale bubbles', ends: ['Living culture', ''] },
  { id: 'organisms', history: 'culture', name: 'Cell activity', color: '#85b8d8', note: 'Follow uptake, products and exchanges between nearby cells. Sparse paths follow real metabolism at a readable visual pace.', key: 'Muted yellow yeast → ethanol → blue bacteria', ends: ['Active reactions', ''] },
  { id: 'flow', history: 'flow', name: 'Circulation', unit: 'model speed', color: cssColor(FLOW_COLOR), note: 'Curved paths follow the current velocity field. Colors scale from the slowest to the fastest current in the tea; still tea has no paths.', key: 'Slow current → fast current within the current range', ends: ['Slow', 'Fast'] },
  { id: 'temperature', history: 'temperature', name: 'Temperature', color: cssColor(THERMAL_COLORS[2]), note: 'Blue marks cooler tea; copper marks warmer tea. Moving sample points show local temperature as they follow the tea. Muted cells remain visible for context.', key: 'The scale centres on room temperature and follows the measured temperature deviation', ends: ['Cooler', 'Warmer'] },
  { id: 'mold', history: 'mold', name: 'Mold', unit: 'ppm', color: cssColor(MOLD_COLOR), note: 'Surface Aspergillus and Penicillium particulates feed on O₂ during low-acid early fermentation. Low pH and ethanol kill nascent spores; the vessel stops above 100 ppm.', key: 'Local surface particulate (ppm) within the current range; darker patches have less mold', ends: ['Lower', 'Higher'] },
  ...[
    ['sugar', 'Sugar', 'sugar', 'g/L', 'Food for yeast and bacteria. Colors show local differences; the readings and history show how much remains.'],
    ['oxygen', 'Oxygen', 'oxygen', 'model units', 'Enters at the surface and feeds acid-producing bacteria. Watch the gradient into the tea.'],
    ['ethanol', 'Ethanol', 'ethanol', 'g/L', 'Made by yeast, then consumed by bacteria. Look for pockets around active cells.'],
    ['acidity', 'Acids', 'acid', 'g/L', 'Acetic and gluconic acids accumulate around bacteria and spread with the currents.'],
    ['co2', 'Dissolved CO₂', 'co2', 'model units', 'Made by yeast. Dissolved gas travels through the liquid before gathering into bubbles.']
  ].map(([id, name, chemical, unit, note]) => ({ id, history: id === 'acidity' ? 'acid' : id, name, unit, color: cssColor(CHEMICAL_COLORS[chemical]), note,
    key: `Darker to brighter = lower to higher ${name.toLowerCase()} within the current range`, ends: ['Lower', 'Higher'], chemical }))
].map(field => ({ ...field, gradient: fieldGradient(field) }));

// Sample the renderer's actual response curve rather than implying a linear
// scale in CSS. Build once: these ramps do not depend on simulation state.
function fieldGradient(field) {
  const stops = Array.from({ length: 17 }, (_, i) => {
    const fraction = i / 16;
    const color = field.id === 'temperature' ? temperatureColor(fraction * 2 - 1)
      : scalarColor(field.id === 'mold' ? MOLD_COLOR : CHEMICAL_COLORS[field.chemical] || FLOW_COLOR, fraction);
    return `${cssColor(color)} ${fraction * 100}%`;
  });
  return `linear-gradient(90deg in srgb, ${stops.join(', ')})`;
}

export const OVERLAYS = FIELD_VIEWS.map(field => field.id);
export const CHEMICAL_FIELDS = FIELD_VIEWS.filter(field => field.chemical);

// Shared by labels and the renderer; these functions only observe model state.
export const fieldView = id => FIELD_VIEWS.find(field => field.id === id);
export function fieldAmount(sim, id, index) {
  if (id === 'mold') return sim.pellicle[index] >= FILM_CUTOFF ? sim.mold.coverage[index] * MOLD_PPM : 0;
  if (id === 'flow') return Math.hypot(sim.vx[index], sim.vy[index], sim.vz[index]);
  const f = sim.fields;
  return id === 'sugar' ? f.sucrose[index] + f.glucose[index] + f.fructose[index]
    : id === 'acidity' ? f.acetic[index] + f.gluconic[index] : f[id][index];
}
export function fieldStats(sim, id) {
  let total = 0, peak = 0, min = Infinity, count = 0;
  const size = id === 'mold' ? sim.pellicle.length : sim.n;
  for (let i = 0; i < size; i++) {
    if (id === 'mold' && sim.pellicle[i] < FILM_CUTOFF) continue;
    const amount = fieldAmount(sim, id, i);
    count++;
    total += amount; peak = Math.max(peak, amount); min = Math.min(min, amount);
  }
  return { mean: count ? total / count : 0, peak, min: count ? min : 0 };
}

export function fieldRange(sim, id) {
  if (id === 'temperature') {
    const range = temperatureRange(sim);
    return { ...range, span: 2 * range.extent };
  }
  const stats = fieldStats(sim, id);
  // A 0.1% relative floor prevents uniform fields and roundoff from flickering.
  const spread = stats.peak - stats.min;
  const span = Math.max(spread, Math.abs(stats.mean) * .001, id === 'mold' ? 1 : 1e-6);
  const low = span === spread ? stats.min : Math.max(0, stats.min - (span - spread) / 2);
  return { ...stats, low, high: span === spread ? stats.peak : low + span, span };
}

export const fieldFraction = (amount, range) => Math.max(0, Math.min(1, (amount - range.low) / range.span));

export function formatFieldValue(value, span) {
  if (value !== 0 && Math.abs(value) < .001) return value.toExponential(1);
  const digits = Math.max(2, Math.min(6, Math.ceil(-Math.log10(span)) + 1));
  return value.toFixed(digits);
}
