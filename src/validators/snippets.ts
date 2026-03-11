import snippetData from '../data/snippets.json';
import type { LintResult } from '../types';

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

/** Parse snippet args respecting single-quoted strings and escape sequences */
export function parseSnippetArgs(body: string): string[] {
  const args: string[] = [];
  let current = '';
  let inQuote = false;
  let inRegex = false;
  let i = 0;

  while (i < body.length) {
    const ch = body[i];

    // Inside regex: preserve escapes as-is, only exit on closing /
    if (inRegex) {
      if (ch === '\\' && i + 1 < body.length) {
        current += ch + body[i + 1];
        i += 2;
        continue;
      }
      if (ch === '/') {
        inRegex = false;
        current += ch;
        i++;
        continue;
      }
      current += ch;
      i++;
      continue;
    }

    if (ch === '\\' && i + 1 < body.length) {
      current += body[i + 1];
      i += 2;
      continue;
    }

    if (ch === "'" && !inQuote) {
      inQuote = true;
      i++;
      continue;
    }

    if (ch === "'" && inQuote) {
      inQuote = false;
      // Always flush on close-quote (handles '' empty string as a valid arg)
      args.push(current);
      current = '';
      i++;
      continue;
    }

    if (ch === ' ' && !inQuote) {
      if (current.length > 0) { args.push(current); current = ''; }
      i++;
      continue;
    }

    // Detect regex start: / at the beginning of a new token
    if (ch === '/' && !inQuote && current.length === 0) {
      inRegex = true;
      current += ch;
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  if (current.length > 0) args.push(current);
  return args;
}

export interface SnippetCall {
  name: string;
  args: string[];
  /** char offset of the snippet name within the body */
  nameOffset: number;
}

/** Split a snippet filter body (after #$#) by `;` respecting single-quoted strings */
export function splitSnippetChain(body: string): SnippetCall[] {
  const parts: string[] = [];
  let current = '';
  let inQuote = false;
  let inRegex = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '\\' && i + 1 < body.length) { current += ch + body[i + 1]; i++; continue; }
    if (ch === "'" && !inQuote && !inRegex) { inQuote = true; current += ch; continue; }
    if (ch === "'" && inQuote) { inQuote = false; current += ch; continue; }
    const prevCh = i > 0 ? body[i - 1] : ' ';
    if (ch === '/' && !inQuote && !inRegex && (prevCh === ' ' || prevCh === ';')) { inRegex = true; current += ch; continue; }
    if (ch === '/' && inRegex) { inRegex = false; current += ch; continue; }
    if (ch === ';' && !inQuote && !inRegex) { parts.push(current); current = ''; continue; }
    current += ch;
  }
  if (current.length > 0) parts.push(current);

  const calls: SnippetCall[] = [];
  let offset = 0;

  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.length === 0) { offset += part.length + 1; continue; }

    const spaceIdx = trimmed.indexOf(' ');
    const name = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
    const argBody = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1);
    const args = argBody ? parseSnippetArgs(argBody) : [];

    const nameOffset = body.indexOf(trimmed, offset);
    calls.push({ name, args, nameOffset });
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

    // Enum validation
    if (argSchema.enum && !argSchema.enum.includes(argVal)) {
      const isNumericLiteral = argSchema.allowsNumericLiteral === true && /^\d+$/.test(argVal);
      if (!isNumericLiteral) {
        results.push({
          message: `Invalid value "${argVal}" for "${argSchema.name}". Expected one of: ${argSchema.enum.join(', ')}`,
          severity: 'error',
          startCol: argSearchOffset,
          endCol: argSearchOffset + argVal.length,
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
                startCol: argSearchOffset + tokenPos,
                endCol: argSearchOffset + tokenPos + token.length,
              });
            }
          }
        }
      }
    }

    argSearchOffset += argVal.length + 1; // +1 for separating space
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

/** Check for unclosed single quotes in a snippet chain body */
export function validateSnippetBody(body: string, bodyOffset: number): LintResult[] {
  const results: LintResult[] = [];
  let inQuote = false;
  let quoteStart = -1;

  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '\\' && i + 1 < body.length) { i++; continue; }
    if (ch === "'") {
      if (!inQuote) { inQuote = true; quoteStart = i; }
      else { inQuote = false; quoteStart = -1; }
    }
  }

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
