#!/usr/bin/env node
import { readFileSync, mkdirSync, renameSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const v = pkg.version;
const name = `hz-abyssal-heart-a2amarket-mcp-server-${v}.tgz`;
const outDir = join(root, 'artifacts');

mkdirSync(outDir, { recursive: true });
execFileSync('npm', ['pack'], { cwd: root, stdio: 'inherit' });
const src = join(root, name);
const dest = join(outDir, name);
if (!existsSync(src)) {
  console.error('Expected tarball missing:', src);
  process.exit(1);
}
renameSync(src, dest);
console.log(`Wrote ${dest}`);
