export type FilterType =
  | 'comment'
  | 'snippet'       // #$#
  | 'extended'      // #?#
  | 'hiding-exception' // #@#
  | 'cosmetic'      // ##
  | 'exception'     // @@ prefix
  | 'network'       // ||, |, or plain blocking rule
  | 'unknown';

export interface ParsedLine {
  type: FilterType;
  domains: string[];      // e.g. ["example.com", "~foo.com"]
  body: string;           // everything after the separator
  separator: string;      // the separator itself
  raw: string;
  lineIndex: number;
  /** character offset where the body starts */
  bodyOffset: number;
}

const SEPARATORS = [
  { sep: '#$#', type: 'snippet' as FilterType },
  { sep: '#?#', type: 'extended' as FilterType },
  { sep: '#@#', type: 'hiding-exception' as FilterType },
  { sep: '##',  type: 'cosmetic' as FilterType },
];

export function parseLine(raw: string, lineIndex: number): ParsedLine {
  const trimmed = raw.trim();

  // Comments
  if (trimmed.startsWith('!') || trimmed.startsWith('[Adblock')) {
    return { type: 'comment', domains: [], body: trimmed, separator: '!', raw, lineIndex, bodyOffset: 0 };
  }

  // Empty
  if (trimmed.length === 0) {
    return { type: 'unknown', domains: [], body: '', separator: '', raw, lineIndex, bodyOffset: 0 };
  }

  // Exception rules (@@)
  if (trimmed.startsWith('@@')) {
    const bodyOffset = raw.indexOf('@@') + 2;
    return { type: 'exception', domains: [], body: trimmed.slice(2), separator: '@@', raw, lineIndex, bodyOffset };
  }

  // Cosmetic-style separators
  for (const { sep, type } of SEPARATORS) {
    const idx = trimmed.indexOf(sep);
    if (idx !== -1) {
      const domainStr = trimmed.slice(0, idx);
      const body = trimmed.slice(idx + sep.length);
      const domains = domainStr
        ? domainStr.split(',').map(d => d.trim()).filter(Boolean)
        : [];
      const bodyOffset = raw.indexOf(sep) + sep.length;
      return { type, domains, body, separator: sep, raw, lineIndex, bodyOffset };
    }
  }

  // Network rules
  return {
    type: 'network',
    domains: [],
    body: trimmed,
    separator: '',
    raw,
    lineIndex,
    bodyOffset: 0,
  };
}

/** Returns true if the document looks like an ABP filter list */
export function isAbpDocument(lines: string[]): boolean {
  return lines.some(l =>
    l.includes('##') ||
    l.includes('#$#') ||
    l.includes('#?#') ||
    l.includes('||') ||
    l.startsWith('@@')
  );
}
