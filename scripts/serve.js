import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { createSiteHandler } from './site-handler.js';

const root = resolve(process.argv[2] || '.');
const server = createServer(await createSiteHandler(root));

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
