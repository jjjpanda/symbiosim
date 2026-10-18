import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { embedAttributes } from '../src/embed-options.js';
import { Simulation } from '../src/engine.js';
import { createSiteHandler } from '../scripts/site-handler.js';
import { siteFiles } from '../scripts/site-files.js';

test('embed options accept supported controls, reject invalid input and preserve component defaults', () => {
  assert.deepEqual(embedAttributes(''), { embed: '' });
  assert.deepEqual(embedAttributes('?embed=false&theme=neon&preset=toString&field=invalid&speed=NaN&room=&swing=Infinity&permeability=oops&width=-1&height=0&transparent=false&autofocus=false&autoplay=no&onclick=alert(1)'), { embed: '' });
  assert.deepEqual(embedAttributes('?theme=dark&field=ethanol&speed=100&room=14&swing=-2&permeability=200&width=420.2&height=520&transparent=true&autoplay=false&autofocus=true'), {
    embed: '', theme: 'dark', field: 'ethanol', speed: '60', room: '15', swing: '0', permeability: '100', width: '420', height: '520', transparent: '', autofocus: '', autoplay: 'false'
  });
  assert.equal(embedAttributes('?speed=4&speed=30').speed, '4');
  assert.equal(embedAttributes('?autoplay=true').autoplay, 'true');
  assert.deepEqual(embedAttributes('?transparent&autofocus'), { embed: '', transparent: '', autofocus: '' });
});

test('the component applies query conditions after presets independently of URL parameter order', async () => {
  const previousElement = globalThis.HTMLElement, previousRegistry = globalThis.customElements;
  globalThis.HTMLElement = class {};
  globalThis.customElements = { get: () => true };
  try {
    const { SymbiosimVessel } = await import('../src/main.js');
    for (const query of ['?room=20&preset=convection&swing=1&permeability=10&autoplay=false', '?permeability=10&swing=1&preset=convection&room=20&autoplay=false']) {
      const attributes = embedAttributes(query);
      const view = Object.assign(Object.create(SymbiosimVessel.prototype), {
        sim: new Simulation({ seed: 7, width: 8, height: 8, depth: 3 }),
        hasAttribute: name => Object.hasOwn(attributes, name),
        getAttribute: name => attributes[name] ?? null
      });
      view.applyAttributes();
      assert.equal(view.sim.settings.room, 20);
      assert.equal(view.sim.settings.swing, 1);
      assert.equal(view.sim.settings.permeability, .1);
      assert.equal(view.sim.playing, false);
    }
  } finally {
    globalThis.HTMLElement = previousElement;
    globalThis.customElements = previousRegistry;
  }
});

test('embed routes serve public assets and retain query options through the directory redirect', async () => {
  const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
  const handler = await createSiteHandler(root);
  const request = async url => {
    const response = {
      writeHead(status, headers) { this.status = status; this.headers = headers; },
      end(body) { this.body = body; }
    };
    await handler({ url }, response);
    return response;
  };
  const redirect = await request('/embed?theme=dark&autoplay=false');
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.Location, '/embed/?theme=dark&autoplay=false');
  for (const route of ['/embed/', '/embed/index.html?transparent=true']) {
    const response = await request(route);
    assert.equal(response.status, 200);
    assert.equal(response.headers['Content-Type'], 'text/html');
    assert.match(response.body.toString(), /<symbiosim-vessel embed>/);
  }
  const files = await siteFiles(root);
  assert.ok(files.includes('embed/index.html'));
  const html = await readFile(resolve(root, 'embed/index.html'), 'utf8');
  const references = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1]);
  for (const reference of references) {
    const local = new URL(reference, 'https://example.com/embed/');
    assert.equal((await request(local.pathname + local.search)).status, 200);
    const deployed = new URL(reference, 'https://example.com/symbiosim/embed/');
    assert.ok(files.includes(deployed.pathname.slice('/symbiosim/'.length)), deployed.pathname);
  }
});
