import { describe, it, expect } from 'vitest';
import { detectDoubleComma, detectSpacesInDomains, detectTrailingWhitespace, buildDuplicateKey } from '../validators/syntax';
import { parseLine } from '../parser';

describe('detectDoubleComma', () => {
  it('returns null for valid line', () => {
    expect(detectDoubleComma('example.com##.ad')).toBeNull();
  });

  it('flags ,, in network options', () => {
    const result = detectDoubleComma('||ads.com^$script,,image');
    expect(result).not.toBeNull();
    expect(result!.severity).toBe('error');
    expect(result!.message).toContain(',,');
  });

  it('points to correct column in options', () => {
    const result = detectDoubleComma('||ads.com^$script,,image');
    expect(result!.startCol).toBe(17);
    expect(result!.endCol).toBe(19);
  });

  it('does not flag ,, in URL pattern before $', () => {
    expect(detectDoubleComma('src/*,,*/^$parameter')).toBeNull();
  });

  it('flags ,, in cosmetic domain list', () => {
    const result = detectDoubleComma('example.com,,website.com##.ad');
    expect(result).not.toBeNull();
    expect(result!.severity).toBe('error');
    expect(result!.startCol).toBe(11);
  });

  it('flags ,, in snippet domain list', () => {
    const result = detectDoubleComma('example.com,,website.com#$#log hello');
    expect(result).not.toBeNull();
    expect(result!.severity).toBe('error');
  });

  it('still flags ,, when the option list is malformed by it', () => {
    const result = detectDoubleComma('foo$image,,script');
    expect(result).not.toBeNull();
    expect(result!.startCol).toBe(9);
    expect(result!.endCol).toBe(11);
  });

  it('does not flag ,, inside a regex filter body', () => {
    expect(detectDoubleComma('/a,,b$/')).toBeNull();
  });
});

describe('detectSpacesInDomains', () => {
  it('flags space after comma in snippet domain list', () => {
    const result = detectSpacesInDomains('example.com, example.org,example.de#$#log hello');
    expect(result).not.toBeNull();
    expect(result!.severity).toBe('error');
    expect(result!.startCol).toBe(12);
    expect(result!.endCol).toBe(13);
  });

  it('flags space after comma in cosmetic domain list', () => {
    const result = detectSpacesInDomains('example.com, example.org##.ad');
    expect(result).not.toBeNull();
    expect(result!.startCol).toBe(12);
  });

  it('flags tab in domain list', () => {
    const result = detectSpacesInDomains('example.com,\texample.org##.ad');
    expect(result).not.toBeNull();
    expect(result!.startCol).toBe(12);
  });

  it('does not flag clean multi-domain cosmetic rule', () => {
    expect(detectSpacesInDomains('example.com,example.org##.ad')).toBeNull();
  });

  it('does not flag no-domain cosmetic rule', () => {
    expect(detectSpacesInDomains('##.ad')).toBeNull();
  });

  it('does not flag spaces inside snippet body', () => {
    expect(detectSpacesInDomains('example.com#$#log a b c')).toBeNull();
  });

  it('flags space around pipe in $domain= network option', () => {
    const result = detectSpacesInDomains('||ads.com^$script,domain=example.com| example.org');
    expect(result).not.toBeNull();
    expect(result!.severity).toBe('error');
    expect(result!.startCol).toBe(37);
  });

  it('does not flag clean $domain= network option', () => {
    expect(detectSpacesInDomains('||ads.com^$script,domain=example.com|example.org')).toBeNull();
  });

  it('does not flag network rule with no $domain= option', () => {
    expect(detectSpacesInDomains('||ads.com^$script,image')).toBeNull();
  });

  it('flags space before pipe in $domain= network option', () => {
    const result = detectSpacesInDomains('||ads.com^$script,domain=example.com |example.org');
    expect(result).not.toBeNull();
    expect(result!.severity).toBe('error');
    expect(result!.startCol).toBe(36);
  });

  it('flags space in $domain= on exception rule', () => {
    const result = detectSpacesInDomains('@@||ads.com^$domain=foo.com| bar.com');
    expect(result).not.toBeNull();
    expect(result!.severity).toBe('error');
    expect(result!.startCol).toBe(28);
  });

  it('flags space in $domain= on regex rule with $ in URL pattern', () => {
    // indexOf('$') would find the wrong $ inside the pattern and miss the space
    const result = detectSpacesInDomains('/ads\\.js$/$domain=a.com | b.com');
    expect(result).not.toBeNull();
    expect(result!.severity).toBe('error');
    expect(result!.startCol).toBe(23);
  });
});

describe('detectTrailingWhitespace', () => {
  it('returns null for clean filter', () => {
    expect(detectTrailingWhitespace('example.com##iframe[src][style]')).toBeNull();
  });

  it('flags trailing spaces on cosmetic filter', () => {
    const result = detectTrailingWhitespace('example.com##iframe[src][style]  ');
    expect(result).not.toBeNull();
    expect(result!.severity).toBe('warning');
    expect(result!.startCol).toBe(31);
    expect(result!.endCol).toBe(33);
  });

  it('flags trailing space after semicolon in snippet filter', () => {
    const result = detectTrailingWhitespace('example.com#$#race stop; ');
    expect(result).not.toBeNull();
    expect(result!.startCol).toBe(24);
  });

  it('returns null for snippet filter ending with semicolon and no space', () => {
    expect(detectTrailingWhitespace('example.com#$#race stop;')).toBeNull();
  });

  it('returns null for blank-only line', () => {
    expect(detectTrailingWhitespace('   ')).toBeNull();
  });

  it('flags trailing tab', () => {
    const result = detectTrailingWhitespace('example.com##.ad\t');
    expect(result).not.toBeNull();
    expect(result!.startCol).toBe(16);
  });

  it('does not flag spaces inside chained snippet body', () => {
    expect(detectTrailingWhitespace("foo.*#$#hide-if-matches-xpath './/div'; hide-if-matches-xpath './/span'")).toBeNull();
  });
});

describe('buildDuplicateKey', () => {
  const key = (line: string) => buildDuplicateKey(parseLine(line, 0));

  it('different domains produce different keys (no false-positive duplicate)', () => {
    expect(key('example.com##.ad')).not.toBe(key('website.com##.ad'));
  });

  it('identical filters produce the same key (duplicate detection still works)', () => {
    expect(key('example.com##.ad')).toBe(key('example.com##.ad'));
  });

  it('normalizes domain to lowercase', () => {
    expect(key('Example.COM##.ad')).toBe(key('example.com##.ad'));
  });

  it('normalizes multi-domain order', () => {
    expect(key('foo.com,example.com##.ad')).toBe(key('example.com,foo.com##.ad'));
  });

  it('handles no-domain cosmetic filter', () => {
    expect(key('##.ad')).toBe('##.ad');
  });

  it('includes domain for snippet filters', () => {
    expect(key('example.com#$#log hello')).not.toBe(key('website.com#$#log hello'));
  });

  it('includes domain for extended filters', () => {
    expect(key('example.com#?#div:-abp-has(.ad)')).not.toBe(key('other.com#?#div:-abp-has(.ad)'));
  });

  it('includes domain for hiding-exception filters', () => {
    expect(key('example.com#@#.ad')).not.toBe(key('other.com#@#.ad'));
  });

  it('returns full line for network rules', () => {
    expect(key('||ads.example.com^$script')).toBe('||ads.example.com^$script');
  });

  it('returns full line for exception rules', () => {
    expect(key('@@||x.com^$elemhide')).toBe('@@||x.com^$elemhide');
  });

  it('returns null for multi-snippet chains (deliberately skipped)', () => {
    expect(key('a.com#$#log a; log b')).toBeNull();
  });
});
