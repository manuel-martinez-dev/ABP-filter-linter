import { describe, it, expect } from 'vitest';
import { validateCosmeticSelector } from '../validators/cosmetic';

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
