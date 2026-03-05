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

  it('warns on unknown action block', async () => {
    const results = await validateCosmeticSelector('.ad { foo: bar; }', 0);
    expect(results.some(r => r.severity === 'warning' && r.message.includes('action'))).toBe(true);
  });

  it('warns on CSS-only action block (no remove: true)', async () => {
    const results = await validateCosmeticSelector('.ad { display: none; }', 0);
    expect(results.some(r => r.severity === 'warning' && r.message.includes('action'))).toBe(true);
  });

  it('returns no errors for empty selector', async () => {
    expect(await validateCosmeticSelector('', 0)).toHaveLength(0);
  });
});
