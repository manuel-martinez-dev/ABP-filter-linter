import type { LintResult } from '../types';

const VALID_ABP_PSEUDOS = new Set([
  ':-abp-has',
  ':-abp-contains',
  ':-abp-properties',
  ':xpath',
]);

export function validateExtendedSelector(
  selector: string,
  bodyOffset: number
): LintResult[] {
  const results: LintResult[] = [];

  // Find all :-abp-* or :xpath occurrences
  const pseudoRegex = /:[-\w]+\(/g;
  let match: RegExpExecArray | null;

  while ((match = pseudoRegex.exec(selector)) !== null) {
    const token = match[0].slice(0, -1); // strip trailing (
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

  return results;
}
