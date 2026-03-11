import * as vscode from 'vscode';
import { parseLine, isAbpDocument } from './parser';
import { splitSnippetChain, validateSnippetCall, validateSnippetChain, validateSnippetBody, detectMissingSnippetSeparator } from './validators/snippets';
import { validateNetworkRule } from './validators/network';
import { validateCosmeticSelector } from './validators/cosmetic';
import { validateExtendedSelector } from './validators/extended';
import { toDiagnostic } from './diagnostics';
import type { LintResult } from './types';

const COLLECTION_NAME = 'abp-filter-linter';

export function activate(context: vscode.ExtensionContext) {
  const collection = vscode.languages.createDiagnosticCollection(COLLECTION_NAME);

  const errorLineDecoration = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: 'rgba(255, 0, 0, 0.08)',
    overviewRulerColor: 'rgba(255, 0, 0, 0.6)',
    overviewRulerLane: vscode.OverviewRulerLane.Right,
  });

  const warningLineDecoration = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: 'rgba(255, 200, 0, 0.07)',
    overviewRulerColor: 'rgba(255, 200, 0, 0.6)',
    overviewRulerLane: vscode.OverviewRulerLane.Right,
  });

  context.subscriptions.push(collection, errorLineDecoration, warningLineDecoration);

  function applyDecorations(editor: vscode.TextEditor) {
    const diags = collection.get(editor.document.uri) ?? [];
    const errorRanges = diags
      .filter(d => d.severity === vscode.DiagnosticSeverity.Error)
      .map(d => d.range);
    const warningRanges = diags
      .filter(d => d.severity === vscode.DiagnosticSeverity.Warning)
      .map(d => d.range);
    editor.setDecorations(errorLineDecoration, errorRanges);
    editor.setDecorations(warningLineDecoration, warningRanges);
  }

  const lint = async (doc: vscode.TextDocument) => {
    if (doc.languageId !== 'plaintext' || !doc.uri.fsPath.endsWith('.txt')) return;
    const lines = doc.getText().split('\n');

    if (!isAbpDocument(lines)) {
      collection.delete(doc.uri);
      for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document.uri.toString() === doc.uri.toString()) {
          editor.setDecorations(errorLineDecoration, []);
          editor.setDecorations(warningLineDecoration, []);
        }
      }
      return;
    }

    const diagnostics: vscode.Diagnostic[] = [];

    for (let i = 0; i < lines.length; i++) {
      const parsed = parseLine(lines[i], i);
      const results: LintResult[] = [];

      if (parsed.type === 'comment' || parsed.type === 'unknown') continue;

      if (parsed.type === 'snippet') {
        results.push(...validateSnippetBody(parsed.body, parsed.bodyOffset));
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
        if (parsed.type === 'network') {
          const missingSep = detectMissingSnippetSeparator(parsed.raw);
          if (missingSep) results.push(missingSep);
        }
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

    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.toString() === doc.uri.toString()) {
        applyDecorations(editor);
      }
    }
  };

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(lint),
    vscode.workspace.onDidChangeTextDocument(e => lint(e.document)),
    vscode.workspace.onDidDeleteFiles(e => {
      for (const file of e.files) collection.delete(file);
    }),
    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (editor) applyDecorations(editor);
    }),
  );

  vscode.workspace.textDocuments.forEach(doc => lint(doc).catch(console.error));

  vscode.workspace.findFiles('**/*.txt', '**/node_modules/**').then(uris => {
    for (const uri of uris) {
      vscode.workspace.openTextDocument(uri).then(doc => lint(doc).catch(console.error));
    }
  });
}

export function deactivate() {}
