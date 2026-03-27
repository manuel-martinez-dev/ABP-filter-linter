/**
 * Compares snippet names in @eyeo/snippets against our snippets.json.
 * Outputs any new snippets not yet tracked in the linter data file.
 * Used by the check-snippets GitHub Action workflow.
 */

import { readFileSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Locate the installed @eyeo/snippets source file
const snippetsPkg = require.resolve('@eyeo/snippets/package.json');
const snippetsDir = path.dirname(snippetsPkg);
const sourceFile = path.join(snippetsDir, 'webext', 'snippets.source.mjs');

const src = readFileSync(sourceFile, 'utf8');
const match = src.match(/const graph = new Map\(\[(.+?)\]\);/s);

if (!match) {
  console.error('Could not find snippet graph in @eyeo/snippets source.');
  process.exit(1);
}

const upstreamNames = new Set(
  [...match[1].matchAll(/\["([^"]+)",null\]/g)].map(m => m[1])
);

// Load our local snippets.json
const dataPath = path.join(__dirname, '../../src/data/snippets.json');
const data = JSON.parse(readFileSync(dataPath, 'utf8'));
const knownNames = new Set([
  ...Object.keys(data.snippets),
  ...Object.keys(data.deprecated),
]);

// Find snippets in upstream but not in our JSON
const newSnippets = [...upstreamNames].filter(n => !knownNames.has(n)).sort();

if (newSnippets.length === 0) {
  console.log('All snippets are up to date.');
  process.exit(0);
}

// Add placeholder entries for new snippets so the PR has real file changes
for (const name of newSnippets) {
  data.snippets[name] = { since: 'TODO', args: [] };
}
writeFileSync(dataPath, JSON.stringify(data, null, 2) + '\n', 'utf8');

console.log('NEW_SNIPPETS_FOUND');
console.log(newSnippets.join('\n'));
process.exit(2); // exit code 2 = new snippets found
