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
}

interface SnippetSchema {
  since: string;
  args: ArgSchema[];
  category?: string;
  noRace?: boolean;
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
  return name.startsWith('log-if-');
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
  /** source-accurate column ranges for each arg, relative to the snippet body start */
  argOffsets?: Array<{ start: number; end: number }>;
  /** char offset of the snippet name within the body */
  nameOffset: number;
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

    calls.push({ name, args, argOffsets, nameOffset });
    offset += part.length + 1;
  }

  return calls;
}

export function validateSnippetCall(
  call: SnippetCall,
  bodyOffset: number
): LintResult[] {
  const results: LintResult[] = [];
  const { name, args, nameOffset } = call;
  const absStart = bodyOffset + nameOffset;
  const absEnd = absStart + name.length;

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
  if (!variadicArg && args.length > schema.args.length) {
    results.push({
      message: `"${name}" accepts at most ${schema.args.length} argument(s) but got ${args.length}`,
      severity: 'warning',
      startCol: absStart,
      endCol: absEnd,
    });
  }

  // Arg-level validation: enum + demarcators
  const demarcatorRules = FORBIDDEN_DEMARCATORS[name];
  let argSearchOffset = bodyOffset + nameOffset + name.length + 1;

  for (let i = 0; i < schema.args.length; i++) {
    const argSchema = schema.args[i];
    const argVal = args[i];
    if (argVal === undefined) break;

    const argStart = call.argOffsets?.[i] !== undefined
      ? bodyOffset + call.argOffsets[i].start
      : argSearchOffset;
    const argEnd = call.argOffsets?.[i] !== undefined
      ? bodyOffset + call.argOffsets[i].end
      : argSearchOffset + argVal.length;

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

    // Demarcator validation
    if (demarcatorRules) {
      for (const rule of demarcatorRules) {
        if (rule.argIndex === i) {
          for (const token of rule.tokens) {
            if (argVal.includes(token)) {
              const tokenPos = argVal.indexOf(token);
              results.push({
                message: `"${token}" is not supported in the "${argSchema.name}" argument of "${name}"`,
                severity: 'error',
                startCol: argStart + tokenPos,
                endCol: argStart + tokenPos + token.length,
              });
            }
          }
        }
      }
    }

    if (!call.argOffsets) argSearchOffset += argVal.length + 1;
  }

  // Nested snippet call pasted into an argument (checks every arg, not just schema slots).
  // Debugging snippets take free text / log-filter patterns, so their args are exempt.
  if (schema.category !== 'debugging') {
    let nestedSearchOffset = bodyOffset + nameOffset + name.length + 1;
    for (let i = 0; i < args.length; i++) {
      const argVal = args[i];
      const nested = findNestedSnippetName(argVal);
      if (nested) {
        const argStart = call.argOffsets?.[i] !== undefined
          ? bodyOffset + call.argOffsets[i].start
          : nestedSearchOffset;
        const argEnd = call.argOffsets?.[i] !== undefined
          ? bodyOffset + call.argOffsets[i].end
          : nestedSearchOffset + argVal.length;
        results.push({
          message: `Argument looks like a nested "${nested}" snippet call — check quoting`,
          severity: 'warning',
          startCol: argStart,
          endCol: argEnd,
        });
      }
      nestedSearchOffset += argVal.length + 1;
    }
  }

  // Race winners must be a positive integer
  if (name === 'race' && args[0] === 'start' && args.length > 1) {
    if (!/^\d+$/.test(args[1]) || parseInt(args[1], 10) < 1) {
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

/** Warn on identical calls (same name + args) repeated within one chain; race start/stop is structural */
export function detectDuplicateCalls(calls: SnippetCall[], bodyOffset: number): LintResult[] {
  const results: LintResult[] = [];
  const seen = new Set<string>();

  for (const call of calls) {
    if (call.name === 'race') continue;
    const key = call.name + '\x00' + call.args.join('\x00');
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
  const results: LintResult[] = [];

  let raceDepth = 0;
  let raceStartCall: SnippetCall | null = null;
  let hasAnyRace = false;

  // First pass: check race start/stop balance
  for (const call of calls) {
    if (call.name !== 'race') continue;
    hasAnyRace = true;
    if (call.args[0] === 'start') {
      raceDepth++;
      if (raceDepth === 1) raceStartCall = call;
    } else if (call.args[0] === 'stop') {
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
        if (call.args[0] === 'start') inRace = true;
        else if (call.args[0] === 'stop') inRace = false;
        continue;
      }
      if (!inRace) continue;

      const schema = SNIPPETS[call.name];
      if (!schema) continue; // already flagged as unknown by validateSnippetCall

      const supported =
        (schema.category === 'conditional-hiding' && !schema.noRace) ||
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
