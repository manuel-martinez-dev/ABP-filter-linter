import { RegExpParser, visitRegExpAST } from '@eslint-community/regexpp';
import snippetData from '../data/snippets.json';
import modifierData from '../data/modifiers.json';
import type { LintResult } from '../types';

const VALID_MODIFIERS = new Set(modifierData.valid);

interface ArgSchema {
  name: string;
  required: boolean;
  variadic?: boolean;
  max?: number;
  enum?: string[];
  allowsNumericLiteral?: boolean;
  numeric?: boolean;
  regex?: boolean | 'comma-separated' | 'space-separated' | 'unflagged';
  regexPrefix?: string;
  when?: { arg: number; equals: string; required?: boolean };
}

interface SnippetSchema {
  since: string;
  args: ArgSchema[];
  category?: string;
  noRace?: boolean;
  race?: boolean;
}

const SNIPPETS = snippetData.snippets as Record<string, SnippetSchema>;
const DEPRECATED = snippetData.deprecated as Record<string, string>;

/** Hyphenated names only — short ones (log, race, …) collide with legit text args */
const NESTABLE_NAMES = [...Object.keys(SNIPPETS), ...Object.keys(DEPRECATED)].filter(n => n.includes('-'));

/** Snippet name at the start of an arg value = likely a call pasted inside quotes */
function findNestedSnippetName(argVal: string): string | null {
  const trimmed = argVal.trimStart();
  for (const name of NESTABLE_NAMES) {
    if (trimmed === name) return name;
    if (trimmed.startsWith(name) && /[ \t]/.test(trimmed[name.length])) return name;
  }
  return null;
}

export function isPassiveSnippet(name: string): boolean {
  return name.startsWith('log-if-') || name === 'race';
}

export function snippetChainRequiresDomain(calls: SnippetCall[]): boolean {
  return !(calls.length > 0 && calls.every(call => isPassiveSnippet(call.name)));
}

/** Snippets where specific arg positions forbid certain shadow DOM demarcators */
const FORBIDDEN_DEMARCATORS: Record<string, Array<{ argIndex: number; tokens: string[] }>> = {
  'hide-if-contains-visible-text': [
    { argIndex: 1, tokens: ['^^svg^^'] }, // selector
    { argIndex: 2, tokens: ['^^svg^^'] }, // searchSelector
  ],
  'hide-if-has-and-matches-style': [
    { argIndex: 0, tokens: ['^^sh^^', '^^svg^^'] }, // search
  ],
};

/** Levenshtein distance for typo suggestions */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function findClosest(name: string): string | null {
  const candidates = Object.keys(SNIPPETS);
  let best: string | null = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    const d = levenshtein(name, c);
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return bestDist <= 3 ? best : null;
}

interface ParsedArgDetail {
  value: string;
  start: number;   // position of first value content char in argBody (after opening quote)
  end: number;     // position after last value content char in argBody (before closing quote)
  rawEnd: number;  // position after last raw source char including closing quote
}

function parseSnippetArgsDetailed(body: string): ParsedArgDetail[] {
  const result: ParsedArgDetail[] = [];
  let value = '';
  let inQuote = false;
  let inRegex = false;
  let contentStart = -1;
  let i = 0;

  const flush = (contentEnd: number, rawEnd: number) => {
    result.push({ value, start: contentStart, end: contentEnd, rawEnd });
    value = '';
    contentStart = -1;
  };

  while (i < body.length) {
    const ch = body[i];

    if (inRegex) {
      if (ch === '\\' && i + 1 < body.length) { value += ch + body[i + 1]; i += 2; continue; }
      if (ch === '/') {
        inRegex = false; value += ch; i++;
        if (i >= body.length || body[i] === ' ') flush(i, i);
        continue;
      }
      value += ch; i++;
      continue;
    }

    if (ch === '\\' && i + 1 < body.length) {
      if (contentStart === -1) contentStart = i;
      value += body[i + 1]; i += 2;
      continue;
    }

    if (ch === "'" && !inQuote) {
      contentStart = i + 1; inQuote = true; i++;
      continue;
    }

    if (ch === "'" && inQuote) {
      inQuote = false; flush(i, i + 1); i++;
      continue;
    }

    if ((ch === ' ' || ch === '\t') && !inQuote) {
      if (value.length > 0 && contentStart !== -1) flush(i, i);
      i++;
      continue;
    }

    if (ch === '/' && !inQuote && value.length === 0 && contentStart === -1) {
      contentStart = i; inRegex = true; value += ch; i++;
      continue;
    }

    if (contentStart === -1) contentStart = i;
    value += ch; i++;
  }

  if (value.length > 0 && contentStart !== -1) flush(body.length, body.length);
  return result;
}

export interface SnippetCall {
  name: string;
  args: string[];
  runtimeArgs?: Array<string | null>;
  /** source-accurate column ranges for each arg, relative to the snippet body start */
  argOffsets?: Array<{ start: number; end: number }>;
  /** char offset of the snippet name within the body */
  nameOffset: number;
  ambiguous?: boolean;
}

function unquotedRegexBreak(raw: string): ';' | ' ' | null {
  let bare: ';' | ' ' | null = null;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '\\') { i++; continue; }
    if (raw[i] === ';') return ';';
    if (raw[i] === ' ' || raw[i] === '\t') bare = ' ';
  }
  return bare;
}

const isBoundary = (ch: string | undefined) =>
  ch === undefined || ch === ' ' || ch === '\t' || ch === ';';

interface BodyScanHandlers {
  escape?: (i: number) => void;
  quoteOpen?: (i: number) => void;
  quoteClose?: (i: number) => void;
  regexChar?: (i: number) => void;
  separator?: (i: number) => void;
  char?: (i: number) => void;
}

/** Shared escape/quote/regex walker; parseSnippetArgsDetailed stays separate (value-position regex entry, merges adjacent runs) */
function scanBody(body: string, on: BodyScanHandlers): { inQuote: boolean; quoteStart: number } {
  let inQuote = false;
  let inRegex = false;
  let quoteStart = -1;

  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '\\' && i + 1 < body.length) { on.escape?.(i); i++; continue; }
    if (inRegex) {
      if (ch === '/') inRegex = false;
      on.regexChar?.(i);
      continue;
    }
    if (ch === "'") {
      if (!inQuote) { inQuote = true; quoteStart = i; on.quoteOpen?.(i); }
      else { inQuote = false; quoteStart = -1; on.quoteClose?.(i); }
      continue;
    }
    if (ch === ';' && !inQuote) { on.separator?.(i); continue; }
    if (ch === '/' && !inQuote && isBoundary(body[i - 1])) { inRegex = true; on.regexChar?.(i); continue; }
    on.char?.(i);
  }

  return { inQuote, quoteStart };
}

/** Split a snippet filter body (after #$#) by `;` respecting single-quoted strings */
export function splitSnippetChain(body: string): SnippetCall[] {
  const parts: string[] = [];
  let current = '';
  scanBody(body, {
    escape: i => { current += body[i] + body[i + 1]; },
    quoteOpen: i => { current += body[i]; },
    quoteClose: i => { current += body[i]; },
    regexChar: i => { current += body[i]; },
    separator: () => { parts.push(current); current = ''; },
    char: i => { current += body[i]; },
  });
  if (current.length > 0) parts.push(current);

  const calls: SnippetCall[] = [];
  let offset = 0;

  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.length === 0) { offset += part.length + 1; continue; }

    const spaceIdx = trimmed.search(/[ \t]/);
    const name = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
    const argBody = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1);

    const nameOffset = body.indexOf(trimmed, offset);
    const detailed = argBody ? parseSnippetArgsDetailed(argBody) : [];
    const args = detailed.map(a => a.value);
    const argBodyBase = nameOffset + name.length + 1;
    const argOffsets = detailed.map(a => ({ start: argBodyBase + a.start, end: argBodyBase + a.end }));

    const runtimeArgs = detailed.map(a => decodeSnippetArgument(argBody.slice(a.start, a.end)));
    const ambiguous = detailed.some(a =>
      argBody[a.start] === '/' && argBody[a.start - 1] !== "'" && unquotedRegexBreak(argBody.slice(a.start, a.end)) !== null);
    calls.push({ name, args, runtimeArgs, argOffsets, nameOffset, ambiguous });
    offset += part.length + 1;
  }

  return calls;
}

function decodeSnippetArgument(raw: string, offsets?: Array<{ start: number; end: number }>): string | null {
  let value = '';
  for (let i = 0; i < raw.length;) {
    const start = i;
    let character = raw[i++];
    if (character === '\\') {
      if (i === raw.length) return null;
      character = raw[i++];
      if (character === 'u') {
        const hex = raw.slice(i, i + 4);
        // Malformed Unicode escapes can consume argument boundaries in ABP's parser.
        if (!/^[\da-fA-F]{4}$/.test(hex)) return null;
        character = String.fromCharCode(parseInt(hex, 16));
        i += 4;
      } else {
        character = ({ n: '\n', r: '\r', t: '\t' } as Record<string, string>)[character] ?? character;
      }
    }
    value += character;
    offsets?.push({ start, end: i });
  }
  return value;
}

function argumentSchema(schema: SnippetSchema, index: number): ArgSchema | undefined {
  const last = schema.args[schema.args.length - 1];
  return schema.args[index] ?? (last?.variadic ? last : undefined);
}

function activeArgument(arg: ArgSchema, args: Array<string | null>): boolean {
  return !arg.when || args[arg.when.arg] === arg.when.equals;
}

function regexParts(pattern: string): { source: string; flags: string } | null {
  const end = pattern[0] === '/' ? pattern.lastIndexOf('/') : 0;
  return end > 0 ? { source: pattern.slice(1, end), flags: pattern.slice(end + 1) } : null;
}

function regexPatterns(value: string, arg: ArgSchema): string[] {
  if (arg.regexPrefix && value.startsWith(arg.regexPrefix)) value = value.slice(arg.regexPrefix.length);
  const mode = arg.regex;
  return mode === 'comma-separated' ? value.split(',').map(s => s.trim())
    : mode === 'space-separated' ? value.split(/ +/) : [value];
}

function hasMalformedRegex(value: string, arg: ArgSchema): boolean {
  return regexPatterns(value, arg).some(pattern => {
    if (arg.regex === 'unflagged' && !pattern.endsWith('/')) return false;
    const parts = regexParts(pattern);
    if (!parts) return false;
    try {
      new RegExp(parts.source, parts.flags);
      return false;
    } catch {
      return true;
    }
  });
}

const regexChecks = new WeakMap<SnippetCall, { key: string; invalid: Set<number> }>();

function malformedRegexArguments(call: SnippetCall): Set<number> {
  const args = call.runtimeArgs ?? call.args;
  const key = JSON.stringify([call.name, args]);
  const cached = regexChecks.get(call);
  if (cached?.key === key) return cached.invalid;
  const invalid = new Set<number>();
  const schema = SNIPPETS[call.name];
  if (schema) args.forEach((value, index) => {
    const arg = argumentSchema(schema, index);
    if (value !== null && arg?.regex && activeArgument(arg, args) && hasMalformedRegex(value, arg)) invalid.add(index);
  });
  regexChecks.set(call, { key, invalid });
  return invalid;
}

function argumentRanges(call: SnippetCall, bodyOffset: number): Array<{ startCol: number; endCol: number }> {
  let start = bodyOffset + call.nameOffset + call.name.length + 1;
  return call.args.map((raw, index) => {
    const offset = call.argOffsets?.[index];
    const range = offset
      ? { startCol: bodyOffset + offset.start, endCol: bodyOffset + offset.end }
      : { startCol: start, endCol: start + raw.length };
    start += raw.length + 1;
    return range;
  });
}

function hasDecodingFailure(call: SnippetCall): boolean {
  return call.runtimeArgs?.includes(null) === true;
}

export function validateSnippetCall(
  call: SnippetCall,
  bodyOffset: number
): LintResult[] {
  const results: LintResult[] = [];
  const { name, nameOffset } = call;
  const args = call.runtimeArgs ?? call.args;
  const absStart = bodyOffset + nameOffset;
  const absEnd = absStart + name.length;
  const ranges = argumentRanges(call, bodyOffset);
  const decodeFailed = hasDecodingFailure(call);
  if (decodeFailed) {
    args.forEach((value, index) => {
      if (value === null) results.push({
        message: `Invalid escape in argument ${index + 1} of "${name}" — use four hexadecimal digits after \\u and complete any trailing escape`,
        severity: 'error',
        ...ranges[index],
      });
    });
  }

  // Deprecated check
  if (DEPRECATED[name]) {
    results.push({
      message: `Deprecated snippet "${name}": ${DEPRECATED[name]}`,
      severity: 'warning',
      startCol: absStart,
      endCol: absEnd,
    });
    return results;
  }

  // Unknown snippet
  if (!SNIPPETS[name]) {
    const suggestion = findClosest(name);
    results.push({
      message: suggestion
        ? `Unknown snippet "${name}". Did you mean "${suggestion}"?`
        : `Unknown snippet "${name}"`,
      severity: 'error',
      startCol: absStart,
      endCol: absEnd,
    });
    return results;
  }

  if (decodeFailed) return results;
  const schema = SNIPPETS[name];

  // Debugging snippets should not appear in the live list
  if (schema.category === 'debugging') {
    results.push({
      message: `"${name}" is a debugging snippet and should not be used in the live list`,
      severity: 'warning',
      startCol: absStart,
      endCol: absEnd,
    });
  }

  const requiredArgs = schema.args.filter(a => a.required);

  // Missing required args
  if (args.length < requiredArgs.length) {
    results.push({
      message: `"${name}" requires ${requiredArgs.length} argument(s) but got ${args.length}`,
      severity: 'warning',
      startCol: absStart,
      endCol: absEnd,
    });
  }

  // Variadic max check
  const variadicArg = schema.args.find(a => a.variadic);
  if (variadicArg?.max !== undefined && args.length > variadicArg.max) {
    results.push({
      message: `"${name}" accepts at most ${variadicArg.max} argument(s) but got ${args.length}`,
      severity: 'warning',
      startCol: absStart,
      endCol: absEnd,
    });
  }

  // Too-many-args check for non-variadic snippets
  const maxArgs = schema.args.filter(arg => activeArgument(arg, args)).length;
  if (!variadicArg && args.length > maxArgs) {
    results.push({
      message: `"${name}" accepts at most ${maxArgs} argument(s) but got ${args.length}`,
      severity: 'warning',
      startCol: absStart,
      endCol: absEnd,
    });
  }

  // Arg-level validation: enum + demarcators
  const demarcatorRules = FORBIDDEN_DEMARCATORS[name];
  const invalidRegexes = malformedRegexArguments(call);

  for (let i = 0; i < args.length; i++) {
    const argSchema = argumentSchema(schema, i);
    if (!argSchema) break;
    const argVal = args[i];
    if (argVal === null || argVal === undefined) continue;
    const { startCol: argStart, endCol: argEnd } = ranges[i];

    if (invalidRegexes.has(i)) {
      results.push({
        message: `Malformed regex in "${argSchema.name}" of "${name}" — the snippets library treats it as literal text`,
        severity: 'warning',
        startCol: argStart,
        endCol: argEnd,
      });
    }

    // Enum validation
    if (argSchema.enum && !argSchema.enum.includes(argVal)) {
      const isNumericLiteral = argSchema.allowsNumericLiteral === true && /^\d+$/.test(argVal);
      if (!isNumericLiteral) {
        results.push({
          message: `Invalid value "${argVal}" for "${argSchema.name}". Expected one of: ${argSchema.enum.join(', ')}`,
          severity: 'error',
          startCol: argStart,
          endCol: argEnd,
        });
      }
    }

    // Numeric-only args — the snippet source enforces /^\d+$/ and silently no-ops otherwise
    if (argSchema.numeric && !/^\d+$/.test(argVal)) {
      results.push({
        message: `"${argSchema.name}" must be a non-negative integer, got "${argVal}"`,
        severity: 'error',
        startCol: argStart,
        endCol: argEnd,
      });
    }

    // Demarcator validation
    if (demarcatorRules) {
      for (const rule of demarcatorRules) {
        if (rule.argIndex === i) {
          for (const token of rule.tokens) {
            if (argVal.includes(token)) {
              const tokenPos = argVal.indexOf(token);
              const decoded = argVal !== call.args[i] || argEnd - argStart !== argVal.length;
              results.push({
                message: `"${token}" is not supported in the "${argSchema.name}" argument of "${name}"`,
                severity: 'error',
                startCol: decoded ? argStart : argStart + tokenPos,
                endCol: decoded ? argEnd : argStart + tokenPos + token.length,
              });
            }
          }
        }
      }
    }

  }

  // Nested snippet call pasted into an argument (checks every arg, not just schema slots).
  // Debugging snippets take free text / log-filter patterns, so their args are exempt.
  if (schema.category !== 'debugging') {
    for (let i = 0; i < args.length; i++) {
      const argVal = args[i];
      const nested = argVal === null || argVal === undefined ? null : findNestedSnippetName(argVal);
      if (nested) {
        const { startCol: argStart, endCol: argEnd } = ranges[i];
        results.push({
          message: `Argument looks like a nested "${nested}" snippet call — check quoting`,
          severity: 'warning',
          startCol: argStart,
          endCol: argEnd,
        });
      }
    }
  }

  for (const [index, arg] of schema.args.entries()) {
    if (arg.when?.required && activeArgument(arg, args) && args[index] !== null && !args[index]) {
      results.push({
        message: `"${name}" in "${arg.when.equals}" mode requires "${arg.name}"`,
        severity: 'error',
        startCol: absStart,
        endCol: absEnd,
      });
    }
  }

  // Race winners must be a positive integer
  if (name === 'race' && args[0] === 'start' && args.length > 1) {
    if (args[1] !== null && (!/^\d+$/.test(args[1]) || parseInt(args[1], 10) < 1)) {
      results.push({
        message: `"race" winners count must be a positive integer, got "${args[1]}"`,
        severity: 'error',
        startCol: absStart,
        endCol: absEnd,
      });
    }
  }

  return results;
}

export function detectDoubleQuotedArgs(body: string, calls: SnippetCall[], bodyOffset: number): LintResult[] {
  const results: LintResult[] = [];
  for (const call of calls) {
    for (const [index, off] of (call.argOffsets ?? []).entries()) {
      if (body[off.start - 1] === "'" || regexParts(call.args[index])) continue;
      const raw = body.slice(off.start, off.end);
      if (raw.length < 2 || !raw.startsWith('"') || !raw.endsWith('"')) continue;
      results.push({
        message: 'Double quotes around an argument are literal characters, possibly unintended — use single quotes to quote it',
        severity: 'warning',
        startCol: bodyOffset + off.start,
        endCol: bodyOffset + off.end,
      });
    }
  }
  return results;
}

/** Check quote sanity in a snippet chain body: unclosed quotes and quotes opening/closing mid-token */
export function validateSnippetBody(body: string, bodyOffset: number): LintResult[] {
  const results: LintResult[] = [];
  let escapedAt = -1; // escaped chars are literal content, not boundaries

  const midToken = (i: number) => {
    results.push({
      message: 'Quote in the middle of an argument — arguments should be fully quoted',
      severity: 'warning',
      startCol: bodyOffset + i,
      endCol: bodyOffset + i + 1,
    });
  };

  const { inQuote, quoteStart } = scanBody(body, {
    escape: i => { escapedAt = i + 1; },
    quoteOpen: i => { if (!isBoundary(body[i - 1]) || escapedAt === i - 1) midToken(i); },
    quoteClose: i => { if (!isBoundary(body[i + 1])) midToken(i); },
  });

  if (inQuote) {
    results.push({
      message: 'Unclosed single quote in snippet arguments',
      severity: 'warning',
      startCol: bodyOffset + quoteStart,
      endCol: bodyOffset + body.length,
    });
  }

  return results;
}

/** Unquoted args starting with "/" (regex or bare xpath) containing spaces or ";":
 *  ABP's tokenizer has no regex awareness — a space splits the argument and a ";"
 *  ends the whole command — silent divergence from how this linter parses them */
export function detectUnquotedRegexBreaks(body: string, calls: SnippetCall[], bodyOffset: number): LintResult[] {
  const results: LintResult[] = [];
  if (!body.includes('/')) return results;
  for (const call of calls) {
    if (!call.argOffsets) continue;
    for (const off of call.argOffsets) {
      if (body[off.start] !== '/' || body[off.start - 1] === "'") continue;
      const bare = unquotedRegexBreak(body.slice(off.start, off.end));
      if (bare === null) continue;
      results.push({
        message: bare === ';'
          ? 'ABP splits the snippet chain at an unquoted ";" (no regex awareness) — quote the argument or escape it'
          : 'ABP splits unquoted arguments on spaces (no regex awareness) — quote the argument or escape the spaces',
        severity: 'warning',
        startCol: bodyOffset + off.start,
        endCol: bodyOffset + off.end,
      });
    }
  }
  return results;
}

// adblockpluscore's singleCharacterEscapes only maps n/r/t; any other \X drops the backslash
const LOST_ESCAPE_CLASS_CHARS = new Set(['s', 'S', 'd', 'D', 'w', 'W', 'b', 'B']);
const LOST_ESCAPE_METACHARS = new Set(['.', '^', '$', '*', '+', '?', '(', ')', '[', ']', '|', '{', '}']);

function isRangeHyphen(pattern: string, index: number): boolean {
  const parts = regexParts(pattern);
  if (!parts) return false;
  try {
    const ast = new RegExpParser({ ecmaVersion: 2025 }).parsePattern(parts.source, 0, parts.source.length, {
      unicode: parts.flags.includes('u'),
      unicodeSets: parts.flags.includes('v'),
    });
    let found = false;
    visitRegExpAST(ast, {
      onCharacterClassRangeEnter(node) { if (node.min.end === index - 1) found = true; },
    });
    return found;
  } catch {
    return false;
  }
}

function isQuantifierBrace(pattern: string, index: number): boolean {
  const parts = regexParts(pattern);
  if (!parts) return false;
  let inClass = false;
  for (let i = 0; i < parts.source.length; i++) {
    const ch = parts.source[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '[') inClass = true;
    if (ch === ']') inClass = false;
    if (ch !== '{' || inClass) continue;
    const quantifier = /^\{\d+(?:,\d*)?\}/.exec(parts.source.slice(i));
    if (quantifier && (index === i + 1 || index === i + quantifier[0].length)) return true;
  }
  return false;
}

/** Regex-literal snippet args (quoted or not) where ABP's parser silently drops an unrecognized escape's backslash */
export function detectLostRegexEscapes(body: string, calls: SnippetCall[], bodyOffset: number): LintResult[] {
  const results: LintResult[] = [];
  if (!body.includes('\\')) return results;

  for (const call of calls) {
    if (!call.argOffsets || hasDecodingFailure(call)) continue;
    const schema = SNIPPETS[call.name];
    if (!schema || DEPRECATED[call.name]) continue;
    const args = call.runtimeArgs ?? call.args;
    for (const [index, off] of call.argOffsets.entries()) {
      const arg = argumentSchema(schema, index);
      const value = args[index];
      if (!arg?.regex || value === null || value === undefined || !activeArgument(arg, args)) continue;
      if (malformedRegexArguments(call).has(index)) continue;
      const raw = body.slice(off.start, off.end);
      const offsets: Array<{ start: number; end: number }> = [];
      if (decodeSnippetArgument(raw, offsets) !== value) continue;
      if (arg.regex === 'unflagged' && !value.endsWith('/')) continue;
      let patternOffset = 0;
      for (const pattern of regexPatterns(value, arg)) {
        const start = value.indexOf(pattern, patternOffset);
        patternOffset = start + pattern.length;
        if (!regexParts(pattern)) continue;
        for (let i = start; i < start + pattern.length; i++) {
          const span = offsets[i];
          if (span.end - span.start !== 2 || raw[span.start] !== '\\') continue;
          const next = raw[span.start + 1];
          const isClass = LOST_ESCAPE_CLASS_CHARS.has(next);
          const brace = next === '{' || next === '}';
          const isMeta = LOST_ESCAPE_METACHARS.has(next) &&
            (!brace || isQuantifierBrace(pattern, i - start));
          const isHyphen = next === '-' && isRangeHyphen(pattern, i - start);
          if (isClass || isMeta || isHyphen) {
            const abs = bodyOffset + off.start + span.start;
            results.push({
              message: isHyphen
                ? `Escaped "\\-" loses its backslash in ABP's snippet parser and becomes a range operator in the character class — use "\\\\-" for a literal hyphen`
                : isClass
                ? `Escaped "\\${next}" loses its backslash in ABP's snippet parser and becomes a literal "${next}" (regex class/boundary lost) — use "\\\\${next}" if that's intended`
                : `Escaped "\\${next}" loses its backslash in ABP's snippet parser and "${next}" becomes a live regex metacharacter — use "\\\\${next}" for a literal "${next}"`,
              severity: 'warning',
              startCol: abs,
              endCol: abs + 2,
            });
          }
        }
      }
    }
  }

  return results;
}

/** Warn on identical calls (same name + args) repeated within one chain; race start/stop is structural */
export function detectDuplicateCalls(calls: SnippetCall[], bodyOffset: number): LintResult[] {
  if (calls.some(hasDecodingFailure)) return [];
  const results: LintResult[] = [];
  const seen = new Set<string>();

  for (const call of calls) {
    if (call.name === 'race' || call.ambiguous) continue;
    const args = call.runtimeArgs ?? call.args;
    if (args.some(arg => arg === null)) continue;
    const key = JSON.stringify([call.name, args]);
    if (seen.has(key)) {
      const abs = bodyOffset + call.nameOffset;
      results.push({
        message: `Duplicate snippet call — identical "${call.name}" call already appears in this filter`,
        severity: 'warning',
        startCol: abs,
        endCol: abs + call.name.length,
      });
    } else {
      seen.add(key);
    }
  }

  return results;
}

/** Detect a network-classified line that looks like a snippet filter missing the #$# separator */
export function detectMissingSnippetSeparator(raw: string): LintResult | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith('!') || trimmed.startsWith('||') || trimmed.startsWith('|') || trimmed.startsWith('@@')) return null;
  if (trimmed.includes('$')) return null;

  const spaceIdx = trimmed.indexOf(' ');
  const firstToken = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);

  for (const snippetName of Object.keys(SNIPPETS)) {
    if (firstToken.endsWith(snippetName)) {
      const domainPart = firstToken.slice(0, -snippetName.length);
      if (domainPart.length > 0 && /^[a-zA-Z0-9*-]+(\.[a-zA-Z0-9*-]+)+$/.test(domainPart)) {
        const rest = trimmed.slice(domainPart.length);
        return {
          message: `Missing "#$#" separator — did you mean "${domainPart}#$#${rest}"?`,
          severity: 'warning',
          startCol: 0,
          endCol: trimmed.length,
        };
      }
    }
  }
  return null;
}

/** True if `rest` reads as a network option list (comma-separated known modifiers, no spaces) */
function looksLikeNetworkOptions(rest: string): boolean {
  if (/\s/.test(rest)) return false;
  return rest.split(',').every(tok => VALID_MODIFIERS.has(tok.replace(/^~/, '').split('=')[0]));
}

/** Detect a network-classified line using a mangled "#$#" snippet separator (e.g. "$#", "#$") */
export function detectMalformedSnippetSeparator(raw: string): LintResult | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith('!') || trimmed.startsWith('@@')) return null;

  // <domain-list><run of # and $ containing at least one $><rest>
  const m = /^(~?[a-zA-Z0-9*-]+(?:\.[a-zA-Z0-9*-]+)+(?:,~?[a-zA-Z0-9*-]+(?:\.[a-zA-Z0-9*-]+)+)*)([#$]*\$[#$]*)(.+)$/.exec(trimmed);
  if (!m) return null;

  const [, domainPart, sep, rest] = m;
  if (sep === '#$#' || !sep.includes('#')) return null;
  // "example.com#$script": trailing "#" is a literal pattern char, "$script" is real options.
  if (sep === '#$' && looksLikeNetworkOptions(rest)) return null;

  return {
    message: `Malformed snippet separator "${sep}" — did you mean "${domainPart}#$#${rest}"?`,
    severity: 'warning',
    startCol: 0,
    endCol: trimmed.length,
  };
}

/** Validate race block structure across a full snippet chain */
export function validateSnippetChain(calls: SnippetCall[], bodyOffset: number): LintResult[] {
  if (calls.some(hasDecodingFailure)) return [];
  const results: LintResult[] = [];

  let raceDepth = 0;
  let raceStartCall: SnippetCall | null = null;
  let hasAnyRace = false;

  // First pass: check race start/stop balance
  for (const call of calls) {
    if (call.name !== 'race') continue;
    hasAnyRace = true;
    const args = call.runtimeArgs ?? call.args;
    if (args[0] === 'start') {
      raceDepth++;
      if (raceDepth === 1) raceStartCall = call;
    } else if (args[0] === 'stop') {
      if (raceDepth === 0) {
        const abs = bodyOffset + call.nameOffset;
        results.push({
          message: '"race stop" without a matching "race start"',
          severity: 'error',
          startCol: abs,
          endCol: abs + 'race'.length,
        });
      } else {
        raceDepth--;
      }
    }
  }

  if (raceDepth > 0 && raceStartCall) {
    const abs = bodyOffset + raceStartCall.nameOffset;
    results.push({
      message: '"race start" without a matching "race stop"',
      severity: 'error',
      startCol: abs,
      endCol: abs + 'race'.length,
    });
  }

  // Second pass: check snippets inside race blocks
  if (hasAnyRace) {
    let inRace = false;
    for (const call of calls) {
      if (call.name === 'race') {
        const args = call.runtimeArgs ?? call.args;
        if (args[0] === 'start') inRace = true;
        else if (args[0] === 'stop') inRace = false;
        continue;
      }
      if (!inRace) continue;

      const schema = SNIPPETS[call.name];
      if (!schema) continue; // already flagged as unknown by validateSnippetCall

      const supported =
        (schema.category === 'conditional-hiding' && !schema.noRace) ||
        schema.race ||
        call.name === 'skip-video' ||
        schema.category === 'debugging';

      if (!supported) {
        const abs = bodyOffset + call.nameOffset;
        results.push({
          message: `"${call.name}" is not supported inside a race block`,
          severity: 'warning',
          startCol: abs,
          endCol: abs + call.name.length,
        });
      }
    }
  }

  return results;
}
