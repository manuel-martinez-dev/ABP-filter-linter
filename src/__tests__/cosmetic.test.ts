import { describe, it, expect } from 'vitest';
import { checkGenericBodyLength, validateCosmeticSelector } from '../validators/cosmetic';

describe('validateCosmeticSelector', () => {
  it('returns no errors for a valid selector', async () => {
    expect(await validateCosmeticSelector('.ad-banner', 0)).toHaveLength(0);
  });

  it('returns no errors for a valid compound selector', async () => {
    expect(await validateCosmeticSelector('div.ad > span[data-ad]', 0)).toHaveLength(0);
  });

  it('warns on malformed CSS selector', async () => {
    const results = await validateCosmeticSelector('div[invalid', 0);
    expect(results[0].severity).toBe('warning');
    expect(results[0].message).toContain('Malformed CSS selector');
  });

  it('errors on selector starting with @', async () => {
    const results = await validateCosmeticSelector('@media screen', 0);
    expect(results).toHaveLength(1);
    expect(results[0].severity).toBe('error');
    expect(results[0].message).toContain('@');
  });

  it('reports correct range for @ selector with leading whitespace', async () => {
    const results = await validateCosmeticSelector('  @.ad', 5);
    expect(results[0].startCol).toBe(7);
    expect(results[0].endCol).toBe(11);
  });

  it('passes with { remove: true; } action', async () => {
    expect(await validateCosmeticSelector('.ad { remove: true; }', 0)).toHaveLength(0);
  });

  it('passes with CSS declarations alongside remove: true', async () => {
    expect(await validateCosmeticSelector('.ad { margin: 0; remove: true; }', 0)).toHaveLength(0);
  });

  it('passes with inline CSS action block', async () => {
    expect(await validateCosmeticSelector('.navigation--has-subnav { top: 0; }', 0)).toHaveLength(0);
  });

  it('passes with multiple CSS declarations in action block', async () => {
    expect(await validateCosmeticSelector('.aside { margin: 0; background: none }', 0)).toHaveLength(0);
  });

  it('warns on empty action block', async () => {
    const results = await validateCosmeticSelector('.ad { }', 0);
    expect(results.some(r => r.severity === 'warning' && r.message.includes('Empty'))).toBe(true);
  });

  it('returns no errors for empty selector', async () => {
    expect(await validateCosmeticSelector('', 0)).toHaveLength(0);
  });

  it('warns on malformed selector in hiding-exception (#@#)', async () => {
    const results = await validateCosmeticSelector('div[invalid', 0);
    expect(results.some(r => r.severity === 'warning' && r.message.includes('Malformed'))).toBe(true);
  });

  it('passes valid selector in hiding-exception (#@#)', async () => {
    expect(await validateCosmeticSelector('.ad-banner', 0)).toHaveLength(0);
  });

  it('passes when attribute value contains braces (findActionBlock must not split on them)', async () => {
    expect(await validateCosmeticSelector('div[data-x="val{x}"] { color: red }', 0)).toHaveLength(0);
  });

  it('passes display: none !important', async () => {
    expect(await validateCosmeticSelector('div { display: none !important }', 0)).toHaveLength(0);
  });

  it('passes CSS custom property declaration', async () => {
    expect(await validateCosmeticSelector('div { --custom: value }', 0)).toHaveLength(0);
  });

  it('warns on missing colon in CSS declaration', async () => {
    const results = await validateCosmeticSelector('div { display none }', 0);
    expect(results.some(r => r.severity === 'warning' && r.message.includes('missing colon'))).toBe(true);
  });

  it('warns on empty value in CSS declaration', async () => {
    const results = await validateCosmeticSelector('div { display: }', 0);
    expect(results.some(r => r.severity === 'warning' && r.message.includes('empty value'))).toBe(true);
  });

  it('warns on empty property name in CSS declaration', async () => {
    const results = await validateCosmeticSelector('div { : none }', 0);
    expect(results.some(r => r.severity === 'warning' && r.message.includes('empty property name'))).toBe(true);
  });

  it('does not warn when semicolon is inside url() value', async () => {
    expect(await validateCosmeticSelector("div { background-image: url('a;b.png') }", 0)).toHaveLength(0);
  });
});

describe('checkGenericBodyLength (filter_elemhide_not_specific_enough)', () => {
  it('errors on a generic 2-char body', () => {
    const r = checkGenericBodyLength([], 'ad', 2);
    expect(r).not.toBeNull();
    expect(r!.severity).toBe('error');
    expect(r!.startCol).toBe(2);
    expect(r!.endCol).toBe(4);
  });

  it('errors on a generic hiding-exception short body (ABP applies it to #@# too)', () => {
    expect(checkGenericBodyLength([], '.x', 3)).not.toBeNull();
  });

  it('accepts a generic 3-char body', () => {
    expect(checkGenericBodyLength([], '.ad', 2)).toBeNull();
  });

  it('accepts a short body when a restricting domain is present', () => {
    expect(checkGenericBodyLength(['example.com'], 'ad', 13)).toBeNull();
  });

  it('still errors when only a negated domain is present', () => {
    expect(checkGenericBodyLength(['~example.com'], 'ad', 14)).not.toBeNull();
  });

  it('counts raw length like core (no trim)', () => {
    expect(checkGenericBodyLength([], ' .a', 2)).toBeNull();
  });
});
