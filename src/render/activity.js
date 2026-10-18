// Keep reaction cues legible at high biological pace without modifying metabolism.
export function activityTurnover(view, agent, sim = view.sim) {
  const samples = view.activitySamples ||= new WeakMap();
  const turnover = agent.metabolism?.turnover || 0;
  let sample = samples.get(agent);
  if (!sample) {
    sample = { actual: turnover, visible: 0, day: sim.day };
    samples.set(agent, sample);
  }
  if (sample.day !== sim.day) {
    const delta = Math.max(0, turnover - sample.actual);
    const seconds = Math.max(0, (sim.day - sample.day) * 60 / Math.max(1, sim.speed));
    sample.visible += Math.min(seconds * 2, delta * Math.min(1, 4 / sim.speed));
    sample.actual = turnover; sample.day = sim.day;
  }
  return sample.visible;
}
