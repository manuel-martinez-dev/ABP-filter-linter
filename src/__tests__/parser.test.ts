import { describe, it, expect } from 'vitest';
import { parseLine, isAbpDocument } from '../parser';

describe('parseLine', () => {
  it.each(['/foo##bar/', '/foo#$#bar/', '||example.com/path##ad$script', 'https://example.com/#?#ad'])
    ('keeps content separators inside network patterns: %s', text => {
      const parsed = parseLine(text, 0);
      expect(parsed.type).toBe('network');
      expect(parsed.body).toBe(text);
    });

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

  it('picks the earliest separator, not priority order (#@# inside attribute)', () => {
    const p = parseLine('foo.com##div[id="#@#x"]', 0);
    expect(p.type).toBe('cosmetic');
    expect(p.domains).toEqual(['foo.com']);
    expect(p.body).toBe('div[id="#@#x"]');
  });

  it('picks the earliest separator, not priority order (#$# inside attribute)', () => {
    const p = parseLine('foo.com##div[onclick="#$#x"]', 0);
    expect(p.type).toBe('cosmetic');
    expect(p.body).toBe('div[onclick="#$#x"]');
  });

  it('keeps hiding-exception when #@# precedes ##', () => {
    const p = parseLine('foo.com#@##ad', 0);
    expect(p.type).toBe('hiding-exception');
    expect(p.body).toBe('#ad');
  });
});

describe('isAbpDocument', () => {
  it('returns true for filter lists', () => {
    expect(isAbpDocument(['example.com##.ad', '||foo.com^'])).toBe(true);
  });

  it('returns false for plain text', () => {
    expect(isAbpDocument(['Hello world', 'This is a normal text file'])).toBe(false);
  });

  it('returns true for pure cosmetic list (##div, no space)', () => {
    expect(isAbpDocument(['##div.ad', '##.banner'])).toBe(true);
  });

  it('returns false for Markdown with ## headings (## + space)', () => {
    expect(isAbpDocument(['## Heading', '## Another heading', 'Some text'])).toBe(false);
  });

  it('returns true for pure network list (|| line-start)', () => {
    expect(isAbpDocument(['||example.com^', '||ads.example.com^$script'])).toBe(true);
  });

  it('returns true for hiding-exception list (#@#)', () => {
    expect(isAbpDocument(['example.com#@#.ad-banner'])).toBe(true);
  });

  it('returns true for snippet list (#$#)', () => {
    expect(isAbpDocument(['example.com#$#log Hello'])).toBe(true);
  });

  it('returns true for exception list (@@)', () => {
    expect(isAbpDocument(['@@||example.com^$document'])).toBe(true);
  });
});

describe('parseLine — snippet exceptions (#@$#)', () => {
  it('parses a domain-scoped exception', () => {
    expect(parseLine('example.com#@$#log hi', 0)).toMatchObject({
      type: 'snippet-exception', domains: ['example.com'], body: 'log hi', separator: '#@$#', bodyOffset: 15,
    });
  });

  it('parses a domain-less exception', () => {
    expect(parseLine('#@$#log hi', 0)).toMatchObject({ type: 'snippet-exception', domains: [], bodyOffset: 4 });
  });

  it('keeps negated and multiple domains', () => {
    expect(parseLine('a.com,b.com,~c.com#@$#log test', 0).domains).toEqual(['a.com', 'b.com', '~c.com']);
  });

  it('lets the earliest separator win', () => {
    expect(parseLine('foo.com#@$##ad', 0)).toMatchObject({ type: 'snippet-exception', body: '#ad' });
    expect(parseLine('foo.com##div[x="#@$#y"]', 0).type).toBe('cosmetic');
  });

  it('leaves #@# and network lines alone', () => {
    expect(parseLine('foo.com#@#.ad', 0).type).toBe('hiding-exception');
    expect(parseLine('||example.com/path#@$#x', 0).type).toBe('network');
  });

  it('parses an empty body', () => {
    expect(parseLine('example.com#@$#', 0)).toMatchObject({ type: 'snippet-exception', body: '' });
  });
});
