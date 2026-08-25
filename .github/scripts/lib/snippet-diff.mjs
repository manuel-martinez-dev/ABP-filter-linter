// Pure parsing/comparison logic for the check-snippets watcher — no file I/O or process.exit.

export function parseUpstreamGraph(sourceText) {
  const match = sourceText.match(/const graph = new Map\(\[(.+?)\]\);/s);
  if (!match) return null;
  const names = [...match[1].matchAll(/\[\s*"([^"]+)"\s*,\s*null\s*\]/g)].map(m => m[1]);
  return names.length > 0 ? new Set(names) : null;
}

// Avoids algorithmic kebab→camelCase conversion, which breaks for aliases like "debug" → setDebug.
export function buildNameMap(sourceText) {
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
    const flat = blockContent.replace(/\s+/g, ' ');

    const pairPattern = /"([^"]+)":\s*([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
    let pair;
    while ((pair = pairPattern.exec(flat)) !== null) {
      map.set(pair[1], pair[2]);
    }

    // ES6-shorthand entries, e.g. `race,`
    const shorthandPattern = /(?:^|[,{])\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?=[,}]|$)/g;
    let sh;
    while ((sh = shorthandPattern.exec(flat)) !== null) {
      if (!map.has(sh[1])) map.set(sh[1], sh[1]);
    }
  }
  return map;
}

function skipStringLiteral(sourceText, i, quoteChar) {
  i++;
  while (i < sourceText.length) {
    if (sourceText[i] === '\\') { i += 2; continue; }
    if (sourceText[i] === quoteChar) return i;
    i++;
  }
  return sourceText.length - 1;
}

function skipRegexLiteral(sourceText, i) {
  let j = i + 1, inClass = false;
  while (j < sourceText.length) {
    const ch = sourceText[j];
    if (ch === '\\') { j += 2; continue; }
    if (ch === '\n') return -1;
    if (ch === '[') inClass = true;
    else if (ch === ']') inClass = false;
    else if (ch === '/' && !inClass) {
      j++;
      while (j < sourceText.length && /[a-zA-Z]/.test(sourceText[j])) j++;
      return j - 1;
    }
    j++;
  }
  return -1;
}

// Division vs regex: an identifier/number/)/] before `/` means division
const REGEX_CONTEXT_KEYWORDS = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'case', 'do', 'else', 'yield', 'void', 'delete', 'throw', 'new']);
function isRegexContext(sourceText, slashIdx) {
  let j = slashIdx - 1;
  while (j >= 0 && /\s/.test(sourceText[j])) j--;
  if (j < 0) return true;
  const ch = sourceText[j];
  if (!/[a-zA-Z0-9_$)\]]/.test(ch)) return true;
  const word = sourceText.slice(0, j + 1).match(/([a-zA-Z_$][a-zA-Z0-9_$]*)$/);
  return word ? REGEX_CONTEXT_KEYWORDS.has(word[1]) : false;
}

// Skips strings/comments/regex so a stray bracket inside one doesn't end the walk early
function walkMatching(sourceText, openIdx, openChar, closeChar) {
  let depth = 0, i = openIdx;
  for (; i < sourceText.length; i++) {
    const ch = sourceText[i];
    if (ch === '"' || ch === "'" || ch === '`') { i = skipStringLiteral(sourceText, i, ch); continue; }
    if (ch === '/' && sourceText[i + 1] === '/') {
      const nl = sourceText.indexOf('\n', i);
      i = nl === -1 ? sourceText.length : nl;
      continue;
    }
    if (ch === '/' && sourceText[i + 1] === '*') {
      const end = sourceText.indexOf('*/', i + 2);
      i = end === -1 ? sourceText.length - 1 : end + 1;
      continue;
    }
    if (ch === '/' && isRegexContext(sourceText, i)) {
      const end = skipRegexLiteral(sourceText, i);
      if (end !== -1) { i = end; continue; }
    }
    if (ch === openChar) depth++;
    else if (ch === closeChar) {
      depth--;
      if (depth === 0) break;
    }
  }
  return depth === 0 ? i : -1;
}

function walkParens(sourceText, openParenIdx) {
  const closeIdx = walkMatching(sourceText, openParenIdx, '(', ')');
  return closeIdx === -1 ? sourceText.length : closeIdx;
}

function walkBraces(sourceText, openBraceIdx) {
  return walkMatching(sourceText, openBraceIdx, '{', '}');
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

// Three strategies, in order: Object.values(CONST).includes(), array-literal .includes(), switch/case
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

// Returns null (not []) when funcName resolved but its definition wasn't found — distinct from a genuine zero-arg function.
export function parseSnippetArgs(snippetName, sourceText, nameMap) {
  const funcName = nameMap.get(snippetName);
  if (!funcName) return [];

  const { rawParams, closeParenIdx, funcStart } = extractSignature(sourceText, funcName);
  if (funcStart === -1) return null;
  if (!rawParams || rawParams.trim() === '') return [];

  const tokens = splitParams(rawParams);
  if (tokens.length === 1 && tokens[0] === '') return [];

  const bodyOpenBrace = sourceText.indexOf('{', closeParenIdx);
  const bodyCloseBrace = bodyOpenBrace !== -1 ? walkBraces(sourceText, bodyOpenBrace) : -1;
  const bodySlice = bodyCloseBrace !== -1
    ? sourceText.slice(bodyOpenBrace, bodyCloseBrace + 1)
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

export function compareArgs(recorded, upstreamArgs) {
  const recordedVariadicIdx = recorded.findIndex(a => a.variadic);
  const upstreamVariadicIdx = upstreamArgs.findIndex(a => a.variadic);
  const recordedPrefixLen = recordedVariadicIdx === -1 ? recorded.length : recordedVariadicIdx;
  const upstreamPrefixLen = upstreamVariadicIdx === -1 ? upstreamArgs.length : upstreamVariadicIdx;
  const arityGrew = upstreamPrefixLen > recordedPrefixLen;

  const enumDiffs = [];
  const fixedLen = Math.min(recordedPrefixLen, upstreamPrefixLen);
  for (let i = 0; i < fixedLen; i++) {
    const upstreamEnum = upstreamArgs[i].enum;
    if (!upstreamEnum) continue;
    const recordedEnum = new Set(recorded[i].enum ?? []);
    const newVals = upstreamEnum.filter(v => !recordedEnum.has(v));
    if (newVals.length > 0) {
      enumDiffs.push({ arg: recorded[i].name, recorded: recorded[i].enum ?? [], upstream: upstreamEnum });
    }
  }

  return { arityGrew, enumDiffs };
}

export function formatDriftReport(drifted, unresolved) {
  const driftLines = drifted.map(d => {
    const base = `${d.name}: recorded=[${d.recorded.join(', ')}] upstream=[${d.upstream.join(', ')}]`;
    const enumLines = d.enumDiffs
      .map(e => `; enum drift on "${e.arg}": recorded=[${e.recorded.join(', ')}] upstream=[${e.upstream.join(', ')}]`)
      .join('');
    return base + enumLines;
  });
  const unresolvedLines = unresolved.map(u => `${u.name}: UNRESOLVED — ${u.reason}, drift checks skipped for this snippet`);
  const allLines = [...driftLines, ...unresolvedLines];
  return allLines.length > 0 ? 'DRIFT_DETECTED\n' + allLines.join('\n') : '';
}
