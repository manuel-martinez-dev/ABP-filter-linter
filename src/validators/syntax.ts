import type { LintResult } from '../types';

export function detectDoubleComma(line: string): LintResult | null {
  // For cosmetic/snippet rules: only check domain part (before the separator)
  const cosmeticMatch = line.match(/#(\$#|#|\?#|@#)/);
  if (cosmeticMatch && cosmeticMatch.index !== undefined) {
    const domainPart = line.slice(0, cosmeticMatch.index);
    const col = domainPart.indexOf(',,');
    if (col === -1) return null;
    return { message: 'Double comma ",," is invalid syntax', severity: 'error', startCol: col, endCol: col + 2 };
  }

  // For network rules: only check options part (after $) — not the URL pattern
  const dollarIdx = line.indexOf('$');
  if (dollarIdx !== -1) {
    const optionsPart = line.slice(dollarIdx);
    const col = optionsPart.indexOf(',,');
    if (col === -1) return null;
    return { message: 'Double comma ",," is invalid syntax', severity: 'error', startCol: dollarIdx + col, endCol: dollarIdx + col + 2 };
  }

  return null;
}

export function extractFilterKey(raw: string): string {
  const match = raw.match(/(#\$#|##|#\?#|#@#).*/);
  return match ? match[0] : raw;
}
