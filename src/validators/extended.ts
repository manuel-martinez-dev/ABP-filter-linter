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
  if (!selector.trim()) return results;

  // Check for action block — same rules as cosmetic filters
  const actionMatch = selector.match(/\{([^}]*)\}\s*$/);
  if (actionMatch) {
    const actionBody = actionMatch[1];
    if (!/remove\s*:\s*true/.test(actionBody)) {
      const blockStart = selector.lastIndexOf('{');
      results.push({
        message: 'Unknown cosmetic action. Only "remove: true" is supported',
        severity: 'warning',
        startCol: bodyOffset + blockStart,
        endCol: bodyOffset + selector.length,
      });
    }
  }

  // Strip the action block before pseudo-class validation
  const stripped = selector.replace(/\s*\{[^}]*\}\s*$/, '').trim();
  const selectorForPseudo = stripped || selector;

  // Find all :-abp-* or :xpath occurrences
  const pseudoRegex = /:[-\w]+\(/g;
  let match: RegExpExecArray | null;

  while ((match = pseudoRegex.exec(selectorForPseudo)) !== null) {
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
