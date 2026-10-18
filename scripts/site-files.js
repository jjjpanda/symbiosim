import { readdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';

// Keep the server and build on the same public asset list. Only browser
// modules, styles and icons are served; repository files remain private.
export async function siteFiles(root) {
  const entries = await readdir(resolve(root, 'src'), { withFileTypes: true, recursive: true });
  return ['index.html', 'embed/index.html', 'favicon.ico', ...entries.filter(entry => entry.isFile() && ['.js', '.css', '.svg'].includes(extname(entry.name)))
    .map(entry => resolve(entry.parentPath, entry.name).slice(root.length + 1).replaceAll('\\', '/'))];
}
