import { CHEMICAL_COLORS } from './metabolism.js';
import { FLOW_COLOR, cssColor } from './render/palette.js';

// One source for the chooser, captions, and quantitative field legend.
export const FIELD_VIEWS = [
  { id: 'liquid', name: 'Living tea', color: '#c99750', note: 'Yeast, bacteria, bubbles and the cellulose mother in circulating tea.', key: 'Amber yeast · teal bacteria · pale bubbles', ends: ['Living culture', ''] },
  { id: 'organisms', name: 'Cell activity', color: '#64b9ab', note: 'Follow uptake, products and exchanges between nearby cells. Paths appear as cells metabolize.', key: 'Amber yeast → ethanol → teal bacteria', ends: ['Active reactions', ''] },
  { id: 'flow', name: 'Circulation', color: cssColor(FLOW_COLOR), note: 'Curved paths follow the current velocity field. Brighter paths carry faster currents; still tea has no paths.', key: 'Slow current → fast current', ends: ['Slow', 'Fast'] },
  { id: 'temperature', name: 'Temperature', color: '#e39453', note: 'Blue marks cooler tea; orange marks warmer tea. Colored clouds sample temperature throughout the liquid.', key: 'The scale centres on room temperature and expands for hot or cold additions', ends: ['Cooler', 'Warmer'] },
  ...[
    ['sugar', 'Sugar', 'sugar', 100, 'g/L', 'Food for yeast and bacteria. Watch it thin out as the culture consumes it.'],
    ['oxygen', 'Oxygen', 'oxygen', .6, 'model units', 'Enters at the surface and feeds acid-producing bacteria. Watch the gradient into the tea.'],
    ['ethanol', 'Ethanol', 'ethanol', 8, 'g/L', 'Made by yeast, then consumed by bacteria. Look for pockets around active cells.'],
    ['acidity', 'Acids', 'acid', 3, 'g/L', 'Acetic and gluconic acids accumulate around bacteria and spread with the currents.'],
    ['co2', 'Dissolved CO₂', 'co2', 5, 'model units', 'Made by yeast. Dissolved gas travels through the liquid before gathering into bubbles.']
  ].map(([id, name, chemical, max, unit, note]) => ({ id, name, color: cssColor(CHEMICAL_COLORS[chemical]), note,
    key: `Brighter clouds = more ${name.toLowerCase()}`, ends: ['0', `${max} ${unit}+`], max, chemical }))
];

export const OVERLAYS = FIELD_VIEWS.map(field => field.id);
