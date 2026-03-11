import { describe, it, expect } from 'vitest';
import { splitSnippetChain, validateSnippetCall, validateSnippetChain, parseSnippetArgs, validateSnippetBody, detectMissingSnippetSeparator } from '../validators/snippets';

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

  it('treats unquoted /regex with spaces/ as a single arg', () => {
    expect(parseSnippetArgs('Math /break;case \\$/')).toEqual(['Math', '/break;case \\$/']);
  });

  it('treats regex with multiple spaces as a single arg', () => {
    expect(parseSnippetArgs('document.createElement /ru-n4p|ua-n4p|загрузка.../')).toEqual(['document.createElement', '/ru-n4p|ua-n4p|загрузка.../']);
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
