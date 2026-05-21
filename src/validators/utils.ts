import type { LintResult } from '../types';

export function findActionBlock(
  selector: string
): { selectorPart: string; actionContent: string | null; blockStart: number } {
  let lastBraceStart = -1;
  let lastBraceEnd = -1;
  let squareDepth = 0;
  let inQuote = false;
  let quoteChar = '';

  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (inQuote) {
      if (ch === '\\' && i + 1 < selector.length) { i++; continue; }
      if (ch === quoteChar) inQuote = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = true; quoteChar = ch; continue;
    }
    if (ch === '[') { squareDepth++; continue; }
    if (ch === ']' && squareDepth > 0) { squareDepth--; continue; }
    if (squareDepth === 0) {
      if (ch === '{') lastBraceStart = i;
      else if (ch === '}') lastBraceEnd = i;
    }
  }

  if (lastBraceStart === -1 || lastBraceEnd === -1 || lastBraceEnd < lastBraceStart) {
    return { selectorPart: selector, actionContent: null, blockStart: -1 };
  }
  if (selector.slice(lastBraceEnd + 1).trim().length > 0) {
    return { selectorPart: selector, actionContent: null, blockStart: -1 };
  }

  const actionContent = selector.slice(lastBraceStart + 1, lastBraceEnd).trim();
  const selectorPart = selector.slice(0, lastBraceStart).trim();
  return { selectorPart, actionContent, blockStart: lastBraceStart };
}

function splitDeclarations(content: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inQuote = false;
  let quoteChar = '';
  let start = 0;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (inQuote) {
      if (ch === '\\' && i + 1 < content.length) { i++; continue; }
      if (ch === quoteChar) inQuote = false;
    } else if (ch === '"' || ch === "'") {
      inQuote = true; quoteChar = ch;
    } else if (ch === '(') {
      depth++;
    } else if (ch === ')' && depth > 0) {
      depth--;
    } else if (ch === ';' && depth === 0) {
      const decl = content.slice(start, i).trim();
      if (decl) parts.push(decl);
      start = i + 1;
    }
  }
  const last = content.slice(start).trim();
  if (last) parts.push(last);
  return parts;
}

export function validateActionCss(
  content: string,
  startCol: number,
  endCol: number
): LintResult[] {
  const results: LintResult[] = [];
  const declarations = splitDeclarations(content);
  for (const decl of declarations) {
    const colonIdx = decl.indexOf(':');
    let message: string | null = null;
    if (colonIdx === -1) {
      message = `Invalid CSS declaration: missing colon in "${decl}"`;
    } else if (colonIdx === 0) {
      message = `Invalid CSS declaration: empty property name in "${decl}"`;
    } else if (!decl.slice(colonIdx + 1).trim()) {
      message = `Invalid CSS declaration: empty value in "${decl}"`;
    }
    if (message) {
      results.push({ message, severity: 'warning', startCol, endCol });
    }
  }
  return results;
}
