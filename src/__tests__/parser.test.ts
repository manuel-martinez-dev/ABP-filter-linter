import { describe, it, expect } from 'vitest';
import { parseLine, isAbpDocument } from '../parser';

describe('parseLine', () => {
  it('classifies comments', () => {
    expect(parseLine('! This is a comment', 0).type).toBe('comment');
  });

  it('classifies snippet filters', () => {
    const p = parseLine('example.com#$#log Hello', 0);
    expect(p.type).toBe('snippet');
    expect(p.domains).toEqual(['example.com']);
    expect(p.body).toBe('log Hello');
  });

  it('classifies cosmetic filters', () => {
    const p = parseLine('example.com##.ad-banner', 0);
    expect(p.type).toBe('cosmetic');
    expect(p.body).toBe('.ad-banner');
  });

  it('classifies extended filters', () => {
    const p = parseLine('example.com#?#div:-abp-has(.ad)', 0);
    expect(p.type).toBe('extended');
  });

  it('classifies exception rules', () => {
    const p = parseLine('@@||example.com^$document', 0);
    expect(p.type).toBe('exception');
  });

  it('classifies network rules', () => {
    const p = parseLine('||ads.example.com^', 0);
    expect(p.type).toBe('network');
  });

  it('handles multi-domain prefix', () => {
    const p = parseLine('a.com,b.com,~c.com#$#log test', 0);
    expect(p.domains).toEqual(['a.com', 'b.com', '~c.com']);
  });
});

describe('isAbpDocument', () => {
  it('returns true for filter lists', () => {
    expect(isAbpDocument(['example.com##.ad', '||foo.com^'])).toBe(true);
  });

  it('returns false for plain text', () => {
    expect(isAbpDocument(['Hello world', 'This is a normal text file'])).toBe(false);
  });
});
