import { describe, it, expect } from 'vitest';
import { splitSnippetChain, validateSnippetCall, parseSnippetArgs } from '../validators/snippets';

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
