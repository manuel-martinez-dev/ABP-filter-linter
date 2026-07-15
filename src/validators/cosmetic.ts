import { parse } from 'css-what';
import type { LintResult } from '../types';
import { findActionBlock, isRestrictedByDomain, validateActionCss } from './utils';

/** filter_elemhide_not_specific_enough: generic ##/#@# body must be ≥3 raw chars (core checks untrimmed length) */
export function checkGenericBodyLength(
  domains: string[],
  body: string,
  bodyOffset: number
): LintResult | null {
  if (isRestrictedByDomain(domains) || body.length >= 3) return null;
  return {
    message: 'Generic content filter body must be at least 3 characters — add a domain or a longer selector',
    severity: 'error',
    startCol: bodyOffset,
    endCol: bodyOffset + Math.max(body.length, 1),
  };
}

export function validateCosmeticSelector(
  selector: string,
  bodyOffset: number
): LintResult[] {
  const results: LintResult[] = [];
  if (!selector.trim()) return results;

  const leadingWs = selector.length - selector.trimStart().length;
  if (selector[leadingWs] === '@') {
    results.push({
      message: 'Selector cannot start with "@"',
      severity: 'error',
      startCol: bodyOffset + leadingWs,
      endCol: bodyOffset + selector.length,
    });
    return results;
  }

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
  if (!stripped) return results;

  try {
    parse(stripped);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Invalid CSS selector';
    results.push({
      message: `Malformed CSS selector: ${msg}`,
      severity: 'warning',
      startCol: bodyOffset,
      endCol: bodyOffset + selector.length,
    });
  }

  return results;
}
