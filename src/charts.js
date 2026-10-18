import { clamp } from './sim/constants.js';

// Compare live readings to an interpolated sample one biological day ago.
// A young culture has no daily trend yet; do not extrapolate its first moments.
export function readingDeltas(history, current) {
  const target = current.day - 1;
  if (!history.length || target < history[0].day) return null;
  let before = history[0], after = current;
  for (const point of history) {
    if (point.day > target) { after = point; break; }
    before = point;
  }
  const fraction = after.day > before.day ? (target - before.day) / (after.day - before.day) : 0;
  return Object.fromEntries(['temperature', 'sugar', 'ph'].map(key =>
    [key, current[key] - (before[key] + (after[key] - before[key]) * fraction)]));
}

export const HISTORY_CHARTS = [
  { kind: 'ph', title: 'pH', unit: 'pH', note: 'Calculated from vessel-average acids' },
  { kind: 'sugar', title: 'Sugar', unit: 'g/L', note: 'Sucrose + glucose + fructose' },
  { kind: 'temperature', title: 'Temperature', unit: '°C', note: 'Average liquid temperature' },
  { kind: 'culture', title: 'Culture', unit: 'cells', note: 'Modeled yeast and bacteria' },
  { kind: 'oxygen', title: 'Dissolved O₂', unit: 'model conc.', note: 'Liquid average; illustrative gas scale' },
  { kind: 'co2', title: 'Dissolved CO₂', unit: 'model conc.', note: 'Liquid average; excludes bubbles and headspace' },
  { kind: 'acid', title: 'Acetic + gluconic acid', unit: 'g/L', note: 'Combined liquid concentration' },
  { kind: 'ethanol', title: 'Ethanol', unit: 'g/L', note: 'Dissolved ethanol' },
  { kind: 'flow', title: 'Circulation', unit: 'model speed', note: 'Mean solver velocity magnitude' },
  { kind: 'mold', title: 'Mold', unit: 'ppm', note: 'Surface particulate; restart above 100 ppm' }
];

export function historyWindow(history) {
  const end = history.at(-1)?.day ?? 0;
  const start = Math.max(history[0]?.day ?? 0, end - 10);
  return { start, end, span: end > start ? end - start : .1, points: history.filter(point => point.day >= start) };
}

export function chartSeries(history, kind, window = historyWindow(history)) {
  const { points } = window;
  const values = key => points.map(point => point[key]).filter(Number.isFinite);
  const populationMax = Math.max(100, ...values('yeast'), ...values('bacteria'));
  const tempMin = Math.min(15, ...values('temperature').map(value => Math.floor(value / 5) * 5));
  const tempMax = Math.max(35, ...values('temperature').map(value => Math.ceil(value / 5) * 5));
  const sugarMax = Math.max(120, ...values('sugar').map(value => Math.ceil(value / 20) * 20));
  const phMin = Math.min(2.4, ...values('ph')), phMax = Math.max(5, ...values('ph'));
  if (kind === 'temperature') return [['temperature', tempMin, tempMax, 'cool']];
  if (kind === 'culture') return [['yeast', 0, populationMax, 'warm'], ['bacteria', 0, populationMax, 'cool']];
  if (kind === 'chemistry') return [['sugar', 0, sugarMax, 'warm'], ['ph', phMin, phMax, 'cool']];
  if (kind === 'ph') return [['ph', phMin, phMax, 'cool']];
  if (kind === 'sugar') return [['sugar', 0, sugarMax, 'warm']];
  const peak = Math.max(kind === 'oxygen' ? .5 : kind === 'co2' || kind === 'flow' ? .1 : kind === 'mold' ? 100 : 1, ...values(kind));
  const step = 10 ** Math.floor(Math.log10(peak)) / 5;
  return [[kind, 0, Math.ceil(peak / step) * step, kind === 'co2' ? 'gas' : kind === 'oxygen' ? 'cool' : 'warm']];
}

export function formatChartValue(value, key) {
  if (!Number.isFinite(value)) return 'Not recorded';
  if (value !== 0 && Math.abs(value) < .001) return value.toExponential(1);
  const precision = { ph: 2, sugar: 1, acid: 2, ethanol: 2, oxygen: 3, co2: 3, temperature: 1, yeast: 0, bacteria: 0, mold: 1 };
  return key in precision ? value.toFixed(precision[key]) : Number(value.toPrecision(3)).toString();
}

export function drawChart(svg, history, kind, palette, window = historyWindow(history), axes = false) {
  const { start, span, points } = window;
  const { width, height } = svg.viewBox.baseVal;
  const left = axes ? 44 : 0, right = axes ? 12 : 0, top = axes ? 12 : 1, bottom = axes ? 24 : 1;
  const w = width - left - right, h = height - top - bottom;
  const series = chartSeries(history, kind, window);
  const marks = series.map(([key, min, max, color]) => {
    const stroke = palette[key] || palette[color] || palette.cool;
    const segments = [[]];
    for (const point of points) {
      if (!Number.isFinite(point[key])) { if (segments.at(-1).length) segments.push([]); continue; }
      segments.at(-1).push(`${(left + (point.day - start) / span * w).toFixed(2)},${(top + h - clamp((point[key] - min) / (max - min), 0, 1) * h).toFixed(2)}`);
    }
    return segments.map(segment => `<polyline ${key === 'bacteria' ? 'stroke-dasharray="5 3"' : ''} stroke="${stroke}" points="${segment.join(' ')}"/>${segment.length === 1 ? `<circle cx="${segment[0].split(',')[0]}" cy="${segment[0].split(',')[1]}" r="2.5" fill="${stroke}"/>` : ''}`).join('');
  }).join('');
  const [, min, max] = series[0];
  const grid = axes ? [0, .5, 1].map(t => {
    const y = top + h * t;
    return `<line class="chart-gridline" x1="${left}" x2="${width - right}" y1="${y}" y2="${y}"/><text class="chart-tick" x="${left - 6}" y="${y + 3}" text-anchor="end">${formatChartValue(max - (max - min) * t)}</text>`;
  }).join('') + (window.end === start ? [0] : [0, .5, 1]).map(t => `<text class="chart-tick" x="${left + w * t}" y="${height - 5}" text-anchor="${t === 0 ? 'start' : t === 1 ? 'end' : 'middle'}">${(start + (window.end - start) * t).toFixed(2)}</text>`).join('') : '';
  svg.innerHTML = grid + marks;
}
