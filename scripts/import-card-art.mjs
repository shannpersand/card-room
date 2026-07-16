// Copies the custom card SVGs from a source folder into src/assets/cards/,
// normalizing filenames to a single consistent `{rank}{suitLetter}` convention
// (e.g. "As.svg", "10d.svg", "Jc.svg") and running them through SVGO to shrink
// file size. Source files are never modified — this only reads from them.
//
// Usage: node scripts/import-card-art.mjs "/path/to/source/svg/folder"

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, extname, basename } from 'path';
import { optimize } from 'svgo';

const srcDir = process.argv[2];
if (!srcDir) {
  console.error('Usage: node scripts/import-card-art.mjs "/path/to/source/svg/folder"');
  process.exit(1);
}

const outDir = join(import.meta.dirname, '..', 'src', 'assets', 'cards');
mkdirSync(outDir, { recursive: true });

// Maps a source filename (without extension) to the normalized output name.
// Handles the inconsistent casing on face cards and the stray "y" typos.
function normalize(name) {
  if (name === 'back' || name === 'joker') return name;
  const match = name.match(/^(10|[2-9]|[AJQKajqk])([SHCDshcd])y?$/);
  if (!match) return null;
  const [, rank, suit] = match;
  return `${rank.toUpperCase()}${suit.toLowerCase()}`;
}

const files = readdirSync(srcDir).filter(f => extname(f).toLowerCase() === '.svg');
let count = 0;

for (const file of files) {
  const name = basename(file, extname(file));
  const normalized = normalize(name);
  if (!normalized) {
    console.warn(`Skipping unrecognized file: ${file}`);
    continue;
  }
  const raw = readFileSync(join(srcDir, file), 'utf8');
  const { data } = optimize(raw, {
    path: file,
    multipass: true,
    plugins: ['preset-default'],
  });
  writeFileSync(join(outDir, `${normalized}.svg`), data);
  count++;
}

console.log(`Wrote ${count} optimized SVGs to ${outDir}`);
