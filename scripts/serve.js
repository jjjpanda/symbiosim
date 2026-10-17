import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { siteFiles } from './site-files.js';

const root = resolve(process.argv[2] || '.');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const resources = new Set((await siteFiles(root)).map(file => '/' + file));
const server = createServer(async (request, response) => {
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
});

let port = Number(process.env.PORT || 4173);
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE' && !process.env.PORT && port < 4183) {
    port += 1;
    server.listen(port, '127.0.0.1');
    return;
  }
  console.error(error);
  process.exitCode = 1;
});
server.on('listening', () => {
  console.log(`Symbiosim running at http://127.0.0.1:${server.address().port}`);
});
server.listen(port, '127.0.0.1');
