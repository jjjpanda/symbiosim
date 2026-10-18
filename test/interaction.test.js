import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultCamera, zoomCamera, bindCamera } from '../src/render/camera.js';
import { cameraMatrix, HEIGHT } from '../src/render/space.js';
import { startSwirl, stopSwirl, advanceSwirl, bindSwirl, swirlSpeed, updateSwirlSpeed } from '../src/swirl.js';
import { activityTurnover } from '../src/render/activity.js';
import { FIELD_VIEWS } from '../src/fields.js';
import { HISTORY_CHARTS } from '../src/charts.js';
import { Simulation } from '../src/engine.js';
import { advanceParticles } from '../src/render/particles.js';
import { LIQUID_RADIUS } from '../src/sim/constants.js';
import { toDisc } from '../src/sim/domain.js';
import { scalarColor, SCALAR_LOW, temperatureColor } from '../src/render/palette.js';

test('zoom enlarges the shared projection, stays bounded, and resets with the camera', () => {
  const camera = defaultCamera(), controls = new Map();
  const view = { camera, canvas: {}, updateCamera() {}, draw() {}, $: id => {
    if (!controls.has(id)) controls.set(id, {});
    return controls.get(id);
  } };
  const before = cameraMatrix(500, 700, camera).project([.3, .72, 0]);
  zoomCamera(camera, 2);
  const after = cameraMatrix(500, 700, camera).project([.3, .72, 0]);
  assert.ok(Math.abs(after[0] - 250) > Math.abs(before[0] - 250) * 1.9);
  zoomCamera(camera, 100); assert.equal(camera.zoom, 3);
  const focused = cameraMatrix(500, 700, camera).project([0, HEIGHT * .29, 0]);
  assert.ok(Math.abs(focused[1] - 350) < 1e-8, 'Full zoom naturally centers the lower third of the jar');
  zoomCamera(camera, .001); assert.equal(camera.zoom, 1);
  zoomCamera(camera, 2); bindCamera(view);
  controls.get('#reset-camera').onclick(); assert.deepEqual(camera, defaultCamera());
});

test('rotational speed fits bulk liquid motion and tracks playback pace without changing state', () => {
  const sim = new Simulation({ width: 8, height: 12, depth: 4 });
  const omega = 1.5;
  // Construct rigid rotation in jar coordinates, then map it into the solver grid.
  for (let z = 0; z < sim.nz; z++) for (let x = 0; x < sim.nx; x++) {
    const u = (x + .5) / sim.nx, v = (z + .5) / sim.nz;
    const [px, pz] = toDisc(u, v, [0, 0], LIQUID_RADIUS);
    const a = u * 2 - 1, b = v * 2 - 1;
    const sx = Math.sqrt(1 - b * b / 2), sz = Math.sqrt(1 - a * a / 2);
    const j11 = 2 * LIQUID_RADIUS * sx, j12 = -LIQUID_RADIUS * a * b / sx;
    const j21 = -LIQUID_RADIUS * a * b / sz, j22 = 2 * LIQUID_RADIUS * sz;
    const determinant = j11 * j22 - j12 * j21;
    for (let y = 0; y < sim.ny; y++) {
      const i = (z * sim.ny + y) * sim.nx + x;
      sim.vx[i] = (-omega * pz * j22 - j12 * omega * px) / determinant;
      sim.vz[i] = (j11 * omega * px + omega * pz * j21) / determinant;
    }
  }
  sim.speed = 12;
  const before = sim.snapshot(), rpm = omega * 12 / (2 * Math.PI);
  assert.ok(Math.abs(swirlSpeed(sim) - rpm) < 1e-10);
  assert.deepEqual(sim.snapshot(), before);
  sim.speed = 60; assert.ok(Math.abs(swirlSpeed(sim) - rpm * 5) < 1e-10);
  const output = {}, view = { sim, $: () => output };
  sim.playing = false; updateSwirlSpeed(view);
  assert.match(output.textContent, /rpm queued$/);
  sim.playing = true; updateSwirlSpeed(view);
  assert.doesNotMatch(output.textContent, /queued/);
  sim.vx.fill(0); sim.vz.fill(0); assert.equal(swirlSpeed(sim), 0);
});

test('field ramps reserve strong color for upper values and keep midpoint temperatures subdued', () => {
  const high = [.8, .6, .3], low = scalarColor(high, 0), mid = scalarColor(high, .5);
  assert.deepEqual(low, SCALAR_LOW);
  assert.ok(mid.every((value,i)=>Math.abs(value-(SCALAR_LOW[i]+(high[i]-SCALAR_LOW[i])*.25))<1e-10));
  assert.deepEqual(scalarColor(high, 2), high);
  assert.ok(Math.max(...temperatureColor(0)) < .5, 'Ordinary temperature readings must not map to pale highlights');
});

test('holding swirl accelerates, preserves pause, and stops on release, cancellation and focus loss', () => {
  const strengths = [], listeners = new Map();
  const button = { focus() {}, setPointerCapture() {}, setAttribute(key, value) { this[key] = value; } };
  const view = { sim: { playing: false, stir: strength => strengths.push(strength) },
    $: () => button, announce() {}, addEventListener: (key, handler) => listeners.set(key, handler) };
  bindSwirl(view);
  button.onpointerdown({ button: 0, pointerId: 1 });
  startSwirl(view); assert.equal(strengths.length, 1, 'Key repeat must not restart a hold');
  for (let i = 0; i < 50; i++) advanceSwirl(view, .1);
  assert.ok(strengths.at(-1) > strengths[1] * 4);
  assert.equal(view.sim.playing, false);
  button.onpointerup(); const count = strengths.length;
  advanceSwirl(view, 1); assert.equal(strengths.length, count);
  assert.equal(button['aria-pressed'], 'false');
  for (const release of [button.onpointercancel, button.onlostpointercapture, listeners.get('blur'), () => listeners.get('keyup')({ key: 'w' })]) {
    startSwirl(view); release(); assert.equal(view.swirlHold, null);
  }
  stopSwirl(view); assert.equal(view.swirlHold, null);
});

test('activity cues keep the same bounded visual pace at 12 and 60 days per minute without mutating metabolism', () => {
  const phases = [];
  for (const speed of [12, 60]) {
    const view = { sim: { day: 0, speed } }, agent = { metabolism: { turnover: 0 } };
    activityTurnover(view, agent);
    for (let i = 0; i < 60; i++) {
      view.sim.day += speed / 3600; agent.metabolism.turnover += 100;
      activityTurnover(view, agent);
    }
    phases.push(activityTurnover(view, agent));
    assert.equal(agent.metabolism.turnover, 6000);
    assert.equal(activityTurnover(view, agent), phases.at(-1), 'Paused redraws must not advance cues');
  }
  assert.ok(Math.abs(phases[0] - phases[1]) < 1e-10);
  assert.ok(phases[0] <= 2.000001);
});

test('every field has matching history and scalar samples follow the solver without modifying the model', () => {
  const sim = new Simulation({ width: 8, height: 12, depth: 4 });
  const before = sim.snapshot();
  for (const field of FIELD_VIEWS) {
    assert.ok(HISTORY_CHARTS.some(chart => chart.kind === field.history), field.id);
    if (!field.chemical && field.id !== 'temperature') continue;
    const view = { sim, motion: true, overlay: field.id };
    advanceParticles(view, 0); const positions = view.particles.slice();
    advanceParticles(view, .2); assert.notDeepEqual(view.particles, positions, `${field.id} samples must move with the tea`);
    assert.ok(view.particles.every(value => value >= 0 && value <= 1));
    view.motion = false;
    const frozen = view.particles.slice();
    advanceParticles(view, .2); assert.deepEqual(view.particles, frozen, 'Reduced motion freezes field samples');
    view.motion = true;
    advanceParticles(view, 0); assert.deepEqual(view.particles, frozen, 'Redrawing a paused field must not advance samples');
  }
  assert.deepEqual(sim.snapshot(), before, 'Visual advection must not change chemistry, organisms, or RNG');
  sim.vx.fill(.3); sim.vy.fill(.4); sim.vz.fill(0); sim.record();
  assert.ok(Math.abs(sim.history.at(-1).flow - .5) < 1e-10);
  const saved = sim.snapshot(); saved.history.at(-1).flow = -1;
  assert.throws(() => Simulation.restore(saved), /Invalid vessel history/);
});
