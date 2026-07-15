import { describe, it, expect } from 'vitest';
import { isRestrictedByDomain } from '../validators/utils';

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
