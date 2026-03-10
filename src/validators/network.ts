import modifierData from '../data/modifiers.json';
import type { LintResult } from '../types';

const VALID = new Set(modifierData.valid);
const VALUE_REQUIRED = new Set(modifierData.valueRequired);
const EXCEPTION_ONLY = new Set(modifierData.exceptionOnly);
const INCOMPATIBLE = modifierData.incompatible as Record<string, string[]>;

export function validateNetworkRule(
  body: string,
  isException: boolean,
  bodyOffset: number
): LintResult[] {
  const results: LintResult[] = [];

  const dollarIdx = body.lastIndexOf('$');
  if (dollarIdx === -1) return results;

  const modifierStr = body.slice(dollarIdx + 1);
  const modifiers = modifierStr.split(',');
  const modifierNames: string[] = [];
  let modRunningOffset = 0;

  for (const mod of modifiers) {
    const trimmedMod = mod.trim();
    const negated = trimmedMod.startsWith('~');
    const raw = negated ? trimmedMod.slice(1) : trimmedMod;
    const [key, value] = raw.split('=');
    const modStart = bodyOffset + dollarIdx + 1 + modRunningOffset;
    const modEnd = modStart + trimmedMod.length;
    modRunningOffset += mod.length + 1; // +1 for the comma

    if (!VALID.has(key)) {
      results.push({
        message: `Unknown modifier "${key}"`,
        severity: 'error',
        startCol: modStart,
        endCol: modEnd,
      });
      continue;
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

    // value required but missing
    if (!negated && VALUE_REQUIRED.has(key)) {
      if (!value || value.trim() === '') {
        results.push({
          message: `Modifier "${key}" requires a value (e.g. ${key}=...)`,
          severity: 'error',
          startCol: modStart,
          endCol: modEnd,
        });
      } else if (key === 'rewrite' && !value.startsWith(modifierData.rewritePrefix)) {
        results.push({
          message: `"rewrite" value must start with "${modifierData.rewritePrefix}"`,
          severity: 'error',
          startCol: modStart,
          endCol: modEnd,
        });
      }
    }

    modifierNames.push(key);
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
