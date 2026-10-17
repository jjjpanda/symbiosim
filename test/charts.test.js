import test from 'node:test';
import assert from 'node:assert/strict';
import { historyWindow, chartSeries, drawChart, readingDeltas } from '../src/charts.js';

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
