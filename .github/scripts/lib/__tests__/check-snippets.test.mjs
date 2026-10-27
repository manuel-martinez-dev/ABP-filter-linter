import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptsDir = fileURLToPath(new URL('../../', import.meta.url));

function runFixture({ extraArg = false, extraParam = 'extra=""', xpathBody = '', xpathArgs, unmappedRecorded = false, newLight = false, rerun = false, newHeavy = false, scopeDefault = '""', scopeUpstreamName = 'scope', ledgerEntries, fooBody = '', fooDefinition, xpathDocs = '', corruptAst } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'snippet-check-'));
  try {
    const scripts = path.join(root, '.github/scripts');
    const pkg = path.join(root, 'node_modules/@eyeo/snippets');
    mkdirSync(path.join(scripts, 'lib'), { recursive: true });
    mkdirSync(path.join(root, 'src/data'), { recursive: true });
    mkdirSync(path.join(pkg, 'webext'), { recursive: true });
    const compilerDir = path.join(root, 'node_modules/typescript');
    mkdirSync(compilerDir, { recursive: true });
    copyFileSync(fileURLToPath(import.meta.resolve('typescript')), path.join(compilerDir, 'typescript.js'));
    writeFileSync(path.join(compilerDir, 'package.json'), JSON.stringify({ main: 'typescript.js' }));
    if (corruptAst) {
      writeFileSync(path.join(compilerDir, 'package.json'), JSON.stringify({ main: 'fault-injection.js' }));
      writeFileSync(path.join(compilerDir, 'fault-injection.js'), `
        const ts = require('./typescript.js');
        module.exports = { ...ts, createSourceFile(...args) {
          const tree = ts.createSourceFile(...args);
          const first = tree.statements[0];
          const replacement = ${JSON.stringify(corruptAst)} === 'statement'
            ? ts.factory.createEmptyStatement()
            : ts.factory.updateFunctionDeclaration(first, first.modifiers, first.asteriskToken,
                ts.factory.createIdentifier('unexpected'), first.typeParameters, first.parameters, first.type, first.body);
          tree.statements = ts.factory.createNodeArray([replacement, ...tree.statements.slice(1)]);
          return tree;
        } };
      `);
    }
    copyFileSync(path.join(scriptsDir, 'check-snippets.mjs'), path.join(scripts, 'check-snippets.mjs'));
    copyFileSync(path.join(scriptsDir, 'lib/snippet-diff.mjs'), path.join(scripts, 'lib/snippet-diff.mjs'));
    writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: '@eyeo/snippets', version: '2.15.0' }));
    writeFileSync(path.join(pkg, 'webext/snippets.source.mjs'),
      `${fooDefinition ?? `function foo(a) { ${fooBody} }`}${newLight ? ' function baz(b) {}' : ''} const snippets$1 = { foo${newLight ? ', baz' : ''} }; const graph = new Map([["foo",null]${newLight ? ',["baz",null]' : ''}${unmappedRecorded ? ',["bar",null]' : ''}]);`);
    const scopeParam = `${scopeUpstreamName}${scopeDefault !== null ? ` = ${scopeDefault}` : ''}`;
    writeFileSync(path.join(pkg, 'webext/isolated-heavy.source.mjs'),
      `${xpathDocs}\nfunction xpath(query, ${scopeParam}${extraArg ? `, ${extraParam}` : ''}) { ${xpathBody} } const snippets = { "xpath": xpath }; const graph = new Map([["xpath",function dependency() { return ["ignored",null]; }]]);`);
    const data = { snippets: { foo: { args: [{ name: 'a', required: false }] } }, deprecated: {} };
    if (!newHeavy) data.snippets.xpath = xpathArgs === null ? {} : { args: xpathArgs ?? [{ name: 'query', required: true }, { name: 'scope', required: true }] };
    if (unmappedRecorded) data.snippets.bar = { args: [] };
    const dataPath = path.join(root, 'src/data/snippets.json');
    const before = JSON.stringify(data);
    writeFileSync(dataPath, before);

    const ledgerPath = path.join(scripts, 'reviewed-requiredness.json');
    const ledgerBefore = ledgerEntries !== undefined ? JSON.stringify({ version: 1, entries: ledgerEntries }) : undefined;
    if (ledgerBefore !== undefined) writeFileSync(ledgerPath, ledgerBefore);

    const check = () => spawnSync(process.execPath, [path.join(scripts, 'check-snippets.mjs')], { encoding: 'utf8', cwd: root });
    const run = check();
    const after = readFileSync(dataPath, 'utf8');
    const second = rerun ? { ...check(), after: readFileSync(dataPath, 'utf8') } : undefined;
    const ledgerAfter = ledgerBefore !== undefined ? readFileSync(ledgerPath, 'utf8') : undefined;
    return { ...run, before, after, second, ledgerBefore, ledgerAfter };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('check-snippets workflow', () => {
  it.each(['function foo(a) { return toRegExp(a);', 'function foo() {', ''])('fails incomplete extraction before writing discoveries: %s', fooDefinition => {
    const run = runFixture({ fooDefinition, newHeavy: true });
    expect(run.status, run.stderr).toBe(1);
    expect(run.stderr).toContain('SNIPPET_ANALYSIS_FAILED:');
    expect(run.stdout).not.toContain('DRIFT_DETECTED');
    expect(run.after).toBe(run.before);
  });

  it.each([
    ['/** @since Adblock Plus 4.42.0 */', '4.42.0'],
    ['', 'unknown'],
    ['/** @since Adblock Plus TBD */', 'unknown'],
    ['/** @since Adblock Plus 4.42.0 */ function previous() {}', 'unknown'],
  ])('uses attached ABP documentation for discovery: %s', (xpathDocs, since) => {
    const run = runFixture({ newHeavy: true, xpathDocs });
    expect(run.status, run.stderr).toBe(2);
    expect(JSON.parse(run.after).snippets.xpath.since).toBe(since);
    expect(run.stdout.includes('SINCE_REVIEW:')).toBe(since === 'unknown');
  });

  it.each(['statement', 'name'])('reports AST %s mismatch as analysis failure, not drift', corruptAst => {
    const run = runFixture({ corruptAst, fooBody: 'return toRegExp(a);' });
    expect(run.status, run.stderr).toBe(1);
    expect(run.stderr).toContain('SNIPPET_ANALYSIS_FAILED: Regex analysis structure mismatch');
    expect(run.stdout).not.toContain('DRIFT_DETECTED');
    expect(run.after).toBe(run.before);
  });

  it('reports invalid generated syntax as analysis failure', () => {
    const run = runFixture({ fooBody: 'return (;' });
    expect(run.status, run.stderr).toBe(1);
    expect(run.stderr).toContain('SNIPPET_ANALYSIS_FAILED: Regex analysis generated invalid JavaScript');
    expect(run.after).toBe(run.before);
  });
  it('reports newly compiled regex arguments without modifying the schema', () => {
    const run = runFixture({ fooBody: 'return toRegExp(a);' });
    expect(run.status, run.stderr).toBe(3);
    expect(run.stdout).toContain('regex drift on "a"');
    expect(run.after).toBe(run.before);
  });
  it('reports requiredness candidates without failing or changing schemas', () => {
    const run = runFixture();
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain('REQUIREDNESS_REVIEW');
    expect(run.stdout).toContain('NEW CANDIDATE:');
    expect(run.stdout).toContain('xpath:');
    expect(run.stdout).not.toContain('DRIFT_DETECTED');
    expect(run.after).toBe(run.before);
  });

  it('appends new trailing args on heavy-bundle arity growth', () => {
    const run = runFixture({ extraArg: true });
    expect(run.status, run.stderr).toBe(2);
    expect(run.stdout).toContain('ARGS_APPENDED\nxpath: added=[extra] upstream=[query, scope, extra]');
    expect(run.stdout).not.toContain('DRIFT_DETECTED');
    expect(run.stdout).not.toContain('NEW_SNIPPETS_FOUND');
    const args = JSON.parse(run.after).snippets.xpath.args;
    expect(args.map(a => a.name)).toEqual(['query', 'scope', 'extra']);
    expect(args[2]).toEqual({ name: 'extra', required: false });
  });

  it('keeps detected enum, regex and requiredness on appended args', () => {
    const run = runFixture({ extraArg: true, extraParam: 'extra', xpathBody: 'if (!["x", "y"].includes(extra)) return; toRegExp(extra);' });
    expect(run.status, run.stderr).toBe(2);
    expect(JSON.parse(run.after).snippets.xpath.args[2]).toEqual({ name: 'extra', required: true, enum: ['x', 'y'], regex: true });
  });

  it('leaves existing args and manual fields untouched when appending', () => {
    const xpathArgs = [
      { name: 'query', required: true, enum: ['a', 'b'] },
      { name: 'scope', required: true, when: { arg: 0, equals: 'a', required: true } },
    ];
    const run = runFixture({ extraArg: true, xpathArgs });
    expect(run.status, run.stderr).toBe(2);
    expect(JSON.parse(run.after).snippets.xpath.args.slice(0, 2)).toEqual(xpathArgs);
  });

  it('is idempotent once appended args are written', () => {
    const run = runFixture({ extraArg: true, rerun: true });
    expect(run.status, run.stderr).toBe(2);
    expect(run.second.status, run.second.stderr).toBe(0);
    expect(run.second.stdout).not.toContain('ARGS_APPENDED');
    expect(run.second.after).toBe(run.after);
  });

  it('writes new snippets and appended args in one run', () => {
    const run = runFixture({ extraArg: true, newLight: true });
    expect(run.status, run.stderr).toBe(2);
    expect(run.stdout).toContain('NEW_SNIPPETS_FOUND\nbaz');
    expect(run.stdout).toContain('ARGS_APPENDED\nxpath: added=[extra]');
    const data = JSON.parse(run.after);
    expect(data.snippets.baz.args).toEqual([{ name: 'b', required: true }]);
    expect(data.snippets.xpath.args).toHaveLength(3);
  });

  it('fails on arity growth behind a renamed prefix without changing schemas', () => {
    const run = runFixture({ extraArg: true, scopeUpstreamName: 'root' });
    expect(run.status, run.stderr).toBe(3);
    expect(run.stdout).toContain('DRIFT_DETECTED');
    expect(run.stdout).toContain('upstream=[query, root, extra]');
    expect(run.stdout).not.toContain('ARGS_APPENDED');
    expect(run.after).toBe(run.before);
  });

  it('appends while still reporting blocking drift on another snippet', () => {
    const run = runFixture({ extraArg: true, fooBody: 'return toRegExp(a);' });
    expect(run.status, run.stderr).toBe(2);
    expect(run.stdout).toContain('ARGS_APPENDED');
    expect(run.stdout).toContain('DRIFT_DETECTED');
    expect(run.stdout).toContain('regex drift on "a"');
    const data = JSON.parse(run.after);
    expect(data.snippets.xpath.args).toHaveLength(3);
    expect(data.snippets.foo).toEqual(JSON.parse(run.before).snippets.foo);
  });

  it('aborts before appending when another snippet is unresolved', () => {
    const run = runFixture({ extraArg: true, unmappedRecorded: true });
    expect(run.status, run.stderr).toBe(1);
    expect(run.stderr).toContain('SNIPPET_ANALYSIS_FAILED: bar: no function-name mapping found');
    expect(run.after).toBe(run.before);
  });

  it('appends into a recorded snippet with no args key', () => {
    const run = runFixture({ extraArg: true, xpathArgs: null });
    expect(run.status, run.stderr).toBe(2);
    expect(JSON.parse(run.after).snippets.xpath.args.map(a => a.name)).toEqual(['query', 'scope', 'extra']);
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
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('SNIPPET_ANALYSIS_FAILED:');
    expect(run.stdout).not.toContain('DRIFT_DETECTED');
    expect(run.stderr).toMatch(/must be a non-empty string/);
  });
});
