import type { LintResult } from '../types';

const VALID_ABP_PSEUDOS = new Set([
  ':-abp-has',
  ':-abp-contains',
  ':-abp-properties',
  ':xpath',
]);

let parse: ((selector: string) => unknown) | null = null;

async function getParser() {
  if (!parse) {
    const cssWhat = await import('css-what');
    parse = cssWhat.parse;
  }
  return parse;
}

function stripAbpPseudos(selector: string): string | null {
  let result = '';
  let i = 0;
  while (i < selector.length) {
    const abpMatch = /^(:-abp-\w+|:xpath)\(/.exec(selector.slice(i));
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

export async function validateExtendedSelector(
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

  // Validate CSS structure after replacing ABP-specific pseudo calls with a valid placeholder
  const strippedForCss = stripAbpPseudos(selectorForPseudo);
  if (strippedForCss === null) {
    results.push({
      message: 'Malformed CSS selector: unclosed ABP pseudo-class argument',
      severity: 'warning',
      startCol: bodyOffset,
      endCol: bodyOffset + selector.length,
    });
  } else if (strippedForCss.trim()) {
    try {
      const p = await getParser();
      p!(strippedForCss);
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

  return results;
}
