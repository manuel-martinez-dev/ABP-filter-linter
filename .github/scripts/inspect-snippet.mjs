/**
 * Prints the source function body for a named snippet in @eyeo/snippets.
 * Usage: node .github/scripts/inspect-snippet.mjs <snippet-name>
 */

import { readFileSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';

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

// Parse the snippets$1 / snippets$2 mapping objects to get kebab→camelCase names.
// Avoids algorithmic conversion which breaks for aliases like "debug" → setDebug.
function buildNameMap(sourceText) {
  const map = new Map();
  const blockPattern = /const snippets\$[12]\s*=\s*\{/g;
  let m;
  while ((m = blockPattern.exec(sourceText)) !== null) {
    const blockStart = m.index + m[0].length;
    let depth = 1, i = blockStart;
    while (i < sourceText.length && depth > 0) {
      if (sourceText[i] === '{') depth++;
      else if (sourceText[i] === '}') depth--;
      i++;
    }
    const blockContent = sourceText.slice(blockStart, i - 1);
    const pairPattern = /"([^"]+)":\s*([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
    let pair;
    while ((pair = pairPattern.exec(blockContent)) !== null) {
      map.set(pair[1], pair[2]);
    }
  }
  return map;
}

function extractFullBody(sourceText, funcName) {
  const startMatch = new RegExp(`function\\s+${funcName}\\s*\\(`).exec(sourceText);
  if (!startMatch) return null;

  // Walk past the signature parens
  const openParenIdx = sourceText.indexOf('(', startMatch.index);
  let depth = 0, i = openParenIdx;
  for (; i < sourceText.length; i++) {
    if (sourceText[i] === '(') depth++;
    else if (sourceText[i] === ')') {
      depth--;
      if (depth === 0) break;
    }
  }

  // Walk the function body braces
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
