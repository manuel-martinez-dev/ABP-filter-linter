import { describe, it, expect } from 'vitest';
import snippetData from '../data/snippets.json';
import { splitSnippetChain, validateSnippetCall, validateSnippetChain, validateSnippetBody, detectDuplicateCalls, detectMissingSnippetSeparator, detectMalformedSnippetSeparator, detectUnquotedRegexBreaks, detectLostRegexEscapes, isPassiveSnippet, snippetChainRequiresDomain } from '../validators/snippets';

describe('snippet regex syntax', () => {
  const run = (body: string, offset = 0) => splitSnippetChain(body)
    .flatMap(call => validateSnippetCall(call, offset))
    .filter(result => result.message.includes('Malformed regex'));

  it.each(['/[/', '/(/g', '/x/gg', '/x/z', '/x/uv'])(
    'warns about literal fallback for %s', pattern => {
      const results = run(`hide-if-contains '${pattern}' div`);
      expect(results).toHaveLength(1);
      expect(results[0].severity).toBe('warning');
      expect(results[0].message).toContain('literal text');
    }
  );

  it.each(['/ad/gim', '/ad/d', '/ad/v', '/path/to/ad/gi', 'Sponsored', '/just-a-path'])(
    'accepts valid patterns or literal text: %s', pattern => {
      expect(run(`hide-if-contains '${pattern}' div`)).toEqual([]);
    }
  );

  it.each([
    "hide-if-matches-xpath '/html/body/div['",
    "skip-video video 0 '/html/body/div['",
    "hide-if-contains ads '/[/'",
    "hide-if-has-and-matches-style '/[/'",
    "replace-fetch-request 'jsonpath($.ads[*)' '/[/'",
    "log '/[/'",
    "event-override click trusted '' data '/[/'",
  ])('does not compile non-regex arguments: %s', body => {
    expect(run(body)).toEqual([]);
  });

  it.each([
    "event-override click rewrite '' data '/[/'",
    "log-if-element-loads '/[/' type",
    "debug '/[/'",
    "hide-if-matches-computed-xpath '//div' '//span' '/[/'",
    "freeze-element div '' .safe '/ok/' '/[/'",
    "array-override push ads false '' 'literal,/[/'",
    "map-override get ads false '' '/ok/,/[/'",
    "replace-outbound-value foo ads '' '' '' 'literal,/[/'",
    "replace-argument foo 0 '' '' 'literal,/[/'",
    "timer-override 10 '' '' both 'literal /[/'",
    "json-prune ads '' 'literal /[/'",
  ])('validates conditional, variadic and nested patterns: %s', body => {
    expect(run(body)).toHaveLength(1);
  });

  it('keeps flagged freeze-element exceptions on the selector path', () => {
    expect(run("freeze-element div '' '/[/g'")).toEqual([]);
  });

  it.each(["'/\\(/u'", '/\\(/u'])(
    'compiles the argument after ABP removes a single escape: %s', arg => {
      expect(run(`hide-if-contains ${arg} div`)).toHaveLength(1);
    }
  );

  it.each(["'/\\\\(/u'", '/\\\\(/u', "'/\\u0028/u'"])(
    'handles doubled backslashes and Unicode decoding: %s', arg => {
      expect(run(`hide-if-contains ${arg} div`)).toHaveLength(arg.includes('u0028') ? 1 : 0);
    }
  );

  it('preserves source columns after escaped content in a chain', () => {
    const body = "log hello; hide-if-contains '/\\(/u' div";
    const [result] = run(body, 12);
    expect(body.slice(result.startCol - 12, result.endCol - 12)).toBe('/\\(/u');
  });

  it('does not guess regex syntax when a broken Unicode escape can consume boundaries', () => {
    expect(run("hide-if-contains '/\\uZZZZ[/' div")).toEqual([]);
  });

  it('decodes control-character escapes without adding regex warnings', () => {
    expect(run("hide-if-contains '/a\\n\\r\\tb/u' div")).toEqual([]);
  });

  it('uses ABP product versions for the corrected since metadata', () => {
    expect(snippetData.snippets['replace-argument'].since).toBe('4.42.0');
    expect(snippetData.snippets['prevent-window-open'].since).toBe('4.43.1');
    expect(Object.values(snippetData.snippets).some(schema => schema.since.startsWith('2.'))).toBe(false);
  });
});

describe('decoded snippet validation and regex boundaries', () => {
  const run = (body: string) => {
    const calls = splitSnippetChain(body);
    return [...calls.flatMap(call => validateSnippetCall(call, 0)),
      ...validateSnippetChain(calls, 0), ...detectDuplicateCalls(calls, 0),
      ...detectLostRegexEscapes(body, calls, 0)];
  };

  it.each([
    String.raw`replace-argument foo '\uZZZZ'`,
    String.raw`event-override click '\uZZZZ' '' data /x/`,
    String.raw`event-override click rewrite '' '\uZZZZ' /x/`,
    String.raw`race '\uZZZZ'; race stop`,
    String.raw`race start; hide-if-contains '\uZZZZ' div; race stop`,
    String.raw`hide-if-contains '\u12' div`,
  ])('reports decoding failure without dependent diagnostics: %s', body => {
    const results = run(body);
    expect(results).toHaveLength(1);
    expect(results[0].severity).toBe('error');
    expect(results[0].message).toContain('Invalid escape');
    expect(body.slice(results[0].startCol, results[0].endCol)).toMatch(/^\\u/);
  });

  it.each([
    ['totally-unknown-snippet', 'Unknown snippet', 'error'],
    ['log-if-script-loads', 'Deprecated snippet', 'warning'],
  ])('preserves name and escape diagnostics for %s', (name, message, severity) => {
    const body = String.raw`${name} '\uZZZZ'`;
    const results = run(body);
    expect(results).toHaveLength(2);
    const escape = results.find(result => result.message.includes('Invalid escape'))!;
    expect(escape.severity).toBe('error');
    expect(body.slice(escape.startCol, escape.endCol)).toBe(String.raw`\uZZZZ`);
    const nameResult = results.find(result => result.message.includes(message))!;
    expect(nameResult.severity).toBe(severity);
    expect(body.slice(nameResult.startCol, nameResult.endCol)).toBe(name);
  });

  it('reports a trailing incomplete escape', () => {
    const results = run('hide-if-contains foo' + '\\');
    expect(results).toHaveLength(1);
    expect(results[0].message).toContain('Invalid escape');
  });

  it('keeps decoding failures visible when duplicate checks are suppressed', () => {
    const results = run(String.raw`hide-if-contains '\uZZZZ' div; hide-if-contains '\uZZZZ' div`);
    expect(results).toHaveLength(2);
    expect(results.every(result => result.message.includes('Invalid escape'))).toBe(true);
  });

  it('uses one fallback range calculation for enum and nested-argument warnings', () => {
    const call = {
      name: 'array-override', nameOffset: 0,
      args: [String.raw`\u0070ush`, 'hide-if-contains ads div'],
      runtimeArgs: ['push', 'hide-if-contains ads div'],
    };
    const results = validateSnippetCall(call, 7);
    expect(results).toHaveLength(1);
    expect(results[0].startCol).toBe(7 + 'array-override '.length + String.raw`\u0070ush `.length);
    expect(results[0].endCol - results[0].startCol).toBe(call.args[1].length);
  });

  it('refreshes regex results if a caller changes its argument values', () => {
    const call = { name: 'hide-if-contains', nameOffset: 0, args: ['/ads/'] };
    expect(validateSnippetCall(call, 0)).toEqual([]);
    call.args[0] = '/[/';
    expect(validateSnippetCall(call, 0)[0].message).toContain('Malformed regex');
  });

  it.each(['!', String.raw`\u0021`])('validates inverted patterns with prefix %s', prefix => {
    const body = `prevent-window-open '${prefix}/[/'`;
    const results = run(body);
    expect(results).toHaveLength(1);
    expect(results[0].message).toContain('Malformed regex');
    expect(body.slice(results[0].startCol, results[0].endCol)).toBe(`${prefix}/[/`);
  });

  it.each(['!', String.raw`\u0021`])('keeps escape warning positions after prefix %s', prefix => {
    const body = String.raw`prevent-window-open '${prefix}/foo\.bar/u'`;
    const results = run(body);
    expect(results).toHaveLength(1);
    expect(results[0].message).toContain('backslash');
    expect(body.slice(results[0].startCol, results[0].endCol)).toBe(String.raw`\.`);
  });

  it.each([
    "prevent-window-open '!/ads/gi'",
    "prevent-window-open '!ads'",
    "prevent-window-open '!'",
    "prevent-window-open '!!/[/'",
    "hide-if-contains '!/[/' div",
    String.raw`prevent-window-open '!/foo\\.bar/u'`,
  ])('preserves valid or literal prefix forms: %s', body => {
    expect(run(body)).toEqual([]);
  });

  it('consolidates inverted-pattern diagnostics after decoding in a chain', () => {
    const body = String.raw`hide-if-contains ads div; prevent-window-open '\u0021/foo\(/u'`;
    const results = run(body);
    expect(results).toHaveLength(1);
    expect(results[0].message).toContain('Malformed regex');
    expect(body.slice(results[0].startCol, results[0].endCol)).toBe(String.raw`\u0021/foo\(/u`);
  });

  it.each([
    String.raw`array-override \u0070ush '/ads/' true`,
    String.raw`replace-argument foo.bar \u0030 '' ''`,
    String.raw`event-override click \u0072ewrite '' data /ads/ replacement`,
    String.raw`race \u0073tart; hide-if-contains ads div; race stop`,
    String.raw`race start \u0031; hide-if-contains ads div; race stop`,
  ])('accepts decoded control values: %s', body => {
    expect(run(body)).toEqual([]);
  });

  it('detects encoded forbidden demarcators with a source-accurate range', () => {
    const body = String.raw`hide-if-has-and-matches-style '^^\u0073vg^^' div`;
    const [result] = run(body);
    expect(result.message).toContain('"^^svg^^" is not supported');
    expect(body.slice(result.startCol, result.endCol)).toBe(String.raw`^^\u0073vg^^`);
  });

  it('detects an encoded nested snippet name', () => {
    expect(run(String.raw`hide-if-contains '\u0068ide-if-contains ads div' div`)
      .some(result => result.message.includes('nested'))).toBe(true);
  });

  it('detects calls that become identical after decoding', () => {
    expect(run(String.raw`hide-if-contains ads div; hide-if-contains \u0061ds div`)
      .some(result => result.message.includes('Duplicate snippet call'))).toBe(true);
  });

  it('preserves argument boundaries when decoded values contain NUL', () => {
    const body = String.raw`hide-if-contains 'a\u0000b' c; hide-if-contains a 'b\u0000c'`;
    expect(run(body)).toEqual([]);
    expect(run(String.raw`hide-if-contains 'a\u0000b' c; hide-if-contains 'a\u0000b' c`)
      .filter(result => result.message.includes('Duplicate snippet call'))).toHaveLength(1);
  });

  it.each([
    String.raw`array-override push ads true '' '/foo\.js/\u002c/bar\.js/'`,
    String.raw`timer-override 10 '' '' both '/foo\.js/\u0020/bar\.js/'`,
    String.raw`array-override push ads true '' '/foo\.js/\u002c /foo\.js/'`,
  ])('maps escape warnings through decoded stack separators: %s', body => {
    const results = run(body);
    expect(results).toHaveLength(2);
    for (const result of results) {
      expect(result.message).toContain('backslash');
      expect(body.slice(result.startCol, result.endCol)).toBe(String.raw`\.`);
    }
    expect(results[0].startCol).toBeLessThan(results[1].startCol);
  });

  it('does not reinterpret a doubled escape as an encoded separator', () => {
    const body = String.raw`array-override push ads true '' '/foo\.js/\\u002c/bar\.js/'`;
    expect(run(body)).toHaveLength(2);
  });

  it('checks regexes after decoding the rewrite mode', () => {
    const results = run(String.raw`event-override click \u0072ewrite '' data '/[/'`);
    expect(results).toHaveLength(1);
    expect(results[0].message).toContain('Malformed regex');
  });

  it.each([
    String.raw`hide-if-matches-xpath '/html/body/a[contains(.,"foo\.bar")]/div'`,
    String.raw`log '/foo\.bar/div'`,
    String.raw`unknown-snippet '/foo\.bar/u'`,
    String.raw`freeze-element div '' '/foo\.bar/g'`,
    String.raw`event-override click trusted '' data '/foo\.bar/u'`,
  ])('does not apply regex escape checks to non-regex values: %s', body => {
    const calls = splitSnippetChain(body);
    expect(detectLostRegexEscapes(body, calls, 0)).toEqual([]);
  });

  it('warns about braces that become a quantifier after decoding', () => {
    const results = run(String.raw`hide-if-contains '/foo\{2\}/u' div`);
    expect(results).toHaveLength(2);
    expect(results.every(result => result.message.includes('backslash'))).toBe(true);
    expect(run("hide-if-contains '/foo{2}/u' div")).toEqual([]);
    expect(run(String.raw`hide-if-contains '/foo\\{2\\}/u' div`)).toEqual([]);
    expect(run(String.raw`hide-if-contains '/foo\{bar\}/' div`)).toEqual([]);
    expect(run(String.raw`hide-if-contains '/[\{2\}]/u' div`)).toEqual([]);
  });

  it('emits one diagnostic when losing an escape makes the regex invalid', () => {
    const results = run(String.raw`hide-if-contains '/foo\(/u' div`);
    expect(results).toHaveLength(1);
    expect(results[0].message).toContain('Malformed regex');
  });

  it('checks separate stack patterns without merging commas inside patterns', () => {
    expect(run(String.raw`array-override push '/ads/' true '' '/foo[bar{2,4}/'`)).toEqual([]);
    const body = String.raw`array-override push '/ads/' true '' '/foo\.js/,/bar\.js/'`;
    const results = run(body);
    expect(results).toHaveLength(2);
    for (const result of results) expect(body.slice(result.startCol, result.endCol)).toBe(String.raw`\.`);
  });
});

describe('conditional-hiding selector defaults', () => {
  const cases = [
    ['hide-if-shadow-contains', '/./'],
    ['hide-if-contains', "'Sponsored content'"],
    ['hide-if-contains-and-matches-style', '/Sponsored/'],
    ['hide-if-has-and-matches-style', '.sponsored'],
  ];

  it.each(cases)('%s accepts search with an omitted or explicit selector', (name, search) => {
    for (const selector of ['', ' *', ' .ad']) {
      const [call] = splitSnippetChain(`${name} ${search}${selector}`);
      expect(validateSnippetCall(call, 0)).toEqual([]);
    }
  });

  it.each(cases)('%s still requires search', name => {
    const [call] = splitSnippetChain(name);
    expect(validateSnippetCall(call, 0)).toEqual([
      expect.objectContaining({
        message: `"${name}" requires 1 argument(s) but got 0`,
        severity: 'warning',
      }),
    ]);
  });
});

describe('splitSnippetChain arg parsing', () => {
  it('splits simple args', () => {
    expect(splitSnippetChain('log foo bar baz')[0].args).toEqual(['foo', 'bar', 'baz']);
  });

  it('handles single-quoted strings', () => {
    expect(splitSnippetChain("log 'hello world' foo")[0].args).toEqual(['hello world', 'foo']);
  });

  it('handles escaped quotes', () => {
    expect(splitSnippetChain("log it\\'s")[0].args).toEqual(["it's"]);
  });

  it('treats unquoted /regex with spaces/ as a single arg', () => {
    expect(splitSnippetChain('abort-on-property-read Math /break;case \\$$/')[0].args).toEqual(['Math', '/break;case \\$$/']);
  });

  it('treats regex with multiple spaces as a single arg', () => {
    expect(splitSnippetChain('abort-on-property-read document.createElement /ru-n4p|ua-n4p|загрузка.../')[0].args)
      .toEqual(['document.createElement', '/ru-n4p|ua-n4p|загрузка.../']);
  });

  it('splits args on tab characters', () => {
    expect(splitSnippetChain('log foo\tbar\tbaz')[0].args).toEqual(['foo', 'bar', 'baz']);
  });

  it('does not split on ; inside a tab-delimited regex arg', () => {
    const calls = splitSnippetChain('abort-on-property-read Math\t/break;case/');
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual(['Math', '/break;case/']);
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

  it('warns on debugging snippets (log, trace, debug, profile)', () => {
    for (const name of ['log', 'trace', 'debug', 'profile']) {
      const results = validateSnippetCall({ name, args: [], nameOffset: 0 }, 0);
      expect(results.some(r => r.severity === 'warning' && r.message.includes('live list'))).toBe(true);
    }
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
    expect(splitSnippetChain("ads ''")[0].args).toEqual(['']);
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

describe('hide-if-canvas-contains clearRectBehavior + mode', () => {
  it('accepts the 4-arg data mode form', () => {
    const call = { name: 'hide-if-canvas-contains', args: ['/.{1000}/', 'parent-selector', '', 'data'], nameOffset: 0 };
    expect(validateSnippetCall(call, 0)).toHaveLength(0);
  });

  it('accepts the 3-arg clearRectBehavior form', () => {
    const call = { name: 'hide-if-canvas-contains', args: ['/ad-label/', '.canvas-parent', 'always'], nameOffset: 0 };
    expect(validateSnippetCall(call, 0)).toHaveLength(0);
  });

  it('errors on an invalid mode value', () => {
    const call = { name: 'hide-if-canvas-contains', args: ['/x/', '.p', '', 'bogus'], nameOffset: 0 };
    const results = validateSnippetCall(call, 0);
    expect(results.some(r => r.severity === 'error' && r.message.includes('bogus'))).toBe(true);
  });

  it('parses and accepts the real release-note example end-to-end', () => {
    const calls = splitSnippetChain("hide-if-canvas-contains /.{1000}/ 'parent-selector' '' data");
    expect(calls[0].args).toEqual(['/.{1000}/', 'parent-selector', '', 'data']);
    expect(validateSnippetCall(calls[0], 0)).toHaveLength(0);
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

describe('too-many-args validation', () => {
  it('warns when non-variadic snippet gets extra args', () => {
    // abort-current-inline-script has 2 args; passing 3 should warn
    const call = {
      name: 'abort-current-inline-script',
      args: ['EventTarget.prototype.addEventListener', 'delete', 'window'],
      nameOffset: 0,
    };
    const results = validateSnippetCall(call, 0);
    expect(results.some(r => r.severity === 'warning' && r.message.includes('2'))).toBe(true);
  });

  it('does not warn when variadic snippet gets extra args (skip-video optional params)', () => {
    const call = {
      name: 'skip-video',
      args: ['video.player', './/div[@class="ad"]', '-run-once:true', '-skip-to:10'],
      nameOffset: 0,
    };
    expect(validateSnippetCall(call, 0)).toHaveLength(0);
  });

  it('does not warn when variadic snippet gets extra style params (hide-if-contains-visible-text)', () => {
    const call = {
      name: 'hide-if-contains-visible-text',
      args: ['/Ad/', '.item', '.item .label', 'color:rgb(255,255,255)', '-disable-font-check:true'],
      nameOffset: 0,
    };
    expect(validateSnippetCall(call, 0)).toHaveLength(0);
  });

  it('does not warn when variadic snippet gets optional param (hide-if-svg-contains)', () => {
    const call = {
      name: 'hide-if-svg-contains',
      args: ['/Ad/', '.wrapper', '.wrapper svg', '-position-threshold:500'],
      nameOffset: 0,
    };
    expect(validateSnippetCall(call, 0)).toHaveLength(0);
  });

  it('does not warn when freeze-element gets multiple exceptions (variadic)', () => {
    const call = {
      name: 'freeze-element',
      args: ['.container', '', '.article', '.navigation', '/keep-me/'],
      nameOffset: 0,
    };
    expect(validateSnippetCall(call, 0)).toHaveLength(0);
  });
});

describe('race direction validation', () => {
  it('passes race start', () => {
    expect(validateSnippetCall({ name: 'race', args: ['start'], nameOffset: 0 }, 0)).toHaveLength(0);
  });

  it('passes race stop', () => {
    expect(validateSnippetCall({ name: 'race', args: ['stop'], nameOffset: 0 }, 0)).toHaveLength(0);
  });

  it('passes race start with winners count', () => {
    expect(validateSnippetCall({ name: 'race', args: ['start', '2'], nameOffset: 0 }, 0)).toHaveLength(0);
  });

  it('errors on invalid race direction', () => {
    const results = validateSnippetCall({ name: 'race', args: ['invalid'], nameOffset: 0 }, 0);
    expect(results.some(r => r.severity === 'error' && r.message.includes('invalid'))).toBe(true);
  });

  it('warns on race with no args (missing required direction)', () => {
    const results = validateSnippetCall({ name: 'race', args: [], nameOffset: 0 }, 0);
    expect(results.some(r => r.severity === 'warning')).toBe(true);
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

describe('validateSnippetBody — unclosed quotes', () => {
  it('returns no errors for balanced quotes', () => {
    expect(validateSnippetBody("abort-on-property-read 'foo bar'", 0)).toHaveLength(0);
  });

  it('warns on unclosed single quote', () => {
    const results = validateSnippetBody("abort-on-property-read 'unclosed", 0);
    expect(results.some(r => r.severity === 'warning' && r.message.includes('Unclosed'))).toBe(true);
  });

  it('returns no errors for empty body', () => {
    expect(validateSnippetBody('', 0)).toHaveLength(0);
  });
});

describe('detectMissingSnippetSeparator', () => {
  it('detects missing #$# when snippet name follows domain directly', () => {
    const result = detectMissingSnippetSeparator('example.comlog Hello');
    expect(result).not.toBeNull();
    expect(result!.message).toContain('#$#');
  });

  it('detects missing #$# with wildcard TLD', () => {
    const result = detectMissingSnippetSeparator('example.*log Hello');
    expect(result).not.toBeNull();
  });

  it('does not flag valid network rules', () => {
    expect(detectMissingSnippetSeparator('||ads.example.com^$script')).toBeNull();
  });

  it('does not flag lines with proper #$# separator', () => {
    expect(detectMissingSnippetSeparator('example.com#$#log Hello')).toBeNull();
  });
});

describe('detectMalformedSnippetSeparator', () => {
  it('detects "$#" (missing leading #)', () => {
    const result = detectMalformedSnippetSeparator('example.com$#hide-if-contains arg1 arg2');
    expect(result).not.toBeNull();
    expect(result!.message).toContain('example.com#$#hide-if-contains arg1 arg2');
  });

  it('detects "#$" (missing trailing #)', () => {
    const result = detectMalformedSnippetSeparator('example.com#$hide-if-contains arg1 arg2');
    expect(result).not.toBeNull();
    expect(result!.message).toContain('example.com#$#hide-if-contains arg1 arg2');
  });

  it('fires on shape even when the snippet name is unknown', () => {
    expect(detectMalformedSnippetSeparator('example.com#$totally-misspelled args')).not.toBeNull();
  });

  it('handles comma-separated and wildcard-TLD domains', () => {
    expect(detectMalformedSnippetSeparator('foo.example.com,bar.*$#do-thing x')).not.toBeNull();
  });

  it('does not flag a valid bare-"$" network rule', () => {
    expect(detectMalformedSnippetSeparator('example.com$script')).toBeNull();
  });

  it('does not flag anchored network rules', () => {
    expect(detectMalformedSnippetSeparator('||ads.example.com^$script')).toBeNull();
  });

  it('does not flag a correct #$# separator', () => {
    expect(detectMalformedSnippetSeparator('example.com#$#hide-if-contains arg')).toBeNull();
  });

  it('does not flag a cosmetic rule (no $ in the run)', () => {
    expect(detectMalformedSnippetSeparator('example.com##.ad')).toBeNull();
  });

  it('does not flag a network rule whose pattern ends in "#" before options', () => {
    expect(detectMalformedSnippetSeparator('example.com#$script')).toBeNull();
  });

  it('does not flag a multi-modifier list after "#$"', () => {
    expect(detectMalformedSnippetSeparator('example.com#$third-party,script')).toBeNull();
  });

  it('does not flag a negated modifier after "#$"', () => {
    expect(detectMalformedSnippetSeparator('example.com#$~third-party')).toBeNull();
  });

  it('still flags "#$" + a snippet name that is not a modifier', () => {
    expect(detectMalformedSnippetSeparator('example.com#$debug')).not.toBeNull();
  });

  it('still flags "$#" even when followed by a modifier name', () => {
    expect(detectMalformedSnippetSeparator('example.com$#script')).not.toBeNull();
  });
});

describe('arg offset accuracy', () => {
  it('enum squiggle column is accurate when earlier arg is quoted', () => {
    // 'a b' is 5 source chars but 3 value chars — old code drifted by 2
    // bad-mode starts at position 21 in the body
    const calls = splitSnippetChain("event-override 'a b' bad-mode");
    const results = validateSnippetCall(calls[0], 0);
    const enumErr = results.find(r => r.severity === 'error' && r.message.includes('bad-mode'));
    expect(enumErr).toBeDefined();
    expect(enumErr!.startCol).toBe(21);
    expect(enumErr!.endCol).toBe(29);
  });

  it('demarcator squiggle column is accurate when earlier arg is quoted', () => {
    // 'ad text' is 9 source chars but 7 value chars — old code drifted by 2
    // ^^svg^^ starts at position 47 in the body
    const calls = splitSnippetChain("hide-if-contains-visible-text 'ad text' '.item ^^svg^^ .child'");
    const results = validateSnippetCall(calls[0], 0);
    const demErr = results.find(r => r.severity === 'error' && r.message.includes('^^svg^^'));
    expect(demErr).toBeDefined();
    expect(demErr!.startCol).toBe(47);
    expect(demErr!.endCol).toBe(54);
  });
});

describe('log-if domain exemption predicate', () => {
  it('single log-if snippet is all-passive', () => {
    const calls = splitSnippetChain('log-if-selector-exists .ad');
    expect(calls.length > 0 && calls.every(c => isPassiveSnippet(c.name))).toBe(true);
  });

  it('chained log-if + behavioral snippet is not all-passive', () => {
    const calls = splitSnippetChain('log-if-selector-exists .ad; abort-on-property-read adHandler');
    expect(calls.every(c => isPassiveSnippet(c.name))).toBe(false);
  });

  it('chain of only log-if snippets is all-passive', () => {
    const calls = splitSnippetChain('log-if-selector-exists .ad; log-if-selector-exists .banner');
    expect(calls.length > 0 && calls.every(c => isPassiveSnippet(c.name))).toBe(true);
  });
});

describe('snippetChainRequiresDomain', () => {
  it('requires domain for empty chain', () => {
    expect(snippetChainRequiresDomain([])).toBe(true);
  });

  it('requires domain for behavioral snippet', () => {
    const calls = splitSnippetChain('abort-on-property-read adHandler');
    expect(snippetChainRequiresDomain(calls)).toBe(true);
  });

  it('requires domain for mixed chain (log-if + behavioral)', () => {
    const calls = splitSnippetChain('log-if-selector-exists .ad; abort-on-property-read adHandler');
    expect(snippetChainRequiresDomain(calls)).toBe(true);
  });

  it('does not require domain for single log-if-* snippet', () => {
    const calls = splitSnippetChain('log-if-selector-exists .ad');
    expect(snippetChainRequiresDomain(calls)).toBe(false);
  });

  it('does not require domain for chain of only log-if-* snippets', () => {
    const calls = splitSnippetChain('log-if-selector-exists .ad; log-if-selector-exists .banner');
    expect(snippetChainRequiresDomain(calls)).toBe(false);
  });

  it('does not require domain for race-wrapped log-if chain (ABP monitoring-only rule)', () => {
    const calls = splitSnippetChain('race start; log-if-selector-exists tel1 .ad-slot; log-if-script-loads tel2 /ads/; race stop');
    expect(snippetChainRequiresDomain(calls)).toBe(false);
  });

  it('treats race itself as passive', () => {
    expect(isPassiveSnippet('race')).toBe(true);
  });

  it('still requires domain for race-wrapped behavioral chain', () => {
    const calls = splitSnippetChain('race start; hide-if-contains Ad div; race stop');
    expect(snippetChainRequiresDomain(calls)).toBe(true);
  });
});

describe('race winners validation', () => {
  it('passes race start with valid integer winners', () => {
    expect(validateSnippetCall({ name: 'race', args: ['start', '2'], nameOffset: 0 }, 0)).toHaveLength(0);
  });

  it('errors on non-numeric winners count', () => {
    const results = validateSnippetCall({ name: 'race', args: ['start', 'abc'], nameOffset: 0 }, 0);
    expect(results.some(r => r.severity === 'error' && r.message.includes('positive integer'))).toBe(true);
  });

  it('errors on zero as winners count', () => {
    const results = validateSnippetCall({ name: 'race', args: ['start', '0'], nameOffset: 0 }, 0);
    expect(results.some(r => r.severity === 'error' && r.message.includes('positive integer'))).toBe(true);
  });

  it('does not validate winners on race stop', () => {
    expect(validateSnippetCall({ name: 'race', args: ['stop'], nameOffset: 0 }, 0)).toHaveLength(0);
  });
});

describe('nested snippet call in argument', () => {
  it('warns when an arg is a pasted snippet call', () => {
    const calls = splitSnippetChain(
      `hide-if-matches-xpath 'hide-if-matches-xpath './/div[@class="foo"]/ancestor::li[1]''`
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0]).toBe('hide-if-matches-xpath ');
    const results = validateSnippetCall(calls[0], 0);
    expect(results.some(r => r.severity === 'warning' && r.message.includes('nested "hide-if-matches-xpath"'))).toBe(true);
  });

  it('warns when a call repeats its own name as an argument', () => {
    const call = { name: 'abort-current-inline-script', args: ['abort-current-inline-script'], nameOffset: 0 };
    const results = validateSnippetCall(call, 0);
    expect(results.some(r => r.message.includes('nested "abort-current-inline-script"'))).toBe(true);
  });

  it('warns when a different known snippet is pasted as an argument', () => {
    const call = { name: 'hide-if-contains', args: ['json-prune foo.bar', 'div'], nameOffset: 0 };
    const results = validateSnippetCall(call, 0);
    expect(results.some(r => r.message.includes('nested "json-prune"'))).toBe(true);
  });

  it('warns when a deprecated snippet name is pasted as an argument', () => {
    const call = { name: 'hide-if-contains', args: ['simulate-event-poc click', 'div'], nameOffset: 0 };
    const results = validateSnippetCall(call, 0);
    expect(results.some(r => r.message.includes('nested "simulate-event-poc"'))).toBe(true);
  });

  it('does not warn on short non-hyphen names in text args', () => {
    const call = { name: 'hide-if-contains', args: ['log in', 'div'], nameOffset: 0 };
    expect(validateSnippetCall(call, 0)).toHaveLength(0);
  });

  it('does not warn when the name is not at the start of the arg', () => {
    const call = { name: 'hide-if-contains', args: ['my hide-if-contains note', 'div'], nameOffset: 0 };
    expect(validateSnippetCall(call, 0)).toHaveLength(0);
  });

  it('does not warn when the name is a prefix of a longer word', () => {
    const call = { name: 'hide-if-contains', args: ['json-pruner', 'div'], nameOffset: 0 };
    expect(validateSnippetCall(call, 0)).toHaveLength(0);
  });

  it('does not flag free-text args of debugging snippets', () => {
    const results = validateSnippetCall({ name: 'log', args: ['json-prune', 'failed'], nameOffset: 0 }, 0);
    expect(results.some(r => r.message.includes('nested'))).toBe(false);
    expect(results.some(r => r.message.includes('live list'))).toBe(true);
  });
});

describe('validateSnippetBody — misplaced quotes', () => {
  it('warns twice on a nested-call quoting mangle', () => {
    const results = validateSnippetBody(
      `hide-if-matches-xpath 'hide-if-matches-xpath './/div[@class="foo"]/ancestor::li[1]''`, 0
    );
    const midToken = results.filter(r => r.message.includes('middle of an argument'));
    expect(midToken).toHaveLength(2);
    expect(results.some(r => r.message.includes('Unclosed'))).toBe(false);
  });

  it('does not warn on clean quoting', () => {
    expect(validateSnippetBody("hide-if-contains 'some text' div", 0)).toHaveLength(0);
  });

  it("does not warn on standalone '' empty arg", () => {
    expect(validateSnippetBody("override-property-read foo ''", 0)).toHaveLength(0);
  });

  it('does not warn on quotes adjacent to semicolons', () => {
    expect(validateSnippetBody("abort-current-inline-script doc 'break;case'; log 'x'", 0)).toHaveLength(0);
  });

  it('ignores escaped quotes', () => {
    expect(validateSnippetBody("log it\\'s fine", 0)).toHaveLength(0);
  });

  it('ignores quotes inside regex args (no false unclosed warning)', () => {
    expect(validateSnippetBody("hide-if-contains /don't/ div", 0)).toHaveLength(0);
  });

  it('ignores quotes inside tab-delimited regex args', () => {
    expect(validateSnippetBody("hide-if-contains\t/don't/\tdiv", 0)).toHaveLength(0);
  });

  it('warns when an opening quote follows an escaped space', () => {
    const results = validateSnippetBody("log foo\\ 'bar'", 0);
    expect(results.filter(r => r.message.includes('middle of an argument'))).toHaveLength(1);
  });

  it('does not warn on escaped spaces without quotes', () => {
    expect(validateSnippetBody('log foo\\ bar', 0)).toHaveLength(0);
  });
});

describe('detectDuplicateCalls', () => {
  it('warns on identical call repeated in one chain', () => {
    const calls = splitSnippetChain('json-prune foo.bar; json-prune foo.bar');
    const results = detectDuplicateCalls(calls, 0);
    expect(results).toHaveLength(1);
    expect(results[0].severity).toBe('warning');
    expect(results[0].message).toContain('json-prune');
  });

  it('does not warn on same snippet with different args', () => {
    const calls = splitSnippetChain("hide-if-matches-xpath './/a'; hide-if-matches-xpath './/b'");
    expect(detectDuplicateCalls(calls, 0)).toHaveLength(0);
  });

  it('never flags race start/stop pairs', () => {
    const calls = splitSnippetChain('race start; log a; race stop; race start; log b; race stop');
    expect(detectDuplicateCalls(calls, 0)).toHaveLength(0);
  });

  it('does not conflate arg boundaries when keying', () => {
    const calls = splitSnippetChain("log 'a b'; log a b");
    expect(detectDuplicateCalls(calls, 0)).toHaveLength(0);
  });
});

describe('numeric arg constraint (replace-argument argPosition)', () => {
  it('accepts a non-negative integer argPosition', () => {
    const call = { name: 'replace-argument', args: ['Element.prototype.setAttribute', '1'], nameOffset: 0 };
    expect(validateSnippetCall(call, 0)).toHaveLength(0);
  });

  it('accepts the full five-argument form', () => {
    const calls = splitSnippetChain("replace-argument Element.prototype.setAttribute 1 '/.+(x-param).+/' '' needle.js");
    expect(validateSnippetCall(calls[0], 0)).toHaveLength(0);
  });

  it('errors on non-numeric argPosition', () => {
    const call = { name: 'replace-argument', args: ['foo.bar', 'baz'], nameOffset: 0 };
    const results = validateSnippetCall(call, 0);
    expect(results.some(r => r.severity === 'error' && r.message.includes('non-negative integer'))).toBe(true);
  });

  it('errors on negative argPosition', () => {
    const call = { name: 'replace-argument', args: ['foo.bar', '-1'], nameOffset: 0 };
    const results = validateSnippetCall(call, 0);
    expect(results.some(r => r.severity === 'error' && r.message.includes('non-negative integer'))).toBe(true);
  });

  it('squiggle covers the offending arg when offsets are present', () => {
    const body = 'replace-argument foo.bar baz';
    const calls = splitSnippetChain(body);
    const results = validateSnippetCall(calls[0], 0);
    const err = results.find(r => r.message.includes('non-negative integer'));
    expect(err).toBeDefined();
    expect(err!.startCol).toBe(body.indexOf('baz'));
    expect(err!.endCol).toBe(body.indexOf('baz') + 3);
  });
});

describe('detectUnquotedRegexBreaks', () => {
  const run = (body: string) => detectUnquotedRegexBreaks(body, splitSnippetChain(body), 0);

  it('warns on unquoted regex containing a space', () => {
    const body = 'hide-if-contains /Sponsored by/ div';
    const results = run(body);
    expect(results).toHaveLength(1);
    expect(results[0].severity).toBe('warning');
    expect(results[0].startCol).toBe(body.indexOf('/Sponsored'));
    expect(results[0].endCol).toBe(body.indexOf('by/') + 3);
  });

  it('does not warn when the regex is quoted', () => {
    expect(run("hide-if-contains '/Sponsored by/' div")).toHaveLength(0);
  });

  it('does not warn when the space is escaped', () => {
    expect(run('hide-if-contains /Sponsored\\ by/ div')).toHaveLength(0);
  });

  it('does not warn on a spaceless regex', () => {
    expect(run('hide-if-contains /Sponsored/ div')).toHaveLength(0);
  });

  it('does not warn when the slash arg has no internal space (xpath split matches ABP)', () => {
    expect(run('hide-if-matches-xpath /foo/bar baz')).toHaveLength(0);
  });

  it('warns once per offending arg across a chain', () => {
    const results = run('hide-if-contains /a b/ div; hide-if-contains /c d/ span');
    expect(results).toHaveLength(2);
  });

  it('does not warn on ordinary quoted args with spaces', () => {
    expect(run("hide-if-contains 'Sponsored by' div")).toHaveLength(0);
  });
});

describe('detectUnquotedRegexBreaks: unquoted ";" inside slash args', () => {
  const run = (body: string) => detectUnquotedRegexBreaks(body, splitSnippetChain(body), 0);

  it('warns on unquoted regex containing ";" even without spaces', () => {
    const results = run('abort-current-inline-script Math /break;case/');
    expect(results).toHaveLength(1);
    expect(results[0].message).toContain('";"');
  });

  it('prefers the ";" message when both ";" and spaces are present', () => {
    const results = run('abort-current-inline-script Math /break;case \$/');
    expect(results).toHaveLength(1);
    expect(results[0].message).toContain('";"');
  });

  it('does not warn when the regex is quoted', () => {
    expect(run("abort-current-inline-script Math '/break;case/'")).toHaveLength(0);
  });

  it('does not warn when the ";" is escaped', () => {
    expect(run('abort-current-inline-script Math /break\\;case/')).toHaveLength(0);
  });
});

describe('log-if-* deprecations (@eyeo/snippets v2.10.0)', () => {
  it.each(['log-if-script-loads', 'log-if-iframe-loads', 'log-if-anchor-href-matches'])(
    'warns that %s is deprecated in favour of log-if-element-loads',
    name => {
      const results = validateSnippetCall({ name, args: ['/ads/', 'tel1'], nameOffset: 0 }, 0);
      expect(results.some(r => r.severity === 'warning' && r.message.includes('log-if-element-loads'))).toBe(true);
    }
  );

  it('does not warn on the log-if-element-loads replacement', () => {
    const call = { name: 'log-if-element-loads', args: ['/ads/', 'tel1'], nameOffset: 0 };
    expect(validateSnippetCall(call, 0)).toHaveLength(0);
  });

  it('deprecated log-if-* still count as passive for the domain gate', () => {
    expect(isPassiveSnippet('log-if-script-loads')).toBe(true);
  });
});

describe('detectLostRegexEscapes', () => {
  const run = (body: string) => detectLostRegexEscapes(body, splitSnippetChain(body), 0);

  it.each(['g', 'm', 's', 'u', 'y', 'd', 'gi', 'gimsuy', 'v'])(
    'detects lost escapes with v2.16.0 regex flags %s', flags => {
      for (const arg of [`/foo\\.bar/${flags}`, `'/foo\\.bar/${flags}'`]) {
        const body = `hide-if-contains ${arg} div`;
        const results = run(body);
        expect(results).toHaveLength(1);
        expect(body.slice(results[0].startCol, results[0].endCol)).toBe('\\.');
      }
    }
  );

  it('uses the last slash to locate flags', () => {
    expect(run("hide-if-contains '/path/to/foo\\.js/gi' div")).toHaveLength(1);
  });

  it.each(['z', 'gg', 'uv'])('ignores literal fallback with invalid flags %s', flags => {
    expect(run(`hide-if-contains '/foo\\.bar/${flags}' div`)).toHaveLength(0);
  });

  it('does not flag doubled escapes with combined flags', () => {
    expect(run("hide-if-contains '/foo\\\\.bar/gim' div")).toHaveLength(0);
  });

  it('leaves invalid decoded patterns to the malformed-regex diagnostic', () => {
    expect(run("hide-if-contains '/foo\\(/u' div")).toHaveLength(0);
  });

  it('flags \\s and \\S inside a character class', () => {
    const results = run('hide-if-contains /[\\s\\S]*/');
    expect(results).toHaveLength(2);
    expect(results.every(r => r.severity === 'warning')).toBe(true);
  });

  it('flags each \\. at its own column', () => {
    const results = run('hide-if-contains /foo\\.bar\\.js/');
    expect(results).toHaveLength(2);
    expect(results[0].startCol).toBe(21);
    expect(results[1].startCol).toBe(26);
  });

  it('flags \\. but not \\/ in the same arg', () => {
    const results = run('hide-if-contains /\\/pop\\.js/');
    expect(results).toHaveLength(1);
    expect(results[0].message).toContain('.');
  });

  it('finds the offset inside the second call of a chain', () => {
    const results = run('log a; hide-if-contains /x\\.y/ sel');
    expect(results).toHaveLength(1);
    const body = 'log a; hide-if-contains /x\\.y/ sel';
    expect(body.slice(results[0].startCol, results[0].endCol)).toBe('\\.');
  });

  it('does not flag an already-doubled backslash', () => {
    expect(run('hide-if-contains /loader\\\\.min\\\\.js/')).toHaveLength(0);
    expect(run('hide-if-contains /[\\\\s\\\\S]*/')).toHaveLength(0);
  });

  it('does not flag recognized escapes', () => {
    expect(run('hide-if-contains /\\n\\r\\t\\\\/')).toHaveLength(0);
  });

  it('flags a regex-looking arg inside quotes too — quoting does not protect escapes', () => {
    const results = run("hide-if-contains '/foo\\.bar/'");
    expect(results).toHaveLength(1);
  });

  it('does not flag a quoted arg that merely starts with "/" but is not regex-shaped', () => {
    expect(run("hide-if-contains '/foo\\.bar'")).toHaveLength(0);
  });

  it('does not crash on a trailing lone backslash', () => {
    expect(() => run('hide-if-contains /foo\\')).not.toThrow();
  });
});

describe('schema drift fixes — previously flagged, now clean', () => {
  it('allows event-override rewrite mode with property/pattern/replacement', () => {
    const calls = splitSnippetChain('event-override message rewrite /_as_res/ data /_as_req$/ _as_res');
    expect(validateSnippetCall(calls[0], 0)).toHaveLength(0);
  });

  it('allows event-override rewrite mode (second example)', () => {
    const calls = splitSnippetChain('event-override click rewrite /h/ data /x/ y');
    expect(validateSnippetCall(calls[0], 0)).toHaveLength(0);
  });

  it('allows hide-if-contains-similar-text with ignoreChars and maxSearches', () => {
    const calls = splitSnippetChain("hide-if-contains-similar-text Sponsored .ad-box '' 2 5");
    expect(validateSnippetCall(calls[0], 0)).toHaveLength(0);
  });

  it('drops debug to exactly the debugging-snippet warning', () => {
    const calls = splitSnippetChain('debug /adshield/');
    const results = validateSnippetCall(calls[0], 0);
    expect(results).toHaveLength(1);
    expect(results[0].severity).toBe('warning');
    expect(results[0].message).toContain('live list');
  });
});

describe('event-override rewrite-mode requirements', () => {
  it('errors when rewrite mode is missing property and pattern', () => {
    const calls = splitSnippetChain('event-override click rewrite');
    const results = validateSnippetCall(calls[0], 0);
    expect(results.some(r => r.severity === 'error' && r.message.includes('requires'))).toBe(true);
  });

  it('errors when rewrite mode has blank property and pattern (truthiness, not arg count)', () => {
    const calls = splitSnippetChain("event-override click rewrite '' '' ''");
    const results = validateSnippetCall(calls[0], 0);
    expect(results.some(r => r.severity === 'error' && r.message.includes('requires'))).toBe(true);
  });

  it('allows a blank needle as long as property and pattern are present', () => {
    const calls = splitSnippetChain("event-override click rewrite '' data /x/");
    const results = validateSnippetCall(calls[0], 0);
    expect(results.some(r => r.severity === 'error')).toBe(false);
  });

  it('warns when trusted mode gets more than 3 arguments', () => {
    const calls = splitSnippetChain('event-override click trusted a b c d');
    const results = validateSnippetCall(calls[0], 0);
    expect(results.some(r => r.severity === 'warning' && r.message.includes('accepts at most 3'))).toBe(true);
  });
});

describe('schema drift fixes — previously clean, now newly flagged', () => {
  it('errors on invalid replace-fetch-request mode', () => {
    const calls = splitSnippetChain("replace-fetch-request 'jsonpath($.tags)' x '' apppend");
    const results = validateSnippetCall(calls[0], 0);
    expect(results.some(r => r.severity === 'error' && r.message.includes('apppend'))).toBe(true);
  });

  it('errors on invalid prevent-window-open decoy', () => {
    const calls = splitSnippetChain('prevent-window-open /popunder/ 2000 nosuchdecoy');
    const results = validateSnippetCall(calls[0], 0);
    expect(results.some(r => r.severity === 'error' && r.message.includes('nosuchdecoy'))).toBe(true);
  });

  it('errors on case-mismatched prevent-window-open decoy', () => {
    const calls = splitSnippetChain('prevent-window-open /popunder/ 2000 IFRAME');
    const results = validateSnippetCall(calls[0], 0);
    expect(results.some(r => r.severity === 'error' && r.message.includes('IFRAME'))).toBe(true);
  });
});

describe('schema drift fixes — regression guards', () => {
  it('allows event-override trusted mode with no needle', () => {
    const calls = splitSnippetChain('event-override click trusted');
    expect(validateSnippetCall(calls[0], 0)).toHaveLength(0);
  });

  it('allows event-override disable mode with needle', () => {
    const calls = splitSnippetChain('event-override visibilitychange disable /adHandler/');
    expect(validateSnippetCall(calls[0], 0)).toHaveLength(0);
  });

  it('allows prevent-window-open with decoy obj', () => {
    const calls = splitSnippetChain('prevent-window-open /popunder/ 2000 obj');
    expect(validateSnippetCall(calls[0], 0)).toHaveLength(0);
  });

  it('allows prevent-window-open with only a pattern', () => {
    const calls = splitSnippetChain('prevent-window-open /./');
    expect(validateSnippetCall(calls[0], 0)).toHaveLength(0);
  });

  it('allows replace-fetch-request with mode append', () => {
    const calls = splitSnippetChain("replace-fetch-request 'jsonpath($.tags)' '\"blocked\"' '' append");
    expect(validateSnippetCall(calls[0], 0)).toHaveLength(0);
  });

  it('allows hide-if-canvas-contains with mode data (unrelated snippet, sanity check)', () => {
    const calls = splitSnippetChain("hide-if-canvas-contains /iVBOR/ '#ad' '' data");
    expect(validateSnippetCall(calls[0], 0)).toHaveLength(0);
  });
});
