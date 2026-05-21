import { describe, it, expect } from 'vitest';
import { validateExtendedSelector } from '../validators/extended';

describe('validateExtendedSelector', () => {
  it('returns no errors for valid :-abp-has()', async () => {
    expect(await validateExtendedSelector('div:-abp-has(.ad)', 0)).toHaveLength(0);
  });

  it('returns no errors for valid :-abp-contains()', async () => {
    expect(await validateExtendedSelector('p:-abp-contains(Sponsored)', 0)).toHaveLength(0);
  });

  it('returns no errors for valid :-abp-properties()', async () => {
    expect(await validateExtendedSelector('div:-abp-properties(width:300px)', 0)).toHaveLength(0);
  });

  it('returns no errors for valid :xpath()', async () => {
    expect(await validateExtendedSelector('div:xpath(//div[@class="ad"])', 0)).toHaveLength(0);
  });

  it('errors on unknown :-abp-* pseudo-class', async () => {
    const results = await validateExtendedSelector('div:-abp-unknown(.ad)', 0);
    expect(results).toHaveLength(1);
    expect(results[0].severity).toBe('error');
    expect(results[0].message).toContain(':-abp-unknown');
  });

  it('ignores standard CSS pseudo-classes with parens', async () => {
    expect(await validateExtendedSelector('div:not(.foo)', 0)).toHaveLength(0);
  });

  it('ignores :is() and :where()', async () => {
    expect(await validateExtendedSelector('div:is(.foo, .bar)', 0)).toHaveLength(0);
  });

  it('passes with valid { remove: true; } action block', async () => {
    expect(await validateExtendedSelector('div:-abp-has(.ad) { remove: true; }', 0)).toHaveLength(0);
  });

  it('passes with inline CSS action block', async () => {
    expect(await validateExtendedSelector('div:-abp-has(.ad) { top: 0; }', 0)).toHaveLength(0);
  });

  it('warns on empty action block', async () => {
    const results = await validateExtendedSelector('div:-abp-has(.ad) { }', 0);
    expect(results.some(r => r.severity === 'warning' && r.message.includes('Empty'))).toBe(true);
  });

  it('still validates pseudo-class when valid action block present', async () => {
    const results = await validateExtendedSelector('div:-abp-unknown(.ad) { remove: true; }', 0);
    expect(results.some(r => r.severity === 'error' && r.message.includes(':-abp-unknown'))).toBe(true);
  });

  it('warns on malformed base selector', async () => {
    const results = await validateExtendedSelector('div[', 0);
    expect(results.some(r => r.severity === 'warning' && r.message.includes('Malformed'))).toBe(true);
  });

  it('handles nested parens in ABP pseudo arg without false positive', async () => {
    expect(await validateExtendedSelector('div:-abp-has([attr="val(ue)"])', 0)).toHaveLength(0);
  });

  it('warns on unclosed ABP pseudo argument', async () => {
    const results = await validateExtendedSelector('div:-abp-has(.ad', 0);
    expect(results.some(r => r.severity === 'warning' && r.message.includes('Malformed'))).toBe(true);
  });

  it('warns on malformed inner selector in :-abp-has()', async () => {
    const results = await validateExtendedSelector('div:-abp-has([invalid)', 0);
    expect(results.some(r => r.severity === 'warning' && r.message.includes(':-abp-has()'))).toBe(true);
  });

  it('does not warn on valid inner selector in :-abp-has()', async () => {
    const results = await validateExtendedSelector('div:-abp-has(.ad > span)', 0);
    expect(results.filter(r => r.message.includes(':-abp-has()'))).toHaveLength(0);
  });

  it('does not validate inner arg of :-abp-contains() as CSS', async () => {
    expect(await validateExtendedSelector('p:-abp-contains(Sponsored text)', 0)).toHaveLength(0);
  });

  it('passes when attribute value inside :-abp-has() contains braces', async () => {
    expect(await validateExtendedSelector('div:-abp-has([data-x="val{x}"])', 0)).toHaveLength(0);
  });

  it('warns on missing colon in extended action block', async () => {
    const results = await validateExtendedSelector('div:-abp-has(.ad) { display none }', 0);
    expect(results.some(r => r.severity === 'warning' && r.message.includes('missing colon'))).toBe(true);
  });

  it('warns on empty value in extended action block', async () => {
    const results = await validateExtendedSelector('div:-abp-has(.ad) { display: }', 0);
    expect(results.some(r => r.severity === 'warning' && r.message.includes('empty value'))).toBe(true);
  });

  it('does not detect action block when quote swallows brace', async () => {
    const results = await validateExtendedSelector("div:-abp-contains('text { remove: true }", 0);
    expect(results.every(r => !r.message.includes('Empty'))).toBe(true);
  });
});
