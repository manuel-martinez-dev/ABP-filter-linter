import { parseLine } from '../parser';
import type { ParsedLine } from '../parser';
import type { LintResult } from '../types';
import { SNIPPET_NAMES, SNIPPET_NAME_SET, closestSnippet, splitSnippetChain } from './snippets';
import { findOptionsSeparator, isRegexFilter, VALID_MODIFIERS, PATTERN_TOO_SHORT, MISSING_OPTION_SEPARATOR, DOUBLED_SEPARATOR } from './network';
import { isDomainLike, abbreviateDomains, DOMAIN_PATTERN } from './utils';

const MALFORMED_SEPARATOR_RE = new RegExp(String.raw`^(${DOMAIN_PATTERN}(?:,${DOMAIN_PATTERN})*)(\s*[#$@](?:\s*[#$@])*)\s*(\S.*)$`);
const PIPE_PREFIX_RE = /^([^/@"!#]*?)(#@\$#|#\$#|#\?#|#@#|##)/;
const CONTENT_TYPES = new Set(['cosmetic', 'hiding-exception', 'extended']);
const PATTERN_SHAPE_MARKERS = [PATTERN_TOO_SHORT, MISSING_OPTION_SEPARATOR, DOUBLED_SEPARATOR];
const MIN_TAIL_LENGTH = 8;
const MAX_ECHOED_PATTERN = 60;
const DOMAIN_LIST_IN_PATTERN = 'Domain list in a network pattern';
export const MAX_SNIPPET_NAME_LENGTH = Math.max(...SNIPPET_NAMES.map(n => n.length));

export type IntendedType = 'snippet' | 'snippet-exception' | 'cosmetic' | 'extended' | 'hiding-exception';

export interface Edit { start: number; end: number; replacement: string }

export interface Repair {
  tier: 'confident' | 'guess' | 'hint';
  edits: Edit[];
  repairedRaw: string;
  intended: IntendedType;
  primary: LintResult;
}

export const TYPE_NAMES: Record<IntendedType, string> = {
  'snippet': 'snippet filter',
  'snippet-exception': 'snippet exception',
  'cosmetic': 'element hiding filter',
  'extended': 'extended element hiding filter',
  'hiding-exception': 'element hiding exception',
};

const SEPARATOR_TYPES: Record<string, IntendedType> = {
  '#@$#': 'snippet-exception',
  '#$#': 'snippet',
  '#?#': 'extended',
  '#@#': 'hiding-exception',
  '##': 'cosmetic',
};

export function indentOf(raw: string): number {
  return raw.length - raw.trimStart().length;
}

function isDomainList(text: string): boolean {
  return text.split(',').every(isDomainLike);
}

function firstToken(text: string): string {
  return /^\S*/.exec(text)![0];
}

function looksLikeNetworkOptions(rest: string): boolean {
  const name = rest.replace(/\s+/g, '').split(',')[0].replace(/^~/, '').split('=')[0];
  return VALID_MODIFIERS.has(name.toLowerCase());
}

function applyEdits(raw: string, edits: Edit[]): string {
  let out = '';
  let cursor = 0;
  for (const edit of edits) {
    out += raw.slice(cursor, edit.start) + edit.replacement;
    cursor = edit.end;
  }
  return out + raw.slice(cursor);
}

function buildRepair(parsed: ParsedLine, fields: Omit<Repair, 'repairedRaw'>): Repair {
  return { ...fields, repairedRaw: applyEdits(parsed.raw, fields.edits) };
}

function wholeLine(parsed: ParsedLine, message: string, severity: LintResult['severity'] = 'warning'): LintResult {
  const start = indentOf(parsed.raw);
  return { message, severity, startCol: start, endCol: start + parsed.raw.trim().length };
}

interface EditSpan extends Edit { delta: number; shift: number; rs: number; re: number }

function editSpans(edits: Edit[]): EditSpan[] {
  const spans: EditSpan[] = [];
  let shift = 0;
  for (const edit of edits) {
    const delta = edit.replacement.length - (edit.end - edit.start);
    const rs = edit.start + shift;
    spans.push({ ...edit, delta, shift, rs, re: rs + edit.replacement.length });
    shift += delta;
  }
  return spans;
}

function spanAt(spans: EditSpan[], col: number): EditSpan | null {
  let found: EditSpan | null = null;
  for (const span of spans) if (span.rs <= col) found = span;
  return found;
}

export function remapColumns(results: LintResult[], edits: Edit[]): LintResult[] {
  const spans = editSpans(edits);
  const mapStart = (col: number): number => {
    const s = spanAt(spans, col);
    if (!s) return col;
    if (col === s.rs) return s.start;
    if (col < s.re) return Math.min(s.start + (col - s.rs), s.end);
    return col - s.shift - s.delta;
  };
  const mapEnd = (col: number): number => {
    const s = spanAt(spans, col);
    if (!s) return col;
    if (col >= s.re) return col - s.shift - s.delta;
    return Math.min(s.start + (col - s.rs), s.end);
  };
  const insertedOnly = (r: LintResult) => spans.some(s =>
    s.replacement.length > s.end - s.start && r.startCol >= s.rs + (s.end - s.start) && r.endCol <= s.re);

  return results.filter(r => !insertedOnly(r)).map(r => {
    const startCol = mapStart(r.startCol);
    const endCol = mapEnd(r.endCol);
    return { ...r, startCol, endCol: endCol <= startCol ? startCol + 1 : endCol };
  });
}

export function detectPipeInDomainList(parsed: ParsedLine): Repair | null {
  if (parsed.type !== 'network') return null;
  const m = PIPE_PREFIX_RE.exec(parsed.raw.trim());
  if (!m || !m[1].includes('|') || !m[1].split(/[,|]/).every(isDomainLike)) return null;

  const indent = indentOf(parsed.raw);
  const edits: Edit[] = [];
  for (let i = 0; i < m[1].length; i++) {
    if (m[1][i] === '|') edits.push({ start: indent + i, end: indent + i + 1, replacement: ',' });
  }
  const separator = m[2];
  const intended = SEPARATOR_TYPES[separator];
  return buildRepair(parsed, {
    tier: 'confident',
    edits,
    intended,
    primary: {
      message: `"|" in domain list — ABP ignores "${separator}" (${TYPE_NAMES[intended]}) and loads this whole line as a URL blocking filter. Separate domains with ","`,
      severity: 'error',
      startCol: edits[0].start,
      endCol: edits[edits.length - 1].end,
    },
  });
}

export function detectMalformedSeparator(parsed: ParsedLine): Repair | null {
  if (parsed.type !== 'network') return null;
  const trimmed = parsed.raw.trim();
  const m = MALFORMED_SEPARATOR_RE.exec(trimmed);
  if (!m) return null;

  const [, domainPart, rawRun, rest] = m;
  const run = rawRun.trim();
  const compactRun = run.replace(/\s+/g, '');
  const token = /^[^\s;]*/.exec(rest)![0];
  if (!token) return null;
  let tier: Repair['tier'];
  if (compactRun.includes('#') && compactRun.includes('$')) {
    if (compactRun === '#$' && looksLikeNetworkOptions(rest)) return null;
    const closest = closestSnippet(token);
    const confident = closest && (closest.distance === 0 || (closest.distance <= 2 && closest.name.includes('-')));
    tier = confident ? 'confident' : 'guess';
  } else if ((compactRun === '#' || compactRun === '#@') && SNIPPET_NAME_SET.has(token)) {
    if (token.includes('-')) tier = 'confident';
    else if (firstCallHasArgs(rest)) tier = 'guess';
    else return null;
  } else {
    return null;
  }

  const intended: IntendedType = compactRun.includes('@') ? 'snippet-exception' : 'snippet';
  const separator = intended === 'snippet-exception' ? '#@$#' : '#$#';
  const indent = indentOf(parsed.raw);
  const edits = [{ start: indent + domainPart.length, end: indent + trimmed.length - rest.length, replacement: separator }];
  const suggestion = `${domainPart}${separator}${rest}`;
  return buildRepair(parsed, {
    tier,
    edits,
    intended,
    primary: wholeLine(parsed, `${tier === 'guess' ? 'Possibly a malformed' : 'Malformed'} ${TYPE_NAMES[intended]} separator "${run}" — did you mean "${suggestion}"?`, 'error'),
  });
}

function contentSeparatorStart(parsed: ParsedLine): number {
  return parsed.bodyOffset - parsed.separator.length;
}

export function trailingJunkStart(raw: string, from: number, floor: number): number {
  let i = from;
  while (i > floor && /[#$\s]/.test(raw[i - 1])) i--;
  return i;
}

function contentRepairStart(parsed: ParsedLine): { start: number; domainPrefix: string; leadingJunk: string } | null {
  const indent = indentOf(parsed.raw);
  const separatorStart = contentSeparatorStart(parsed);
  const tailStart = trailingJunkStart(parsed.raw, separatorStart, indent);
  const leadingJunk = parsed.raw.slice(tailStart, separatorStart);
  if (!/[#$]/.test(leadingJunk)) return { start: separatorStart, domainPrefix: parsed.raw.slice(indent, separatorStart), leadingJunk: '' };
  const domainPrefix = parsed.raw.slice(indent, tailStart);
  if (!isDomainList(domainPrefix)) return null;
  return { start: tailStart, domainPrefix, leadingJunk };
}

export function detectMangledContentSeparator(parsed: ParsedLine): Repair | null {
  if (!CONTENT_TYPES.has(parsed.type)) return null;
  const m = /^(\s*)([$#@]*\$[$#@]*)(\s*)([^\s;]+)/.exec(parsed.body);
  if (!m || !SNIPPET_NAME_SET.has(m[4])) return null;
  const repairStart = contentRepairStart(parsed);
  if (!repairStart) return null;

  const junk = m[2];
  const intended: IntendedType = parsed.separator.includes('@') || junk.includes('@') ? 'snippet-exception' : 'snippet';
  const separator = intended === 'snippet-exception' ? '#@$#' : '#$#';
  const nameIdx = m[1].length + m[2].length + m[3].length;
  const edits = [{ start: repairStart.start, end: parsed.bodyOffset + nameIdx, replacement: separator }];
  const suggestion = `${repairStart.domainPrefix}${separator}${parsed.body.slice(nameIdx)}`;
  return buildRepair(parsed, {
    tier: 'confident',
    edits,
    intended,
    primary: wholeLine(parsed, `Malformed ${TYPE_NAMES[intended]} separator "${repairStart.leadingJunk}${parsed.separator}${junk}" — did you mean "${suggestion}"?`),
  });
}

export function detectDroppedSnippetDollar(parsed: ParsedLine): Repair | null {
  if (!CONTENT_TYPES.has(parsed.type)) return null;
  const m = /^\s*([^\s;]+)\s+\S/.exec(parsed.body);
  if (!m || !m[1].includes('-') || !SNIPPET_NAME_SET.has(m[1])) return null;
  const repairStart = contentRepairStart(parsed);
  if (!repairStart) return null;

  const intended: IntendedType = parsed.type === 'hiding-exception' ? 'snippet-exception' : 'snippet';
  const separator = intended === 'snippet-exception' ? '#@$#' : '#$#';
  const edits = [{ start: repairStart.start, end: parsed.bodyOffset, replacement: separator }];
  const suggestion = `${repairStart.domainPrefix}${separator}${parsed.body.trimStart()}`;
  return buildRepair(parsed, {
    tier: 'guess',
    edits,
    intended,
    primary: wholeLine(parsed, `Possibly a ${TYPE_NAMES[intended]} (${separator}) — "${m[1]}" is a snippet name, not a CSS selector. If so: "${suggestion}"`),
  });
}

function missingSeparatorToken(parsed: ParsedLine): { token: string; afterToken: string } | null {
  if (parsed.type !== 'network') return null;
  const trimmed = parsed.raw.trim();
  if (trimmed.startsWith('|')) return null;
  const token = firstToken(trimmed);
  if (token.includes('$')) return null;
  return { token, afterToken: trimmed.slice(token.length) };
}

function firstCallHasArgs(body: string): boolean {
  return (splitSnippetChain(body)[0]?.args.length ?? 0) > 0;
}

function isPlausibleLastLabel(domainPart: string): boolean {
  const lastLabel = domainPart.slice(domainPart.lastIndexOf('.') + 1);
  return lastLabel === '*' || lastLabel.length >= 2;
}

export function detectMissingSeparatorExact(parsed: ParsedLine): Repair | null {
  const split = missingSeparatorToken(parsed);
  if (!split) return null;
  const { token, afterToken } = split;

  let name: string | null = null;
  let hasArgs = false;
  for (const candidate of SNIPPET_NAMES) {
    if (token.length <= candidate.length || !token.endsWith(candidate)) continue;
    const domainPart = token.slice(0, -candidate.length);
    if (!isDomainList(domainPart)) continue;
    const candidateHasArgs = firstCallHasArgs(candidate + afterToken);
    if (!candidate.includes('-') && !(candidateHasArgs && isPlausibleLastLabel(domainPart))) continue;
    if (!name || candidate.length > name.length) {
      name = candidate;
      hasArgs = candidateHasArgs;
    }
  }
  if (!name) return null;

  const domainPart = token.slice(0, -name.length);
  const insertAt = indentOf(parsed.raw) + domainPart.length;
  const suggestion = `${domainPart}#$#${name}${afterToken}`;
  const tier = !name.includes('-') ? 'guess' : hasArgs ? 'confident' : 'hint';
  return buildRepair(parsed, {
    tier,
    edits: [{ start: insertAt, end: insertAt, replacement: '#$#' }],
    intended: 'snippet',
    primary: wholeLine(parsed, `${tier === 'guess' ? 'Possibly missing' : 'Missing'} "#$#" snippet filter separator — did you mean "${suggestion}"?`),
  });
}

export function candidateCutStart(token: string): number {
  return Math.max(1, token.length - MAX_SNIPPET_NAME_LENGTH);
}

export function detectTruncatedSnippetName(parsed: ParsedLine): Repair | null {
  const split = missingSeparatorToken(parsed);
  if (!split || !split.afterToken.trim()) return null;
  const { token, afterToken } = split;

  let cut = -1;
  let candidates: string[] = [];
  for (let i = candidateCutStart(token); token.length - i >= MIN_TAIL_LENGTH; i++) {
    const tail = token.slice(i);
    candidates = SNIPPET_NAMES.filter(n => {
      const k = n.length - tail.length;
      return k > 0 && n.endsWith(tail) && (n[k] === '-' || n[k - 1] === '-');
    });
    if (candidates.length > 0 && isDomainList(token.slice(0, i))) { cut = i; break; }
  }
  if (cut === -1) return null;

  const tail = token.slice(cut);
  const prefix = token.slice(0, cut);

  if (candidates.length > 1) {
    return {
      tier: 'hint',
      edits: [],
      repairedRaw: parsed.raw,
      intended: 'snippet',
      primary: wholeLine(parsed, `Possibly a snippet filter (#$#) with a missing "#$#" and a truncated name — "…${tail}" matches the end of: ${candidates.join(', ')}. Expected shape: "${abbreviateDomains(prefix.split(','))}#$#<snippet-name> <args>".`),
    };
  }

  const name = candidates[0];
  const head = name.slice(0, name.length - tail.length);
  const insertAt = indentOf(parsed.raw) + cut;
  return buildRepair(parsed, {
    tier: 'guess',
    edits: [{ start: insertAt, end: insertAt, replacement: `#$#${head}` }],
    intended: 'snippet',
    primary: wholeLine(parsed, `Possibly a snippet filter (#$#) missing "#$#${head}" — "…${tail}" matches the end of "${name}". If so: "${prefix}#$#${name}${afterToken}".`),
  });
}

export function detectRepair(parsed: ParsedLine): Repair | null {
  return detectPipeInDomainList(parsed)
    ?? detectMalformedSeparator(parsed)
    ?? detectMangledContentSeparator(parsed)
    ?? detectDroppedSnippetDollar(parsed)
    ?? detectMissingSeparatorExact(parsed)
    ?? detectTruncatedSnippetName(parsed);
}

interface NormalizedPattern {
  pattern: string;
  rawPatternEnd: number;
}

function normalizeNetworkPattern(parsed: ParsedLine): NormalizedPattern {
  const { body, bodyOffset } = parsed;
  const rawCols: number[] = [];
  let stripped = '';
  for (let i = 0; i < body.length; i++) {
    if (/\s/.test(body[i])) continue;
    rawCols.push(bodyOffset + i);
    stripped += body[i];
  }
  rawCols.push(bodyOffset + body.length);
  const dollarIdx = findOptionsSeparator(stripped);
  return {
    pattern: dollarIdx === -1 ? stripped : stripped.slice(0, dollarIdx),
    rawPatternEnd: dollarIdx === -1 ? bodyOffset + body.length : rawCols[dollarIdx],
  };
}

export function detectDamagedNetworkPattern(parsed: ParsedLine): LintResult | null {
  if (parsed.type !== 'network') return null;
  const normalized = normalizeNetworkPattern(parsed);
  const rawPattern = parsed.body.slice(0, normalized.rawPatternEnd - parsed.bodyOffset).trimEnd();
  const token = firstToken(rawPattern).split(/[#?]/)[0];
  if (token.includes(',') && isDomainList(token)) {
    return {
      message: `${DOMAIN_LIST_IN_PATTERN} — ABP loads this as a URL blocking filter. This usually means a damaged content filter (missing ##/#$# separator).`,
      severity: 'warning',
      startCol: parsed.bodyOffset,
      endCol: parsed.bodyOffset + token.length,
    };
  }

  if (!/\s/.test(rawPattern) || isRegexFilter(normalized.pattern)) return null;
  const echoed = normalized.pattern.length > MAX_ECHOED_PATTERN ? `${normalized.pattern.slice(0, MAX_ECHOED_PATTERN - 1)}…` : normalized.pattern;
  return {
    message: `Whitespace in a network pattern — ABP removes it and reads this as "${echoed}". This usually means a damaged content filter (missing ##/#$# separator).`,
    severity: 'warning',
    startCol: parsed.bodyOffset,
    endCol: parsed.bodyOffset + rawPattern.length,
  };
}

export function hasPatternShapeFinding(results: LintResult[]): boolean {
  return results.some(r => PATTERN_SHAPE_MARKERS.some(marker => r.message.includes(marker)));
}

export function detectMissingSnippetSeparator(raw: string): LintResult | null {
  return detectMissingSeparatorExact(parseLine(raw, 0))?.primary ?? null;
}

export function detectMalformedSnippetSeparator(raw: string): LintResult | null {
  return detectMalformedSeparator(parseLine(raw, 0))?.primary ?? null;
}
