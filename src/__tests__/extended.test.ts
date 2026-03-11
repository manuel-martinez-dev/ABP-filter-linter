import { describe, it, expect } from 'vitest';
import { validateExtendedSelector } from '../validators/extended';

describe('validateExtendedSelector', () => {
  it('returns no errors for valid :-abp-has()', () => {
    expect(validateExtendedSelector('div:-abp-has(.ad)', 0)).toHaveLength(0);
  });

  it('returns no errors for valid :-abp-contains()', () => {
    expect(validateExtendedSelector('p:-abp-contains(Sponsored)', 0)).toHaveLength(0);
  });

  it('returns no errors for valid :-abp-properties()', () => {
    expect(validateExtendedSelector('div:-abp-properties(width:300px)', 0)).toHaveLength(0);
  });

  it('returns no errors for valid :xpath()', () => {
    expect(validateExtendedSelector('div:xpath(//div[@class="ad"])', 0)).toHaveLength(0);
  });

  it('errors on unknown :-abp-* pseudo-class', () => {
    const results = validateExtendedSelector('div:-abp-unknown(.ad)', 0);
    expect(results).toHaveLength(1);
    expect(results[0].severity).toBe('error');
    expect(results[0].message).toContain(':-abp-unknown');
  });

  it('ignores standard CSS pseudo-classes with parens', () => {
    expect(validateExtendedSelector('div:not(.foo)', 0)).toHaveLength(0);
  });

  it('ignores :is() and :where()', () => {
    expect(validateExtendedSelector('div:is(.foo, .bar)', 0)).toHaveLength(0);
  });

  it('passes with valid { remove: true; } action block', () => {
    expect(validateExtendedSelector('div:-abp-has(.ad) { remove: true; }', 0)).toHaveLength(0);
  });

  it('warns on unknown action block on extended selector', () => {
    const results = validateExtendedSelector('div:-abp-has(.ad) { remove: false; }', 0);
    expect(results.some(r => r.severity === 'warning' && r.message.includes('action'))).toBe(true);
  });

  it('still validates pseudo-class when valid action block present', () => {
    const results = validateExtendedSelector('div:-abp-unknown(.ad) { remove: true; }', 0);
    expect(results.some(r => r.severity === 'error' && r.message.includes(':-abp-unknown'))).toBe(true);
  });
});
