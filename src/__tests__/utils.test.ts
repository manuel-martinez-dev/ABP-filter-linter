import { describe, it, expect } from 'vitest';
import { isRestrictedByDomain, domainScope, isDomainLike, abbreviateDomains } from '../validators/utils';

describe('domainScope', () => {
  it.each([
    [[], 'global'],
    [['~a.com'], 'exclusion-only'],
    [['~a.com', '~b.com'], 'exclusion-only'],
    [['foo'], 'scoped'],
    [['a.com'], 'scoped'],
    [['~a.com', 'b.com'], 'scoped'],
  ])('%j -> %s', (domains, expected) => {
    expect(domainScope(domains)).toBe(expected);
  });
});

describe('isRestrictedByDomain', () => {
  it('is false for an empty domain list', () => {
    expect(isRestrictedByDomain([])).toBe(false);
  });

  it('is false for a negated-only list', () => {
    expect(isRestrictedByDomain(['~example.com'])).toBe(false);
  });

  it('is false for a dotless single label', () => {
    expect(isRestrictedByDomain(['foo'])).toBe(false);
  });

  it('is true for a plain domain', () => {
    expect(isRestrictedByDomain(['example.com'])).toBe(true);
  });

  it('is true for lowercase localhost only (core tests the raw text)', () => {
    expect(isRestrictedByDomain(['localhost'])).toBe(true);
    expect(isRestrictedByDomain(['LOCALHOST'])).toBe(false);
  });

  it('is true for a wildcard TLD domain', () => {
    expect(isRestrictedByDomain(['foo.*'])).toBe(true);
  });

  it('requires a char before and after the dot (core regex)', () => {
    expect(isRestrictedByDomain(['foo.'])).toBe(false);
    expect(isRestrictedByDomain(['.com'])).toBe(false);
    expect(isRestrictedByDomain(['a.b'])).toBe(true);
  });

  it('is true when at least one entry restricts', () => {
    expect(isRestrictedByDomain(['~a.com', 'b.com'])).toBe(true);
  });

  it('is false when only negated entries have dots', () => {
    expect(isRestrictedByDomain(['~a.com', 'foo'])).toBe(false);
  });
});

describe('isDomainLike', () => {
  it.each(['example.com', '~example.com', 'sub.example.org', 'example.*', 'my-site.example.net'])('accepts %s', d => {
    expect(isDomainLike(d)).toBe(true);
  });

  it.each(['', 'example', 'example.com/', 'example..com', '.example.com', 'example.com|example.org'])('rejects %s', d => {
    expect(isDomainLike(d)).toBe(false);
  });
});

describe('abbreviateDomains', () => {
  it('keeps up to three domains', () => {
    expect(abbreviateDomains(['example.com', 'example.org', 'example.net'])).toBe('example.com,example.org,example.net');
  });

  it('abbreviates longer lists', () => {
    expect(abbreviateDomains(['a.example.com', 'b.example.com', 'c.example.com', 'd.example.com'])).toBe('a.example.com,…,d.example.com (4 domains)');
  });
});
