import * as vscode from 'vscode';
import { parseLine, isAbpDocument } from './parser';
import { splitSnippetChain, validateSnippetCall, validateSnippetChain } from './validators/snippets';
import { validateNetworkRule } from './validators/network';
import { validateCosmeticSelector } from './validators/cosmetic';
import { validateExtendedSelector } from './validators/extended';
import { toDiagnostic } from './diagnostics';
import type { LintResult } from './types';

const COLLECTION_NAME = 'abp-filter-linter';

export function activate(context: vscode.ExtensionContext) {
  const collection = vscode.languages.createDiagnosticCollection(COLLECTION_NAME);
  context.subscriptions.push(collection);

  const lint = async (doc: vscode.TextDocument) => {
    if (doc.languageId !== 'plaintext' || !doc.uri.fsPath.endsWith('.txt')) return;
    const lines = doc.getText().split('\n');

    if (!isAbpDocument(lines)) {
      collection.delete(doc.uri);
      return;
    }

    const diagnostics: vscode.Diagnostic[] = [];

    for (let i = 0; i < lines.length; i++) {
      const parsed = parseLine(lines[i], i);
      const results: LintResult[] = [];

      if (parsed.type === 'comment' || parsed.type === 'unknown') continue;

      if (parsed.type === 'snippet') {
        const calls = splitSnippetChain(parsed.body);
        results.push(...validateSnippetChain(calls, parsed.bodyOffset));
        for (const call of calls) {
          results.push(...validateSnippetCall(call, parsed.bodyOffset));
        }
      }

      if (parsed.type === 'network' || parsed.type === 'exception') {
        results.push(
          ...validateNetworkRule(parsed.body, parsed.type === 'exception', parsed.bodyOffset)
        );
      }

      if (parsed.type === 'cosmetic') {
        const cosmeticResults = await validateCosmeticSelector(parsed.body, parsed.bodyOffset);
        results.push(...cosmeticResults);
      }

      if (parsed.type === 'extended') {
        results.push(...validateExtendedSelector(parsed.body, parsed.bodyOffset));
      }

      for (const r of results) {
        diagnostics.push(toDiagnostic(r, i, doc));
      }
    }

    collection.set(doc.uri, diagnostics);
  };

  // Run on open and change
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(lint),
    vscode.workspace.onDidChangeTextDocument(e => lint(e.document)),
    vscode.workspace.onDidDeleteFiles(e => {
      for (const file of e.files) collection.delete(file);
    })
  );

  // Lint all already-open editor tabs
  vscode.workspace.textDocuments.forEach(doc => lint(doc).catch(console.error));

  // Lint all .txt files in the workspace (not just open tabs)
  vscode.workspace.findFiles('**/*.txt', '**/node_modules/**').then(uris => {
    for (const uri of uris) {
      vscode.workspace.openTextDocument(uri).then(doc => lint(doc).catch(console.error));
    }
  });
}

export function deactivate() {}
