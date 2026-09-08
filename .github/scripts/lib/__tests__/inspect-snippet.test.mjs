import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptsDir = fileURLToPath(new URL('../../', import.meta.url));

function inspect(name) {
  const root = mkdtempSync(path.join(tmpdir(), 'snippet-inspect-'));
  try {
    const pkg = path.join(root, 'node_modules/@eyeo/snippets');
    mkdirSync(path.join(root, 'lib'), { recursive: true });
    mkdirSync(path.join(pkg, 'webext'), { recursive: true });
    copyFileSync(path.join(scriptsDir, 'inspect-snippet.mjs'), path.join(root, 'inspect-snippet.mjs'));
    copyFileSync(path.join(scriptsDir, 'lib/snippet-diff.mjs'), path.join(root, 'lib/snippet-diff.mjs'));
    writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: '@eyeo/snippets', version: '2.15.0' }));
    writeFileSync(path.join(pkg, 'webext/snippets.source.mjs'),
      'function setDebug(pattern) { return pattern; } const snippets$1 = { "debug": setDebug };');
    writeFileSync(path.join(pkg, 'webext/isolated-heavy.source.mjs'),
      'function hideIfMatchesXPath3(query, scopeQuery) { return query; } const snippets = { "hide-if-matches-xpath3": hideIfMatchesXPath3 };');
    return spawnSync(process.execPath, [path.join(root, 'inspect-snippet.mjs'), name], { encoding: 'utf8', cwd: root });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('inspect-snippet', () => {
  it.each([
    ['debug', 'snippets.source.mjs', 'setDebug(pattern) { return pattern; }'],
    ['hide-if-matches-xpath3', 'isolated-heavy.source.mjs', 'hideIfMatchesXPath3(query, scopeQuery) { return query; }'],
  ])('prints the source of %s', (name, file, body) => {
    const run = inspect(name);
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain(`Snippet:  ${name}`);
    expect(run.stdout).toContain(`Source:   ${file}`);
    expect(run.stdout).toContain(`function ${body}`);
  });

  it('reports unknown snippets after checking both bundles', () => {
    const run = inspect('missing-snippet');
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('Snippet "missing-snippet" not found');
  });
});
