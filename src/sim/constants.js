export const FIELDS = ['sucrose', 'glucose', 'fructose', 'ethanol', 'oxygen', 'acetic', 'gluconic', 'co2'];
export const PRESETS = { open: 1, breathable: .45, sealed: .005 };
export const REGIMES = {
  balanced: { room: 24, swing: 3, cover: 'breathable', permeability: PRESETS.breathable, convection: 1.2, label: 'Balanced culture preset.' },
  convection: { room: 28, swing: 6, cover: 'breathable', permeability: PRESETS.breathable, convection: 2.4, label: 'High thermal convection plumes.' },
  tangy: { room: 26, swing: 2, cover: 'open', permeability: PRESETS.open, convection: 1.45, label: 'High-oxygen tangy acidification preset.' },
  cool: { room: 19, swing: 2, cover: 'breathable', permeability: .25, convection: .9, label: 'Cool slow fermentation preset.' },
  vinegar: { room: 28, swing: 1, cover: 'open', permeability: 1, convection: 1.4,
    care: { autoDrain: false, teaMode: false }, label: 'Pure vinegar: warm, well-aerated fermentation. Harvest and refill off so acid can accumulate.' },
  mold: { room: 22, swing: 0, cover: 'open', permeability: 1, convection: .25,
    care: { autoDrain: true, teaMode: true, autoSkim: true, temperature: 22, sugar: 80, harvestPh: 4.5, fraction: .9 },
    label: 'Mold growing: cool, open conditions. Early 90% harvests and fresh tea dilute acidity, allowing pH to rise naturally. Mold still requires exposed film, incubation and a rare spore arrival.' }
};
export const POPULATION_CAPACITY = 1584;
export const MIN_VOLUME = .04;
// Retain enough suspended yeast to avoid repeated stochastic washout.
export const HARVEST_FRACTION = .65;
export const TRANSFER_DAYS = .12;
export const JAR_HEIGHT = 4 / 3;
export const LIQUID_RADIUS = .49;
export const FILM_CUTOFF = .035;
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const mix = (a, b, t) => a + (b - a) * t;

