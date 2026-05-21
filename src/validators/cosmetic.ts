import { parse } from 'css-what';
import type { LintResult } from '../types';
import { findActionBlock, validateActionCss } from './utils';

export function validateCosmeticSelector(
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
