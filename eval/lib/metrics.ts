// eval/lib/metrics.ts
export type ChatIntent = 'chitchat' | 'profile' | 'kb' | 'web' | 'kb_then_web';

export type IntentCaseResult = {
  id: string;
  expectIntent: ChatIntent;
  predIntent: ChatIntent;
  expectAllowGraph: boolean;
  predAllowGraph: boolean;
  expectAllowWeb: boolean;
  predAllowWeb: boolean;
};

export function summarizeIntentResults(rows: IntentCaseResult[]) {
  const confusion: Record<string, Record<string, number>> = {};
  let intentOk = 0;
  let graphOk = 0;
  let webOk = 0;
  const failures: IntentCaseResult[] = [];

  for (const row of rows) {
    if (!confusion[row.expectIntent]) confusion[row.expectIntent] = {};
    confusion[row.expectIntent][row.predIntent] =
      (confusion[row.expectIntent][row.predIntent] ?? 0) + 1;
    if (row.expectIntent === row.predIntent) intentOk += 1;
    if (row.expectAllowGraph === row.predAllowGraph) graphOk += 1;
    if (row.expectAllowWeb === row.predAllowWeb) webOk += 1;
    if (
      row.expectIntent !== row.predIntent ||
      row.expectAllowGraph !== row.predAllowGraph ||
      row.expectAllowWeb !== row.predAllowWeb
    ) {
      failures.push(row);
    }
  }

  const total = rows.length || 1;
  return {
    total: rows.length,
    intentAccuracy: intentOk / total,
    allowGraphAccuracy: graphOk / total,
    allowWebAccuracy: webOk / total,
    confusion,
    failures,
  };
}
