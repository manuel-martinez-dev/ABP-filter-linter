import modifierData from '../data/modifiers.json';
import type { LintResult } from '../types';

const VALID = new Set(modifierData.valid);
const DEPRECATED = new Set(modifierData.deprecated ?? []);
const VALUE_REQUIRED = new Set(modifierData.valueRequired);
const VALUE_OPTIONAL_ON_EXCEPTION = new Set(modifierData.valueOptionalOnException);
const EXCEPTION_ONLY = new Set(modifierData.exceptionOnly);
const BLOCKING_ONLY = new Set(modifierData.blockingOnly);
const MV3_UNSUPPORTED = new Set(modifierData.mv3Unsupported);
const REWRITE_RESOURCES = new Set(modifierData.rewriteResources);
const FORBIDDEN_ADDHEADER_NAMES = new Set(modifierData.forbiddenAddheaderNames);
const PRIVILEGED_ADDHEADER_NAMES = new Set(modifierData.privilegedAddheaderNames);
const INCOMPATIBLE = modifierData.incompatible as Record<string, string[]>;

// regexes verbatim from ABP core
const INVALID_CSP_RE = /(;|^) ?(base-uri|referrer|report-to|report-uri|upgrade-insecure-requests)\b/i;
const INVALID_HEADER_NAME_RE = /[^!#$%&'*+\-.^_`|~A-Za-z0-9]/;
const INVALID_HEADER_VALUE_RE = /[^\x20-\x7E]/;
const DOMAIN_ENTRY_RE = /^[\w-]+(\.[\w-]+)*$/;

// ABP ignores "~" on these options (stripped before its option switch), so values are still required/validated
const NEGATION_IGNORED = new Set(['domain', 'rewrite', 'sitekey']);

/** ABP core isValidDomainWildcard: at most one "*", last char only, preceded by "." */
function hasMalformedWildcard(entry: string): boolean {
  const stars = (entry.match(/\*/g) ?? []).length;
  if (stars === 0) return false;
  if (stars > 1) return true;
  const pos = entry.indexOf('*');
  return pos !== entry.length - 1 || entry.length === 1 || (pos > 0 && entry[pos - 1] !== '.');
}

/** ABP core addheader validation sequence */
function validateAddheaderValue(value: string): string | null {
  const parts = value.split(':');
  if (parts.length < 2) return `"addheader" value must be "[request:|response:]name:value"`;
  let name: string;
  let headerValue: string;
  const maybePhase = parts[0].trim().toLowerCase();
  if (maybePhase === 'request' || maybePhase === 'response') {
    if (parts.length < 3) return `"addheader" with a phase needs "phase:name:value"`;
    name = parts[1].trim().toLowerCase();
    headerValue = parts.slice(2).join(':').trim();
  } else {
    name = parts[0].trim().toLowerCase();
    headerValue = parts.slice(1).join(':').trim();
  }
  if (!name || !headerValue) return `"addheader" header name and value must be non-empty`;
  if (INVALID_HEADER_NAME_RE.test(name)) return `Invalid characters in "addheader" header name "${name}"`;
  if (FORBIDDEN_ADDHEADER_NAMES.has(name)) return `Header "${name}" cannot be modified with "addheader"`;
  if (!name.startsWith('x-') && !PRIVILEGED_ADDHEADER_NAMES.has(name)) {
    return `"addheader" header name must start with "x-" or be "set-cookie"`;
  }
  if (INVALID_HEADER_VALUE_RE.test(headerValue)) return `"addheader" header value must be printable ASCII`;
  return null;
}

// Option-list shape after "$" — looser than ABP core ([\w.*-], optional space after commas) so domain-like typos still get flagged
const OPTIONS_RE = /^(.*)\$(~?[\w.*-]+(?:=[^,]*)?(?:,[ \t]*~?[\w.*-]+(?:=[^,]*)?)*)$/;

/** Last "$" counts as options separator only if the rest looks like an option list; -1 for regex filters and literal "$" */
export function findOptionsSeparator(body: string): number {
  if (body.length > 1 && body.startsWith('/') && body.endsWith('/')) return -1;
  const match = OPTIONS_RE.exec(body);
  return match ? match[1].length : -1;
}

export function validateNetworkRule(
  body: string,
  isException: boolean,
  bodyOffset: number
): LintResult[] {
  const results: LintResult[] = [];

  const dollarIdx = findOptionsSeparator(body);
  if (dollarIdx === -1) return results;

  const modifierStr = body.slice(dollarIdx + 1);
  const modifiers = modifierStr.split(',');
  const modifierNames: string[] = [];
  let modRunningOffset = 0;

  // ~domain= counts too — ABP strips "~" before its option switch
  let hasDomainValue = false;
  let hasNegatedThirdParty = false;
  let hasRewrite = false;

  /** Tokens that are unknown but look like domain names — checked after the loop */
  const domainLikeUnknowns: Array<{ key: string; start: number; end: number }> = []; // key used for fallback "Unknown modifier" message

  for (const mod of modifiers) {
    const trimmedMod = mod.trim();
    const negated = trimmedMod.startsWith('~');
    const raw = negated ? trimmedMod.slice(1) : trimmedMod;
    // split at first "=" only — values may contain "=" (e.g. header=X-Frame-Options=deny)
    const eqIdx = raw.indexOf('=');
    // ABP matches option names case-insensitively
    const key = (eqIdx === -1 ? raw : raw.slice(0, eqIdx)).toLowerCase();
    const value = eqIdx === -1 ? undefined : raw.slice(eqIdx + 1);
    const leading = mod.length - mod.trimStart().length;
    const modStart = bodyOffset + dollarIdx + 1 + modRunningOffset + leading;
    const modEnd = modStart + trimmedMod.length;
    modRunningOffset += mod.length + 1; // +1 for the comma

    if (!VALID.has(key)) {
      if (/^~?[\w-]+(\.[\w-]+)+$/.test(trimmedMod)) {
        domainLikeUnknowns.push({ key: trimmedMod, start: modStart, end: modEnd });
      } else {
        results.push({
          message: `Unknown modifier "${key}"`,
          severity: 'error',
          startCol: modStart,
          endCol: modEnd,
        });
      }
      continue;
    }

    if (DEPRECATED.has(key)) {
      results.push({
        message: `"${key}" is deprecated and may not be supported in future ABP versions`,
        severity: 'warning',
        startCol: modStart,
        endCol: modEnd,
      });
    }

    // exception-only modifiers on non-@@ rules
    if (!negated && EXCEPTION_ONLY.has(key) && !isException) {
      results.push({
        message: `"${key}" is only valid on exception rules (@@)`,
        severity: 'error',
        startCol: modStart,
        endCol: modEnd,
      });
    }

    // blocking-only modifiers on @@ rules
    if (isException && BLOCKING_ONLY.has(key)) {
      results.push({
        message: `"${key}" is only valid on blocking rules`,
        severity: 'error',
        startCol: modStart,
        endCol: modEnd,
      });
    }

    if (MV3_UNSUPPORTED.has(key)) {
      results.push({
        message: `"${key}" has no effect in Chrome (MV3) — Firefox only`,
        severity: 'warning',
        startCol: modStart,
        endCol: modEnd,
      });
    }

    if (key === 'domain' && value) hasDomainValue = true;
    if (negated && key === 'third-party') hasNegatedThirdParty = true;

    // value required but missing
    if ((!negated || NEGATION_IGNORED.has(key)) && VALUE_REQUIRED.has(key)) {
      if (!value || value.trim() === '') {
        // blocking-only modifiers on @@ are already rejected outright — don't stack a second error
        if (!(isException && (VALUE_OPTIONAL_ON_EXCEPTION.has(key) || BLOCKING_ONLY.has(key)))) {
          results.push({
            message: `Modifier "${key}" requires a value (e.g. ${key}=...)`,
            severity: 'error',
            startCol: modStart,
            endCol: modEnd,
          });
        }
      } else if (key === 'rewrite') {
        if (!value.startsWith(modifierData.rewritePrefix)) {
          results.push({
            message: `"rewrite" value must start with "${modifierData.rewritePrefix}"`,
            severity: 'error',
            startCol: modStart,
            endCol: modEnd,
          });
        } else {
          hasRewrite = true;
          const resource = value.slice(modifierData.rewritePrefix.length);
          if (!REWRITE_RESOURCES.has(resource)) {
            results.push({
              message: `Unknown rewrite resource "${resource}"`,
              severity: 'error',
              startCol: modStart,
              endCol: modEnd,
            });
          }
        }
      } else if (key === 'domain') {
        const valueStart = modEnd - value.length;
        let entryOffset = 0;
        let emptyReported = false;
        for (const entry of value.split('|')) {
          const entryStart = valueStart + entryOffset;
          entryOffset += entry.length + 1; // +1 for the "|"
          const bare = entry.startsWith('~') ? entry.slice(1) : entry;
          if (bare === '') {
            if (!emptyReported) {
              results.push({
                message: `"domain=" contains an empty entry — check for consecutive, leading, or trailing "|"`,
                severity: 'error',
                startCol: modStart,
                endCol: modEnd,
              });
              emptyReported = true;
            }
            continue;
          }
          const bareStart = entryStart + (entry.length - bare.length);
          const bareEnd = bareStart + bare.length;
          if (bare.includes('?')) {
            results.push({
              message: `"domain=" entry "${bare}" must not contain "?"`,
              severity: 'error',
              startCol: bareStart,
              endCol: bareEnd,
            });
          } else if (hasMalformedWildcard(bare)) {
            results.push({
              message: `Invalid wildcard in "domain=" entry "${bare}" — only a single trailing ".*" is allowed`,
              severity: 'error',
              startCol: bareStart,
              endCol: bareEnd,
            });
          } else if (bare.endsWith('.*')) {
            results.push({
              message: `Wildcard TLD in "domain=" drops the whole filter in Chrome (MV3) — Firefox-only syntax`,
              severity: 'error',
              startCol: bareStart,
              endCol: bareEnd,
            });
          } else if (/[^\x00-\x7F]/.test(bare)) {
            results.push({
              message: `"domain=" entries must be ASCII (use punycode)`,
              severity: 'error',
              startCol: bareStart,
              endCol: bareEnd,
            });
          } else if (!DOMAIN_ENTRY_RE.test(bare)) {
            results.push({
              message: `"domain=" entry "${bare}" is not a valid domain`,
              severity: 'error',
              startCol: bareStart,
              endCol: bareEnd,
            });
          }
        }
      } else if (key === 'addheader' && !isException) {
        const message = validateAddheaderValue(value);
        if (message) {
          results.push({ message, severity: 'error', startCol: modStart, endCol: modEnd });
        }
      } else if (key === 'csp' && !isException) {
        const forbidden = INVALID_CSP_RE.exec(value);
        if (forbidden) {
          results.push({
            message: `CSP directive "${forbidden[2]}" is not allowed in "csp="`,
            severity: 'error',
            startCol: modStart,
            endCol: modEnd,
          });
        }
      } else if (key === 'header') {
        const headerEq = value.indexOf('=');
        if (headerEq === 0) {
          results.push({
            message: `"header" name must not be empty`,
            severity: 'error',
            startCol: modStart,
            endCol: modEnd,
          });
        } else if (headerEq > 0 && headerEq < value.length - 1 && /^\/[\s\S]*\/$/.test(value.slice(headerEq + 1))) {
          results.push({
            message: `Regex header values are reserved and not supported`,
            severity: 'error',
            startCol: modStart,
            endCol: modEnd,
          });
        }
      }
    }

    modifierNames.push(key);
  }

  if (hasRewrite && !isException) {
    const pattern = body.slice(0, dollarIdx);
    const anchored = pattern.startsWith('||')
      ? hasDomainValue || hasNegatedThirdParty
      : pattern.startsWith('*') && hasDomainValue;
    if (!anchored) {
      results.push({
        message: `"rewrite" requires a pattern starting with "||" (plus domain= or ~third-party) or "*" (plus domain=)`,
        severity: 'error',
        startCol: bodyOffset + dollarIdx,
        endCol: bodyOffset + body.length,
      });
    }
  }

  // domain= comma-separator check
  if (domainLikeUnknowns.length > 0) {
    if (modifierNames.includes('domain')) {
      for (const { start, end } of domainLikeUnknowns) {
        results.push({
          message: `Use "|" to separate multiple domains in "domain=" (e.g. domain=foo.com|bar.com)`,
          severity: 'warning',
          startCol: start,
          endCol: end,
        });
      }
    } else {
      for (const { key, start, end } of domainLikeUnknowns) {
        results.push({
          message: `Unknown modifier "${key}"`,
          severity: 'error',
          startCol: start,
          endCol: end,
        });
      }
    }
  }

  // Incompatibility checks
  for (const [mod, incompatibles] of Object.entries(INCOMPATIBLE)) {
    if (!modifierNames.includes(mod)) continue;
    // document can be combined with any modifier on exception (@@) rules
    if (isException && mod === 'document') continue;
    for (const inc of incompatibles) {
      if (modifierNames.includes(inc)) {
        results.push({
          message: `"${mod}" cannot be combined with "${inc}"`,
          severity: 'error',
          startCol: bodyOffset + dollarIdx,
          endCol: bodyOffset + body.length,
        });
      }
    }
  }

  return results;
}
