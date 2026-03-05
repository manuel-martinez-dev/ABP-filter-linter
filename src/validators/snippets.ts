import snippetData from '../data/snippets.json';
import type { LintResult } from '../types';

interface ArgSchema {
  name: string;
  required: boolean;
  variadic?: boolean;
  max?: number;
  enum?: string[];
}

interface SnippetSchema {
  since: string;
  args: ArgSchema[];
  category?: string;
  noRace?: boolean;
  noSvg?: boolean;
  noShadowInSearch?: boolean;
}

const SNIPPETS = snippetData.snippets as Record<string, SnippetSchema>;
const DEPRECATED = snippetData.deprecated as Record<string, string>;

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
  let i = 0;

  while (i < body.length) {
    const ch = body[i];

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
  // Tokenise: split on ';' only when outside single quotes
  const parts: string[] = [];
  let current = '';
  let inQuote = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '\\' && i + 1 < body.length) { current += ch + body[i + 1]; i++; continue; }
    if (ch === "'" && !inQuote) { inQuote = true; current += ch; continue; }
    if (ch === "'" && inQuote) { inQuote = false; current += ch; continue; }
    if (ch === ';' && !inQuote) { parts.push(current); current = ''; continue; }
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

  // Enum validation — track running offset so squiggle lands on the right arg
  let argSearchOffset = bodyOffset + nameOffset + name.length + 1;
  for (let i = 0; i < schema.args.length; i++) {
    const argSchema = schema.args[i];
    const argVal = args[i];
    if (argVal === undefined) break;
    if (argSchema.enum && !argSchema.enum.includes(argVal)) {
      results.push({
        message: `Invalid value "${argVal}" for "${argSchema.name}". Expected one of: ${argSchema.enum.join(', ')}`,
        severity: 'error',
        startCol: argSearchOffset,
        endCol: argSearchOffset + argVal.length,
      });
    }
    argSearchOffset += argVal.length + 1; // +1 for separating space
  }

  return results;
}
