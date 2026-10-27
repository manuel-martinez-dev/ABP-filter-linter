import { describe, it, expect } from 'vitest';
import { parseLine, isAbpDocument } from '../parser';
import { lintLine, lintRawLine } from '../validators/lint-line';
import { buildDuplicateKey } from '../validators/syntax';
import { REPLACEMENT_ARGS } from '../validators/snippets';
import snippetData from '../data/snippets.json';
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

  const quoted = (line: string) => warnings(line).filter(r => r.message.includes('Double quotes'));

  it('does not warn on a JSON fragment in a replacement argument', () => {
    expect(quoted('a.com#$#replace-fetch-response /"x":"1"/ "x":"0"')).toHaveLength(0);
    expect(quoted('a.com#@$#replace-fetch-response /"x":"1"/ "x":"0"')).toHaveLength(0);
  });

  it('still warns on a whole quoted replacement without interior quotes', () => {
    expect(quoted('a.com#$#replace-fetch-response /x/ "none"')).toHaveLength(1);
  });

  it('still warns on interior quotes outside replacement arguments', () => {
    expect(quoted('a.com#$#abort-on-property-read "foo"')).toHaveLength(1);
    expect(quoted(String.raw`a.com#$#log "a\"b"`)).toHaveLength(1);
  });

  it('accepts escaped interior quotes in a replacement argument (known cost)', () => {
    expect(quoted(String.raw`a.com#$#replace-fetch-response /x/ "a\"b"`)).toHaveLength(0);
  });

  it('honours the event-override rewrite condition', () => {
    expect(quoted('a.com#$#event-override click rewrite /a/ p /b/ "x":"1"')).toHaveLength(0);
    expect(quoted('a.com#$#event-override click trusted /a/ p /b/ "x":"1"')).toHaveLength(1);
  });

  it('every schema argument named replacement is listed in REPLACEMENT_ARGS', () => {
    const schemas = snippetData.snippets as Record<string, { args: Array<{ name: string }> }>;
    const unlisted = Object.entries(schemas).flatMap(([name, s]) =>
      s.args.flatMap((a, i) => a.name === 'replacement' && REPLACEMENT_ARGS[name] !== i ? [`${name}[${i}]`] : []));
    expect(unlisted).toEqual([]);
  });

  it('every REPLACEMENT_ARGS entry matches a replacement argument in the schema', () => {
    const schemas = snippetData.snippets as Record<string, { args: Array<{ name: string; when?: { arg: number; equals: string } }> }>;
    for (const [name, index] of Object.entries(REPLACEMENT_ARGS)) {
      const arg = schemas[name]?.args[index];
      expect(arg?.name, name).toBe('replacement');
      const args = Array<string>(index + 1).fill('a');
      if (arg?.when) args[arg.when.arg] = arg.when.equals;
      args[index] = '"x":"1"';
      expect(quoted(`a.com#$#${name} ${args.join(' ')}`), name).toHaveLength(0);
    }
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

describe('lintLine — lost escapes in deprecated log-if wrappers', () => {
  const WRAPPERS = ['log-if-script-loads', 'log-if-iframe-loads', 'log-if-anchor-href-matches'];
  const escapeWarnings = (line: string) => warnings(line).filter(r => r.message.includes('loses its backslash'));
  const deprecated = (line: string) => warnings(line).filter(r => r.message.includes('Deprecated snippet'));

  it.each(WRAPPERS)('reports the lost escape and the deprecation on %s', name => {
    const line = String.raw`#$#${name} /a\.com/ t`;
    expect(escapeWarnings(line)).toHaveLength(1);
    expect(deprecated(line)).toHaveLength(1);
  });

  it('stays silent on a bracketed dot, keeping only the deprecation', () => {
    const line = String.raw`#$#log-if-script-loads /a[.]com/ t`;
    expect(escapeWarnings(line)).toEqual([]);
    expect(deprecated(line)).toHaveLength(1);
  });

  it('still reports on log-if-element-loads (control)', () => {
    expect(escapeWarnings(String.raw`#$#log-if-element-loads /a\.com/ script`)).toHaveLength(1);
  });

  it.each(WRAPPERS)('marks urlPattern of %s as a regex argument', name => {
    const schemas = snippetData.snippets as Record<string, { args: Array<{ regex?: unknown }> }>;
    expect(schemas[name].args[0].regex).toBe(true);
  });
});

describe('lintRawLine — damaged content filters', () => {
  const raw = (line: string) => lintRawLine(line, 0);
  const LINE1 = 'example.com,example.org,example.net-property-read Foo.bar false';
  const LINE2 = 'example.com,example.org|example.net#$#abort-property-read Foo.bar false';

  it('reports the repaired-text domain error at the raw column', () => {
    const results = raw('example.com|ex*ample.org#$#abort-on-property-read x');
    expect(results.map(r => r.severity)).toEqual(['error', 'error']);
    expect(results[0].message).toContain('"|" in domain list');
    expect(results[1]).toMatchObject({ message: expect.stringContaining('Invalid wildcard in domain'), startCol: 12, endCol: 24 });
  });

  it('reports trailing whitespace once on a repaired line', () => {
    expect(raw('example.com|example.org##.ad  ').filter(r => r.message === 'Trailing whitespace')).toHaveLength(1);
  });

  it('keeps network findings alongside a hint', () => {
    const results = raw('example.comabort-on-property-read');
    expect(results.map(r => r.message)).toEqual([expect.stringContaining('Missing "#$#"')]);
  });

  it('leaves separator detection out of lintLine', () => {
    for (const line of ['example.com#$abort-on-property-read x', 'example.comabort-on-property-read x']) {
      expect(lint(line).some(r => r.message.includes('#$#'))).toBe(false);
    }
  });

  it('gives line 1 the truncated-name hint with all candidates and no safety net', () => {
    const messages = raw(LINE1).map(r => r.message);
    expect(messages[0]).toContain('abort-on-property-read, abort-on-iframe-property-read, override-property-read');
    expect(messages.some(m => m.includes('Domain list in a network pattern') || m.includes('Whitespace in a network pattern'))).toBe(false);
  });

  it('gives line 2 the pipe error and the unknown snippet, nothing from the network reading', () => {
    const results = raw(LINE2);
    expect(results).toEqual([
      expect.objectContaining({ severity: 'error', message: expect.stringContaining('"|" in domain list') }),
      expect.objectContaining({ severity: 'error', message: expect.stringContaining('Unknown snippet "abort-property-read"') }),
    ]);
  });

  it('puts network findings at the raw column of an indented line', () => {
    expect(lint('  ||example.com^$foo').find(r => r.message.includes('Unknown modifier'))).toMatchObject({ startCol: 17, endCol: 20 });
  });

  describe('document detection', () => {
    it('does not recognise a headerless document with only line 1', () => {
      expect(isAbpDocument([LINE1])).toBe(false);
    });

    it.each([
      ['headerless line 1 + line 2', [LINE1, LINE2]],
      ['header + line 1', ['[Adblock Plus 2.0]', LINE1]],
      ['header + line 2', ['[Adblock Plus 2.0]', LINE2]],
    ])('recognises %s and lints each line', (_, lines) => {
      expect(isAbpDocument(lines)).toBe(true);
      for (const line of lines) {
        if (line === LINE1) expect(raw(line)[0].message).toContain('truncated name');
        if (line === LINE2) expect(raw(line).map(r => r.message)).toEqual([expect.stringContaining('"|" in domain list'), expect.stringContaining('Unknown snippet')]);
      }
    });
  });
});

describe('lintRawLine — mutation sweep', () => {
  const DOMAINS = 'example.com,example.org,example.net';
  const NAME = 'abort-on-property-read';
  const SNIPPET = `${DOMAINS}#$#${NAME} Foo.bar false`;
  const BASES = [
    { line: SNIPPET, sep: '#$#', name: NAME },
    { line: `${DOMAINS}##.ad`, sep: '##', name: '' },
    { line: `${DOMAINS}#?#div:-abp-has(.ad)`, sep: '#?#', name: '' },
  ];
  const SEPARATOR_MANGLES = ['#$', '$#', '##$', '#$$#', '#$ #', '#', '##'];
  const ALLOWED = new Map([
    [`${DOMAINS}##div:-abp-has(.ad)`, 'deleting "?" from #?# leaves a ## filter the linter reads as CSS'],
  ]);
  const raw = (line: string) => lintRawLine(line, 0);

  const mutations: Array<{ line: string; recoverable: boolean }> = [];
  for (const { line, sep, name } of BASES) {
    const sepStart = line.indexOf(sep);
    const isSnippet = sep === '#$#';
    for (let i = sepStart; i < sepStart + sep.length + name.length; i++) {
      mutations.push({ line: line.slice(0, i) + line.slice(i + 1), recoverable: isSnippet && i < sepStart + sep.length });
    }
    for (let i = 0; i < sepStart; i++) {
      if (line[i] === ',') mutations.push({ line: `${line.slice(0, i)}|${line.slice(i + 1)}`, recoverable: isSnippet });
    }
  }
  for (const mangle of SEPARATOR_MANGLES) {
    mutations.push({ line: SNIPPET.replace('#$#', () => mangle), recoverable: true });
  }

  it.each(mutations.filter(m => !ALLOWED.has(m.line)))('flags $line', ({ line, recoverable }) => {
    const messages = raw(line).map(r => r.message);
    expect(messages.length).toBeGreaterThan(0);
    if (recoverable) expect(messages.some(m => m.includes('#$#') || m.includes('#@$#'))).toBe(true);
  });

  it('only allowlists mutations the sweep generates', () => {
    for (const line of ALLOWED.keys()) expect(mutations.some(m => m.line === line)).toBe(true);
  });
});

describe('lintRawLine — missing "$" after a regex', () => {
  const raw = (line: string) => lintRawLine(line, 0);

  it('replaces the whitespace safety net', () => {
    expect(raw("/^ads/script,csp=default-src 'none'").map(r => r.message)).toEqual([
      expect.stringContaining('Likely missing "$"'),
    ]);
  });

  it('puts the finding at the raw column of an indented line', () => {
    expect(raw('  /^ads/script,image')).toEqual([
      expect.objectContaining({ severity: 'error', startCol: 7, endCol: 14 }),
    ]);
  });

  it('reports trailing whitespace once', () => {
    expect(raw('/^ads/script,image  ').map(r => r.message)).toEqual([
      expect.stringContaining('Likely missing "$"'),
      'Trailing whitespace',
    ]);
  });
});

describe('lintRawLine — regex recovery drops literal-pattern suggestions', () => {
  const raw = (line: string) => lintRawLine(line, 0).map(r => r.message);

  it.each(['/^ads[^^]/script,image', '/^ads/script,csp=x^image'])('reports only the missing "$" on %s', line => {
    expect(raw(line)).toEqual([expect.stringContaining('Likely missing "$"')]);
  });

  it.each([
    ['/^ads^script', 'looks like a filter option'],
    ['||example.com^^$script', 'Doubled separator'],
  ])('keeps the original-pattern finding on %s', (line, message) => {
    expect(raw(line)).toEqual([expect.stringContaining(message)]);
  });
});

describe('lintLine — replace response mode argument', () => {
  const modeFindings = (line: string) => lint(line).filter(r => r.message.includes('"mode"') || r.message.includes('accepts at most'));

  it.each(['replace-fetch-response', 'replace-xhr-response'])('accepts every mode for %s', snippet => {
    for (const mode of ['replace', 'append', 'remove']) {
      expect(modeFindings(`example.com#$#${snippet} jsonpath($.ad) 0 /ads/ ${mode}`)).toEqual([]);
    }
  });

  it.each(['replace-fetch-response', 'replace-xhr-response'])('rejects an unknown mode for %s', snippet => {
    expect(errors(`example.com#$#${snippet} jsonpath($.ad) 0 /ads/ delete`)).toEqual([
      expect.objectContaining({ message: 'Invalid value "delete" for "mode". Expected one of: replace, append, remove' }),
    ]);
  });
});
