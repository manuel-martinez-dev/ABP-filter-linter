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

  // Strip ABP cosmetic action suffix e.g. {remove:true;} or {display:none!important;}
  // These are valid ABP extended syntax but not valid CSS — remove before validating
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
