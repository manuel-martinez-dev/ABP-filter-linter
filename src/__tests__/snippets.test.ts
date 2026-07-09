import { describe, it, expect } from 'vitest';
import { splitSnippetChain, validateSnippetCall, validateSnippetChain, validateSnippetBody, detectDuplicateCalls, detectMissingSnippetSeparator, detectMalformedSnippetSeparator, isPassiveSnippet, snippetChainRequiresDomain } from '../validators/snippets';

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
    const result = detectMalformedSnippetSeparator('example.com$#some-snippet arg1 arg2');
    expect(result).not.toBeNull();
    expect(result!.message).toContain('example.com#$#some-snippet arg1 arg2');
  });

  it('detects "#$" (missing trailing #)', () => {
    const result = detectMalformedSnippetSeparator('example.com#$some-snippet arg1 arg2');
    expect(result).not.toBeNull();
    expect(result!.message).toContain('example.com#$#some-snippet arg1 arg2');
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
    expect(detectMalformedSnippetSeparator('example.com#$#some-snippet arg')).toBeNull();
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
