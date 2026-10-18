import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { siteFiles } from './site-files.js';

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

export async function createSiteHandler(root) {
  const resources = new Set((await siteFiles(root)).map(file => '/' + file));
  return async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const resource = pathname === '/' ? '/index.html' : pathname;
      if (!resources.has(resource)) throw new Error('Unknown resource');
      const target = resolve(root, '.' + resource);
      if (target !== root && !target.startsWith(root + sep)) throw new Error('Outside site root');
      const data = await readFile(target);
      response.writeHead(200, { 'Content-Type': types[extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(data);
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain' });
      response.end('Not found');
    }
  };
}
