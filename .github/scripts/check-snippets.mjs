/**
 * Compares snippet names in @eyeo/snippets against our snippets.json.
 * Auto-populates arg definitions by parsing the @eyeo/snippets source.
 * Used by the check-snippets GitHub Action workflow.
 */

import { readFileSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const snippetsPkg = require.resolve('@eyeo/snippets/package.json');
const snippetsDir = path.dirname(snippetsPkg);
const sourceFile = path.join(snippetsDir, 'webext', 'snippets.source.mjs');

const src = readFileSync(sourceFile, 'utf8');
const snippetsVersion = JSON.parse(readFileSync(snippetsPkg, 'utf8')).version;

const match = src.match(/const graph = new Map\(\[(.+?)\]\);/s);

if (!match) {
  console.error('Could not find snippet graph in @eyeo/snippets source.');
  process.exit(1);
}

const upstreamNames = new Set(
  [...match[1].matchAll(/\["([^"]+)",null\]/g)].map(m => m[1])
);

const dataPath = path.join(__dirname, '../../src/data/snippets.json');
const data = JSON.parse(readFileSync(dataPath, 'utf8'));
const knownNames = new Set([
  ...Object.keys(data.snippets),
  ...Object.keys(data.deprecated),
]);

const newSnippets = [...upstreamNames].filter(n => !knownNames.has(n)).sort();

if (newSnippets.length === 0) {
  console.log('All snippets are up to date.');
  process.exit(0);
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

// Character-walk past matching parens from openParenIdx.
// Returns the index of the closing paren.
function walkParens(sourceText, openParenIdx) {
  let depth = 0, i = openParenIdx;
  for (; i < sourceText.length; i++) {
    if (sourceText[i] === '(') depth++;
    else if (sourceText[i] === ')') {
      depth--;
      if (depth === 0) break;
    }
  }
  return i;
}

function extractSignature(sourceText, funcName) {
  const startMatch = new RegExp(`function\\s+${funcName}\\s*\\(`).exec(sourceText);
  if (!startMatch) return { rawParams: null, closeParenIdx: -1, funcStart: -1 };

  const openParenIdx = sourceText.indexOf('(', startMatch.index);
  const closeParenIdx = walkParens(sourceText, openParenIdx);
  return {
    rawParams: sourceText.slice(openParenIdx + 1, closeParenIdx),
    closeParenIdx,
    funcStart: startMatch.index,
  };
}

function splitParams(rawParams) {
  const params = [];
  let depth = 0;
  let inStr = false;
  let strChar = '';
  let current = '';

  for (let i = 0; i < rawParams.length; i++) {
    const ch = rawParams[i];
    if (inStr) {
      current += ch;
      if (ch === strChar && rawParams[i - 1] !== '\\') inStr = false;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      inStr = true;
      strChar = ch;
      current += ch;
    } else if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
      current += ch;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      current += ch;
    } else if (ch === ',' && depth === 0) {
      params.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) params.push(current.trim());
  return params;
}

function parseParam(token) {
  token = token.replace(/\s+/g, ' ').trim();
  if (token.startsWith('...')) {
    return { name: token.slice(3), required: true, variadic: true };
  }
  const eqIdx = token.indexOf(' = ');
  if (eqIdx === -1) {
    return { name: token, required: true };
  }
  return { name: token.slice(0, eqIdx).trim(), required: false };
}

// Three strategies for detecting enum values, applied in order:
// A) Object$X.values(CONST).includes(param) — look for the const declaration nearby
// B) $([...]).includes(param) — inline array literal
// C) switch(param) { case "val": } — switch statement
function detectEnum(paramName, bodySlice, preSlice) {
  if (!bodySlice) return null;

  const objValuesPattern = new RegExp(
    `Object\\$?\\w*\\.values\\((\\w+)\\)\\.includes\\(${paramName}\\)`
  );
  const objMatch = objValuesPattern.exec(bodySlice);
  if (objMatch) {
    const constName = objMatch[1];
    const searchArea = preSlice + bodySlice.slice(0, 500);
    const constMatch = new RegExp(`const\\s+${constName}\\s*=\\s*\\{([^}]+)\\}`).exec(searchArea);
    if (constMatch) {
      const vals = [];
      const strPattern = /:\s*"([^"]+)"/g;
      let sm;
      while ((sm = strPattern.exec(constMatch[1])) !== null) vals.push(sm[1]);
      if (vals.length > 0) return vals;
    }
  }

  const arrMatch = new RegExp(
    `\\$?\\(?((\\[[^\\]]+\\]))\\)?\\.includes\\(${paramName}\\)`
  ).exec(bodySlice);
  if (arrMatch) {
    const vals = [];
    const strPattern = /"([^"]+)"/g;
    let sm;
    while ((sm = strPattern.exec(arrMatch[1])) !== null) vals.push(sm[1]);
    if (vals.length > 0) return vals;
  }

  const switchMatch = new RegExp(
    `switch\\s*\\(\\s*${paramName}\\s*\\)\\s*\\{([^}]+)\\}`
  ).exec(bodySlice);
  if (switchMatch) {
    const vals = [];
    const casePattern = /case\s+"([^"]+)"\s*:/g;
    let cm;
    while ((cm = casePattern.exec(switchMatch[1])) !== null) vals.push(cm[1]);
    if (vals.length > 0) return vals;
  }

  return null;
}

function parseSnippetArgs(snippetName, sourceText, nameMap) {
  const funcName = nameMap.get(snippetName);
  if (!funcName) return [];

  const { rawParams, closeParenIdx, funcStart } = extractSignature(sourceText, funcName);
  if (!rawParams || rawParams.trim() === '') return [];

  const tokens = splitParams(rawParams);
  if (tokens.length === 1 && tokens[0] === '') return [];

  // Limit body slice to first ~8000 chars — enum validations are always near the top
  const bodyOpenBrace = sourceText.indexOf('{', closeParenIdx);
  const bodySlice = bodyOpenBrace !== -1
    ? sourceText.slice(bodyOpenBrace, bodyOpenBrace + 8000)
    : null;
  const preSlice = funcStart > 0
    ? sourceText.slice(Math.max(0, funcStart - 3000), funcStart)
    : '';

  const args = [];
  for (const token of tokens) {
    const parsed = parseParam(token);
    const argEntry = { name: parsed.name, required: parsed.required };
    if (parsed.variadic) argEntry.variadic = true;

    const enumVals = detectEnum(parsed.name, bodySlice, preSlice);
    if (enumVals && enumVals.length > 0) argEntry.enum = enumVals;

    args.push(argEntry);
  }

  return args;
}

const nameMap = buildNameMap(src);

for (const name of newSnippets) {
  const args = parseSnippetArgs(name, src, nameMap);
  data.snippets[name] = { since: snippetsVersion, args };
}

writeFileSync(dataPath, JSON.stringify(data, null, 2) + '\n', 'utf8');

console.log('NEW_SNIPPETS_FOUND');
console.log(newSnippets.join('\n'));
process.exit(2); // exit code 2 = new snippets found
