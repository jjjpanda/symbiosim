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

export function historyWindow(history) {
  const end = history.at(-1)?.day ?? 0;
  const start = Math.max(history[0]?.day ?? 0, end - 10);
  return { start, end, span: Math.max(.1, end - start), points: history.filter(point => point.day >= start) };
}

export function chartSeries(history, kind, window = historyWindow(history)) {
  const { points } = window;
  let populationMax = 100, tempMin = 15, tempMax = 35, sugarMax = 120;
  for (const point of points) {
    populationMax = Math.max(populationMax, point.yeast, point.bacteria);
    tempMin = Math.min(tempMin, Math.floor(point.temperature / 5) * 5);
    tempMax = Math.max(tempMax, Math.ceil(point.temperature / 5) * 5);
    sugarMax = Math.max(sugarMax, Math.ceil(point.sugar / 20) * 20);
  }
  if (kind === 'temperature') return [['temperature', tempMin, tempMax, 'cool']];
  if (kind === 'culture') return [['yeast', 0, populationMax, 'warm'], ['bacteria', 0, populationMax, 'cool']];
  return [['sugar', 0, sugarMax, 'warm'], ['ph', 2.4, 5, 'cool']];
}

export function drawChart(svg, history, kind, palette, window = historyWindow(history)) {
  const { start, span, points } = window;
  const { width, height } = svg.viewBox.baseVal;
  svg.innerHTML = chartSeries(history, kind, window).map(([key, min, max, color]) => {
    const coordinates = points.map(point => [
      ((point.day - start) / span * width).toFixed(2),
      (height - 1 - clamp((point[key] - min) / (max - min), 0, 1) * (height - 2)).toFixed(2)
    ].join(',')).join(' ');
    return `<polyline stroke="${palette[color]}" points="${coordinates}"/>`;
  }).join('');
}
