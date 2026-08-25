// Prints the source function body for a named snippet in @eyeo/snippets.
// Usage: node .github/scripts/inspect-snippet.mjs <snippet-name>

import { readFileSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { buildNameMap } from './lib/snippet-diff.mjs';

const require = createRequire(import.meta.url);

const snippetsPkg = require.resolve('@eyeo/snippets/package.json');
const snippetsDir = path.dirname(snippetsPkg);
const sourceFile = path.join(snippetsDir, 'webext', 'snippets.source.mjs');

const src = readFileSync(sourceFile, 'utf8');
const version = JSON.parse(readFileSync(snippetsPkg, 'utf8')).version;

const snippetName = process.argv[2];
if (!snippetName) {
  console.error('Usage: node inspect-snippet.mjs <snippet-name>');
  process.exit(1);
}

function extractFullBody(sourceText, funcName) {
  const startMatch = new RegExp(`function\\s+${funcName}\\s*\\(`).exec(sourceText);
  if (!startMatch) return null;

  const openParenIdx = sourceText.indexOf('(', startMatch.index);
  let depth = 0, i = openParenIdx;
  for (; i < sourceText.length; i++) {
    if (sourceText[i] === '(') depth++;
    else if (sourceText[i] === ')') {
      depth--;
      if (depth === 0) break;
    }
  }

  const bodyOpenBrace = sourceText.indexOf('{', i);
  if (bodyOpenBrace === -1) return null;

  depth = 0;
  let j = bodyOpenBrace;
  for (; j < sourceText.length; j++) {
    if (sourceText[j] === '{') depth++;
    else if (sourceText[j] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }

  return {
    body: sourceText.slice(startMatch.index, j + 1),
    lineNumber: sourceText.slice(0, startMatch.index).split('\n').length,
  };
}

const nameMap = buildNameMap(src);
const funcName = nameMap.get(snippetName);

if (!funcName) {
  console.error(`Snippet "${snippetName}" not found in @eyeo/snippets v${version}.`);
  process.exit(1);
}

const result = extractFullBody(src, funcName);
if (!result) {
  console.error(`Could not extract body for function "${funcName}".`);
  process.exit(1);
}

console.log(`Snippet:  ${snippetName}`);
console.log(`Function: ${funcName}`);
console.log(`Version:  @eyeo/snippets v${version}`);
console.log(`Line:     ${result.lineNumber}`);
console.log(`\n${'─'.repeat(60)}\n`);
console.log(result.body);
