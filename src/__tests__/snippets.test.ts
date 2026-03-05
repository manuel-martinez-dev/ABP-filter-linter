import { describe, it, expect } from 'vitest';
import { splitSnippetChain, validateSnippetCall, validateSnippetChain, parseSnippetArgs } from '../validators/snippets';

describe('parseSnippetArgs', () => {
  it('splits simple args', () => {
    expect(parseSnippetArgs('foo bar baz')).toEqual(['foo', 'bar', 'baz']);
  });

  it('handles single-quoted strings', () => {
    expect(parseSnippetArgs("'hello world' foo")).toEqual(['hello world', 'foo']);
  });

  it('handles escaped quotes', () => {
    expect(parseSnippetArgs("it\\'s")).toEqual(["it's"]);
  });
});

describe('splitSnippetChain', () => {
  it('splits by semicolon', () => {
    const calls = splitSnippetChain('log Hello; trace World');
    expect(calls).toHaveLength(2);
    expect(calls[0].name).toBe('log');
    expect(calls[1].name).toBe('trace');
  });

  it('handles single snippet', () => {
    const calls = splitSnippetChain('json-prune data.ads');
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('json-prune');
    expect(calls[0].args).toEqual(['data.ads']);
  });
});

describe('validateSnippetCall', () => {
  it('passes valid snippet with required args', () => {
    const call = { name: 'abort-on-property-read', args: ['adHandler'], nameOffset: 0 };
    expect(validateSnippetCall(call, 0)).toHaveLength(0);
  });

  it('errors on unknown snippet', () => {
    const call = { name: 'nonexistent-snippet', args: [], nameOffset: 0 };
    const results = validateSnippetCall(call, 0);
    expect(results[0].severity).toBe('error');
  });

  it('suggests typo correction', () => {
    const call = { name: 'json-prne', args: ['foo'], nameOffset: 0 };
    const results = validateSnippetCall(call, 0);
    expect(results[0].message).toContain('json-prune');
  });

  it('warns on deprecated snippet', () => {
    const call = { name: 'simulate-event-poc', args: [], nameOffset: 0 };
    const results = validateSnippetCall(call, 0);
    expect(results[0].severity).toBe('warning');
  });

  it('warns on missing required arg', () => {
    const call = { name: 'abort-on-property-read', args: [], nameOffset: 0 };
    const results = validateSnippetCall(call, 0);
    expect(results[0].severity).toBe('warning');
  });

  it('errors on invalid enum value', () => {
    const call = { name: 'event-override', args: ['click', 'bad-mode'], nameOffset: 0 };
    const results = validateSnippetCall(call, 0);
    expect(results.some(r => r.severity === 'error' && r.message.includes('bad-mode'))).toBe(true);
  });
});

describe('empty string and quote-aware split fixes', () => {
  it("parses '' as an empty string argument", () => {
    expect(parseSnippetArgs("ads ''")).toEqual(['ads', '']);
  });

  it('does not split on ; inside single-quoted arg', () => {
    const calls = splitSnippetChain("abort-current-inline-script document.documentElement 'break;case'");
    expect(calls).toHaveLength(1);
    expect(calls[0].args[1]).toBe('break;case');
  });

  it('does split unquoted ; as snippet separator', () => {
    const calls = splitSnippetChain("log hello; trace world");
    expect(calls).toHaveLength(2);
  });

  it('accepts emptyObj as valid value for override-property-read', () => {
    const call = { name: 'override-property-read', args: ['sssp', 'emptyObj'], nameOffset: 0 };
    expect(validateSnippetCall(call, 0)).toHaveLength(0);
  });

  it('accepts numeric literal as valid value for override-property-read', () => {
    const call = { name: 'override-property-read', args: ['MDCore.adblock', '0'], nameOffset: 0 };
    expect(validateSnippetCall(call, 0)).toHaveLength(0);
  });
});

describe('json-override value enum', () => {
  it('accepts valid keyword value', () => {
    const call = { name: 'json-override', args: ['data.ads', 'undefined'], nameOffset: 0 };
    expect(validateSnippetCall(call, 0)).toHaveLength(0);
  });

  it('accepts integer value (allowsNumericLiteral)', () => {
    const call = { name: 'json-override', args: ['data.ads', '42'], nameOffset: 0 };
    expect(validateSnippetCall(call, 0)).toHaveLength(0);
  });

  it('errors on arbitrary string value', () => {
    const call = { name: 'json-override', args: ['data.ads', 'emptyStr'], nameOffset: 0 };
    const results = validateSnippetCall(call, 0);
    expect(results.some(r => r.severity === 'error' && r.message.includes('emptyStr'))).toBe(true);
  });
});

describe('max arg count', () => {
  it('warns when simulate-mouse-event exceeds 7 selectors', () => {
    const call = {
      name: 'simulate-mouse-event',
      args: ['sel1', 'sel2', 'sel3', 'sel4', 'sel5', 'sel6', 'sel7', 'sel8'],
      nameOffset: 0,
    };
    const results = validateSnippetCall(call, 0);
    expect(results.some(r => r.severity === 'warning' && r.message.includes('7'))).toBe(true);
  });

  it('passes with exactly 7 selectors', () => {
    const call = {
      name: 'simulate-mouse-event',
      args: ['sel1', 'sel2', 'sel3', 'sel4', 'sel5', 'sel6', 'sel7'],
      nameOffset: 0,
    };
    expect(validateSnippetCall(call, 0)).toHaveLength(0);
  });
});

describe('demarcator validation', () => {
  it('errors on ^^svg^^ in selector of hide-if-contains-visible-text', () => {
    const call = {
      name: 'hide-if-contains-visible-text',
      args: ['ad-text', '.parent ^^svg^^ .child'],
      nameOffset: 0,
    };
    const results = validateSnippetCall(call, 0);
    expect(results.some(r => r.severity === 'error' && r.message.includes('^^svg^^'))).toBe(true);
  });

  it('errors on ^^sh^^ in search of hide-if-has-and-matches-style', () => {
    const call = {
      name: 'hide-if-has-and-matches-style',
      args: ['.item ^^sh^^ .ad', '.container'],
      nameOffset: 0,
    };
    const results = validateSnippetCall(call, 0);
    expect(results.some(r => r.severity === 'error' && r.message.includes('^^sh^^'))).toBe(true);
  });

  it('allows ^^sh^^ in selector of hide-if-contains (supported)', () => {
    const call = {
      name: 'hide-if-contains',
      args: ['ad-text', '.parent ^^sh^^ .child'],
      nameOffset: 0,
    };
    expect(validateSnippetCall(call, 0)).toHaveLength(0);
  });
});

describe('validateSnippetChain — race block', () => {
  it('passes a valid race block', () => {
    const calls = splitSnippetChain('race start; hide-if-contains foo .bar; race stop');
    expect(validateSnippetChain(calls, 0)).toHaveLength(0);
  });

  it('errors on race start without matching race stop', () => {
    const calls = splitSnippetChain('race start; hide-if-contains foo .bar');
    const results = validateSnippetChain(calls, 0);
    expect(results.some(r => r.severity === 'error' && r.message.includes('race start'))).toBe(true);
  });

  it('errors on race stop without matching race start', () => {
    const calls = splitSnippetChain('hide-if-contains foo .bar; race stop');
    const results = validateSnippetChain(calls, 0);
    expect(results.some(r => r.severity === 'error' && r.message.includes('race stop'))).toBe(true);
  });

  it('warns on unsupported behavioral snippet inside race', () => {
    const calls = splitSnippetChain('race start; abort-on-property-read adHandler; race stop');
    const results = validateSnippetChain(calls, 0);
    expect(results.some(r => r.severity === 'warning' && r.message.includes('abort-on-property-read'))).toBe(true);
  });

  it('warns on hide-if-canvas-contains inside race (noRace)', () => {
    const calls = splitSnippetChain('race start; hide-if-canvas-contains foo; race stop');
    const results = validateSnippetChain(calls, 0);
    expect(results.some(r => r.severity === 'warning' && r.message.includes('hide-if-canvas-contains'))).toBe(true);
  });

  it('allows skip-video inside race', () => {
    const calls = splitSnippetChain('race start; skip-video .player //condition; race stop');
    expect(validateSnippetChain(calls, 0)).toHaveLength(0);
  });
});
