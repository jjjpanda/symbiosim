import { embedAttributes } from './embed-options.js';

const vessel = document.querySelector('symbiosim-vessel');
for (const [name, value] of Object.entries(embedAttributes(location.search))) {
  vessel.setAttribute(name, value);
}
// Configure the element before it upgrades or starts its animation loop.
await import('./main.js');
