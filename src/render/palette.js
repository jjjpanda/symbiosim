// Species keep the same identity in the vessel and the tracking microscopes.
export const SPECIES_COLORS = { yeast: [.81, .55, .23], bacteria: [.20, .61, .58] };
export const FLOW_COLOR = [.48, .63, .63];
// A symmetric scale around the room average, expanded for hot/cold pours.
// Shared by volume samples, water tint, and the numeric legend.
export function temperatureRange(sim) {
  const centre = sim.settings.room;
  let extent = 2;
  for (const value of sim.temperature) extent = Math.max(extent, Math.abs(value - centre));
  extent = Math.ceil(extent * 2) / 2;
  return { low: centre - extent, high: centre + extent, centre, extent };
}
export const cssColor = color => `rgb(${color.map(c => Math.round(c * 255)).join(',')})`;
