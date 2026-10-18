import { moldPpm } from './sim/mold.js';
import { stopSwirl } from './swirl.js';

export function updateMold(view) {
  const sim = view.sim, ppm = moldPpm(sim);
  const status = view.$('#mold-status');
  status.hidden = !ppm && !sim.mold.failed;
  status.textContent = sim.mold.failed ? 'Mold takeover — restart vessel' : `Mold: ${ppm.toFixed(1)} ppm`;
  if (!sim.mold.failed) return;
  sim.playing = false;
  stopSwirl(view);
  view.pending = 0;
  if (view.moldNoticeSim === sim) return;
  // Replace any other modal so the restart action receives keyboard focus.
  for (const id of ['#panel', '#detail']) if (view.$(id).open) view.$(id).close();
  view.$('#mold-dialog').showModal();
  view.moldNoticeSim = sim;
}
