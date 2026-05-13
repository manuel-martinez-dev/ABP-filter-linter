import type { LintResult } from '../types';

export function detectSpacesInDomains(line: string): LintResult | null {
  // Cosmetic/snippet/extended/hiding-exception: check domain part before separator
  const sepMatch = line.match(/#(\$#|#|\?#|@#)/);
  if (sepMatch && sepMatch.index !== undefined) {
    const domainPart = line.slice(0, sepMatch.index);
    if (!domainPart) return null;
    const spaceMatch = domainPart.match(/\s+/);
    if (!spaceMatch || spaceMatch.index === undefined) return null;
    return {
      message: 'Spaces are not allowed in domain list',
      severity: 'error',
      startCol: spaceMatch.index,
      endCol: spaceMatch.index + spaceMatch[0].length,
    };
  }

  // Network rules: check $domain= option value
  const dollarIdx = line.indexOf('$');
  if (dollarIdx !== -1) {
    const optionsPart = line.slice(dollarIdx + 1);
    const domainOptMatch = optionsPart.match(/(?:^|,)domain=([^,]*)/);
    if (domainOptMatch && domainOptMatch.index !== undefined) {
      const valueStart = dollarIdx + 1 + domainOptMatch.index + domainOptMatch[0].indexOf('=') + 1;
      const spaceMatch = domainOptMatch[1].match(/\s+/);
      if (!spaceMatch || spaceMatch.index === undefined) return null;
      return {
        message: 'Spaces are not allowed in domain list',
        severity: 'error',
        startCol: valueStart + spaceMatch.index,
        endCol: valueStart + spaceMatch.index + spaceMatch[0].length,
      };
    }
  }

  return null;
}

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

export function detectTrailingWhitespace(line: string): LintResult | null {
  if (!line.trim()) return null;
  const trimmed = line.trimEnd();
  if (trimmed.length === line.length) return null;
  return {
    message: 'Trailing whitespace',
    severity: 'warning',
    startCol: trimmed.length,
    endCol: line.length,
  };
}

export function extractFilterKey(raw: string): string {
  const match = raw.match(/^([^#]*)(#\$#|##|#\?#|#@#)(.*)/);
  if (!match) return raw;
  const domains = match[1]
    .split(',')
    .map(d => d.trim().toLowerCase())
    .sort()
    .join(',');
  return `${domains}${match[2]}${match[3]}`;
}
