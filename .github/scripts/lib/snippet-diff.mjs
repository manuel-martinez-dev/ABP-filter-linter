// Pure parsing/comparison logic for the check-snippets watcher — no file I/O or process.exit.
import ts from 'typescript';

export const SNIPPET_SOURCE_FILES = ['snippets.source.mjs', 'isolated-heavy.source.mjs'];

export function parseUpstreamGraph(sourceText) {
  const match = /const graph = new Map\(\s*\[/.exec(sourceText);
  if (!match) return null;
  const start = match.index + match[0].length - 1;
  const end = walkMatching(sourceText, start, '[', ']');
  if (end === -1) return null;
  const names = splitParams(sourceText.slice(start + 1, end))
    .map(entry => /^\[\s*"([^"]+)"\s*,/.exec(entry)?.[1])
    .filter(Boolean);
  return names.length > 0 ? new Set(names) : null;
}

// Avoids algorithmic kebab→camelCase conversion, which breaks for aliases like "debug" → setDebug.
export function buildNameMap(sourceText) {
  const map = new Map();
  const blockPattern = /const snippets(?:\$\d+)?\s*=\s*\{/g;
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

function parseParam(rawToken) {
  const token = rawToken.replace(/\s+/g, ' ').trim();
  if (token.startsWith('...')) {
    return { name: token.slice(3), required: true, variadic: true };
  }
  const eqIdx = token.indexOf('=');
  if (eqIdx === -1) {
    return { name: token, required: true };
  }
  // Sliced from rawToken so internal whitespace in the default survives collapsing.
  return {
    name: token.slice(0, eqIdx).trim(),
    required: false,
    defaultExpr: rawToken.slice(rawToken.indexOf('=') + 1).trim(),
  };
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

const regexAnalysisCache = new WeakMap();

function regexParamsByFunction(sourceText, nameMap) {
  const cached = regexAnalysisCache.get(nameMap);
  if (cached?.sourceText === sourceText) return cached.result;
  const functions = [];
  for (const name of new Set(nameMap.values())) {
    const { rawParams, closeParenIdx, funcStart } = extractSignature(sourceText, name);
    if (funcStart === -1) continue;
    const start = sourceText.indexOf('{', closeParenIdx);
    const end = start === -1 ? -1 : walkBraces(sourceText, start);
    if (end === -1) throw new Error(`Incomplete function body: ${name}`);
    functions.push({ name, rawParams, body: sourceText.slice(start, end + 1) });
  }
  const result = new Map();
  if (!functions.length) return result;
  const filename = '/snippet-analysis/snippet.js';
  const generatedFunctions = new Map(functions.map((fn, i) => [`snippet_${i}`, fn]));
  const source = [...generatedFunctions].map(([id, fn]) => `function ${id}(${fn.rawParams}) ${fn.body}`).join('\n');
  const options = { allowJs: true, noLib: true, noResolve: true, noEmit: true, types: [], typeRoots: [] };
  const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (tree.parseDiagnostics.length) throw new Error('Regex analysis generated invalid JavaScript');
  const declarations = new Map();
  for (const statement of tree.statements) {
    if (!ts.isFunctionDeclaration(statement) || !statement.name || !statement.body ||
        !generatedFunctions.has(statement.name.text) || declarations.has(statement.name.text)) {
      throw new Error('Regex analysis structure mismatch: unexpected or duplicate function declaration');
    }
    declarations.set(statement.name.text, statement);
  }
  if (declarations.size !== generatedFunctions.size) {
    throw new Error('Regex analysis structure mismatch: missing function declaration');
  }
  const host = {
    getSourceFile: name => name === filename ? tree : undefined,
    fileExists: name => name === filename,
    readFile: name => name === filename ? source : undefined,
    getDefaultLibFileName: () => '',
    getCurrentDirectory: () => '/snippet-analysis',
    getCanonicalFileName: name => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    directoryExists: () => false,
    getDirectories: () => [],
    readDirectory: () => [],
    realpath: name => name,
    writeFile: () => { throw new Error('Snippet analysis must not write files'); },
  };
  const checker = ts.createProgram([filename], options, host).getTypeChecker();
  for (const [id, fn] of declarations) {
    const names = new Set();
    const params = new Map(fn.parameters
      .filter(param => ts.isIdentifier(param.name))
      .map(param => [checker.getSymbolAtLocation(param.name), param.name.text]));
    function visit(node) {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
          /^to(?:Global)?RegExp(?:\$\d+)?$/.test(node.expression.text)) {
        const arg = node.arguments[0];
        const param = arg && ts.isIdentifier(arg) && params.get(checker.getSymbolAtLocation(arg));
        if (param && !checker.getSymbolAtLocation(node.expression)) names.add(param);
      }
      ts.forEachChild(node, visit);
    }
    visit(fn);
    result.set(generatedFunctions.get(id).name, names);
  }
  regexAnalysisCache.set(nameMap, { sourceText, result });
  return result;
}

// Returns null when a mapped function's definition cannot be found.
export function parseSnippetArgs(snippetName, sourceText, nameMap) {
  const funcName = nameMap.get(snippetName);
  if (!funcName) return [];

  const { rawParams, closeParenIdx, funcStart } = extractSignature(sourceText, funcName);
  if (funcStart === -1) return null;
  const regexParams = regexParamsByFunction(sourceText, nameMap).get(funcName) ?? new Set();
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
    if (parsed.defaultExpr !== undefined) argEntry.defaultExpr = parsed.defaultExpr;

    const enumVals = detectEnum(parsed.name, bodySlice, preSlice);
    if (enumVals && enumVals.length > 0) argEntry.enum = enumVals;
    if (regexParams.has(parsed.name)) argEntry.regex = true;

    args.push(argEntry);
  }

  return args;
}

export function parseSnippetSince(snippetName, sourceText, nameMap) {
  const funcName = nameMap.get(snippetName);
  if (!funcName) return 'unknown';
  const { funcStart } = extractSignature(sourceText, funcName);
  if (funcStart === -1) return 'unknown';
  const prefix = sourceText.slice(0, funcStart).replace(/(?:export\s+(?:default\s+)?)?$/, '').trimEnd();
  if (!prefix.endsWith('*/')) return 'unknown';
  const start = prefix.lastIndexOf('/*');
  if (start === -1 || prefix[start + 2] !== '*') return 'unknown';
  const doc = prefix.slice(start);
  return /@since\s+Adblock Plus\s+(\d+\.\d+\.\d+)(?=\s|\*\/)/.exec(doc)?.[1] ?? 'unknown';
}

export function compareArgs(recorded, upstreamArgs) {
  const recordedVariadicIdx = recorded.findIndex(a => a.variadic);
  const upstreamVariadicIdx = upstreamArgs.findIndex(a => a.variadic);
  const recordedPrefixLen = recordedVariadicIdx === -1 ? recorded.length : recordedVariadicIdx;
  const upstreamPrefixLen = upstreamVariadicIdx === -1 ? upstreamArgs.length : upstreamVariadicIdx;
  const arityGrew = upstreamPrefixLen > recordedPrefixLen;

  const enumDiffs = [];
  const requiredDiffs = [];
  const regexDiffs = [];
  for (let i = 0; i < Math.min(recorded.length, upstreamArgs.length); i++) {
    // Absence of a direct call is inconclusive: helpers may compile the argument.
    if (upstreamArgs[i].regex && !recorded[i].regex) {
      regexDiffs.push({ arg: recorded[i].name, upstreamParam: upstreamArgs[i].name });
    }
  }
  const fixedLen = Math.min(recordedPrefixLen, upstreamPrefixLen);
  for (let i = 0; i < fixedLen; i++) {
    // Flag required arguments with upstream defaults for review.
    if (recorded[i].required === true && upstreamArgs[i].required === false) {
      requiredDiffs.push({
        arg: recorded[i].name,
        position: i + 1,
        recorded: true,
        upstream: false,
        upstreamParam: upstreamArgs[i].name,
        defaultExpr: upstreamArgs[i].defaultExpr,
      });
    }
    const upstreamEnum = upstreamArgs[i].enum;
    if (!upstreamEnum) continue;
    const recordedEnum = new Set(recorded[i].enum ?? []);
    const newVals = upstreamEnum.filter(v => !recordedEnum.has(v));
    if (newVals.length > 0) {
      enumDiffs.push({ arg: recorded[i].name, recorded: recorded[i].enum ?? [], upstream: upstreamEnum });
    }
  }

  return { arityGrew, enumDiffs, requiredDiffs, regexDiffs };
}

export function formatDriftReport(drifted, unresolved) {
  const driftLines = drifted.map(d => {
    const base = `${d.name}: recorded=[${d.recorded.join(', ')}] upstream=[${d.upstream.join(', ')}]`;
    const enumLines = d.enumDiffs
      .map(e => `; enum drift on "${e.arg}": recorded=[${e.recorded.join(', ')}] upstream=[${e.upstream.join(', ')}]`)
      .join('');
    const regexLines = (d.regexDiffs ?? [])
      .map(arg => `; regex drift on "${arg.arg}": upstream compiles "${arg.upstreamParam}" — review regex schema`)
      .join('');
    return base + enumLines + regexLines;
  });
  const unresolvedLines = unresolved.map(u => `${u.name}: UNRESOLVED — ${u.reason}, drift checks skipped for this snippet`);
  const allLines = [...driftLines, ...unresolvedLines];
  return allLines.length > 0 ? 'DRIFT_DETECTED\n' + allLines.join('\n') : '';
}

// CI-only evidence — must never reach the shipped runtime schema.
export function toRuntimeArgs(args) {
  return args.map(({ defaultExpr, ...rest }) => rest);
}

const LEDGER_STRING_FIELDS = ['snippet', 'arg', 'upstreamParam', 'defaultExpr', 'reason'];

export function validateLedger(raw) {
  if (raw.version !== 1) throw new Error(`reviewed-requiredness.json: expected version 1, got ${raw.version}`);
  if (!Array.isArray(raw.entries)) throw new Error('reviewed-requiredness.json: entries must be an array');

  const seenKeys = new Set();
  raw.entries.forEach((entry, i) => {
    for (const field of LEDGER_STRING_FIELDS) {
      if (typeof entry[field] !== 'string' || entry[field] === '') {
        throw new Error(`reviewed-requiredness.json: entries[${i}].${field} must be a non-empty string`);
      }
    }
    if (!Number.isInteger(entry.position) || entry.position < 1) {
      throw new Error(`reviewed-requiredness.json: entries[${i}].position must be a positive integer`);
    }
    const key = `${entry.snippet}::${entry.position}`;
    if (seenKeys.has(key)) {
      throw new Error(`reviewed-requiredness.json: duplicate entry for snippet "${entry.snippet}" position ${entry.position}`);
    }
    seenKeys.add(key);
  });

  return raw.entries;
}

// Looked up by snippet+position only; a match also requires the evidence (defaultExpr, upstreamParam) to still hold.
export function filterUnreviewedCandidates(snippetName, requiredDiffs, ledger) {
  return requiredDiffs.filter(diff => {
    const entry = ledger.find(e => e.snippet === snippetName && e.position === diff.position);
    if (!entry) return true;
    return !(entry.defaultExpr === diff.defaultExpr && entry.upstreamParam === diff.upstreamParam);
  });
}

// Checks every entry regardless of compareArgs, or a removed default would go undetected.
export function checkLedgerStaleness(ledger, sources) {
  const stale = [];
  for (const entry of ledger) {
    const source = sources.get(entry.snippet);
    if (!source) {
      stale.push({ ...entry, status: 'snippet no longer found upstream — needs review' });
      continue;
    }
    if (!source.nameMap.has(entry.snippet)) {
      stale.push({ ...entry, status: 'no function-name mapping found for this snippet upstream — needs review' });
      continue;
    }
    const upstreamArgs = parseSnippetArgs(entry.snippet, source.src, source.nameMap);
    if (upstreamArgs === null) {
      stale.push({ ...entry, status: 'upstream function could not be resolved or parsed — needs review' });
      continue;
    }
    const upstreamArg = upstreamArgs[entry.position - 1];
    if (!upstreamArg) {
      stale.push({ ...entry, status: 'argument no longer found at recorded position upstream — needs review' });
      continue;
    }
    if (upstreamArg.name !== entry.upstreamParam) {
      stale.push({ ...entry, status: `upstream parameter renamed to "${upstreamArg.name}" — needs review` });
      continue;
    }
    if (upstreamArg.defaultExpr !== entry.defaultExpr) {
      stale.push({
        ...entry,
        status: upstreamArg.defaultExpr === undefined
          ? 'default expression no longer present upstream — needs review (does not by itself mean the argument is now required; the function body may still handle omission)'
          : `default expression changed to ${JSON.stringify(upstreamArg.defaultExpr)} — needs review`,
      });
    }
  }
  return stale;
}

// A (snippet, position) present in both inputs is merged into one line, not printed twice.
export function formatRequirednessReport(candidates, staleEntries) {
  const candidateFlat = candidates.flatMap(c => c.requiredDiffs.map(d => ({ snippet: c.name, ...d })));
  const staleByKey = new Map(staleEntries.map(e => [`${e.snippet}::${e.position}`, e]));
  const candidateKeys = new Set(candidateFlat.map(c => `${c.snippet}::${c.position}`));

  const newLines = [];
  const reviewLines = [];

  for (const c of candidateFlat) {
    const stale = staleByKey.get(`${c.snippet}::${c.position}`);
    if (stale) {
      reviewLines.push(`  ${c.snippet}: "${c.arg}" (argument ${c.position}) — recorded required=true, upstream param "${c.upstreamParam}" now defaults to ${c.defaultExpr}; ledger entry also stale: ${stale.status}`);
    } else {
      newLines.push(`  ${c.snippet}: "${c.arg}" (argument ${c.position}) — recorded required=true, upstream param "${c.upstreamParam}" now defaults to ${c.defaultExpr} — review runtime behavior before changing schema`);
    }
  }
  for (const e of staleEntries) {
    if (candidateKeys.has(`${e.snippet}::${e.position}`)) continue;
    reviewLines.push(`  ${e.snippet}: "${e.arg}" (argument ${e.position}, upstream param "${e.upstreamParam}") — ${e.status}`);
  }

  const lines = [];
  if (newLines.length > 0) lines.push('NEW CANDIDATE:', ...newLines);
  if (reviewLines.length > 0) lines.push('LEDGER ENTRY NEEDS REVIEW:', ...reviewLines);
  return lines.length > 0 ? 'REQUIREDNESS_REVIEW\n' + lines.join('\n') : '';
}
