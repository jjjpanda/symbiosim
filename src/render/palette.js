// Species keep the same identity in the vessel and the tracking microscopes.
export const SPECIES_COLORS = { yeast: [.67, .64, .38], bacteria: [.34, .65, .83] };
export const MOLD_COLOR = [.32, .53, .19];
// Fields use their own hues, distinct from yellow yeast, blue bacteria and pale gas.
export const FLOW_COLOR = [.57, .45, .59];
export const SCALAR_LOW = [.14, .12, .15];
export const THERMAL_COLORS = [[.18, .34, .62], [.40, .37, .43], [.78, .49, .32]];

// Reserve stronger color for the upper range. The legend samples this exact
// curve; fixed sample size and opacity keep intensity from compounding.
export function scalarColor(color, amount, out = [0, 0, 0], low = SCALAR_LOW) {
  const t = Math.max(0, Math.min(1, amount)) ** 2;
  for (let i = 0; i < 3; i++) out[i] = low[i] + (color[i] - low[i]) * t;
  return out;
}

export function temperatureColor(heat, out = [0, 0, 0]) {
  const [low, mid, high] = THERMAL_COLORS;
  return scalarColor(heat < 0 ? low : high, Math.abs(heat), out, mid);
}
// A symmetric scale around the room average, expanded for hot/cold pours.
// Shared by volume samples, water tint, and the numeric legend.
export function temperatureRange(sim) {
  const centre = sim.settings.room;
  // Follow the measured deviation without magnifying sub-tenth-degree noise.
  let extent = .1;
  for (const value of sim.temperature) extent = Math.max(extent, Math.abs(value - centre));
  return { low: centre - extent, high: centre + extent, centre, extent };
}
export const cssColor = color => `rgb(${color.map(c => Math.round(c * 255)).join(',')})`;
