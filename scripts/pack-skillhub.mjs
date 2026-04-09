#!/usr/bin/env node
/**
 * 打包 skills/a2amarket-agent 为 zip，供 SkillHub / 手动上传。
 */
import { readFileSync, mkdirSync, rmSync, readdirSync } from 'fs';
import { execFileSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const outDir = join(root, 'artifacts');
const outName = `a2amarket-agent-skillhub-${version}.zip`;
const outPath = join(outDir, outName);

mkdirSync(outDir, { recursive: true });
for (const f of readdirSync(outDir)) {
  if (f.startsWith('a2amarket-agent-skillhub-') && f.endsWith('.zip')) {
    rmSync(join(outDir, f));
  }
}

const skillsDir = join(root, 'skills');
execFileSync('zip', ['-r', outPath, 'a2amarket-agent'], {
  cwd: skillsDir,
  stdio: 'inherit',
});

console.log(`Wrote ${outPath}`);
