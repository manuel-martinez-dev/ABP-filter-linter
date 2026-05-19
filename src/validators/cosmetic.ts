import type { LintResult } from '../types';

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

  const actionMatch = selector.match(/\{([^}]*)\}\s*$/);
  if (actionMatch && !actionMatch[1].trim()) {
    const blockStart = selector.lastIndexOf('{');
    results.push({
      message: 'Empty cosmetic action block',
      severity: 'warning',
      startCol: bodyOffset + blockStart,
      endCol: bodyOffset + selector.length,
    });
  }

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
