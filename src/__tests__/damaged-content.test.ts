import { describe, it, expect } from 'vitest';
import { parseLine } from '../parser';
import { lintRawLine } from '../validators/lint-line';
import { remapColumns, detectRepair, detectTruncatedSnippetName, trailingJunkStart, detectDamagedNetworkPattern, candidateCutStart, MAX_SNIPPET_NAME_LENGTH } from '../validators/damaged-content';
import { SNIPPET_NAMES } from '../validators/snippets';
import type { Edit } from '../validators/damaged-content';
import type { LintResult } from '../types';

const lint = (line: string) => lintRawLine(line, 0);
const repairOf = (line: string) => detectRepair(parseLine(line, 0));
const has = (line: string, text: string) => lint(line).some(r => r.message.includes(text));
const finding = (startCol: number, endCol: number): LintResult => ({ message: 'x', severity: 'error', startCol, endCol });
const cols = (results: LintResult[]) => results.map(r => [r.startCol, r.endCol]);

const PIPE = '"|" in domain list';
const MALFORMED = 'Malformed snippet';
const FRAGMENT = 'fragment';
const DOMAIN_LIST = 'Domain list in a network pattern';
const WHITESPACE = 'Whitespace in a network pattern';
const TRUNCATED = 'truncated name';

describe('remapColumns', () => {
  it('maps an insertion: inserted text collapses to the insert point', () => {
    const edits: Edit[] = [{ start: 5, end: 5, replacement: '#$#' }];
    expect(cols(remapColumns([finding(0, 20), finding(8, 12), finding(6, 10)], edits))).toEqual([[0, 17], [5, 9], [5, 7]]);
  });

  it('maps a pure deletion: start to edit start, end to edit end', () => {
    expect(cols(remapColumns([finding(5, 5)], [{ start: 5, end: 7, replacement: '' }]))).toEqual([[5, 7]]);
  });

  it('maps a shorter replacement through the post-edit rule', () => {
    const edits: Edit[] = [{ start: 10, end: 14, replacement: 'abc' }];
    expect(cols(remapColumns([finding(12, 13), finding(20, 20)], edits))).toEqual([[12, 14], [21, 22]]);
  });

  it('maps a longer replacement', () => {
    const edits: Edit[] = [{ start: 4, end: 5, replacement: 'xyz' }];
    expect(cols(remapColumns([finding(4, 7), finding(8, 10)], edits))).toEqual([[4, 5], [6, 8]]);
  });

  it('accumulates the shift across edits with different deltas', () => {
    const edits: Edit[] = [{ start: 2, end: 3, replacement: 'xyz' }, { start: 10, end: 10, replacement: 'ab' }];
    expect(cols(remapColumns([finding(11, 14), finding(13, 20)], edits))).toEqual([[9, 10], [10, 16]]);
  });

  it('maps several equal-length edits as identity and drops nothing', () => {
    const edits: Edit[] = [3, 8, 13].map(i => ({ start: i, end: i + 1, replacement: ',' }));
    const results = [finding(3, 4), finding(0, 20), finding(9, 13)];
    expect(cols(remapColumns(results, edits))).toEqual(cols(results));
  });

  it('drops a finding that lies wholly in the inserted excess', () => {
    expect(remapColumns([finding(6, 8)], [{ start: 5, end: 5, replacement: '#$#' }])).toEqual([]);
  });

  it('clamps a finding straddling an edit', () => {
    expect(cols(remapColumns([finding(3, 7)], [{ start: 5, end: 6, replacement: 'abcd' }]))).toEqual([[3, 6]]);
  });
});

describe('D1 — pipe in domain list', () => {
  it('flags each separator type with its own type name', () => {
    expect(lint('example.com|example.org##.ad')[0]).toMatchObject({ severity: 'error', startCol: 11, endCol: 12, message: expect.stringContaining('element hiding filter') });
    expect(lint('example.com|example.org#?#div:-abp-has(.ad)')[0].message).toContain('extended element hiding filter');
    expect(lint('example.com|example.org#$#abort-on-property-read x')[0].message).toContain('"#$#" (snippet filter)');
  });

  it('keeps exception intent and validates as a hiding exception', () => {
    const results = lint('example.com|example.org#@#.ad');
    expect(results).toHaveLength(1);
    expect(results[0].message).toContain('element hiding exception');
  });

  it('spans every pipe and reports nothing from the network reading', () => {
    const results = lint('example.com|example.org|example.net##.ad');
    expect(results).toEqual([expect.objectContaining({ startCol: 11, endCol: 24 })]);
  });

  it('puts the error on the raw pipe column of an indented line', () => {
    expect(lint('  example.com|example.org##.ad').find(r => r.message.includes(PIPE))).toMatchObject({ startCol: 13, endCol: 14 });
  });

  it.each([
    '||example.com^$domain=example.org|example.net',
    '|https://example.com/##x',
    '||example.com##x',
    'example.com|##.ad',
    '/a|b/##x',
  ])('does not repair %s', line => {
    expect(repairOf(line)).toBeNull();
    expect(has(line, PIPE)).toBe(false);
  });
});

describe('D2 — malformed snippet separator', () => {
  it.each(['#$', '$#', '#$$#', '#$ #'])('rebuilds "%s" to #$#', run => {
    const line = `example.com${run}abort-on-property-read x`;
    expect(repairOf(line)).toMatchObject({ tier: 'confident', repairedRaw: 'example.com#$#abort-on-property-read x' });
    expect(lint(line)).toHaveLength(1);
  });

  it('rebuilds a single "#" only when followed by an exact snippet name', () => {
    expect(repairOf('example.com#abort-on-property-read x')).toMatchObject({ tier: 'confident' });
    expect(repairOf('example.com#abort-on-propety-read x')).toBeNull();
  });

  it.each(['#@$', '$@#', '#@'])('keeps exception intent for "%s"', run => {
    expect(repairOf(`example.com${run}abort-on-property-read x`)).toMatchObject({
      intended: 'snippet-exception',
      repairedRaw: 'example.com#@$#abort-on-property-read x',
    });
  });

  it('is confident within distance 2 and validates at full severity', () => {
    expect(repairOf('example.com#$abort-on-propety-read x')).toMatchObject({ tier: 'confident' });
    expect(lint('example.com#$abort-on-propety-read x').some(r => r.severity === 'error' && r.message.includes('Unknown snippet'))).toBe(true);
  });

  it('is a guess beyond distance 2 and downgrades body findings', () => {
    expect(repairOf('example.com#$abort-property-read x')).toMatchObject({ tier: 'guess' });
    expect(lint('example.com#$abort-property-read x')[0].message).toMatch(/^Possibly a malformed snippet filter separator "#\$"/);
    const unknown = lint('example.com#$abort-property-read x').find(r => r.message.includes('Unknown snippet'));
    expect(unknown).toMatchObject({ severity: 'warning', message: expect.stringMatching(/^\(if this is a snippet filter\) /) });
  });

  it('keeps domain-list errors at full severity in the guess tier', () => {
    const results = lint('example.com,,example.org##abort-on-property-read Foo.bar false');
    expect(results).toContainEqual(expect.objectContaining({ severity: 'error', message: 'Double comma ",," is invalid syntax', startCol: 11, endCol: 13 }));
  });

  it('keeps firing on unknown names as a guess', () => {
    const unknown = lint('example.com#$totally-misspelled args').find(r => r.message.includes('Unknown snippet'));
    expect(unknown).toMatchObject({ severity: 'warning', message: expect.stringMatching(/^\(if this is a snippet filter\) /) });
  });

  it('still fires on "$#" followed by a modifier name', () => {
    expect(repairOf('example.com$#script')).toMatchObject({ tier: 'guess' });
    expect(has('example.com$#script', '(if this is a snippet filter)')).toBe(true);
  });

  it.each(['example.com$debug', 'example.com$third-party,script'])('never treats a bare "$" as a separator: %s', line => {
    expect(repairOf(line)).toBeNull();
  });

  it('keeps network findings on a bare "$"', () => {
    expect(has('example.com$debug', 'Unknown modifier "debug"')).toBe(true);
  });

  it.each(['example.com#$script', 'example.com#$script,', 'example.com#$third-party,script'])('defers to network options after "#$": %s', line => {
    expect(repairOf(line)).toBeNull();
    expect(lint(line)).toEqual([]);
  });
});

describe('D3 — mangle that parsed as content', () => {
  it('rebuilds "##$" to #$#', () => {
    expect(repairOf('example.com##$abort-on-property-read x')).toMatchObject({
      tier: 'confident',
      repairedRaw: 'example.com#$#abort-on-property-read x',
    });
  });

  it('rebuilds a hiding-exception mangle to #@$#', () => {
    expect(repairOf('example.com#@#$abort-on-property-read x')).toMatchObject({
      intended: 'snippet-exception',
      repairedRaw: 'example.com#@$#abort-on-property-read x',
    });
  });

  it.each(['example.com###log', 'example.com###debug', 'example.com###race', 'example.com###logo', 'example.com#?##debug'])(
    'leaves ID selectors alone: %s', line => {
      expect(repairOf(line)).toBeNull();
      expect(lint(line)).toEqual([]);
    });

  it('does not repair a trailing "$" in a selector', () => {
    expect(repairOf('example.com##.ad$')).toBeNull();
  });
});

describe('D3b — dropped "$"', () => {
  it('guesses #$# for a hyphenated snippet name with arguments', () => {
    expect(repairOf('example.com,example.org##abort-on-property-read Foo.bar false')).toMatchObject({
      tier: 'guess',
      repairedRaw: 'example.com,example.org#$#abort-on-property-read Foo.bar false',
    });
  });

  it('guesses #@$# for a hiding exception', () => {
    expect(repairOf('example.com#@#abort-on-property-read Foo.bar false')).toMatchObject({
      repairedRaw: 'example.com#@$#abort-on-property-read Foo.bar false',
    });
  });

  it('needs arguments', () => {
    expect(repairOf('example.com##log')).toBeNull();
    expect(repairOf('example.com##abort-on-property-read')).toBeNull();
  });

  it.each(['example.com##profile .ad', 'example.com##log div', 'example.com##race start', 'example.com##debug > span', 'example.com##trace .x'])(
    'leaves CSS with bare snippet names alone: %s', line => {
      expect(repairOf(line)).toBeNull();
      expect(lint(line)).toEqual([]);
    });
});

describe('D4 — missing separator, exact name', () => {
  it('is confident with arguments', () => {
    expect(repairOf('example.comabort-on-property-read x')).toMatchObject({
      tier: 'confident',
      repairedRaw: 'example.com#$#abort-on-property-read x',
    });
  });

  it('is a hint without arguments: no missing-argument finding', () => {
    expect(repairOf('example.comabort-on-property-read')).toMatchObject({ tier: 'hint' });
    const results = lint('example.comabort-on-property-read');
    expect(results.some(r => r.message.includes('Missing "#$#"'))).toBe(true);
    expect(results.some(r => /argument/i.test(r.message))).toBe(false);
    expect(has('example.comabort-on-property-read', DOMAIN_LIST)).toBe(false);
  });

  it('guesses a bare name with arguments after a plausible domain', () => {
    expect(repairOf('example.comlog Hello')).toMatchObject({ tier: 'guess', repairedRaw: 'example.com#$#log Hello' });
    expect(repairOf('example.*log Hello')).toMatchObject({ tier: 'guess', repairedRaw: 'example.*#$#log Hello' });
  });

  it('prefers the longest bare name', () => {
    expect(repairOf('example.comtrace x')).toMatchObject({ tier: 'guess', repairedRaw: 'example.com#$#trace x' });
  });

  it.each(['adad.blog', 'adad.blog foo', 'example.blog', 'example.comdebug'])('does not repair %s', line => {
    expect(repairOf(line)).toBeNull();
    expect(has(line, 'Missing "#$#"')).toBe(false);
  });

  it('keeps an ambiguous bare-name match hedged', () => {
    expect(repairOf('example.catalog foo')).toMatchObject({ tier: 'guess' });
    const results = lint('example.catalog foo');
    expect(results.every(r => r.severity === 'warning')).toBe(true);
    expect(results[0].message).toMatch(/^Possibly missing "#\$#" snippet filter separator — did you mean "example\.cata#\$#log foo"\?$/);
  });

  it('words bare-name guesses as possible', () => {
    expect(lint('example.comlog Hello')[0].message).toMatch(/^Possibly missing "#\$#"/);
  });

  it('keeps definite wording when confident', () => {
    expect(lint('example.comabort-on-property-read x')[0].message).toMatch(/^Missing "#\$#" snippet filter separator/);
  });

  it('accepts a comma domain list', () => {
    expect(repairOf('example.com,example.orgabort-on-property-read x')).toMatchObject({
      repairedRaw: 'example.com,example.org#$#abort-on-property-read x',
    });
  });
});

describe('D5 — missing separator and truncated name', () => {
  it('lists every candidate as a hint without rebuilding', () => {
    const line = 'example.com,example.org-property-read Foo.bar false';
    expect(repairOf(line)).toMatchObject({ tier: 'hint', edits: [] });
    const hint = lint(line).find(r => r.message.includes(TRUNCATED));
    expect(hint!.message).toContain('abort-on-property-read, abort-on-iframe-property-read, override-property-read');
    expect(has(line, DOMAIN_LIST)).toBe(false);
    expect(has(line, WHITESPACE)).toBe(false);
  });

  it('rebuilds a unique tail as a guess', () => {
    expect(repairOf('example.com-on-iframe-property-read x')).toMatchObject({
      tier: 'guess',
      repairedRaw: 'example.com#$#abort-on-iframe-property-read x',
    });
  });

  it.each([
    ['a tail that is too short', 'example.com,example.org-read x'],
    ['a non-hyphen cut for every candidate', 'example.com,example.orgperty-read x'],
    ['no arguments', 'example.com,example.org-property-read'],
  ])('falls back to D6 on %s', (_, line) => {
    expect(repairOf(line)).toBeNull();
    expect(has(line, DOMAIN_LIST)).toBe(true);
  });
});

describe('D6 — generic safety net', () => {
  it('flags whitespace in the pattern at the raw column of an indented line', () => {
    expect(lint('  example.com/ad path')).toEqual([
      expect.objectContaining({ message: expect.stringContaining('"example.com/adpath"'), startCol: 2, endCol: 21 }),
    ]);
  });

  it('ignores whitespace inside options', () => {
    expect(lint("||example.com^$csp=script-src 'self'")).toEqual([]);
  });

  it('defers to pattern-shape findings', () => {
    expect(has('a b', 'Generic pattern too short')).toBe(true);
    expect(has('a b', WHITESPACE)).toBe(false);
  });
});

describe('"#" in a network pattern', () => {
  it.each(['||example.org/frag#x', 'example.com#$script', '||example.com/ad#x', "example.com#$csp=script-src 'self'"])('gets no fragment diagnostic: %s', line => {
    expect(lint(line)).toEqual([]);
  });

  it.each(['|https://example.com/##x', '||example.com##x', 'example.com|##.ad', 'example.com/example.org##.ad'])('makes no repair for %s', line => {
    expect(repairOf(line)).toBeNull();
    expect(has(line, FRAGMENT)).toBe(false);
  });

  it('keeps network validation for a misspelled option after "#$"', () => {
    expect(repairOf('example.com#$third-party,scritp')).toBeNull();
    expect(has('example.com#$third-party,scritp', 'Unknown modifier "scritp"')).toBe(true);
  });
});

describe('D6 domain list cut at a dropped separator', () => {
  it.each([
    ['example.com,example.org#.ad', 23],
    ['example.com,example.org,example.net?#div:-abp-has(.ad)', 35],
    ['example.com,example.org#$script', 23],
  ])('flags %s', (line, endCol) => {
    expect(lint(line)).toEqual([expect.objectContaining({ message: expect.stringContaining(DOMAIN_LIST), startCol: 0, endCol })]);
  });

  it('stays silent on a single domain with a dropped "#"', () => {
    expect(lint('example.com#.ad')).toEqual([]);
  });
});

describe('indented content lines', () => {
  it('ignores the indent in domain-list checks', () => {
    expect(lint('  example.com##.ad')).toEqual([]);
  });

  it('still reports a space inside the domain list at its raw column', () => {
    expect(lint('  example.com, example.org##.ad')).toEqual([
      expect.objectContaining({ message: 'Spaces are not allowed in domain list', startCol: 14, endCol: 15 }),
    ]);
  });

  it('reports a double comma at its raw column', () => {
    expect(lint('  example.com,,example.org##.ad')).toEqual([
      expect.objectContaining({ message: 'Double comma ",," is invalid syntax', startCol: 13, endCol: 15 }),
    ]);
  });

  it('gives a repaired indented line only the repair warning', () => {
    expect(lint('  example.com#$hide-if-contains foo')).toEqual([
      expect.objectContaining({ message: expect.stringContaining(MALFORMED), startCol: 2 }),
    ]);
  });
});

describe('regex filters with whitespace', () => {
  it.each(['/example(?:#|ad)/$script', '/example(?:#|ad)/ $script'])('gets no fragment warning: %s', line => {
    expect(lint(line)).toEqual([]);
  });

  it('is not called a damaged content filter', () => {
    expect(has('/ads/ banner/', WHITESPACE)).toBe(false);
  });

  it('keeps the invalid-regex error', () => {
    expect(lint('/ex(ample/ $script')).toEqual([
      expect.objectContaining({ severity: 'error', message: expect.stringContaining('Invalid regular expression') }),
    ]);
  });
});

describe('D6 — domain list before options', () => {
  it('flags a domain list followed by options', () => {
    expect(lint('example.com,example.org$script')).toEqual([
      expect.objectContaining({ message: expect.stringContaining(DOMAIN_LIST), startCol: 0, endCol: 23 }),
    ]);
  });
});

describe('suggestions keep the full domain list', () => {
  const DOMAINS = 'a.example.com,b.example.com,c.example.com,d.example.com';
  const primary = (line: string) => lint(line)[0].message;

  it('in a malformed separator', () => {
    expect(primary(`${DOMAINS}#$hide-if-contains foo`)).toContain(`"${DOMAINS}#$#hide-if-contains foo"`);
  });

  it('in an exception rebuild', () => {
    expect(primary(`${DOMAINS}#@$hide-if-contains foo`)).toContain(`"${DOMAINS}#@$#hide-if-contains foo"`);
  });

  it('in a single-candidate truncated name', () => {
    expect(primary(`${DOMAINS}-on-iframe-property-read x`)).toContain(`"${DOMAINS}#$#abort-on-iframe-property-read x"`);
  });

  it('but abbreviates the multi-candidate shape hint', () => {
    expect(primary(`${DOMAINS}-property-read x`)).toContain('"a.example.com,…,d.example.com (4 domains)#$#<snippet-name> <args>"');
  });
});

describe('whitespace-normalized network pattern', () => {
  it.each([
    '/example(?:#|ad)/$ script',
    '/example(?:#|ad)/ $script',
    '||example.com^ $script',
    '||example.com^$script ,third-party',
    '||example.com^$ script',
    "||example.com^$csp=script-src 'self'",
    "||example.com^$csp=script-src 'nonce' 'self',third-party",
  ])('finds the options boundary after removing spaces: %s', line => {
    expect(lint(line)).toEqual([]);
  });

  it('flags whitespace inside the pattern only', () => {
    expect(lint('example.com/ad path$script')).toEqual([
      expect.objectContaining({ message: expect.stringContaining('"example.com/adpath"'), startCol: 0, endCol: 19 }),
    ]);
  });

  it('keeps raw columns on an indented line', () => {
    expect(lint('  example.com/a b$script')).toEqual([expect.objectContaining({ message: expect.stringContaining(WHITESPACE), startCol: 2, endCol: 17 })]);
  });

  it.each([
    ['example.com/a\tb  c#d $script', 0, 20],
    ['example.com/a b#c', 0, 17],
  ])('maps %s at detector and pipeline level', (line, d6Start, d6End) => {
    expect(detectDamagedNetworkPattern(parseLine(line, 0))).toMatchObject({ startCol: d6Start, endCol: d6End });
    expect(lint(line)).toEqual([expect.objectContaining({ message: expect.stringContaining(WHITESPACE), startCol: d6Start, endCol: d6End })]);
  });
});

describe('single "#" before a bare snippet name', () => {
  it.each(['example.com#log', 'example.com#log   ', 'example.com#log;', 'example.com#@log'])('needs arguments: %s', line => {
    expect(repairOf(line)).toBeNull();
  });

  it.each([
    ['example.com#log foo', 'snippet', 'example.com#$#log foo'],
    ['example.com#@log foo', 'snippet-exception', 'example.com#@$#log foo'],
  ])('guesses %s with hedged wording', (line, intended, repairedRaw) => {
    expect(repairOf(line)).toMatchObject({ tier: 'guess', intended, repairedRaw });
    const results = lint(line);
    expect(results[0].message).toMatch(/^Possibly a malformed snippet/);
    const hedged = results.filter(r => r.message.startsWith('(if this is'));
    expect(hedged.length).toBeGreaterThan(0);
    expect(hedged.every(r => r.severity === 'warning' && r.message.startsWith('(if this is a snippet'))).toBe(true);
    expect(has(line, FRAGMENT)).toBe(false);
  });

  it.each([
    ['example.com#abort-on-property-read x', 'example.com#$#abort-on-property-read x'],
    ['example.com#@abort-on-property-read x', 'example.com#@$#abort-on-property-read x'],
  ])('stays confident for hyphenated names: %s', (line, repairedRaw) => {
    expect(repairOf(line)).toMatchObject({ tier: 'confident', repairedRaw });
  });
});

describe('whitespace around a mangled separator', () => {
  it('repairs a space between the domain list and the run', () => {
    expect(repairOf('example.com #$ abort-on-property-read foo')).toMatchObject({ repairedRaw: 'example.com#$#abort-on-property-read foo' });
  });

  it('still repairs whitespace inside the run', () => {
    expect(repairOf('example.com# $abort-on-property-read x')).not.toBeNull();
  });

  it.each(['example.com $script', 'example.com# $script', 'example.com #$script'])('treats network options as options: %s', line => {
    expect(repairOf(line)).toBeNull();
  });

  it('gives " #$script" only the whitespace safety net', () => {
    expect(lint('example.com #$script')).toEqual([expect.objectContaining({ message: expect.stringContaining(WHITESPACE), startCol: 0, endCol: 13 })]);
  });
});

describe('content suggestions copy the raw domain text', () => {
  it('keeps an empty entry in the suggestion and reports it separately', () => {
    const results = lint('example.com,,example.org##hide-if-contains x');
    expect(results[0].message).toContain('"example.com,,example.org#$#hide-if-contains x"');
    expect(results).toContainEqual(expect.objectContaining({ severity: 'error', message: 'Double comma ",," is invalid syntax' }));
  });

  it('keeps an empty entry in a mangled-separator suggestion', () => {
    expect(lint('example.com,,example.org##$hide-if-contains x')[0].message).toContain('"example.com,,example.org#$#hide-if-contains x"');
  });
});

describe('truncated-name scan on long tokens', () => {
  const LIST = Array.from({ length: 500 }, (_, i) => `d${i}.example.com`).join(',');

  it('bounds the number of candidate cuts by the longest snippet name', () => {
    expect(MAX_SNIPPET_NAME_LENGTH).toBe(Math.max(...SNIPPET_NAMES.map(n => n.length)));
    const token = `${LIST}-property-read`;
    expect(token.length - candidateCutStart(token)).toBeLessThanOrEqual(MAX_SNIPPET_NAME_LENGTH);
  });

  it('gives a long list the same hint as a short one', () => {
    expect(lint(`${LIST}-property-read Foo.bar false`)[0].message).toContain('abort-on-property-read, abort-on-iframe-property-read, override-property-read');
  });

  it('finds no truncated name without a snippet tail', () => {
    expect(has(`${LIST} Foo.bar false`, TRUNCATED)).toBe(false);
  });
});

describe('network options guard ignores whitespace in the first option name', () => {
  it.each(['example.com#$script ,third-party', 'example.com# $scr ipt'])('keeps %s a network filter', line => {
    expect(repairOf(line)).toBeNull();
    const results = lint(line);
    expect(results.some(r => /malformed snippet|Unknown snippet|\(if this is|fragment/i.test(r.message))).toBe(false);
  });

  it('still repairs a snippet name after "#$"', () => {
    expect(repairOf('example.com#$abort-on-property-read x')).not.toBeNull();
  });
});

describe('guess-tier repairs keep the original reading', () => {
  it('keeps the network reading of a guessed snippet', () => {
    const results = lint('example.com#$script foo');
    expect(results[0].message).toMatch(/^Possibly a malformed snippet/);
    expect(results).toContainEqual(expect.objectContaining({ message: expect.stringMatching(/^\(if this is a snippet filter\) Unknown snippet "script"/) }));
    expect(results.some(r => r.message.includes(FRAGMENT))).toBe(false);
  });

  it('keeps the cosmetic reading of a dropped-"$" guess', () => {
    const results = lint('example.com##abort-on-property-read Foo.bar[');
    expect(results[0].message).toMatch(/^Possibly a snippet filter/);
    expect(results).toContainEqual(expect.objectContaining({ message: expect.stringMatching(/^Malformed CSS selector/) }));
  });

  it('reports a domain-list error once', () => {
    expect(lint('example.com,,example.org##hide-if-contains x').filter(r => r.message === 'Double comma ",," is invalid syntax')).toHaveLength(1);
  });

  it('adds no safety-net warning to a guessed truncated name', () => {
    const results = lint('example.com-on-iframe-property-read x');
    expect(results[0].message).toMatch(/^Possibly a snippet filter/);
    expect(results.some(r => r.message.includes(WHITESPACE) || r.message.includes(DOMAIN_LIST))).toBe(false);
  });
});

describe('truncated-name detection tries shorter tails', () => {
  it.each([
    ['example.net-on-property-read foo', 'example.net#$#abort-on-property-read foo'],
    ['example.de-if-contains foo', 'example.de#$#hide-if-contains foo'],
  ])('repairs %s', (line, repairedRaw) => {
    expect(repairOf(line)).toMatchObject({ tier: 'guess', repairedRaw });
  });

  it('leaves a full name after a domain to the exact-name detector', () => {
    expect(repairOf('example.comhide-if-contains foo')).toMatchObject({ tier: 'confident', repairedRaw: 'example.com#$#hide-if-contains foo' });
  });

  it('never treats a full name after a non-domain prefix as truncated', () => {
    expect(detectTruncatedSnippetName(parseLine('example/hide-if-contains foo', 0))).toBeNull();
  });
});

describe('separator junk at the end of the domain prefix', () => {
  const TOO_MANY = 'accepts at most';

  it('absorbs a stray "$" before "##" into the repair', () => {
    const repair = repairOf('example.com$##hide-if-contains ad');
    expect(repair).toMatchObject({ tier: 'guess', repairedRaw: 'example.com#$#hide-if-contains ad' });
    expect(repair!.edits[0].start).toBe(11);
    const message = lint('example.com$##hide-if-contains ad')[0].message;
    expect(message).toContain('"example.com#$#hide-if-contains ad"');
    expect(message).not.toContain('example.com$#');
  });

  it('keeps exception intent', () => {
    expect(repairOf('example.com$#@#hide-if-contains ad')).toMatchObject({
      intended: 'snippet-exception',
      repairedRaw: 'example.com#@$#hide-if-contains ad',
    });
  });

  it('keeps the indent in the repair but not in the suggestion', () => {
    const line = '  example.com$##hide-if-contains ad';
    expect(repairOf(line)).toMatchObject({ repairedRaw: '  example.com#$#hide-if-contains ad' });
    const primary = lint(line)[0];
    expect(primary.startCol).toBe(2);
    expect(primary.message).toContain('If so: "example.com#$#hide-if-contains ad"');
  });

  it.each([
    ['example.com$##$abort-on-property-read a b c d', 15],
    ['  example.com$##$abort-on-property-read a b c d', 17],
  ])('maps a confident repair of %s back to the raw name column', (line, nameCol) => {
    expect(repairOf(line)).toMatchObject({ tier: 'confident', repairedRaw: line.replace('$##$', '#$#') });
    const results = lint(line);
    expect(results[0].message).toContain('separator "$##$"');
    const expected = lint('example.com#$#abort-on-property-read a b c d').find(r => r.message.includes(TOO_MANY))!;
    const tooMany = results.find(r => r.message.includes(TOO_MANY))!;
    expect(tooMany).toMatchObject({ severity: expected.severity, message: expected.message, startCol: nameCol, endCol: nameCol + 'abort-on-property-read'.length });
  });

  it.each(['example$##hide-if-contains ad', 'example.com$x$##hide-if-contains ad'])('needs a domain list before the junk: %s', line => {
    expect(repairOf(line)).toBeNull();
  });
});

describe('fuzzy matches to bare snippet names are guesses', () => {
  it.each(['example.com#$doc', 'example.com#$frame'])('keeps the network reading of %s', line => {
    expect(repairOf(line)).toMatchObject({ tier: 'guess' });
    const results = lint(line);
    expect(results[0].message).toMatch(/^Possibly a malformed snippet filter separator/);
    expect(results).toContainEqual(expect.objectContaining({ severity: 'warning', message: expect.stringMatching(/^\(if this is a snippet filter\) Unknown snippet/) }));
    expect(results).toContainEqual(expect.objectContaining({ severity: 'error', message: expect.stringMatching(/^Unknown modifier/) }));
  });

  it('hedges a near miss of a bare name with arguments', () => {
    expect(repairOf('example.com#$racee x')).toMatchObject({ tier: 'guess' });
  });

  it.each(['example.com#$abort-on-propety-read x', 'example.com#$debug'])('stays confident for %s', line => {
    expect(repairOf(line)).toMatchObject({ tier: 'confident' });
  });

  it('keeps a full-severity unknown snippet for a confident hyphenated near miss', () => {
    expect(lint('example.com#$abort-on-propety-read x')).toContainEqual(expect.objectContaining({ severity: 'error', message: expect.stringMatching(/^Unknown snippet/) }));
  });
});

describe('domain-list findings of guesses on network lines', () => {
  it.each(['foo*.example.comlog x', 'foo*.example.com#$abort-property-read x'])('hedges them for %s', line => {
    const results = lint(line);
    expect(results).toContainEqual(expect.objectContaining({ severity: 'warning', message: expect.stringMatching(/^\(if this is a snippet filter\) Invalid wildcard in domain/) }));
    expect(results.some(r => r.severity === 'error' && r.message.startsWith('Invalid wildcard'))).toBe(false);
  });

  it('keeps them at full severity for content lines', () => {
    expect(lint('example.com,,example.org##hide-if-contains x').filter(r => r.severity === 'error' && r.message === 'Double comma ",," is invalid syntax')).toHaveLength(1);
  });

  it('keeps them at full severity for confident repairs', () => {
    expect(lint('example.com|ex*ample.org#$#abort-on-property-read x')).toContainEqual(expect.objectContaining({ severity: 'error', message: expect.stringMatching(/^Invalid wildcard in domain/) }));
  });
});

describe('whitespace around separator junk', () => {
  it.each([
    ['example.com$ ##hide-if-contains ad', 'snippet', 'example.com#$#hide-if-contains ad'],
    ['example.com $##hide-if-contains ad', 'snippet', 'example.com#$#hide-if-contains ad'],
    ['example.com$ #@#hide-if-contains ad', 'snippet-exception', 'example.com#@$#hide-if-contains ad'],
  ])('absorbs it in the dropped-"$" repair of %s', (line, intended, repairedRaw) => {
    expect(repairOf(line)).toMatchObject({ tier: 'guess', intended, repairedRaw });
    expect(lint(line)[0].message).toContain(`"${repairedRaw}"`);
  });

  it('absorbs it in a confident mangled-separator repair', () => {
    const line = 'example.com$ ##$abort-on-property-read x';
    expect(repairOf(line)).toMatchObject({ tier: 'confident', repairedRaw: 'example.com#$#abort-on-property-read x' });
    const message = lint(line)[0].message;
    expect(message).toContain('"example.com#$#abort-on-property-read x"');
    expect(message).not.toContain('example.com$ ');
  });

  it('leaves a whitespace-only gap to the spaces check', () => {
    const line = 'example.com ##hide-if-contains ad';
    expect(repairOf(line)).toMatchObject({ repairedRaw: 'example.com #$#hide-if-contains ad' });
    expect(lint(line)).toContainEqual(expect.objectContaining({ severity: 'error', message: 'Spaces are not allowed in domain list' }));
  });

  it('scans back over junk and whitespace only', () => {
    expect(trailingJunkStart('ab$ #x', 4, 0)).toBe(2);
    expect(trailingJunkStart('example.com$ ##', 13, 0)).toBe(11);
    expect(trailingJunkStart('  $##', 3, 2)).toBe(2);
  });

  it('keeps the raw prefix when a long junk run is not adjacent to the separator', () => {
    const line = `example.com${'$'.repeat(64000)}x##hide-if-contains ad`;
    expect(repairOf(line)!.repairedRaw.endsWith('x#$#hide-if-contains ad')).toBe(true);
  });
});

describe('bare-name argument check stops at the first command', () => {
  it.each(['example.com#log; foo', 'example.com#@log; foo', 'example.comlog ; foo'])('makes no repair for %s', line => {
    expect(repairOf(line)).toBeNull();
  });

  it('keeps the hint for a hyphenated name without first-call arguments', () => {
    const line = 'example.comabort-on-property-read ; foo';
    expect(repairOf(line)).toMatchObject({ tier: 'hint' });
    const results = lint(line);
    expect(results[0].message).toMatch(/^Missing "#\$#" snippet filter separator/);
    expect(results.some(r => /argument|Unknown snippet/.test(r.message))).toBe(false);
  });

  it.each([
    ['example.com#log \'a;b\'', 'guess'],
    ['example.com#log foo', 'guess'],
    ['example.comabort-on-property-read x', 'confident'],
  ])('still repairs %s', (line, tier) => {
    expect(repairOf(line)).toMatchObject({ tier });
  });
});

describe('empty snippet token after a mangled separator', () => {
  it('makes no repair for example.com#$;foo', () => {
    expect(repairOf('example.com#$;foo')).toBeNull();
    expect(lint('example.com#$;foo')).toEqual([]);
  });
});

describe('domain-list safety net next to a "#"', () => {
  it('reports the domain list', () => {
    expect(lint('example.com,example.org abort-on-property-read foo #bar')).toEqual([
      expect.objectContaining({ message: expect.stringContaining(DOMAIN_LIST), startCol: 0, endCol: 23 }),
    ]);
  });
});

describe('empty snippet token after a single "#"', () => {
  it.each(['example.com#;foo', 'example.com#@;foo'])('makes no repair for %s', line => {
    expect(repairOf(line)).toBeNull();
  });
});

describe('popup filters with a "#"', () => {
  it('keep their network validation', () => {
    expect(lint('||example.com/#ad$popup,foo')).toEqual([expect.objectContaining({ severity: 'error', message: 'Unknown modifier "foo"' })]);
  });
});

describe('malformed snippet separator severity', () => {
  it.each(['example.com#$abort-on-property-read x', 'example.com$#abort-on-property-read x', 'example.com#@$abort-on-property-read x'])(
    'is an error when confident: %s', line => {
      expect(lint(line)[0]).toMatchObject({ severity: 'error', message: expect.stringMatching(/^Malformed snippet/) });
    });

  it('is an error when guessed, with hedged body findings', () => {
    const results = lint('example.com#$abort-property-read x');
    expect(results[0]).toMatchObject({ severity: 'error', message: expect.stringMatching(/^Possibly a malformed/) });
    expect(results.filter(r => r.message.startsWith('(if this is')).every(r => r.severity === 'warning')).toBe(true);
  });
});
