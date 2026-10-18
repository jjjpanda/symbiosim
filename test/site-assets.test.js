import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { siteFiles } from '../scripts/site-files.js';
import { createSiteHandler } from '../scripts/site-handler.js';

test('favicon fallbacks are public assets and versioned icon URLs return the correct content types', async () => {
  const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
  const files = await siteFiles(root), handler = await createSiteHandler(root);
  assert.ok(files.includes('favicon.ico'));
  assert.ok(files.includes('src/favicon.svg'));
  // Exercise the real server handler without binding a network port.
  const request = async url => {
    const response = {
      writeHead(status, headers) { this.status = status; this.headers = headers; },
      end(body) { this.body = body; }
    };
    await handler({ url }, response);
    return response;
  };
  const html = (await request('/')).body.toString();
  const icons = [...html.matchAll(/<link rel="icon"[^>]*href="([^"]+)"/g)].map(match => match[1]);
  assert.equal(icons.length, 2);
  for (const icon of icons) {
    assert.match(icon, /[?]v=\d+/);
    const url = new URL(icon, 'http://localhost/');
    const response = await request(url.pathname + url.search);
    assert.equal(response.status, 200, icon);
    assert.equal(response.headers['Content-Type'], icon.includes('.ico') ? 'image/x-icon' : 'image/svg+xml');
    assert.equal(response.headers['Cache-Control'], 'no-store');
    assert.ok(response.body.byteLength > 100);
  }
  for (const path of ['/README.md', '/package.json', '/src/../README.md', '/%2e%2e/README.md']) {
    assert.equal((await request(path)).status, 404, 'Repository files stay private');
  }
  const ico = await readFile(new URL('../favicon.ico', import.meta.url));
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 1);
  assert.equal(ico.readUInt32LE(18) + ico.readUInt32LE(14), ico.length);
  assert.equal(ico[6], 32); assert.equal(ico[7], 32);
});
