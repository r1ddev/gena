export type ImportIssue = { sheet: string; row: number; message: string };

export function summarizeImportIssues(issues: ImportIssue[]) {
  const counts = new Map<string, number>();
  for (const issue of issues) counts.set(issue.message, (counts.get(issue.message) ?? 0) + 1);
  return [...counts].map(([message, count]) => ({ message, count }));
}
