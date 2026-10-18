import { HISTORY_CHARTS, drawChart, historyWindow, formatChartValue } from './charts.js';
import { fieldView } from './fields.js';

const fmt = value => value.toFixed(2);
const reading = (sample, kind) => (kind === 'culture' ? ['yeast', 'bacteria'] : [kind])
  .map(key => `${formatChartValue(sample?.[key], key)}${kind === 'culture' ? ' ' + key : ''}`).join(' · ');

// Compare the latest sample by identity: history remains bounded at 240 entries.
function observation(view, key, kind) {
  const history = view.sim.history, sample = history.at(-1), palette = view.palette;
  const previous = view[key];
  if (previous?.history === history && previous.sample === sample && previous.palette === palette && previous.kind === kind) return;
  return view[key] = { history, sample, palette, kind };
}

export function updateFieldHistory(view) {
  const kind = fieldView(view.overlay).history;
  const current = observation(view, 'fieldObservation', kind);
  if (!current) return;
  const { history, sample, palette } = current;
  const { title, unit, note } = HISTORY_CHARTS.find(chart => chart.kind === kind);
  view.$('#field-history-title').textContent = `${title} history`;
  view.$('#field-history-note').textContent = kind === 'culture'
    ? `${note}. Solid muted yellow: yeast; dashed blue: bacteria.` : `${note}. Time in simulated days.`;
  view.$('#field-history-reading').textContent = reading(sample, kind) + (kind === 'culture' ? '' : ` ${unit}`);
  drawChart(view.$('#field-history-chart'), history, kind, palette || {}, historyWindow(history), true);
}

export function updateHistoryDialog(view) {
  const current = observation(view, 'detailObservation');
  if (!current) return;
  const { history, sample, palette } = current, window = historyWindow(history);
  view.$('#history-window').textContent = `Days ${fmt(window.start)}–${fmt(window.end)} · latest recorded readings · up to 240 retained samples`;
  for (const { kind, title, unit } of HISTORY_CHARTS) {
    const svg = view.$('#history-chart-' + kind);
    drawChart(svg, history, kind, palette || {}, window, true);
    svg.setAttribute('aria-label', `${title}, day ${fmt(window.start)} to ${fmt(window.end)}; ${unit}.`);
    view.$('#history-reading-' + kind).textContent = reading(sample, kind);
  }
}
