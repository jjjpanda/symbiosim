import { mkdir, copyFile, rm } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { siteFiles } from './site-files.js';

const root = resolve('.');
const output=resolve(root,'dist');
if(dirname(output)!==root||basename(output)!=='dist')throw new Error('Build output must be the workspace dist directory');
await rm(output,{recursive:true,force:true});
for (const file of await siteFiles(root)) {
  await mkdir(resolve(root, 'dist', file, '..'), { recursive: true });
  await copyFile(resolve(root, file), resolve(root, 'dist', file));
}
console.log('Built dist/');
