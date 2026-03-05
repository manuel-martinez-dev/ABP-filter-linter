import type { LintResult } from '../types';

// css-what throws on invalid selectors — we use that as our validator
let parse: ((selector: string) => unknown) | null = null;

async function getParser() {
  if (!parse) {
    const cssWhat = await import('css-what');
    parse = cssWhat.parse;
  }
  return parse;
}

export async function validateCosmeticSelector(
  selector: string,
  bodyOffset: number
): Promise<LintResult[]> {
  const results: LintResult[] = [];
  if (!selector.trim()) return results;

  // Check for ABP cosmetic action block e.g. { remove: true; }
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

  // Strip the action block before CSS validation
  const stripped = selector.replace(/\s*\{[^}]*\}\s*$/, '').trim();
  if (!stripped) return results;

  try {
    const p = await getParser();
    p!(stripped);
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
