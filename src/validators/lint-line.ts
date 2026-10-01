import type { ParsedLine } from '../parser';
import type { LintResult } from '../types';
import { splitSnippetChain, validateSnippetCall, validateSnippetChain, validateSnippetBody, detectDuplicateCalls, detectMissingSnippetSeparator, detectMalformedSnippetSeparator, detectUnquotedRegexBreaks, detectLostRegexEscapes, detectDoubleQuotedArgs, snippetChainRequiresDomain } from './snippets';
import { isRestrictedByDomain, domainScope } from './utils';
import { validateNetworkRule } from './network';
import { checkEmptyBody, checkGenericBodyLength, validateCosmeticSelector } from './cosmetic';
import { validateExtendedSelector } from './extended';

function domainRequiredError(parsed: ParsedLine): LintResult {
  const sep = parsed.separator;
  return {
    message: `"${sep}" filter must have a non-negated domain with a dot (e.g. example.com${sep}...)`,
    severity: 'error',
    startCol: 0,
    endCol: parsed.raw.length,
  };
}

function exceptionScopeWarning(parsed: ParsedLine): LintResult | null {
  const scope = domainScope(parsed.domains);
  if (scope === 'scoped') return null;
  return {
    message: scope === 'global'
      ? 'Snippet exception has no domain — it disables this command on every site, in every subscribed list'
      : 'Snippet exception has only excluded domains — it disables this command on every site except those',
    severity: 'warning',
    startCol: 0,
    endCol: parsed.raw.length,
  };
}

export function lintLine(parsed: ParsedLine): LintResult[] {
  const results: LintResult[] = [];

  if (parsed.type === 'extended' && parsed.body.trim() && !isRestrictedByDomain(parsed.domains)) {
    results.push(domainRequiredError(parsed));
  }

  if (parsed.type === 'snippet') {
    const calls = splitSnippetChain(parsed.body);
    if (!isRestrictedByDomain(parsed.domains) && snippetChainRequiresDomain(calls)) {
      results.push(domainRequiredError(parsed));
    }
    results.push(...validateSnippetBody(parsed.body, parsed.bodyOffset));
    results.push(...validateSnippetChain(calls, parsed.bodyOffset));
    results.push(...detectDuplicateCalls(calls, parsed.bodyOffset));
    results.push(...detectUnquotedRegexBreaks(parsed.body, calls, parsed.bodyOffset));
    results.push(...detectLostRegexEscapes(parsed.body, calls, parsed.bodyOffset));
    results.push(...detectDoubleQuotedArgs(parsed.body, calls, parsed.bodyOffset));
    for (const call of calls) {
      results.push(...validateSnippetCall(call, parsed.bodyOffset));
    }
  }

  if (parsed.type === 'snippet-exception') {
    const emptyBody = checkEmptyBody(parsed.body, parsed.separator, parsed.bodyOffset);
    if (emptyBody) {
      results.push(emptyBody);
    } else {
      const calls = splitSnippetChain(parsed.body);
      results.push(...validateSnippetBody(parsed.body, parsed.bodyOffset));
      results.push(...detectDuplicateCalls(calls, parsed.bodyOffset));
      results.push(...detectUnquotedRegexBreaks(parsed.body, calls, parsed.bodyOffset));
      results.push(...detectLostRegexEscapes(parsed.body, calls, parsed.bodyOffset));
      results.push(...detectDoubleQuotedArgs(parsed.body, calls, parsed.bodyOffset));
      const scopeWarning = exceptionScopeWarning(parsed);
      if (scopeWarning) results.push(scopeWarning);
      for (const call of calls) {
        results.push(...validateSnippetCall(call, parsed.bodyOffset));
      }
    }
  }

  if (parsed.type === 'network' || parsed.type === 'exception') {
    results.push(...validateNetworkRule(parsed.body, parsed.type === 'exception', parsed.bodyOffset));
    if (parsed.type === 'network') {
      const missingSep = detectMissingSnippetSeparator(parsed.raw);
      if (missingSep) results.push(missingSep);
      const malformedSep = detectMalformedSnippetSeparator(parsed.raw);
      if (malformedSep) results.push(malformedSep);
    }
  }

  if (parsed.type === 'cosmetic' || parsed.type === 'hiding-exception') {
    const emptyBody = checkEmptyBody(parsed.body, parsed.separator, parsed.bodyOffset);
    if (emptyBody) {
      results.push(emptyBody);
    } else {
      const tooGeneric = checkGenericBodyLength(parsed.domains, parsed.body, parsed.bodyOffset);
      if (tooGeneric) results.push(tooGeneric);
    }
    results.push(...validateCosmeticSelector(parsed.body, parsed.bodyOffset));
  }

  if (parsed.type === 'extended') {
    const emptyBody = checkEmptyBody(parsed.body, parsed.separator, parsed.bodyOffset);
    if (emptyBody) results.push(emptyBody);
    results.push(...validateExtendedSelector(parsed.body, parsed.bodyOffset));
  }

  return results;
}
