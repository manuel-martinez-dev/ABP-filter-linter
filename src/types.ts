export type Severity = 'error' | 'warning';

export interface LintResult {
  message: string;
  severity: Severity;
  /** start char offset within the line */
  startCol: number;
  /** end char offset within the line */
  endCol: number;
}
