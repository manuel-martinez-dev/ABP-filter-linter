// Compares snippet names/args in @eyeo/snippets against our snippets.json. Used by the check-snippets workflow.

import { readFileSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import { parseUpstreamGraph, buildNameMap, parseSnippetArgs, compareArgs, formatDriftReport } from './lib/snippet-diff.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const snippetsPkg = require.resolve('@eyeo/snippets/package.json');
const snippetsDir = path.dirname(snippetsPkg);
const sourceFile = path.join(snippetsDir, 'webext', 'snippets.source.mjs');

const src = readFileSync(sourceFile, 'utf8');
const snippetsVersion = JSON.parse(readFileSync(snippetsPkg, 'utf8')).version;

const upstreamNames = parseUpstreamGraph(src);
if (!upstreamNames) {
  console.error('Could not find snippet graph in @eyeo/snippets source.');
  process.exit(1);
}

const dataPath = path.join(__dirname, '../../src/data/snippets.json');
const data = JSON.parse(readFileSync(dataPath, 'utf8'));
const knownNames = new Set([
  ...Object.keys(data.snippets),
  ...Object.keys(data.deprecated),
]);

const newSnippets = [...upstreamNames].filter(n => !knownNames.has(n)).sort();

const nameMap = buildNameMap(src);

const driftNames = [...upstreamNames].filter(n => data.snippets[n]).sort();

// Unresolvable names (mapping or signature-extraction failure) get reported via `unresolved`
// rather than aborting the run or being silently skipped.
const unresolved = [];
const drifted = [];
for (const name of driftNames) {
  if (!nameMap.has(name)) {
    unresolved.push({ name, reason: 'no function-name mapping found' });
    continue;
  }
  const recorded = data.snippets[name].args ?? [];
  const upstreamArgs = parseSnippetArgs(name, src, nameMap);
  if (upstreamArgs === null) {
    unresolved.push({ name, reason: 'function signature could not be located' });
    continue;
  }

  const { arityGrew, enumDiffs } = compareArgs(recorded, upstreamArgs);
  if (arityGrew || enumDiffs.length > 0) {
    drifted.push({
      name,
      recorded: recorded.map(a => a.name),
      upstream: upstreamArgs.map(a => a.name),
      enumDiffs,
    });
  }
}

const newSnippetArgs = new Map();
for (const name of newSnippets) {
  if (!nameMap.has(name)) {
    newSnippetArgs.set(name, []);
    unresolved.push({ name, reason: 'no function-name mapping found (new snippet)' });
    continue;
  }
  const args = parseSnippetArgs(name, src, nameMap);
  if (args === null) {
    newSnippetArgs.set(name, []);
    unresolved.push({ name, reason: 'function signature could not be located (new snippet)' });
    continue;
  }
  newSnippetArgs.set(name, args);
}

const driftReport = formatDriftReport(drifted, unresolved);

if (newSnippets.length > 0) {
  for (const name of newSnippets) {
    data.snippets[name] = { since: snippetsVersion, args: newSnippetArgs.get(name) };
  }
  writeFileSync(dataPath, JSON.stringify(data, null, 2) + '\n', 'utf8');

  console.log('NEW_SNIPPETS_FOUND');
  console.log(newSnippets.join('\n'));
  if (driftReport) console.log(driftReport);
  process.exit(2); // new snippets found
} else if (driftReport) {
  console.log(driftReport);
  process.exit(3); // drift or unresolved snippets, nothing written
} else {
  console.log('All snippets are up to date.');
  process.exit(0);
}
