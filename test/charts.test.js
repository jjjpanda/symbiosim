import test from 'node:test';
import assert from 'node:assert/strict';
import { HISTORY_CHARTS, historyWindow, chartSeries, drawChart, readingDeltas } from '../src/charts.js';
import { Simulation } from '../src/engine.js';
import { vesselTemplate } from '../src/template.js';

test('daily stats interpolate irregular history and wait for a complete day', () => {
  const history = [{ day: .8, temperature: 20, sugar: 100, ph: 4.2 }, { day: 1.4, temperature: 26, sugar: 70, ph: 3.9 }];
  assert.equal(readingDeltas(history, { day: 1.5 }), null);
  assert.equal(readingDeltas([], { day: 10 }), null);
  const delta = readingDeltas(history, { day: 2, temperature: 24, sugar: 80, ph: 3.8 });
  assert.ok(Math.abs(delta.temperature - 2) < 1e-9);
  assert.ok(Math.abs(delta.sugar + 10) < 1e-9);
  assert.ok(Math.abs(delta.ph + .3) < 1e-9);
});

test('charts use the visible history for both time and population scales', () => {
  const history = [
    { day: 0, yeast: 1500, bacteria: 500 },
    { day: 15, yeast: 40, bacteria: 80 },
    { day: 20, yeast: 60, bacteria: 70 }
  ];
  assert.deepEqual(historyWindow(history).points, history.slice(1));
  assert.equal(historyWindow(history).start, 10);
  assert.equal(chartSeries(history, 'culture')[0][2], 100, 'An old population peak must not flatten the current trend');
  assert.deepEqual(historyWindow([{ day: 19 }, { day: 20 }]), { start: 19, end: 20, span: 1, points: [{ day: 19 }, { day: 20 }] });
});

test('an empty or fresh history draws without invalid coordinates', () => {
  const svg = { viewBox: { baseVal: { width: 240, height: 90 } }, innerHTML: '' };
  for (const history of [[], [{ day: 0, sugar: 91, ph: 4.45 }]]) {
    drawChart(svg, history, 'chemistry', { warm: '#a74', cool: '#487' });
    assert.ok(!/NaN|Infinity/.test(svg.innerHTML));
    assert.equal((svg.innerHTML.match(/polyline/g) || []).length, 2);
  }
});

test('temperature history keeps hot tea and cold additions inside its value scale', () => {
  const history = [{ day: 0, temperature: 12 }, { day: 1, temperature: 74 }];
  assert.deepEqual(chartSeries(history, 'temperature'), [['temperature', 10, 75, 'cool']]);
});

test('History graphs record chemical means, handle missing older readings and label their scales', () => {
  const sim = new Simulation({ width: 8, height: 8, depth: 1 });
  for (const [key, value] of [['oxygen', .25], ['co2', .12], ['ethanol', 2.3], ['acetic', 1.1], ['gluconic', .7]]) sim.fields[key].fill(value);
  sim.record(); const sample = sim.history.at(-1);
  for (const [key, value] of [['oxygen', .25], ['co2', .12], ['ethanol', 2.3], ['acid', 1.8]]) assert.ok(Math.abs(sample[key] - value) < 1e-12);
  const snapshot = sim.snapshot(); delete snapshot.history[0].oxygen;
  assert.deepEqual(Simulation.restore(snapshot).history, snapshot.history);
  snapshot.history[1].oxygen = -1;
  assert.throws(() => Simulation.restore(snapshot), /Invalid vessel history/);
  const svg = { viewBox: { baseVal: { width: 320, height: 160 } }, innerHTML: '' };
  for (const { kind } of HISTORY_CHARTS) {
    drawChart(svg, sim.history, kind, { warm: '#a74', cool: '#487', gas: '#789' }, historyWindow(sim.history), true);
    assert.ok(!/NaN|Infinity|undefined/.test(svg.innerHTML), kind);
    assert.match(svg.innerHTML, /chart-tick/);
  }
  assert.equal(historyWindow([{ day: 100 }, { day: 100.08 }]).span, 100.08 - 100);
});

test('the compact workspace has one control for each tea action and one History graph per metric', () => {
  const markup = vesselTemplate(), ids = [...markup.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, new Set(ids).size);
  for (const id of ['pour', 'drain', 'skim']) assert.equal((markup.match(new RegExp('id="' + id + '"', 'g')) || []).length, 1);
  assert.doesNotMatch(markup, /quick-feed|quick-drain|care-mode|data-undo/);
  for (const { kind } of HISTORY_CHARTS) assert.ok(ids.includes('history-chart-' + kind));
});
