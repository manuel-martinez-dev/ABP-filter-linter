import { parse } from 'css-what';
import type { LintResult } from '../types';
import { findActionBlock, validateActionCss } from './utils';

const VALID_ABP_PSEUDOS = new Set([
  ':-abp-has',
  ':-abp-contains',
  ':-abp-properties',
  ':xpath',
]);

const abpRe = /(?::-abp-\w+|:xpath)\(/y;

function stripAbpPseudos(selector: string): string | null {
  let result = '';
  let i = 0;
  while (i < selector.length) {
    abpRe.lastIndex = i;
    const abpMatch = abpRe.exec(selector);
    if (abpMatch) {
      i += abpMatch[0].length;
      let depth = 1;
      let inQuote = false;
      let quoteChar = '';
      while (i < selector.length) {
        const ch = selector[i];
        if (inQuote) {
          if (ch === '\\' && i + 1 < selector.length) { i += 2; continue; }
          if (ch === quoteChar) inQuote = false;
          i++;
        } else {
          if (ch === '"' || ch === "'") { inQuote = true; quoteChar = ch; i++; }
          else if (ch === '(') { depth++; i++; }
          else if (ch === ')') { depth--; i++; if (depth === 0) break; }
          else { i++; }
        }
      }
      if (depth > 0) return null;
      result += ':not(*)';
    } else {
      result += selector[i];
      i++;
    }
  }
  return result;
}

function validateAbpHasInners(
  selector: string,
  bodyOffset: number
): LintResult[] {
  const results: LintResult[] = [];
  const re = /:-abp-has\(/g;
  let match: RegExpExecArray | null;

  while ((match = re.exec(selector)) !== null) {
    const argStart = match.index + match[0].length;
    let depth = 1;
    let inQuote = false;
    let quoteChar = '';
    let i = argStart;

    while (i < selector.length) {
      const ch = selector[i];
      if (inQuote) {
        if (ch === '\\' && i + 1 < selector.length) { i += 2; continue; }
        if (ch === quoteChar) inQuote = false;
        i++;
      } else {
        if (ch === '"' || ch === "'") { inQuote = true; quoteChar = ch; i++; }
        else if (ch === '(') { depth++; i++; }
        else if (ch === ')') {
          depth--;
          if (depth === 0) {
            const innerArg = selector.slice(argStart, i);
            const stripped = stripAbpPseudos(innerArg);
            if (stripped !== null && stripped.trim()) {
              try {
                parse(stripped);
              } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : 'Invalid CSS selector';
                results.push({
                  message: `Malformed :-abp-has() selector: ${msg}`,
                  severity: 'warning',
                  startCol: bodyOffset + argStart,
                  endCol: bodyOffset + i,
                });
              }
            }
            re.lastIndex = i + 1;
            break;
          }
          i++;
        } else { i++; }
      }
    }
  }

  return results;
}

export function validateExtendedSelector(
  selector: string,
  bodyOffset: number
): LintResult[] {
  const results: LintResult[] = [];
  if (!selector.trim()) return results;

  const { selectorPart: stripped, actionContent, blockStart } = findActionBlock(selector);
  if (blockStart !== -1 && actionContent !== null) {
    if (!actionContent) {
      results.push({
        message: 'Empty cosmetic action block',
        severity: 'warning',
        startCol: bodyOffset + blockStart,
        endCol: bodyOffset + selector.length,
      });
    } else {
      results.push(...validateActionCss(actionContent, bodyOffset + blockStart, bodyOffset + selector.length));
    }
  }

  const selectorForPseudo = stripped || selector;

  const pseudoRegex = /:[-\w]+\(/g;
  let match: RegExpExecArray | null;

  while ((match = pseudoRegex.exec(selectorForPseudo)) !== null) {
    const token = match[0].slice(0, -1);
    if (token.startsWith(':-abp-') && !VALID_ABP_PSEUDOS.has(token)) {
      const start = bodyOffset + match.index;
      results.push({
        message: `Unknown ABP pseudo-class "${token}()"`,
        severity: 'error',
        startCol: start,
        endCol: start + token.length,
      });
    }
  }

  const strippedForCss = stripAbpPseudos(selectorForPseudo);
  if (strippedForCss === null) {
    results.push({
      message: 'Malformed CSS selector: unclosed ABP pseudo-class argument',
      severity: 'warning',
      startCol: bodyOffset,
      endCol: bodyOffset + selector.length,
    });
    return results;
  }

  if (strippedForCss.trim()) {
    try {
      parse(strippedForCss);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Invalid CSS selector';
      results.push({
        message: `Malformed CSS selector: ${msg}`,
        severity: 'warning',
        startCol: bodyOffset,
        endCol: bodyOffset + selector.length,
      });
    }
  }

  results.push(...validateAbpHasInners(selectorForPseudo, bodyOffset));

  return results;
}
