import { describe, it, expect } from 'vitest';
import {
  parseUpstreamGraph, buildNameMap, parseSnippetArgs, compareArgs, formatDriftReport,
  toRuntimeArgs, validateLedger, filterUnreviewedCandidates, checkLedgerStaleness, formatRequirednessReport,
} from '../snippet-diff.mjs';

describe('parseUpstreamGraph', () => {
  it('includes heavy snippets with dependency functions', () => {
    const src = 'const graph = new Map([["debug",null],["xpath",function dependency() { return ["not-a-snippet", null]; }]]);';
    expect(parseUpstreamGraph(src)).toEqual(new Set(['debug', 'xpath']));
  });
  it('extracts names from a valid graph', () => {
    const src = 'const graph = new Map([["foo",null],["bar-baz",null]]);';
    const names = parseUpstreamGraph(src);
    expect(names).toEqual(new Set(['foo', 'bar-baz']));
  });

  it('returns null when the graph pattern is missing', () => {
    expect(parseUpstreamGraph('const somethingElse = 1;')).toBeNull();
  });

  it('extracts names when tuples have extra whitespace', () => {
    const src = 'const graph = new Map([["foo", null],["bar-baz", null]]);';
    expect(parseUpstreamGraph(src)).toEqual(new Set(['foo', 'bar-baz']));
  });

  it('returns null when the graph matches but no tuples parse', () => {
    expect(parseUpstreamGraph('const graph = new Map([]);')).toBeNull();
  });
});

describe('buildNameMap', () => {
  it('maps an unnumbered heavy bundle', () => {
    expect(buildNameMap('const snippets = { "xpath": hideXPath };').get('xpath')).toBe('hideXPath');
  });
  it('maps quoted entries', () => {
    const src = 'const snippets$1 = { "foo": fooFunc, "bar-baz": barBazFunc };';
    const map = buildNameMap(src);
    expect(map.get('foo')).toBe('fooFunc');
    expect(map.get('bar-baz')).toBe('barBazFunc');
  });

  it('maps ES6-shorthand entries', () => {
    const src = 'const snippets$2 = { foo, "bar": barFunc, baz };';
    const map = buildNameMap(src);
    expect(map.get('foo')).toBe('foo');
    expect(map.get('bar')).toBe('barFunc');
    expect(map.get('baz')).toBe('baz');
  });

  it('maps a multi-line quoted entry', () => {
    const src = 'const snippets$1 = {\n  "log-if-inline-script-contains-fingerprint":\n    logIfInlineScriptContainsFingerprint\n};';
    const map = buildNameMap(src);
    expect(map.get('log-if-inline-script-contains-fingerprint')).toBe('logIfInlineScriptContainsFingerprint');
  });

  it('does not misfire on the value-half of an adjacent quoted pair', () => {
    const src = 'const snippets$1 = { "a": someFunctionName, b };';
    const map = buildNameMap(src);
    expect(map.get('a')).toBe('someFunctionName');
    expect(map.get('b')).toBe('b');
    expect(map.has('someFunctionName')).toBe(false);
  });
});

describe('parseSnippetArgs', () => {
  it.each(['selector="*"', 'selector ="*"', 'selector= "*"'])('parses compact defaults: %s', param => {
    expect(parseSnippetArgs('foo', `function foo(${param}) {}`, new Map([['foo', 'foo']])))
      .toEqual([{ name: 'selector', required: false, defaultExpr: '"*"' }]);
  });

  it('preserves internal whitespace in the default expression despite extra spacing before "="', () => {
    expect(parseSnippetArgs('foo', 'function foo(selector    = "x  y") {}', new Map([['foo', 'foo']])))
      .toEqual([{ name: 'selector', required: false, defaultExpr: '"x  y"' }]);
  });
  const nameMap = new Map([
    ['foo', 'foo'],
    ['zero', 'zero'],
    ['ghost', 'ghostFunc'],
  ]);

  it('parses required args', () => {
    const src = 'function foo(a, b) { }';
    expect(parseSnippetArgs('foo', src, nameMap)).toEqual([
      { name: 'a', required: true },
      { name: 'b', required: true },
    ]);
  });

  it('parses optional (default-valued) args', () => {
    const src = 'function foo(a, b = "") { }';
    expect(parseSnippetArgs('foo', src, nameMap)).toEqual([
      { name: 'a', required: true },
      { name: 'b', required: false, defaultExpr: '""' },
    ]);
  });

  it('parses a variadic arg', () => {
    const src = 'function foo(a, ...rest) { }';
    expect(parseSnippetArgs('foo', src, nameMap)).toEqual([
      { name: 'a', required: true },
      { name: 'rest', required: true, variadic: true },
    ]);
  });

  it('detects enum via Object.values(CONST).includes(param)', () => {
    const src = 'const MODES = {A:"a",B:"b"}; function foo(mode = MODES.A) { if (!Object.values(MODES).includes(mode)) throw 1; }';
    const args = parseSnippetArgs('foo', src, nameMap);
    expect(args[0].enum).toEqual(['a', 'b']);
  });

  it('detects enum via array-literal .includes(param)', () => {
    const src = 'function foo(x) { if (!["a","b"].includes(x)) throw 1; }';
    const args = parseSnippetArgs('foo', src, nameMap);
    expect(args[0].enum).toEqual(['a', 'b']);
  });

  it('detects enum via switch/case', () => {
    const src = 'function foo(x) { switch (x) { case "a": break; case "b": break; } }';
    const args = parseSnippetArgs('foo', src, nameMap);
    expect(args[0].enum).toEqual(['a', 'b']);
  });

  it('does not leak an enum check from a later function using the same param name', () => {
    const src = 'function foo(mode) { return mode; } function bar(other) { if (!["x","y"].includes(mode)) throw 1; }';
    const args = parseSnippetArgs('foo', src, nameMap);
    expect(args[0].enum).toBeUndefined();
  });

  it('does not end the body scan early on a "}" inside a string', () => {
    const src = 'function foo(mode) { const marker = "}"; if (["x","y"].includes(mode)) throw 1; }';
    expect(parseSnippetArgs('foo', src, nameMap)[0].enum).toEqual(['x', 'y']);
  });

  it('does not end the body scan early on a "}" inside a regex literal', () => {
    const src = 'function foo(mode) { const re = /\\}/; if (["x","y"].includes(mode)) throw 1; }';
    expect(parseSnippetArgs('foo', src, nameMap)[0].enum).toEqual(['x', 'y']);
  });

  it('does not end the body scan early on a "}" inside a template literal', () => {
    const src = 'function foo(mode) { const t = `}`; if (["x","y"].includes(mode)) throw 1; }';
    expect(parseSnippetArgs('foo', src, nameMap)[0].enum).toEqual(['x', 'y']);
  });

  it('does not end the body scan early on a "}" inside a line comment', () => {
    const src = 'function foo(mode) { // }\n if (["x","y"].includes(mode)) throw 1; }';
    expect(parseSnippetArgs('foo', src, nameMap)[0].enum).toEqual(['x', 'y']);
  });

  it('does not end the signature scan early on a ")" inside a default-value string', () => {
    const src = 'function foo(a = ")", b) { return a; }';
    expect(parseSnippetArgs('foo', src, nameMap)).toEqual([
      { name: 'a', required: false, defaultExpr: '")"' },
      { name: 'b', required: true },
    ]);
  });

  it('returns [] for an unmapped name', () => {
    expect(parseSnippetArgs('nonexistent', 'function foo(a) {}', nameMap)).toEqual([]);
  });

  it('returns null when the mapped function definition is not in the source', () => {
    expect(parseSnippetArgs('ghost', 'function foo(a) {}', nameMap)).toBeNull();
  });

  it('returns [] for a genuinely zero-arg function', () => {
    expect(parseSnippetArgs('zero', 'function zero() { }', nameMap)).toEqual([]);
  });
});

describe('compareArgs', () => {
  it('flags recorded=true/upstream=false (schema over-strict)', () => {
    const recorded = [{ name: 'search', required: true }];
    const upstream = [{ name: 'textToReplace', required: false, defaultExpr: '""' }];
    expect(compareArgs(recorded, upstream).requiredDiffs).toEqual([
      { arg: 'search', position: 1, recorded: true, upstream: false, upstreamParam: 'textToReplace', defaultExpr: '""' },
    ]);
  });

  it('does not flag recorded=false/upstream=true (unreliable direction, dropped)', () => {
    const recorded = [{ name: 'search', required: false }];
    const upstream = [{ name: 'textToReplace', required: true }];
    expect(compareArgs(recorded, upstream).requiredDiffs).toEqual([]);
  });

  it('does not compare variadic slots with fixed parameters', () => {
    const recorded = [{ name: 'rest', required: true, variadic: true }];
    const upstream = [{ name: 'selector', required: false }];
    expect(compareArgs(recorded, upstream).requiredDiffs).toEqual([]);
  });

  it('flags arity growth (non-variadic)', () => {
    const recorded = [{ name: 'a', required: true }, { name: 'b', required: false }];
    const upstream = [{ name: 'a', required: true }, { name: 'b', required: false }, { name: 'c', required: false }];
    expect(compareArgs(recorded, upstream).arityGrew).toBe(true);
  });

  it('does not flag unchanged arity', () => {
    const recorded = [{ name: 'a', required: true }];
    const upstream = [{ name: 'a', required: true }];
    expect(compareArgs(recorded, upstream).arityGrew).toBe(false);
  });

  it('flags growth ahead of a variadic slot', () => {
    const recorded = [{ name: 'a', required: true }, { name: 'rest', required: true, variadic: true }];
    const upstream = [{ name: 'a', required: true }, { name: 'b', required: false }, { name: 'rest', required: true, variadic: true }];
    expect(compareArgs(recorded, upstream).arityGrew).toBe(true);
  });

  it('does not flag a variadic slot with no prefix growth', () => {
    const recorded = [{ name: 'a', required: true }, { name: 'rest', required: true, variadic: true }];
    const upstream = [{ name: 'a', required: true }, { name: 'rest', required: true, variadic: true }];
    expect(compareArgs(recorded, upstream).arityGrew).toBe(false);
  });

  it('flags an enum value upstream has that recorded lacks', () => {
    const recorded = [{ name: 'mode', required: false, enum: ['x', 'y'] }];
    const upstream = [{ name: 'mode', required: false, enum: ['x', 'y', 'z'] }];
    const { enumDiffs } = compareArgs(recorded, upstream);
    expect(enumDiffs).toEqual([{ arg: 'mode', recorded: ['x', 'y'], upstream: ['x', 'y', 'z'] }]);
  });

  it('does not flag when upstream enum is a subset of recorded', () => {
    const recorded = [{ name: 'mode', required: false, enum: ['x', 'y', 'z'] }];
    const upstream = [{ name: 'mode', required: false, enum: ['x', 'y'] }];
    expect(compareArgs(recorded, upstream).enumDiffs).toEqual([]);
  });

  it('flags a newly-detected enum where recorded had none', () => {
    const recorded = [{ name: 'mode', required: false }];
    const upstream = [{ name: 'mode', required: false, enum: ['x'] }];
    const { enumDiffs } = compareArgs(recorded, upstream);
    expect(enumDiffs).toEqual([{ arg: 'mode', recorded: [], upstream: ['x'] }]);
  });
});

describe('formatDriftReport', () => {
  it('returns empty string for no drift and no unresolved', () => {
    expect(formatDriftReport([], [])).toBe('');
  });

  it('formats drift-only entries', () => {
    const drifted = [{ name: 'foo', recorded: ['a'], upstream: ['a', 'b'], enumDiffs: [] }];
    expect(formatDriftReport(drifted, [])).toBe(
      'DRIFT_DETECTED\nfoo: recorded=[a] upstream=[a, b]'
    );
  });

  it('appends an enum-diff line to a drift entry', () => {
    const drifted = [{
      name: 'foo',
      recorded: ['mode'],
      upstream: ['mode'],
      enumDiffs: [{ arg: 'mode', recorded: ['x'], upstream: ['x', 'y'] }],
    }];
    expect(formatDriftReport(drifted, [])).toBe(
      'DRIFT_DETECTED\nfoo: recorded=[mode] upstream=[mode]; enum drift on "mode": recorded=[x] upstream=[x, y]'
    );
  });

  it('formats unresolved-only entries', () => {
    const unresolved = [{ name: 'foo', reason: 'no function-name mapping found' }];
    expect(formatDriftReport([], unresolved)).toBe(
      'DRIFT_DETECTED\nfoo: UNRESOLVED — no function-name mapping found, drift checks skipped for this snippet'
    );
  });

  it('combines drift and unresolved, drift lines first', () => {
    const drifted = [{ name: 'foo', recorded: ['a'], upstream: ['a', 'b'], enumDiffs: [] }];
    const unresolved = [{ name: 'bar', reason: 'function signature could not be located' }];
    expect(formatDriftReport(drifted, unresolved)).toBe(
      'DRIFT_DETECTED\nfoo: recorded=[a] upstream=[a, b]\nbar: UNRESOLVED — function signature could not be located, drift checks skipped for this snippet'
    );
  });
});

describe('toRuntimeArgs', () => {
  it('strips defaultExpr, keeps other fields', () => {
    const args = [
      { name: 'a', required: true },
      { name: 'b', required: false, defaultExpr: '"*"' },
      { name: 'c', required: false, variadic: true, enum: ['x'] },
    ];
    expect(toRuntimeArgs(args)).toEqual([
      { name: 'a', required: true },
      { name: 'b', required: false },
      { name: 'c', required: false, variadic: true, enum: ['x'] },
    ]);
  });
});

describe('validateLedger', () => {
  const validEntry = { snippet: 'foo', arg: 'a', upstreamParam: 'a', position: 1, defaultExpr: '""', reason: 'why' };

  it('accepts a well-formed ledger', () => {
    expect(validateLedger({ version: 1, entries: [validEntry] })).toEqual([validEntry]);
  });

  it('throws on the wrong version', () => {
    expect(() => validateLedger({ version: 2, entries: [] })).toThrow(/version 1/);
  });

  it('throws when entries is not an array', () => {
    expect(() => validateLedger({ version: 1, entries: {} })).toThrow(/entries must be an array/);
  });

  it.each(['snippet', 'arg', 'upstreamParam', 'defaultExpr', 'reason'])('throws when %s is missing or empty', field => {
    expect(() => validateLedger({ version: 1, entries: [{ ...validEntry, [field]: '' }] })).toThrow(new RegExp(field));
  });

  it.each([0, -1, 1.5, 'x'])('throws on a non-positive-integer position (%s)', position => {
    expect(() => validateLedger({ version: 1, entries: [{ ...validEntry, position }] })).toThrow(/position/);
  });

  it('throws on duplicate (snippet, position) pairs', () => {
    expect(() => validateLedger({ version: 1, entries: [validEntry, { ...validEntry, arg: 'b' }] })).toThrow(/duplicate/);
  });
});

describe('filterUnreviewedCandidates', () => {
  const diff = { arg: 'search', position: 2, recorded: true, upstream: false, upstreamParam: 'textToReplace', defaultExpr: '""' };
  const entry = { snippet: 'replace-outbound-value', arg: 'search', upstreamParam: 'textToReplace', position: 2, defaultExpr: '""', reason: 'why' };

  it('suppresses when the ledger entry matches exactly', () => {
    expect(filterUnreviewedCandidates('replace-outbound-value', [diff], [entry])).toEqual([]);
  });

  it('does not suppress when no ledger entry exists', () => {
    expect(filterUnreviewedCandidates('replace-outbound-value', [diff], [])).toEqual([diff]);
  });

  it('does not suppress when defaultExpr differs', () => {
    expect(filterUnreviewedCandidates('replace-outbound-value', [diff], [{ ...entry, defaultExpr: '"x"' }])).toEqual([diff]);
  });

  it('does not suppress when upstreamParam differs', () => {
    expect(filterUnreviewedCandidates('replace-outbound-value', [diff], [{ ...entry, upstreamParam: 'other' }])).toEqual([diff]);
  });
});

describe('checkLedgerStaleness', () => {
  const baseEntry = { snippet: 'foo', arg: 'search', upstreamParam: 'textToReplace', position: 2, defaultExpr: '""', reason: 'why' };
  const sourcesFor = (src, nameMap = new Map([['foo', 'foo']])) => new Map([['foo', { src, nameMap }]]);

  it('returns [] when everything still matches', () => {
    const src = 'function foo(methodPath, textToReplace = "") {}';
    expect(checkLedgerStaleness([baseEntry], sourcesFor(src))).toEqual([]);
  });

  it('flags a changed default expression', () => {
    const src = 'function foo(methodPath, textToReplace = "x") {}';
    expect(checkLedgerStaleness([baseEntry], sourcesFor(src))[0].status).toMatch(/default expression changed/);
  });

  it('flags a disappeared default, hedged rather than confirmed', () => {
    const src = 'function foo(methodPath, textToReplace) {}';
    const status = checkLedgerStaleness([baseEntry], sourcesFor(src))[0].status;
    expect(status).toMatch(/no longer present upstream/);
    expect(status).toMatch(/does not by itself mean/);
    expect(status).not.toMatch(/confirmed/i);
  });

  it('flags a renamed upstream parameter', () => {
    const src = 'function foo(methodPath, replacement = "") {}';
    expect(checkLedgerStaleness([baseEntry], sourcesFor(src))[0].status).toMatch(/renamed to "replacement"/);
  });

  it('flags a snippet missing from sources entirely', () => {
    expect(checkLedgerStaleness([baseEntry], new Map())[0].status).toMatch(/no longer found upstream/);
  });

  it('flags a missing function-name mapping', () => {
    const sources = sourcesFor('function foo(){}', new Map());
    expect(checkLedgerStaleness([baseEntry], sources)[0].status).toMatch(/no function-name mapping/);
  });

  it('flags an unresolvable function body', () => {
    expect(checkLedgerStaleness([baseEntry], sourcesFor('no function here'))[0].status).toMatch(/could not be resolved or parsed/);
  });

  it('flags a position that no longer exists', () => {
    expect(checkLedgerStaleness([baseEntry], sourcesFor('function foo(methodPath) {}'))[0].status).toMatch(/argument no longer found/);
  });
});

describe('formatRequirednessReport', () => {
  it('returns empty string for no candidates and no stale entries', () => {
    expect(formatRequirednessReport([], [])).toBe('');
  });

  it('formats a new-candidate-only report', () => {
    const candidates = [{ name: 'foo', requiredDiffs: [
      { arg: 'search', position: 2, recorded: true, upstream: false, upstreamParam: 'textToReplace', defaultExpr: '""' },
    ] }];
    const report = formatRequirednessReport(candidates, []);
    expect(report).toContain('REQUIREDNESS_REVIEW');
    expect(report).toContain('NEW CANDIDATE:');
    expect(report).not.toContain('LEDGER ENTRY NEEDS REVIEW:');
  });

  it('formats a stale-entry-only report', () => {
    const stale = [{
      snippet: 'foo', arg: 'search', upstreamParam: 'textToReplace', position: 2, defaultExpr: '""', reason: 'why',
      status: 'default expression changed to "x" — needs review',
    }];
    const report = formatRequirednessReport([], stale);
    expect(report).toContain('LEDGER ENTRY NEEDS REVIEW:');
    expect(report).not.toContain('NEW CANDIDATE:');
  });

  it('consolidates an overlapping (snippet, position) into one line', () => {
    const candidates = [{ name: 'foo', requiredDiffs: [
      { arg: 'search', position: 2, recorded: true, upstream: false, upstreamParam: 'textToReplace', defaultExpr: '"x"' },
    ] }];
    const stale = [{
      snippet: 'foo', arg: 'search', upstreamParam: 'textToReplace', position: 2, defaultExpr: '""', reason: 'why',
      status: 'default expression changed to "x" — needs review',
    }];
    const report = formatRequirednessReport(candidates, stale);
    const matchingLines = report.split('\n').filter(l => l.includes('foo') && l.includes('search'));
    expect(matchingLines).toHaveLength(1);
    expect(report).toContain('LEDGER ENTRY NEEDS REVIEW:');
    expect(report).not.toContain('NEW CANDIDATE:');
  });
});
