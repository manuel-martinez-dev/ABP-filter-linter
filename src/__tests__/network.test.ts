import { describe, it, expect } from 'vitest';
import { validateNetworkRule, findOptionsSeparator } from '../validators/network';

describe('validateNetworkRule', () => {
  it('returns no errors for valid rule with no modifiers', () => {
    expect(validateNetworkRule('||ads.example.com^', false, 0)).toHaveLength(0);
  });

  it('returns no errors for valid content-type modifier', () => {
    expect(validateNetworkRule('||ads.example.com^$script', false, 0)).toHaveLength(0);
  });

  it('returns no errors for multiple valid modifiers', () => {
    expect(validateNetworkRule('||ads.example.com^$script,image', false, 0)).toHaveLength(0);
  });

  it('errors on unknown modifier', () => {
    const results = validateNetworkRule('||ads.example.com^$badmod', false, 0);
    expect(results).toHaveLength(1);
    expect(results[0].severity).toBe('error');
    expect(results[0].message).toContain('badmod');
  });

  it('errors on exception-only modifier on non-exception rule', () => {
    const results = validateNetworkRule('||ads.example.com^$elemhide', false, 0);
    expect(results[0].severity).toBe('error');
    expect(results[0].message).toContain('elemhide');
  });

  it('allows exception-only modifier on exception rule', () => {
    expect(validateNetworkRule('||ads.example.com^$elemhide', true, 0)).toHaveLength(0);
  });

  it('errors on rewrite without value', () => {
    const results = validateNetworkRule('||ads.example.com^$rewrite', false, 0);
    expect(results[0].severity).toBe('error');
    expect(results[0].message).toContain('rewrite');
  });

  it('errors on rewrite with wrong prefix', () => {
    const results = validateNetworkRule('||ads.example.com^$rewrite=wrong-value', false, 0);
    expect(results[0].severity).toBe('error');
    expect(results[0].message).toContain('abp-resource:');
  });

  it('accepts valid rewrite value', () => {
    expect(validateNetworkRule('||ads.example.com^$rewrite=abp-resource:blank-mp3,~third-party', false, 0)).toHaveLength(0);
  });

  it('errors on $header without value', () => {
    const results = validateNetworkRule('||ads.example.com^$header', false, 0);
    expect(results.some(r => r.severity === 'error' && r.message.includes('header'))).toBe(true);
  });

  it('accepts $header with value (MV3 warning only)', () => {
    const results = validateNetworkRule('||ads.example.com^$header=X-Frame-Options', false, 0);
    expect(results).toHaveLength(1);
    expect(results[0].severity).toBe('warning');
    expect(results[0].message).toContain('MV3');
  });

  it('errors on $addheader without value', () => {
    const results = validateNetworkRule('||ads.example.com^$addheader', false, 0);
    expect(results[0].severity).toBe('error');
    expect(results[0].message).toContain('addheader');
  });

  it('errors on $document on a blocking rule', () => {
    const results = validateNetworkRule('||ads.example.com^$document', false, 0);
    expect(results.some(r => r.severity === 'error' && r.message.includes('document'))).toBe(true);
  });

  it('errors on $document combined with content-type modifier', () => {
    const results = validateNetworkRule('||ads.example.com^$document,script', false, 0);
    expect(results.some(r => r.message.includes('document') && r.message.includes('script'))).toBe(true);
  });

  it('errors on $document combined with image', () => {
    const results = validateNetworkRule('||ads.example.com^$document,image', false, 0);
    expect(results.some(r => r.message.includes('document') && r.message.includes('image'))).toBe(true);
  });

  it('allows $document combined with content-type modifier on exception rules', () => {
    expect(validateNetworkRule('@@||example.com^$document,script', true, 0)).toHaveLength(0);
  });

  it('allows $document combined with image on exception rules', () => {
    expect(validateNetworkRule('@@||example.com^$document,image', true, 0)).toHaveLength(0);
  });

  it('warns on comma-separated domains in domain= value', () => {
    const results = validateNetworkRule('||ads.example.com^$domain=foo.com,bar.com', false, 0);
    expect(results.some(r => r.severity === 'warning' && r.message.includes('|'))).toBe(true);
  });

  it('does not warn on valid domain= with pipe separator', () => {
    expect(validateNetworkRule('||ads.example.com^$domain=foo.com|bar.com', false, 0)).toHaveLength(0);
  });

  it('does not misidentify domain=foo.com,script as domain separator issue', () => {
    const results = validateNetworkRule('||ads.example.com^$domain=foo.com,script', false, 0);
    expect(results.every(r => !r.message.includes('|'))).toBe(true);
  });

  it('allows inverted modifier ~third-party', () => {
    expect(validateNetworkRule('||ads.example.com^$~third-party', false, 0)).toHaveLength(0);
  });

  it('accepts $webrtc modifier', () => {
    expect(validateNetworkRule('||ads.example.com^$webrtc', false, 0)).toHaveLength(0);
  });

  it('accepts $webbundle modifier', () => {
    expect(validateNetworkRule('||ads.example.com^$webbundle', false, 0)).toHaveLength(0);
  });

  it('warns on deprecated $collapse modifier', () => {
    const results = validateNetworkRule('||ads.example.com^$collapse', false, 0);
    expect(results).toHaveLength(1);
    expect(results[0].severity).toBe('warning');
    expect(results[0].message).toContain('collapse');
  });

  it('errors on double pipe in domain= value', () => {
    const results = validateNetworkRule('/rule$xmlhttprequest,domain=actvid.rs||myflixerzz.tube|videostr.net', false, 0);
    expect(results.some(r => r.severity === 'error' && r.message.includes('empty entry'))).toBe(true);
  });

  it('errors on leading pipe in domain= value', () => {
    const results = validateNetworkRule('||ads.example.com^$domain=|foo.com', false, 0);
    expect(results.some(r => r.severity === 'error' && r.message.includes('empty entry'))).toBe(true);
  });

  it('errors on trailing pipe in domain= value', () => {
    const results = validateNetworkRule('||ads.example.com^$domain=foo.com|', false, 0);
    expect(results.some(r => r.severity === 'error' && r.message.includes('empty entry'))).toBe(true);
  });

  it('does not flag $ anchor in regex filters', () => {
    expect(validateNetworkRule('/ads$/', false, 0)).toHaveLength(0);
    expect(validateNetworkRule('/banner\\d+$/', false, 0)).toHaveLength(0);
  });

  it('treats trailing bare $ as pattern text', () => {
    expect(validateNetworkRule('||example.com/path$', false, 0)).toHaveLength(0);
  });

  it('accepts header value containing = (MV3 warning only)', () => {
    const results = validateNetworkRule('||ads.example.com^$header=X-Frame-Options=deny', false, 0);
    expect(results.filter(r => r.severity === 'error')).toHaveLength(0);
    expect(results).toHaveLength(1);
    expect(results[0].message).toContain('MV3');
  });

  it('reports correct range for modifier after a spaced comma', () => {
    const results = validateNetworkRule('||x.com^$foo, bar', false, 0);
    expect(results).toHaveLength(2);
    expect(results[1].message).toContain('bar');
    expect(results[1].startCol).toBe(14);
    expect(results[1].endCol).toBe(17);
  });

});

describe('domain= entry shape', () => {
  it('errors on doubled domain= key inside the value', () => {
    const results = validateNetworkRule('||ads.example.com^$domain=domain=foo.com|bar.com', false, 0);
    expect(results).toHaveLength(1);
    expect(results[0].severity).toBe('error');
    expect(results[0].message).toContain('domain=foo.com');
    expect(results[0].message).toContain('not a valid domain');
  });

  it('reports the range of the bad entry, not the whole modifier', () => {
    // body: ||ads.example.com^$domain=domain=foo.com|bar.com — value starts at col 26
    const results = validateNetworkRule('||ads.example.com^$domain=domain=foo.com|bar.com', false, 0);
    expect(results[0].startCol).toBe(26);
    expect(results[0].endCol).toBe(40);
  });

  it('accepts valid entries including negation', () => {
    expect(validateNetworkRule('||ads.example.com^$domain=foo.com|~bar.example.net', false, 0)).toHaveLength(0);
  });

  it('accepts single-label and IP-style entries', () => {
    expect(validateNetworkRule('||ads.example.com^$domain=localhost|192.168.1.1', false, 0)).toHaveLength(0);
  });

  it('accepts punycode entries', () => {
    expect(validateNetworkRule('||ads.example.com^$domain=xn--exmple-cua.com', false, 0)).toHaveLength(0);
  });

  it('errors on wildcard TLD in network domain=', () => {
    const results = validateNetworkRule('||ads.example.com^$domain=foo.*', false, 0);
    expect(results).toHaveLength(1);
    expect(results[0].severity).toBe('error');
    expect(results[0].message).toContain('MV3');
  });

  it('errors on negated wildcard TLD entry', () => {
    const results = validateNetworkRule('||ads.example.com^$domain=foo.com|~bar.*', false, 0);
    expect(results.some(r => r.severity === 'error' && r.message.includes('MV3'))).toBe(true);
  });

  it('errors on malformed wildcard: not last char', () => {
    const results = validateNetworkRule('||ads.example.com^$domain=foo.*.com', false, 0);
    expect(results.some(r => r.severity === 'error' && r.message.includes('Invalid wildcard'))).toBe(true);
  });

  it('errors on malformed wildcard: not preceded by dot', () => {
    const results = validateNetworkRule('||ads.example.com^$domain=foo*', false, 0);
    expect(results.some(r => r.message.includes('Invalid wildcard'))).toBe(true);
  });

  it('errors on malformed wildcard: multiple asterisks', () => {
    const results = validateNetworkRule('||ads.example.com^$domain=f*o.*', false, 0);
    expect(results.some(r => r.message.includes('Invalid wildcard'))).toBe(true);
  });

  it('errors on "?" in a domain entry', () => {
    const results = validateNetworkRule('||ads.example.com^$domain=fo?o.com', false, 0);
    expect(results.some(r => r.severity === 'error' && r.message.includes('"?"'))).toBe(true);
  });

  it('validates entries in negated ~domain= like plain domain=', () => {
    const results = validateNetworkRule('||ads.example.com^$~domain=domain=foo.com|bar.com', false, 0);
    expect(results.some(r => r.message.includes('not a valid domain'))).toBe(true);
  });

  it('matches modifier names case-insensitively', () => {
    expect(validateNetworkRule('||ads.example.com^$Script,Domain=foo.com', false, 0)).toHaveLength(0);
    const results = validateNetworkRule('||ads.example.com^$Domain=domain=foo.com', false, 0);
    expect(results.some(r => r.message.includes('not a valid domain'))).toBe(true);
  });

  it('errors on non-ASCII domain entry', () => {
    const results = validateNetworkRule('||ads.example.com^$domain=exämple.com', false, 0);
    expect(results.some(r => r.severity === 'error' && r.message.includes('punycode'))).toBe(true);
  });

  it('reports each bad entry separately', () => {
    const results = validateNetworkRule('||ads.example.com^$domain=a=b.com|c.com|d=e.net', false, 0);
    expect(results.filter(r => r.message.includes('not a valid domain'))).toHaveLength(2);
  });

  it('reports empty entry once alongside shape errors on other entries', () => {
    const results = validateNetworkRule('||ads.example.com^$domain=foo.com||bad=entry.com', false, 0);
    expect(results.filter(r => r.message.includes('empty entry'))).toHaveLength(1);
    expect(results.filter(r => r.message.includes('not a valid domain'))).toHaveLength(1);
  });
});

describe('rewrite validation', () => {
  it('errors on unknown rewrite resource', () => {
    const results = validateNetworkRule('||example.com/ad.js$rewrite=abp-resource:blank-javascript,domain=foo.com', false, 0);
    expect(results).toHaveLength(1);
    expect(results[0].severity).toBe('error');
    expect(results[0].message).toContain('blank-javascript');
  });

  it('accepts all known rewrite resources', () => {
    for (const name of ['blank-text', 'blank-css', 'blank-js', 'blank-html', 'blank-mp3', 'blank-mp4', '1x1-transparent-gif', '2x2-transparent-png', '3x2-transparent-png', '32x32-transparent-png']) {
      expect(validateNetworkRule(`||example.com/x$rewrite=abp-resource:${name},domain=foo.com`, false, 0)).toHaveLength(0);
    }
  });

  it('errors on || pattern without domain= or ~third-party', () => {
    const results = validateNetworkRule('||example.com/ad.js$rewrite=abp-resource:blank-js', false, 0);
    expect(results).toHaveLength(1);
    expect(results[0].severity).toBe('error');
    expect(results[0].message).toContain('rewrite');
  });

  it('accepts || pattern with ~third-party', () => {
    expect(validateNetworkRule('||example.com/ad.js$rewrite=abp-resource:blank-js,~third-party', false, 0)).toHaveLength(0);
  });

  it('errors on * pattern with only third-party (no domain=)', () => {
    const results = validateNetworkRule('*ad.js$rewrite=abp-resource:blank-js,third-party', false, 0);
    expect(results.some(r => r.severity === 'error' && r.message.includes('rewrite'))).toBe(true);
  });

  it('accepts * pattern with domain=', () => {
    expect(validateNetworkRule('*ad.js$rewrite=abp-resource:blank-js,domain=foo.com', false, 0)).toHaveLength(0);
  });

  it('errors on pattern starting with neither || nor *', () => {
    const results = validateNetworkRule('example.com/ad.js$rewrite=abp-resource:blank-js,domain=foo.com', false, 0);
    expect(results.some(r => r.severity === 'error' && r.message.includes('rewrite'))).toBe(true);
  });

  it('skips structural check on exception rules', () => {
    expect(validateNetworkRule('||example.com/ad.js$rewrite=abp-resource:blank-js', true, 0)).toHaveLength(0);
  });

  it('validates ~rewrite= like plain rewrite=', () => {
    const results = validateNetworkRule('||example.com/x$~rewrite=abp-resource:bogus,domain=foo.com', false, 0);
    expect(results.some(r => r.message.includes('bogus'))).toBe(true);
  });

  it('applies structural check to ~rewrite=', () => {
    const results = validateNetworkRule('||example.com/x$~rewrite=abp-resource:blank-js', false, 0);
    expect(results.some(r => r.message.includes('rewrite'))).toBe(true);
  });
});

describe('csp validation', () => {
  it('accepts a normal csp value', () => {
    expect(validateNetworkRule("||example.com^$csp=script-src 'none'", false, 0)).toHaveLength(0);
  });

  it('errors on forbidden directive at value start', () => {
    const results = validateNetworkRule('||example.com^$csp=report-uri https://example.net', false, 0);
    expect(results).toHaveLength(1);
    expect(results[0].severity).toBe('error');
    expect(results[0].message).toContain('report-uri');
  });

  it('errors on forbidden directive after semicolon', () => {
    const results = validateNetworkRule("||example.com^$csp=script-src 'none'; base-uri 'self'", false, 0);
    expect(results.some(r => r.message.includes('base-uri'))).toBe(true);
  });

  it('errors on upgrade-insecure-requests', () => {
    const results = validateNetworkRule('||example.com^$csp=upgrade-insecure-requests', false, 0);
    expect(results.some(r => r.message.includes('upgrade-insecure-requests'))).toBe(true);
  });

  it('allows valueless csp on exception rules', () => {
    expect(validateNetworkRule('||example.com^$csp', true, 0)).toHaveLength(0);
  });

  it('still errors on valueless csp on blocking rules', () => {
    const results = validateNetworkRule('||example.com^$csp', false, 0);
    expect(results.some(r => r.severity === 'error' && r.message.includes('csp'))).toBe(true);
  });

  it('does not check directives on exception rules', () => {
    expect(validateNetworkRule("||example.com^$csp=base-uri 'self'", true, 0)).toHaveLength(0);
  });
});

describe('header validation', () => {
  it('allows valueless header on exception rules (MV3 warning only)', () => {
    const results = validateNetworkRule('||example.com^$header', true, 0);
    expect(results.filter(r => r.severity === 'error')).toHaveLength(0);
    expect(results.some(r => r.message.includes('MV3'))).toBe(true);
  });

  it('errors on regex header value', () => {
    const results = validateNetworkRule('||example.com^$header=x-tag=/ads?/', false, 0);
    expect(results.some(r => r.severity === 'error' && r.message.includes('reserved'))).toBe(true);
  });

  it('errors on empty header name', () => {
    const results = validateNetworkRule('||example.com^$header==deny', false, 0);
    expect(results.some(r => r.severity === 'error' && r.message.includes('empty'))).toBe(true);
  });

  it('accepts name-only form with trailing =', () => {
    const results = validateNetworkRule('||example.com^$header=x-tag=', false, 0);
    expect(results.filter(r => r.severity === 'error')).toHaveLength(0);
  });
});

describe('addheader validation', () => {
  it('errors on addheader on exception rules', () => {
    const results = validateNetworkRule('||example.com^$addheader=x-test:1', true, 0);
    expect(results.some(r => r.severity === 'error' && r.message.includes('blocking'))).toBe(true);
  });

  it('emits a single error for valueless addheader on exception rules', () => {
    const results = validateNetworkRule('||example.com^$addheader', true, 0);
    expect(results).toHaveLength(1);
    expect(results[0].message).toContain('blocking');
  });

  it('errors when value has no colon', () => {
    const results = validateNetworkRule('||example.com^$addheader=x-test', false, 0);
    expect(results.some(r => r.severity === 'error' && r.message.includes('addheader'))).toBe(true);
  });

  it('errors when phase given without value part', () => {
    const results = validateNetworkRule('||example.com^$addheader=request:x-test', false, 0);
    expect(results.some(r => r.severity === 'error' && r.message.includes('phase'))).toBe(true);
  });

  it('accepts phase:name:value forms', () => {
    expect(validateNetworkRule('||example.com^$addheader=response:x-test:1', false, 0)).toHaveLength(0);
    expect(validateNetworkRule('||example.com^$addheader=request:x-test:1', false, 0)).toHaveLength(0);
  });

  it('accepts colons inside the value', () => {
    expect(validateNetworkRule('||example.com^$addheader=x-test:a:b:c', false, 0)).toHaveLength(0);
  });

  it('accepts set-cookie with a cookie-style value', () => {
    expect(validateNetworkRule('||example.com^$addheader=response:set-cookie:k=v; path=/', false, 0)).toHaveLength(0);
  });

  it('errors on non x-/set-cookie header name', () => {
    const results = validateNetworkRule('||example.com^$addheader=content-type:text/html', false, 0);
    expect(results.some(r => r.severity === 'error' && r.message.includes('x-'))).toBe(true);
  });

  it('errors on forbidden x- header', () => {
    const results = validateNetworkRule('||example.com^$addheader=x-frame-options:deny', false, 0);
    expect(results.some(r => r.severity === 'error' && r.message.includes('x-frame-options'))).toBe(true);
  });

  it('errors on illegal characters in header name', () => {
    const results = validateNetworkRule('||example.com^$addheader=x te st:1', false, 0);
    expect(results.some(r => r.severity === 'error' && r.message.includes('Invalid characters'))).toBe(true);
  });

  it('errors on non-printable-ASCII value', () => {
    const results = validateNetworkRule('||example.com^$addheader=x-test:välue', false, 0);
    expect(results.some(r => r.severity === 'error' && r.message.includes('ASCII'))).toBe(true);
  });
});

describe('sitekey and MV3 warnings', () => {
  it('errors on empty sitekey=', () => {
    const results = validateNetworkRule('||example.com^$sitekey=', false, 0);
    expect(results.some(r => r.severity === 'error' && r.message.includes('sitekey'))).toBe(true);
  });

  it('warns on sitekey (MV3)', () => {
    const results = validateNetworkRule('||example.com^$sitekey=abcdef', true, 0);
    expect(results).toHaveLength(1);
    expect(results[0].severity).toBe('warning');
    expect(results[0].message).toContain('MV3');
  });

  it('warns on header even on exception rules', () => {
    const results = validateNetworkRule('||example.com^$header=x-tag', true, 0);
    expect(results.some(r => r.severity === 'warning' && r.message.includes('MV3'))).toBe(true);
  });
});

describe('findOptionsSeparator', () => {
  it('finds the options $', () => {
    expect(findOptionsSeparator('||x.com^$script')).toBe(8);
  });

  it('returns -1 for pure regex filters', () => {
    expect(findOptionsSeparator('/ads$/')).toBe(-1);
  });

  it('returns -1 when nothing follows $', () => {
    expect(findOptionsSeparator('foo$')).toBe(-1);
  });

  it('picks the last valid $', () => {
    expect(findOptionsSeparator('/ads$/$image')).toBe(6);
  });

  it('returns -1 when options are malformed (,,)', () => {
    expect(findOptionsSeparator('||x.com^$script,,image')).toBe(-1);
  });
});

describe('generic pattern specificity (filter_url_not_specific_enough)', () => {
  it('errors on short pattern with options but no domain=/sitekey=', () => {
    const results = validateNetworkRule('ad$script', false, 0);
    expect(results.some(r => r.severity === 'error' && r.message.includes('too short'))).toBe(true);
  });

  it('errors on short ||-anchored pattern', () => {
    const results = validateNetworkRule('||ad^$script', false, 0);
    expect(results.some(r => r.message.includes('too short'))).toBe(true);
  });

  it('errors on short pattern without any options', () => {
    const results = validateNetworkRule('|ads', false, 0);
    expect(results.some(r => r.message.includes('too short'))).toBe(true);
  });

  it('accepts short pattern with domain=', () => {
    expect(validateNetworkRule('ads$script,domain=example.com', false, 0)).toHaveLength(0);
  });

  it('accepts short pattern with sitekey=', () => {
    const results = validateNetworkRule('ads$sitekey=abcdef', true, 0);
    expect(results.some(r => r.message.includes('too short'))).toBe(false);
  });

  it('accepts short pattern containing a wildcard', () => {
    expect(validateNetworkRule('ad*$script', false, 0)).toHaveLength(0);
  });

  it('accepts a pattern of exactly 4 chars', () => {
    expect(validateNetworkRule('adsx$script', false, 0)).toHaveLength(0);
  });

  it('does not count the || prefix toward the 4-char minimum', () => {
    const results = validateNetworkRule('||ads$script', false, 0);
    expect(results.some(r => r.message.includes('too short'))).toBe(true);
  });

  it('accepts a 4-char regex filter', () => {
    expect(validateNetworkRule('/ad/', false, 0)).toHaveLength(0);
  });

  it('errors on a sub-4-char regex filter (ABP counts the slashes)', () => {
    const results = validateNetworkRule('/a/', false, 0);
    expect(results.some(r => r.message.includes('too short'))).toBe(true);
  });

  it('errors on a short generic exception pattern (ABP applies the check to @@ too)', () => {
    const results = validateNetworkRule('ad$script', true, 0);
    expect(results.some(r => r.message.includes('too short'))).toBe(true);
  });

  it('squiggle covers the pattern part', () => {
    const results = validateNetworkRule('ad$script', false, 5);
    const err = results.find(r => r.message.includes('too short'));
    expect(err!.startCol).toBe(5);
    expect(err!.endCol).toBe(7);
  });
});

describe('missing options separator', () => {
  const flags = (body: string, isException = false) => {
    const results = validateNetworkRule(body, isException, 0);
    expect(results).toHaveLength(1);
    expect(results[0].severity).toBe('error');
    expect(results[0].message).toContain('looks like a filter option');
    return results[0];
  };

  it('errors on a dropped $ before a single option', () => {
    const err = flags('||aboveboardcomplicate.com^popup');
    expect(err.message).toContain('"||aboveboardcomplicate.com^$popup"');
  });

  it('errors on a hyphenated option name', () => {
    flags('||host.com^third-party');
  });

  it('errors on a multi-option tail', () => {
    expect(flags('||host.com^script,image').message).toContain('"||host.com^$script,image"');
  });

  it('errors on a value-bearing option', () => {
    flags('||host.com^domain=foo.com');
  });

  it('errors on a mixed tail', () => {
    flags('||host.com^popup,third-party');
  });

  it('errors on exception rules and keeps @@ in the suggestion', () => {
    expect(flags('||host.com^document', true).message).toContain('"@@||host.com^$document"');
  });

  it('drops space after commas in the suggestion', () => {
    expect(flags('||host.com^script, image').message).toContain('"||host.com^$script,image"');
  });

  it('matches option names case-insensitively', () => {
    flags('||host.com^Popup,THIRD-PARTY');
  });

  it('errors when a literal $ elsewhere is not an options separator', () => {
    expect(flags('||host.com/a$b^popup').message).toContain('"||host.com/a$b^$popup"');
  });

  // the missing "$" is the defect; the remaining option errors surface once it is added
  it('errors even when the suggested fix would still need a value', () => {
    flags('||host.com^domain');
  });

  it('errors even when the suggested fix would be an incompatible pair', () => {
    flags('||host.com^script,document');
  });

  it('squiggle covers the caret to end of body', () => {
    const results = validateNetworkRule('||host.com^popup', false, 2);
    expect(results).toHaveLength(1);
    expect(results[0].startCol).toBe(12);
    expect(results[0].endCol).toBe(18);
  });

  it('accepts a correct filter', () => {
    expect(validateNetworkRule('||host.com^$popup', false, 0)).toHaveLength(0);
  });

  it('ignores an explicit path with no caret', () => {
    expect(validateNetworkRule('||host.com/popup', false, 0)).toHaveLength(0);
  });

  it('ignores a tail that is not a known option name', () => {
    expect(validateNetworkRule('||host.com^popupads.js', false, 0)).toHaveLength(0);
  });

  it('ignores a tail where only some tokens are known', () => {
    expect(validateNetworkRule('||host.com^abc,script', false, 0)).toHaveLength(0);
  });

  it('ignores a bare separator', () => {
    expect(validateNetworkRule('||host.com^', false, 0)).toHaveLength(0);
  });

  it('ignores a wildcarded tail', () => {
    expect(validateNetworkRule('||host.com^popup*', false, 0)).toHaveLength(0);
  });

  it('ignores regex filters', () => {
    expect(validateNetworkRule('/banner\\d+^popup/', false, 0)).toHaveLength(0);
    expect(findOptionsSeparator('/banner\\d+^popup/')).toBe(-1);
  });

  it('leaves the pattern-only specificity check untouched', () => {
    const results = validateNetworkRule('||a^', false, 0);
    expect(results).toHaveLength(1);
    expect(results[0].message).toContain('too short');
  });

  it('stays quiet on an ordinary blocking filter', () => {
    expect(validateNetworkRule('||ads.example.com^', false, 0)).toHaveLength(0);
  });
});

describe('regex body validation', () => {
  it('flags an unterminated group', () => {
    const results = validateNetworkRule('/(((((/', false, 0);
    expect(results.some(r => r.message.includes('Invalid regular expression'))).toBe(true);
  });

  it('flags a quantifier with numbers out of order', () => {
    const results = validateNetworkRule('/a{2,1}/', false, 0);
    expect(results.some(r => r.message.includes('Invalid regular expression'))).toBe(true);
  });

  it('flags a character class range out of order', () => {
    const results = validateNetworkRule('/[z-a]/', false, 0);
    const err = results.find(r => r.message.includes('Invalid regular expression'));
    expect(err!.message).toBe('Invalid regular expression: Range out of order in character class');
  });

  it('flags an invalid regex body even with options attached', () => {
    const results = validateNetworkRule('/(((((/$script', false, 0);
    expect(results.some(r => r.message.includes('Invalid regular expression'))).toBe(true);
  });

  it('flags an invalid regex body with options in either order', () => {
    const results = validateNetworkRule('/a{2,1}/$third-party,script', false, 0);
    expect(results.some(r => r.message.includes('Invalid regular expression'))).toBe(true);
  });

  it('does not flag a valid regex body', () => {
    expect(validateNetworkRule('/valid.*regex/', false, 0)).toHaveLength(0);
  });

  it('does not flag a valid regex body with options', () => {
    expect(validateNetworkRule('/valid.*regex/$script', false, 0)).toHaveLength(0);
  });

  it('does not flag a non-regex pattern', () => {
    expect(validateNetworkRule('||ads.example.com^$script', false, 0)).toHaveLength(0);
  });

  it('does not duplicate the prefix when the regex source contains a colon', () => {
    const results = validateNetworkRule('/https:(/', false, 0);
    const err = results.find(r => r.message.includes('Invalid regular expression'));
    expect(err).toBeDefined();
    expect(err!.message).toBe('Invalid regular expression: Unterminated group');
  });

  it('does not flag a pattern that is only invalid at its literal case (core lowercases first)', () => {
    expect(validateNetworkRule('/[a-Z]/', false, 0)).toHaveLength(0);
  });

  it('flags a pattern that is only invalid once core lowercases it', () => {
    const results = validateNetworkRule('/[U-pc]/', false, 0);
    expect(results.some(r => r.message.includes('Invalid regular expression'))).toBe(true);
  });

  it('does not lowercase the source when $match-case is set', () => {
    const results = validateNetworkRule('/[a-Z]/$match-case', false, 0);
    expect(results.some(r => r.message.includes('Invalid regular expression'))).toBe(true);
  });

  it('does not flag a pattern that is only invalid when lowercased, under $match-case', () => {
    expect(validateNetworkRule('/[U-pc]/$match-case', false, 0)).toHaveLength(0);
  });

  it('a later ~match-case overrides an earlier match-case (order matters)', () => {
    expect(validateNetworkRule('/[a-Z]/$match-case,~match-case', false, 0)).toHaveLength(0);
  });

  it('a later match-case overrides an earlier ~match-case (order matters)', () => {
    const results = validateNetworkRule('/[a-Z]/$~match-case,match-case', false, 0);
    expect(results.some(r => r.message.includes('Invalid regular expression'))).toBe(true);
  });

  it('flags a pattern that only breaks once core strips the space (dangling escape)', () => {
    const results = validateNetworkRule('/d\\ /', false, 0);
    expect(results.some(r => r.message.includes('Invalid regular expression'))).toBe(true);
  });

  it('does not flag a pattern that is only invalid before core strips the space', () => {
    expect(validateNetworkRule('/\\ [/', false, 0)).toHaveLength(0);
  });

  it('flags an invalid pattern when a space before "$" hides the closing slash', () => {
    const results = validateNetworkRule('/((/ $script', false, 0);
    expect(results.some(r => r.message.includes('Invalid regular expression'))).toBe(true);
  });

  it('flags an invalid pattern when a tab before "$" hides the closing slash', () => {
    const results = validateNetworkRule('/((/\t$script', false, 0);
    expect(results.some(r => r.message.includes('Invalid regular expression'))).toBe(true);
  });

  it('does not flag a valid pattern with a space before "$"', () => {
    expect(validateNetworkRule('/valid.*regex/ $script', false, 0)).toHaveLength(0);
  });
});

describe('duplicate modifiers', () => {
  it('warns on a duplicate content-type modifier', () => {
    const results = validateNetworkRule('||a.com^$image,image', false, 0);
    expect(results.some(r => r.severity === 'warning' && r.message.includes('Duplicate modifier "image"'))).toBe(true);
  });

  it('warns on a duplicate popup modifier', () => {
    const results = validateNetworkRule('||a.com^$popup,popup', false, 0);
    expect(results.some(r => r.severity === 'warning' && r.message.includes('Duplicate modifier "popup"'))).toBe(true);
  });

  it('warns on a duplicate match-case modifier', () => {
    const results = validateNetworkRule('||a.com^$match-case,match-case', false, 0);
    expect(results.some(r => r.severity === 'warning' && r.message.includes('Duplicate modifier "match-case"'))).toBe(true);
  });

  it('warns once per duplicate header= occurrence, in addition to the MV3 warning', () => {
    const results = validateNetworkRule('||a.com^$header=x-a,header=x-b', false, 0);
    expect(results.filter(r => r.message.includes('Duplicate modifier "header"'))).toHaveLength(1);
  });

  it('does not warn on a single occurrence', () => {
    expect(validateNetworkRule('||a.com^$image', false, 0)).toHaveLength(0);
  });
});

describe('self-negating modifier pairs', () => {
  it('warns (not errors) on third-party combined with its own negation — plain last-write-wins boolean in core', () => {
    const results = validateNetworkRule('||a.com^$third-party,~third-party', false, 0);
    expect(results.some(r => r.message.includes('combined with its own negation'))).toBe(false);
    expect(results.some(r => r.severity === 'warning' && r.message.includes('Duplicate modifier "third-party"'))).toBe(true);
  });

  it('errors on script combined with its own negation — core zeroes the content-type bitmask', () => {
    const results = validateNetworkRule('||a.com^$script,~script', false, 0);
    expect(results.some(r => r.severity === 'error' && r.message.includes('combined with its own negation'))).toBe(true);
  });

  it('does not error on match-case combined with its own negation (well-defined override in core)', () => {
    const results = validateNetworkRule('||a.com^$match-case,~match-case', false, 0);
    expect(results.some(r => r.message.includes('combined with its own negation'))).toBe(false);
  });

  it('does not treat domain= polarity as a conflict — core ignores "~" for domain entirely', () => {
    const results = validateNetworkRule('||a.com^$domain=a.com,~domain=b.com', false, 0);
    expect(results.some(r => r.message.includes('combined with its own negation'))).toBe(false);
    expect(results.some(r => r.severity === 'warning' && r.message.includes('Duplicate modifier "domain"'))).toBe(true);
  });

  it('errors on the reverse order too (~script,script) — nets to no content-type restriction at all, not what either token alone means', () => {
    const results = validateNetworkRule('||a.com^$~script,script', false, 0);
    expect(results.some(r => r.severity === 'error' && r.message.includes('combined with its own negation'))).toBe(true);
  });

  it('reports one conflict, not two, for a repeated negated modifier (script,~script,~script)', () => {
    const results = validateNetworkRule('||a.com^$script,~script,~script', false, 0);
    expect(results.filter(r => r.message.includes('combined with its own negation'))).toHaveLength(1);
    expect(results.some(r => r.severity === 'warning' && r.message.includes('Duplicate modifier "script"'))).toBe(true);
  });

  it('warns on the exact repeat trailing a tolerated polarity flip (match-case,~match-case,~match-case)', () => {
    const results = validateNetworkRule('||a.com^$match-case,~match-case,~match-case', false, 0);
    expect(results.some(r => r.message.includes('combined with its own negation'))).toBe(false);
    expect(results.some(r => r.severity === 'warning' && r.message.includes('Duplicate modifier "match-case"'))).toBe(true);
  });

  it('does not error on a single negated modifier', () => {
    expect(validateNetworkRule('||a.com^$~third-party', false, 0)).toHaveLength(0);
  });
});

describe('deduplicated MV3 diagnostics', () => {
  it('does not repeat the MV3 warning for a duplicate header= modifier', () => {
    const results = validateNetworkRule('||a.com^$header=x-a,header=x-b', false, 0);
    expect(results.filter(r => r.message.includes('no effect in Chrome'))).toHaveLength(1);
  });
});

describe('report-2026-08-25 §6 regression contract (verified NOT gaps, network path)', () => {
  it('||a.com^$addheader=set-cookie:a=b', () => {
    expect(validateNetworkRule('||a.com^$addheader=set-cookie:a=b', false, 0)).toHaveLength(0);
  });

  it('/valid.*regex/$script', () => {
    expect(validateNetworkRule('/valid.*regex/$script', false, 0)).toHaveLength(0);
  });

  it('|http://a.com|$script', () => {
    expect(validateNetworkRule('|http://a.com|$script', false, 0)).toHaveLength(0);
  });

  it('$script,domain=a.com', () => {
    expect(validateNetworkRule('$script,domain=a.com', false, 0)).toHaveLength(0);
  });

  it('@@||a.com^$elemhide', () => {
    expect(validateNetworkRule('||a.com^$elemhide', true, 0)).toHaveLength(0);
  });

  it('||site.com^$~third-party', () => {
    expect(validateNetworkRule('||site.com^$~third-party', false, 0)).toHaveLength(0);
  });

  it('||UPPER.com^$script', () => {
    expect(validateNetworkRule('||UPPER.com^$script', false, 0)).toHaveLength(0);
  });
});
