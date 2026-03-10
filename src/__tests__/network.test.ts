import { describe, it, expect } from 'vitest';
import { validateNetworkRule } from '../validators/network';

describe('validateNetworkRule', () => {
  it('returns no errors for valid rule with no modifiers', () => {
    expect(validateNetworkRule('||ads.example.com^', false, 0)).toHaveLength(0);
  });

  it('returns no errors for valid content-type modifier', () => {
    expect(validateNetworkRule('||ads.example.com^$script', false, 0)).toHaveLength(0);
  });

  it('returns no errors for multiple valid modifiers', () => {
    expect(validateNetworkRule('||ads.example.com^$script,image', false, 0)).toHaveLength(0);
  });

  it('errors on unknown modifier', () => {
    const results = validateNetworkRule('||ads.example.com^$badmod', false, 0);
    expect(results).toHaveLength(1);
    expect(results[0].severity).toBe('error');
    expect(results[0].message).toContain('badmod');
  });

  it('errors on exception-only modifier on non-exception rule', () => {
    const results = validateNetworkRule('||ads.example.com^$elemhide', false, 0);
    expect(results[0].severity).toBe('error');
    expect(results[0].message).toContain('elemhide');
  });

  it('allows exception-only modifier on exception rule', () => {
    expect(validateNetworkRule('||ads.example.com^$elemhide', true, 0)).toHaveLength(0);
  });

  it('errors on rewrite without value', () => {
    const results = validateNetworkRule('||ads.example.com^$rewrite', false, 0);
    expect(results[0].severity).toBe('error');
    expect(results[0].message).toContain('rewrite');
  });

  it('errors on rewrite with wrong prefix', () => {
    const results = validateNetworkRule('||ads.example.com^$rewrite=wrong-value', false, 0);
    expect(results[0].severity).toBe('error');
    expect(results[0].message).toContain('abp-resource:');
  });

  it('accepts valid rewrite value', () => {
    expect(validateNetworkRule('||ads.example.com^$rewrite=abp-resource:blank-mp3', false, 0)).toHaveLength(0);
  });

  it('errors on $header without value', () => {
    const results = validateNetworkRule('||ads.example.com^$header', false, 0);
    expect(results[0].severity).toBe('error');
    expect(results[0].message).toContain('header');
  });

  it('accepts $header with value', () => {
    expect(validateNetworkRule('||ads.example.com^$header=X-Frame-Options', false, 0)).toHaveLength(0);
  });

  it('errors on $addheader without value', () => {
    const results = validateNetworkRule('||ads.example.com^$addheader', false, 0);
    expect(results[0].severity).toBe('error');
    expect(results[0].message).toContain('addheader');
  });

  it('errors on $document on a blocking rule', () => {
    const results = validateNetworkRule('||ads.example.com^$document', false, 0);
    expect(results.some(r => r.severity === 'error' && r.message.includes('document'))).toBe(true);
  });

  it('errors on $document combined with content-type modifier', () => {
    const results = validateNetworkRule('||ads.example.com^$document,script', false, 0);
    expect(results.some(r => r.message.includes('document') && r.message.includes('script'))).toBe(true);
  });

  it('errors on $document combined with image', () => {
    const results = validateNetworkRule('||ads.example.com^$document,image', false, 0);
    expect(results.some(r => r.message.includes('document') && r.message.includes('image'))).toBe(true);
  });

  it('allows $document combined with content-type modifier on exception rules', () => {
    expect(validateNetworkRule('@@||example.com^$document,script', true, 0)).toHaveLength(0);
  });

  it('allows $document combined with image on exception rules', () => {
    expect(validateNetworkRule('@@||example.com^$document,image', true, 0)).toHaveLength(0);
  });

  it('warns on comma-separated domains in domain= value', () => {
    const results = validateNetworkRule('||ads.example.com^$domain=foo.com,bar.com', false, 0);
    expect(results.some(r => r.severity === 'warning' && r.message.includes('|'))).toBe(true);
  });

  it('does not warn on valid domain= with pipe separator', () => {
    expect(validateNetworkRule('||ads.example.com^$domain=foo.com|bar.com', false, 0)).toHaveLength(0);
  });

  it('does not misidentify domain=foo.com,script as domain separator issue', () => {
    const results = validateNetworkRule('||ads.example.com^$domain=foo.com,script', false, 0);
    expect(results.every(r => !r.message.includes('|'))).toBe(true);
  });

  it('allows inverted modifier ~third-party', () => {
    expect(validateNetworkRule('||ads.example.com^$~third-party', false, 0)).toHaveLength(0);
  });
});
