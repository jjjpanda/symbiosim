import { toDisc } from './sim/domain.js';
import { LIQUID_RADIUS } from './sim/constants.js';

// Fit a bulk rotation to the solver's tangential momentum in circular jar space.
// Convert the material-grid velocity with the square-to-disc Jacobian, then use
// the same motion clock as the visible tea. Opposing eddies cancel in this fit.
export function swirlSpeed(sim) {
  if (!sim.nx) return 0;
  let momentum = 0, inertia = 0;
  const point = [0, 0];
  for (let z = 0; z < sim.nz; z++) for (let x = 0; x < sim.nx; x++) {
    const u = (x + .5) / sim.nx, v = (z + .5) / sim.nz;
    const a = 2 * u - 1, b = 2 * v - 1;
    const sx = Math.sqrt(1 - b * b / 2), sz = Math.sqrt(1 - a * a / 2);
    toDisc(u, v, point, LIQUID_RADIUS);
    const [px, pz] = point;
    for (let y = 0; y < sim.ny; y++) {
      const i = (z * sim.ny + y) * sim.nx + x;
      const vx = LIQUID_RADIUS * (2 * sx * sim.vx[i] - a * b / sx * sim.vz[i]);
      const vz = LIQUID_RADIUS * (2 * sz * sim.vz[i] - a * b / sz * sim.vx[i]);
      momentum += px * vz - pz * vx;
      inertia += px * px + pz * pz;
    }
  }
  return inertia ? Math.abs(momentum / inertia) * Math.max(12, sim.speed) / (2 * Math.PI) : 0;
}

export function updateSwirlSpeed(view) {
  const output = view.$('#swirl-speed');
  if (output) output.textContent = `${swirlSpeed(view.sim).toFixed(1)} rpm${view.sim.playing ? '' : ' queued'}`;
}

// One hold lifecycle for mouse, touch, keyboard, focus loss and disconnection.
export function startSwirl(view) {
  if (view.swirlHold || view.sim.mold?.failed) return;
  view.swirlHold = { seconds: 0, pending: 0 };
  view.sim.stir(.2);
  updateSwirlSpeed(view);
  view.$('#swirl').setAttribute('aria-pressed', 'true');
  view.announce(view.sim.playing ? 'Swirling. Hold to build speed.' : 'Swirl queued. Resume or Step to see the tea move.');
}

export function stopSwirl(view) {
  view.swirlHold = null;
  view.$?.('#swirl')?.setAttribute('aria-pressed', 'false');
}

export function advanceSwirl(view, elapsed) {
  const hold = view.swirlHold;
  if (!hold) return;
  hold.seconds += elapsed;
  hold.pending += elapsed;
  while (hold.pending >= .12) {
    hold.pending -= .12;
    view.sim.stir(Math.min(.35, .04 + hold.seconds * .05));
    updateSwirlSpeed(view);
  }
}

export function bindSwirl(view) {
  const button = view.$('#swirl');
  button.oncontextmenu = e => e.preventDefault();
  button.onpointerdown = e => {
    if (e.button !== 0) return;
    button.focus();
    button.setPointerCapture(e.pointerId); startSwirl(view);
  };
  button.onpointerup = button.onpointercancel = button.onlostpointercapture = () => stopSwirl(view);
  button.onkeydown = e => {
    if (![' ', 'Enter'].includes(e.key)) return;
    e.preventDefault(); e.stopPropagation(); startSwirl(view);
  };
  button.onkeyup = e => {
    if ([' ', 'Enter'].includes(e.key)) { e.preventDefault(); stopSwirl(view); }
  };
  // Assistive technology can activate a button without a pointer or key event.
  button.onclick = e => { if (e.detail === 0 && !view.swirlHold) view.command('w'); };
  view.addEventListener('keyup', e => { if (e.key.toLowerCase() === 'w') stopSwirl(view); });
  view.addEventListener('blur', () => stopSwirl(view), true);
}
