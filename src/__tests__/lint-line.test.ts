import { describe, it, expect } from 'vitest';
import { parseLine, isAbpDocument } from '../parser';
import { lintLine } from '../validators/lint-line';
import { buildDuplicateKey } from '../validators/syntax';
import type { LintResult } from '../types';

const lint = (line: string): LintResult[] => lintLine(parseLine(line, 0));
const errors = (line: string) => lint(line).filter(r => r.severity === 'error');
const warnings = (line: string) => lint(line).filter(r => r.severity === 'warning');
const REQUIRES_DOMAIN = 'must have a non-negated domain with a dot';

describe('lintLine — snippet exception domain scope', () => {
  it('accepts a domain-less exception without any error', () => {
    expect(errors('#@$#abort-on-property-read x')).toEqual([]);
    expect(lint('#@$#abort-on-property-read x').some(r => r.message.includes(REQUIRES_DOMAIN))).toBe(false);
  });

  it('warns once when there is no domain', () => {
    expect(warnings('#@$#abort-on-property-read x')).toEqual([
      expect.objectContaining({ message: expect.stringContaining('no domain'), startCol: 0 }),
    ]);
  });

  it('warns once when only excluded domains are given', () => {
    expect(warnings('~a.com#@$#abort-on-property-read x')).toEqual([
      expect.objectContaining({ message: expect.stringContaining('only excluded domains') }),
    ]);
  });

  it.each(['example.com', 'foo', 'localhost', '~a.com,b.com'])('stays silent for a positive domain: %s', domain => {
    expect(lint(`${domain}#@$#abort-on-property-read x`)).toEqual([]);
  });

  it('still requires a domain for #$# filters', () => {
    expect(errors('#$#abort-on-property-read x')).toEqual([
      expect.objectContaining({ message: expect.stringContaining(REQUIRES_DOMAIN) }),
    ]);
  });
});

describe('lintLine — snippet exception routing', () => {
  it('does not apply race-block validation to an exception', () => {
    expect(lint('example.com#@$#race start; hide-if-contains a')
      .some(r => r.message.includes('race'))).toBe(false);
  });

  it('still applies race-block validation to a #$# filter', () => {
    expect(lint('example.com#$#race start; hide-if-contains a')
      .some(r => r.message.includes('race'))).toBe(true);
  });

  it('reports an unknown snippet as an error', () => {
    expect(errors('example.com#@$#nosuchsnippet a').some(r => r.message.includes('Unknown snippet'))).toBe(true);
  });

  it('accepts a clean multi-command exception', () => {
    expect(lint('example.com#@$#abort-on-property-read x; hide-if-contains Ad div')).toEqual([]);
  });

  it('flags an identical repeated command', () => {
    expect(warnings('example.com#@$#abort-on-property-read x; abort-on-property-read x')
      .some(r => r.message.includes('Duplicate snippet call'))).toBe(true);
  });

  it('treats an escape and its decoded form as different commands', () => {
    expect(lint('example.com#@$#log a\\nb; log anb').some(r => r.message.includes('Duplicate'))).toBe(false);
  });

  it('reports an empty body as an error', () => {
    expect(errors('example.com#@$#')).toEqual([expect.objectContaining({ message: expect.stringContaining('empty body') })]);
  });

  it('does not raise network-rule false positives', () => {
    expect(errors('example.com#@$#log a^script,image')).toEqual([]);
    expect(errors('example.com#@$#abort-on-property-read x$foo')).toEqual([]);
  });
});

describe('lintLine — double-quoted arguments', () => {
  it('warns on a double-quoted argument', () => {
    const results = warnings('example.com#@$#log "hi"').filter(r => r.message.includes('Double quotes'));
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ startCol: 'example.com#@$#log '.length, endCol: 'example.com#@$#log "hi"'.length });
  });

  it('warns on a double-quoted selector argument', () => {
    expect(warnings('example.com#@$#hide-if-contains "Ad" div').filter(r => r.message.includes('Double quotes'))).toHaveLength(1);
  });

  it('does not warn on quotes inside an attribute selector', () => {
    expect(warnings('example.com#@$#hide-if-contains Ad div[class="foo"]').some(r => r.message.includes('Double quotes'))).toBe(false);
  });

  it('does not warn on explicitly escaped literal quotes', () => {
    expect(warnings(String.raw`example.com#@$#log \"hi\"`).some(r => r.message.includes('Double quotes'))).toBe(false);
  });

  it('warns on a double-quoted argument in a #$# filter', () => {
    expect(warnings('example.com#$#log "hi"').filter(r => r.message.includes('Double quotes'))).toHaveLength(1);
  });

  it('does not warn on quotes inside an attribute selector in a #$# filter', () => {
    expect(warnings('example.com#$#hide-if-contains Ad div[class="foo"]').some(r => r.message.includes('Double quotes'))).toBe(false);
  });

  it('does not warn on single-quoted arguments', () => {
    expect(warnings("example.com#@$#log 'hi'").some(r => r.message.includes('Double quotes'))).toBe(false);
  });

  it('does not warn on a double quote inside single quotes', () => {
    expect(warnings(`example.com#@$#log 'say "hi"'`).some(r => r.message.includes('Double quotes'))).toBe(false);
  });

  it('does not warn on a double quote inside a regex', () => {
    expect(warnings('example.com#@$#hide-if-contains /a"b/ div').some(r => r.message.includes('Double quotes'))).toBe(false);
  });
});

describe('snippet exception parsing and documents', () => {
  it('detects an exception-only document', () => {
    expect(isAbpDocument(['example.com#@$#log hi'])).toBe(true);
  });

  it('keeps Markdown headings out', () => {
    expect(isAbpDocument(['## Heading', '## Another'])).toBe(false);
  });

  it('treats #$# and #@$# lines with the same body as distinct duplicates', () => {
    const snippet = buildDuplicateKey(parseLine('a.com#$#log x', 0));
    const exception = buildDuplicateKey(parseLine('a.com#@$#log x', 0));
    expect(snippet).not.toEqual(exception);
  });

  it('normalises domain order for exception duplicates', () => {
    expect(buildDuplicateKey(parseLine('a.com,b.com#@$#log x', 0)))
      .toEqual(buildDuplicateKey(parseLine('b.com,a.com#@$#log x', 0)));
  });
});

describe('lintLine — regex boundary regressions', () => {
  it('does not flag a duplicate when an unquoted regex has ambiguous boundaries', () => {
    for (const sep of ['#@$#', '#$#']) {
      expect(lint(`example.com${sep}hide-if-contains /a b/ div; hide-if-contains '/a b/' div`)
        .some(r => r.message.includes('Duplicate snippet call'))).toBe(false);
    }
  });

  it('still flags a duplicate for identical quoted regexes', () => {
    expect(lint(`example.com#@$#hide-if-contains '/a b/' div; hide-if-contains '/a b/' div`)
      .some(r => r.message.includes('Duplicate snippet call'))).toBe(true);
  });

  it('does not warn about double quotes inside a regex that contains a slash', () => {
    expect(lint('example.com#@$#hide-if-contains /a/b"c/ div').some(r => r.message.includes('Double quotes'))).toBe(false);
  });

  it('still warns about a wrapped double-quoted argument next to a regex', () => {
    expect(lint('example.com#@$#hide-if-contains /a/b/ "div"').filter(r => r.message.includes('Double quotes'))).toHaveLength(1);
  });
});

describe('lintLine — escaped hyphen in a character class', () => {
  const hyphenWarnings = (line: string) => lint(line).filter(r => r.message.includes('range operator'));

  it.each([
    String.raw`/[a\-z]/`, String.raw`/[a\-z]/u`, String.raw`/[a\-z]/v`, String.raw`/[^a\-z]/`,
    String.raw`/[[a]b\-z]/v`, String.raw`/[a\-b\-c]/u`, String.raw`/[a\-z]/u`,
    String.raw`/[\\u\-z]/`, String.raw`/[\\u0061\-z]/`, String.raw`/[\\xZZ\-a]/`, String.raw`/[\\p\-z]/`,
    String.raw`/ad[a\-z]banner/`, String.raw`/[\\141\-z]/`,String.raw`/[\\uD83D\\uDE00\-\\u{1F700}]/u`,
  ])('warns once for %s', pattern => {
    expect(hyphenWarnings(`example.com#$#hide-if-contains '${pattern}' div`)).toHaveLength(1);
  });

  it.each([
    String.raw`/[\-a]/u`, String.raw`/[a\-]/u`, String.raw`/[^\-a]/`, String.raw`/a\-z/u`, String.raw`/[a\\-z]/u`,
    String.raw`/[a-b\-c]/u`, String.raw`/[\\d\-z]/`, String.raw`/[a\-\\d]/`, String.raw`/[\\cA-\\c0\-z]/`,String.raw`/[a-\\141\-z]/`, String.raw`/[a-\\uD83D\\uDE00\-z]/u`,String.raw`/[[a]\-z]/`,
  ])('stays silent for %s', pattern => {
    expect(hyphenWarnings(`example.com#$#hide-if-contains '${pattern}' div`)).toEqual([]);
  });

  it.each([String.raw`/[a-b\-c]/v`, String.raw`/[[a]\-z]/v`, String.raw`/[\\uD83D\\uDE00\-z]/u`])('leaves %s to the malformed-regex warning', pattern => {
    const results = lint(`example.com#$#hide-if-contains '${pattern}' div`);
    expect(results.filter(r => r.message.includes('Malformed regex'))).toHaveLength(1);
    expect(results.filter(r => r.message.includes('range operator'))).toEqual([]);
  });
});
