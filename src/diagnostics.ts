import * as vscode from 'vscode';
import type { LintResult } from './types';

export function toDiagnostic(
  result: LintResult,
  lineIndex: number,
  doc: vscode.TextDocument
): vscode.Diagnostic {
  const line = doc.lineAt(lineIndex);
  const start = new vscode.Position(lineIndex, Math.min(result.startCol, line.text.length));
  const end = new vscode.Position(lineIndex, Math.min(result.endCol, line.text.length));
  const range = new vscode.Range(start, end);

  const severity =
    result.severity === 'error'
      ? vscode.DiagnosticSeverity.Error
      : vscode.DiagnosticSeverity.Warning;

  const diagnostic = new vscode.Diagnostic(range, result.message, severity);
  diagnostic.source = 'abp-filter-linter';
  return diagnostic;
}
