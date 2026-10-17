// Species keep the same identity in the vessel and the tracking microscopes.
export const SPECIES_COLORS = { yeast: [.81, .55, .23], bacteria: [.20, .61, .58] };
export const FLOW_COLOR = [.48, .63, .63];
export const cssColor = color => `rgb(${color.map(c => Math.round(c * 255)).join(',')})`;
