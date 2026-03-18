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
  it('extracts cosmetic body ignoring domain', () => {
    expect(extractFilterKey('example.com##.ad')).toBe('##.ad');
    expect(extractFilterKey('website.com##.ad')).toBe('##.ad');
  });

  it('extracts snippet body ignoring domain', () => {
    expect(extractFilterKey('example.com#$#log hello')).toBe('#$#log hello');
    expect(extractFilterKey('website.com#$#log hello')).toBe('#$#log hello');
  });

  it('extracts extended body ignoring domain', () => {
    expect(extractFilterKey('example.com#?#div:-abp-has(.ad)')).toBe('#?#div:-abp-has(.ad)');
  });

  it('extracts hiding-exception body ignoring domain', () => {
    expect(extractFilterKey('example.com#@#.ad')).toBe('#@#.ad');
  });

  it('returns full line for network rules', () => {
    expect(extractFilterKey('||ads.example.com^$script')).toBe('||ads.example.com^$script');
  });
});
