import { describe, it, expect } from 'vitest';
import { detectDoubleComma, extractFilterKey } from '../validators/syntax';

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
});

describe('extractFilterKey', () => {
  it('different domains produce different keys (no false-positive duplicate)', () => {
    expect(extractFilterKey('example.com##.ad')).not.toBe(extractFilterKey('website.com##.ad'));
  });

  it('identical filters produce the same key (duplicate detection still works)', () => {
    expect(extractFilterKey('example.com##.ad')).toBe(extractFilterKey('example.com##.ad'));
  });

  it('normalizes domain to lowercase', () => {
    expect(extractFilterKey('Example.COM##.ad')).toBe(extractFilterKey('example.com##.ad'));
  });

  it('normalizes multi-domain order', () => {
    expect(extractFilterKey('foo.com,example.com##.ad')).toBe(extractFilterKey('example.com,foo.com##.ad'));
  });

  it('handles no-domain cosmetic filter', () => {
    expect(extractFilterKey('##.ad')).toBe('##.ad');
  });

  it('includes domain for snippet filters', () => {
    expect(extractFilterKey('example.com#$#log hello')).not.toBe(extractFilterKey('website.com#$#log hello'));
  });

  it('includes domain for extended filters', () => {
    expect(extractFilterKey('example.com#?#div:-abp-has(.ad)')).not.toBe(extractFilterKey('other.com#?#div:-abp-has(.ad)'));
  });

  it('includes domain for hiding-exception filters', () => {
    expect(extractFilterKey('example.com#@#.ad')).not.toBe(extractFilterKey('other.com#@#.ad'));
  });

  it('returns full line for network rules', () => {
    expect(extractFilterKey('||ads.example.com^$script')).toBe('||ads.example.com^$script');
  });
});
