import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptsDir = fileURLToPath(new URL('../../', import.meta.url));

function runFixture({ extraArg = false, newHeavy = false, scopeDefault = '""', scopeUpstreamName = 'scope', ledgerEntries } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'snippet-check-'));
  try {
    const scripts = path.join(root, '.github/scripts');
    const pkg = path.join(root, 'node_modules/@eyeo/snippets');
    mkdirSync(path.join(scripts, 'lib'), { recursive: true });
    mkdirSync(path.join(root, 'src/data'), { recursive: true });
    mkdirSync(path.join(pkg, 'webext'), { recursive: true });
    copyFileSync(path.join(scriptsDir, 'check-snippets.mjs'), path.join(scripts, 'check-snippets.mjs'));
    copyFileSync(path.join(scriptsDir, 'lib/snippet-diff.mjs'), path.join(scripts, 'lib/snippet-diff.mjs'));
    writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: '@eyeo/snippets', version: '2.15.0' }));
    writeFileSync(path.join(pkg, 'webext/snippets.source.mjs'),
      'function foo(a) {} const snippets$1 = { foo }; const graph = new Map([["foo",null]]);');
    const scopeParam = `${scopeUpstreamName}${scopeDefault !== null ? ` = ${scopeDefault}` : ''}`;
    writeFileSync(path.join(pkg, 'webext/isolated-heavy.source.mjs'),
      `function xpath(query, ${scopeParam}${extraArg ? ', extra=""' : ''}) {} const snippets = { "xpath": xpath }; const graph = new Map([["xpath",function dependency() { return ["ignored",null]; }]]);`);
    const data = { snippets: { foo: { args: [{ name: 'a', required: false }] } }, deprecated: {} };
    if (!newHeavy) data.snippets.xpath = { args: [{ name: 'query', required: true }, { name: 'scope', required: true }] };
    const dataPath = path.join(root, 'src/data/snippets.json');
    const before = JSON.stringify(data);
    writeFileSync(dataPath, before);

    const ledgerPath = path.join(scripts, 'reviewed-requiredness.json');
    const ledgerBefore = ledgerEntries !== undefined ? JSON.stringify({ version: 1, entries: ledgerEntries }) : undefined;
    if (ledgerBefore !== undefined) writeFileSync(ledgerPath, ledgerBefore);

    const run = spawnSync(process.execPath, [path.join(scripts, 'check-snippets.mjs')], { encoding: 'utf8', cwd: root });
    const ledgerAfter = ledgerBefore !== undefined ? readFileSync(ledgerPath, 'utf8') : undefined;
    return { ...run, before, after: readFileSync(dataPath, 'utf8'), ledgerBefore, ledgerAfter };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('check-snippets workflow', () => {
  it('reports requiredness candidates without failing or changing schemas', () => {
    const run = runFixture();
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain('REQUIREDNESS_REVIEW');
    expect(run.stdout).toContain('NEW CANDIDATE:');
    expect(run.stdout).toContain('xpath:');
    expect(run.stdout).not.toContain('DRIFT_DETECTED');
    expect(run.after).toBe(run.before);
  });

  it('fails on heavy-bundle arity growth without changing schemas', () => {
    const run = runFixture({ extraArg: true });
    expect(run.status, run.stderr).toBe(3);
    expect(run.stdout).toContain('DRIFT_DETECTED');
    expect(run.stdout).toContain('upstream=[query, scope, extra]');
    expect(run.after).toBe(run.before);
  });

  it('discovers heavy snippets without overwriting existing requiredness or leaking defaultExpr', () => {
    const run = runFixture({ newHeavy: true });
    expect(run.status, run.stderr).toBe(2);
    expect(run.stdout).toContain('NEW_SNIPPETS_FOUND');
    const data = JSON.parse(run.after);
    expect(data.snippets.xpath.args).toHaveLength(2);
    expect(data.snippets.foo.args[0].required).toBe(false);
    expect(JSON.stringify(data.snippets.xpath.args)).not.toContain('defaultExpr');
  });

  it('treats a missing ledger file as an empty ledger without erroring', () => {
    const run = runFixture();
    expect(run.status, run.stderr).toBe(0);
    expect(run.ledgerBefore).toBeUndefined();
    expect(run.ledgerAfter).toBeUndefined();
  });

  it('suppresses a candidate when the ledger matches current upstream exactly', () => {
    const run = runFixture({ ledgerEntries: [
      { snippet: 'xpath', arg: 'scope', upstreamParam: 'scope', position: 2, defaultExpr: '""', reason: 'test' },
    ] });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).not.toContain('xpath');
    expect(run.ledgerAfter).toBe(run.ledgerBefore);
    expect(run.after).toBe(run.before);
  });

  it('consolidates into one line when the default text changed', () => {
    const run = runFixture({
      scopeDefault: '"x"',
      ledgerEntries: [{ snippet: 'xpath', arg: 'scope', upstreamParam: 'scope', position: 2, defaultExpr: '""', reason: 'test' }],
    });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain('LEDGER ENTRY NEEDS REVIEW:');
    expect(run.stdout).not.toContain('NEW CANDIDATE:');
    const xpathLines = run.stdout.split('\n').filter(l => l.includes('xpath') && l.includes('scope'));
    expect(xpathLines).toHaveLength(1);
  });

  it('resurfaces only via the ledger pass when the default disappears entirely', () => {
    const run = runFixture({
      scopeDefault: null,
      ledgerEntries: [{ snippet: 'xpath', arg: 'scope', upstreamParam: 'scope', position: 2, defaultExpr: '""', reason: 'test' }],
    });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain('LEDGER ENTRY NEEDS REVIEW:');
    expect(run.stdout).not.toContain('NEW CANDIDATE:');
    expect(run.stdout).toContain('no longer present upstream');
  });

  it('consolidates into one line when the upstream parameter name changes', () => {
    const run = runFixture({
      scopeUpstreamName: 'area',
      ledgerEntries: [{ snippet: 'xpath', arg: 'scope', upstreamParam: 'scope', position: 2, defaultExpr: '""', reason: 'test' }],
    });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain('LEDGER ENTRY NEEDS REVIEW:');
    expect(run.stdout).not.toContain('NEW CANDIDATE:');
    const xpathLines = run.stdout.split('\n').filter(l => l.includes('xpath') && l.includes('scope'));
    expect(xpathLines).toHaveLength(1);
  });

  it('flags a ledgered snippet that vanished from upstream entirely', () => {
    const run = runFixture({ ledgerEntries: [
      { snippet: 'gone-snippet', arg: 'x', upstreamParam: 'x', position: 1, defaultExpr: '""', reason: 'test' },
    ] });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain('LEDGER ENTRY NEEDS REVIEW:');
    expect(run.stdout).toContain('no longer found upstream');
    expect(run.after).toBe(run.before);
    expect(run.ledgerAfter).toBe(run.ledgerBefore);
  });

  it('fails loudly on a malformed ledger instead of silently proceeding as empty', () => {
    const run = runFixture({ ledgerEntries: [
      { snippet: 'xpath', arg: '', upstreamParam: 'scope', position: 2, defaultExpr: '""', reason: 'test' },
    ] });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/must be a non-empty string/);
  });
});
