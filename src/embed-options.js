import { REGIMES } from './sim/constants.js';
import { OVERLAYS } from './fields.js';

// Keep a fixed application order: explicit settings override the chosen preset,
// regardless of the order of parameters in the URL.
export function embedAttributes(search) {
  const params = new URLSearchParams(search);
  const attributes = { embed: '' };
  const preset = params.get('preset');
  if (Object.hasOwn(REGIMES, preset)) attributes.preset = preset;
  const theme = params.get('theme');
  if (['light', 'dark'].includes(theme)) attributes.theme = theme;
  const field = params.get('field');
  if (OVERLAYS.includes(field)) attributes.field = field;
  for (const [name, min, max] of [
    ['speed', 1, 60], ['room', 15, 35], ['swing', 0, 12], ['permeability', 0, 100]
  ]) {
    const value = params.get(name);
    if (value?.trim() && Number.isFinite(Number(value))) {
      attributes[name] = String(Math.max(min, Math.min(max, Number(value))));
    }
  }
  for (const name of ['width', 'height']) {
    const value = params.get(name);
    if (value?.trim() && Number.isFinite(Number(value)) && Number(value) > 0) {
      attributes[name] = String(Math.max(1, Math.round(Number(value))));
    }
  }
  for (const name of ['transparent', 'autofocus']) {
    if (params.get(name) === 'true' || params.get(name) === '') attributes[name] = '';
  }
  if (['true', 'false'].includes(params.get('autoplay'))) attributes.autoplay = params.get('autoplay');
  return attributes;
}
