import * as vscode from 'vscode';
import { parseLine, isAbpDocument } from './parser';
import { splitSnippetChain, validateSnippetCall, validateSnippetChain, validateSnippetBody, detectDuplicateCalls, detectMissingSnippetSeparator, detectMalformedSnippetSeparator, snippetChainRequiresDomain } from './validators/snippets';
import { validateNetworkRule } from './validators/network';
import { validateCosmeticSelector } from './validators/cosmetic';
import { validateExtendedSelector } from './validators/extended';
import { detectDoubleComma, detectDomainListEdges, detectSpacesInDomains, detectTrailingWhitespace, buildDuplicateKey } from './validators/syntax';
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

  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

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

  const lint = (doc: vscode.TextDocument) => {
    if (doc.languageId !== 'plaintext' || !doc.uri.fsPath.endsWith('.txt')) return;
    const lines = doc.getText().split(/\r?\n/); // strip \r so CRLF files don't trigger false space errors

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
    const seen = new Map<string, number>();

    for (let i = 0; i < lines.length; i++) {
      const parsed = parseLine(lines[i], i);
      const results: LintResult[] = [];

      if (parsed.type === 'comment' || parsed.type === 'unknown') continue;

      const doubleComma = detectDoubleComma(lines[i]);
      if (doubleComma) diagnostics.push(toDiagnostic(doubleComma, i, doc));

      const domainListEdges = detectDomainListEdges(lines[i]);
      if (domainListEdges) diagnostics.push(toDiagnostic(domainListEdges, i, doc));

      const spacesInDomains = detectSpacesInDomains(lines[i]);
      if (spacesInDomains) diagnostics.push(toDiagnostic(spacesInDomains, i, doc));

      const trailingWs = detectTrailingWhitespace(lines[i]);
      if (trailingWs) diagnostics.push(toDiagnostic(trailingWs, i, doc));

      // generic #@# exceptions are valid ABP syntax — only #?# requires a domain
      if (parsed.type === 'extended' && parsed.domains.length === 0) {
        const sep = parsed.separator;
        const range = new vscode.Range(i, 0, i, lines[i].length);
        const diag = new vscode.Diagnostic(
          range,
          `"${sep}" filter must have a domain (e.g. example.com${sep}...)`,
          vscode.DiagnosticSeverity.Error
        );
        diag.source = 'abp-filter-linter';
        diagnostics.push(diag);
      }

      if (parsed.type === 'snippet') {
        const calls = splitSnippetChain(parsed.body);

        if (parsed.domains.length === 0 && snippetChainRequiresDomain(calls)) {
          const sep = parsed.separator;
          const range = new vscode.Range(i, 0, i, lines[i].length);
          const diag = new vscode.Diagnostic(
            range,
            `"${sep}" filter must have a domain (e.g. example.com${sep}...)`,
            vscode.DiagnosticSeverity.Error
          );
          diag.source = 'abp-filter-linter';
          diagnostics.push(diag);
        }

        results.push(...validateSnippetBody(parsed.body, parsed.bodyOffset));
        results.push(...validateSnippetChain(calls, parsed.bodyOffset));
        results.push(...detectDuplicateCalls(calls, parsed.bodyOffset));
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
          const malformedSep = detectMalformedSnippetSeparator(parsed.raw);
          if (malformedSep) results.push(malformedSep);
        }
      }

      if (parsed.type === 'cosmetic' || parsed.type === 'hiding-exception') {
        results.push(...validateCosmeticSelector(parsed.body, parsed.bodyOffset));
      }

      if (parsed.type === 'extended') {
        results.push(...validateExtendedSelector(parsed.body, parsed.bodyOffset));
      }

      for (const r of results) {
        diagnostics.push(toDiagnostic(r, i, doc));
      }

      // duplicate detection (merged into primary pass)
      const key = buildDuplicateKey(parsed);
      if (key !== null) {
        if (seen.has(key)) {
          const range = new vscode.Range(i, 0, i, lines[i].length);
          const diag = new vscode.Diagnostic(range, 'Duplicate filter', vscode.DiagnosticSeverity.Warning);
          diag.source = 'abp-filter-linter';
          diagnostics.push(diag);
        } else {
          seen.set(key, i);
        }
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
    vscode.workspace.onDidChangeTextDocument(e => {
      const key = e.document.uri.toString();
      clearTimeout(debounceTimers.get(key));
      debounceTimers.set(key, setTimeout(() => lint(e.document), 300));
    }),
    vscode.workspace.onDidCloseTextDocument(doc => {
      const key = doc.uri.toString();
      clearTimeout(debounceTimers.get(key));
      debounceTimers.delete(key);
    }),
    vscode.workspace.onDidDeleteFiles(e => {
      for (const file of e.files) {
        const key = file.toString();
        clearTimeout(debounceTimers.get(key));
        debounceTimers.delete(key);
        collection.delete(file);
      }
    }),
    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (editor) applyDecorations(editor);
    }),
  );

  vscode.workspace.textDocuments.forEach(doc => { try { lint(doc); } catch (e) { console.error(e); } });

  context.subscriptions.push(
    vscode.commands.registerCommand('abp-filter-linter.lintWorkspace', async () => {
      const uris = await vscode.workspace.findFiles('**/*.txt', '**/node_modules/**');
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Linting workspace .txt files…', cancellable: false },
        async () => {
          for (const uri of uris) {
            const doc = await vscode.workspace.openTextDocument(uri);
            lint(doc);
          }
        }
      );
    })
  );
}

export function deactivate() {}
