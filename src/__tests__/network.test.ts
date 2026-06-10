import { describe, it, expect } from 'vitest';
import { validateNetworkRule, findOptionsSeparator } from '../validators/network';

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

  it('accepts $webrtc modifier', () => {
    expect(validateNetworkRule('||ads.example.com^$webrtc', false, 0)).toHaveLength(0);
  });

  it('accepts $webbundle modifier', () => {
    expect(validateNetworkRule('||ads.example.com^$webbundle', false, 0)).toHaveLength(0);
  });

  it('warns on deprecated $collapse modifier', () => {
    const results = validateNetworkRule('||ads.example.com^$collapse', false, 0);
    expect(results).toHaveLength(1);
    expect(results[0].severity).toBe('warning');
    expect(results[0].message).toContain('collapse');
  });

  it('errors on double pipe in domain= value', () => {
    const results = validateNetworkRule('/rule$xmlhttprequest,domain=actvid.rs||myflixerzz.tube|videostr.net', false, 0);
    expect(results.some(r => r.severity === 'error' && r.message.includes('empty entry'))).toBe(true);
  });

  it('errors on leading pipe in domain= value', () => {
    const results = validateNetworkRule('||ads.example.com^$domain=|foo.com', false, 0);
    expect(results.some(r => r.severity === 'error' && r.message.includes('empty entry'))).toBe(true);
  });

  it('errors on trailing pipe in domain= value', () => {
    const results = validateNetworkRule('||ads.example.com^$domain=foo.com|', false, 0);
    expect(results.some(r => r.severity === 'error' && r.message.includes('empty entry'))).toBe(true);
  });

  it('does not flag $ anchor in regex filters', () => {
    expect(validateNetworkRule('/ads$/', false, 0)).toHaveLength(0);
    expect(validateNetworkRule('/banner\\d+$/', false, 0)).toHaveLength(0);
  });

  it('treats trailing bare $ as pattern text', () => {
    expect(validateNetworkRule('||example.com/path$', false, 0)).toHaveLength(0);
  });

  it('accepts header value containing =', () => {
    expect(validateNetworkRule('||ads.example.com^$header=X-Frame-Options=deny', false, 0)).toHaveLength(0);
  });

  it('reports correct range for modifier after a spaced comma', () => {
    const results = validateNetworkRule('||x.com^$foo, bar', false, 0);
    expect(results).toHaveLength(2);
    expect(results[1].message).toContain('bar');
    expect(results[1].startCol).toBe(14);
    expect(results[1].endCol).toBe(17);
  });

});

describe('findOptionsSeparator', () => {
  it('finds the options $', () => {
    expect(findOptionsSeparator('||x.com^$script')).toBe(8);
  });

  it('returns -1 for pure regex filters', () => {
    expect(findOptionsSeparator('/ads$/')).toBe(-1);
  });

  it('returns -1 when nothing follows $', () => {
    expect(findOptionsSeparator('foo$')).toBe(-1);
  });

  it('picks the last valid $', () => {
    expect(findOptionsSeparator('/ads$/$image')).toBe(6);
  });

  it('returns -1 when options are malformed (,,)', () => {
    expect(findOptionsSeparator('||x.com^$script,,image')).toBe(-1);
  });
});
