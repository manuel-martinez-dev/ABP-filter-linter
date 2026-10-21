import { parseLine } from '../parser';
import type { ParsedLine } from '../parser';
import type { LintResult } from '../types';
import { splitSnippetChain, validateSnippetCall, validateSnippetChain, validateSnippetBody, detectDuplicateCalls, detectUnquotedRegexBreaks, detectLostRegexEscapes, detectDoubleQuotedArgs, snippetChainRequiresDomain } from './snippets';
import { detectDoubleComma, detectDomainListEdges, detectSpacesInDomains, detectTrailingWhitespace, validateContentDomainEntries } from './syntax';
import { detectRepair, remapColumns, TYPE_NAMES, detectDamagedNetworkPattern, hasPatternShapeFinding, indentOf } from './damaged-content';
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

function domainListFindings(raw: string): LintResult[] {
  const indent = indentOf(raw);
  const line = raw.slice(indent);
  const results = [detectDoubleComma(line), detectDomainListEdges(line), detectSpacesInDomains(line)]
    .filter((r): r is LintResult => r !== null);
  return [...results, ...validateContentDomainEntries(line)]
    .map(r => ({ ...r, startCol: r.startCol + indent, endCol: r.endCol + indent }));
}

function originalReading(parsed: ParsedLine, withSafetyNet: boolean): LintResult[] {
  const results = [...domainListFindings(parsed.raw), ...lintLine(parsed)];
  if (parsed.type !== 'network' || !withSafetyNet || hasPatternShapeFinding(results)) return results;
  const damaged = detectDamagedNetworkPattern(parsed);
  if (damaged) results.push(damaged);
  return results;
}

function dedupe(results: LintResult[]): LintResult[] {
  const seen = new Set<string>();
  return results.filter(r => {
    const key = `${r.severity}|${r.startCol}|${r.endCol}|${r.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function validateInterpretation(parsed: ParsedLine): LintResult[] {
  const repair = detectRepair(parsed);
  if (repair && repair.tier !== 'hint') {
    const repaired = parseLine(repair.repairedRaw, parsed.lineIndex);
    const prefix = `(if this is a ${TYPE_NAMES[repair.intended]}) `;
    const hedge = (results: LintResult[]) => results.map(r => ({ ...r, severity: 'warning' as const, message: prefix + r.message }));
    const guess = repair.tier === 'guess';
    const body = guess ? hedge(lintLine(repaired)) : lintLine(repaired);
    const domainList = guess && parsed.type === 'network' ? hedge(domainListFindings(repaired.raw)) : domainListFindings(repaired.raw);
    const reconstructed = [repair.primary, ...remapColumns([...domainList, ...body], repair.edits)];
    return guess ? dedupe([...reconstructed, ...originalReading(parsed, false)]) : reconstructed;
  }

  const results = originalReading(parsed, !repair);
  return repair ? [repair.primary, ...results] : results;
}

export function lintRawLine(raw: string, lineIndex: number, parsed: ParsedLine = parseLine(raw, lineIndex)): LintResult[] {
  if (parsed.type === 'comment' || parsed.type === 'unknown') return [];
  const results = validateInterpretation(parsed);
  const trailingWs = detectTrailingWhitespace(raw);
  if (trailingWs) results.push(trailingWs);
  return results;
}
