// Compares snippet names/args in @eyeo/snippets against our snippets.json. Used by the check-snippets workflow.

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import {
  SNIPPET_SOURCE_FILES, parseUpstreamGraph, buildNameMap, parseSnippetArgs, parseSnippetSince, compareArgs, formatDriftReport,
  toRuntimeArgs, validateLedger, filterUnreviewedCandidates, checkLedgerStaleness, formatRequirednessReport,
} from './lib/snippet-diff.mjs';

async function main() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const require = createRequire(import.meta.url);

  const snippetsPkg = require.resolve('@eyeo/snippets/package.json');
  const snippetsDir = path.dirname(snippetsPkg);
  const sources = new Map();
  for (const file of SNIPPET_SOURCE_FILES) {
    const src = readFileSync(path.join(snippetsDir, 'webext', file), 'utf8');
    const names = parseUpstreamGraph(src);
    if (!names) {
      console.error(`Could not find snippet graph in ${file}.`);
      process.exit(1);
    }
    const nameMap = buildNameMap(src);
    for (const name of names) {
      if (!sources.has(name)) sources.set(name, { src, nameMap });
    }
  }
  const upstreamNames = new Set(sources.keys());

  const ledgerPath = path.join(__dirname, 'reviewed-requiredness.json');
  const ledger = existsSync(ledgerPath) ? validateLedger(JSON.parse(readFileSync(ledgerPath, 'utf8'))) : [];

  const dataPath = path.join(__dirname, '../../src/data/snippets.json');
  const data = JSON.parse(readFileSync(dataPath, 'utf8'));
  const knownNames = new Set([
    ...Object.keys(data.snippets),
    ...Object.keys(data.deprecated),
  ]);

  const newSnippets = [...upstreamNames].filter(n => !knownNames.has(n)).sort();

  const driftNames = [...upstreamNames].filter(n => data.snippets[n]).sort();

  // Report unresolved mappings or signatures instead of silently skipping them.
  const unresolved = [];
  const drifted = [];
  const requiredReview = [];
  for (const name of driftNames) {
    const { src, nameMap } = sources.get(name);
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

    const { arityGrew, enumDiffs, requiredDiffs, regexDiffs } = compareArgs(recorded, upstreamArgs);
    const newCandidates = filterUnreviewedCandidates(name, requiredDiffs, ledger);
    if (newCandidates.length > 0) {
      requiredReview.push({ name, requiredDiffs: newCandidates });
    }
    if (arityGrew || enumDiffs.length > 0 || regexDiffs.length > 0) {
      drifted.push({
        name,
        recorded: recorded.map(a => a.name),
        upstream: upstreamArgs.map(a => a.name),
        enumDiffs,
        regexDiffs,
      });
    }
  }

  const newSnippetArgs = new Map();
  for (const name of newSnippets) {
    const { src, nameMap } = sources.get(name);
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

  if (unresolved.length) {
    throw new Error(unresolved.map(({ name, reason }) => `${name}: ${reason}`).join('; '));
  }
  const driftReport = formatDriftReport(drifted, unresolved);
  const staleLedgerEntries = checkLedgerStaleness(ledger, sources);
  const requirednessReport = formatRequirednessReport(requiredReview, staleLedgerEntries);
  if (requirednessReport) console.log(requirednessReport);

  if (newSnippets.length > 0) {
    for (const name of newSnippets) {
      const { src, nameMap } = sources.get(name);
      const since = parseSnippetSince(name, src, nameMap);
      data.snippets[name] = { since, args: toRuntimeArgs(newSnippetArgs.get(name)) };
      if (since === 'unknown') console.log(`SINCE_REVIEW: ${name}: verify the Adblock Plus introduction version; package source has no usable @since documentation.`);
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
    console.log(requirednessReport ? 'No blocking snippet schema drift detected.' : 'All snippets are up to date.');
    process.exit(0);
  }

}

main().catch(error => {
  console.error(`SNIPPET_ANALYSIS_FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
