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

/** 命中文本（标题+正文拼接）是否覆盖全部期望关键词 */
export function hitAtK(blob: string, keywords: string[]): boolean {
  if (!keywords.length) return true;
  const text = blob.toLowerCase();
  return keywords.every((kw) => text.includes(kw.trim().toLowerCase()));
}

/** top-k 命中里是否包含任一期望 documentId */
export function docHitAtK(docIds: string[], mustDocIds: string[]): boolean {
  if (!mustDocIds.length) return true;
  const set = new Set(docIds.map(String));
  return mustDocIds.some((id) => set.has(String(id)));
}

/** top-k 标题是否包含任一期望子串 */
export function titleHitAtK(titles: string[], mustTitleContains: string[]): boolean {
  if (!mustTitleContains.length) return true;
  const lower = titles.map((t) => t.toLowerCase());
  return mustTitleContains.some((frag) =>
    lower.some((t) => t.includes(frag.trim().toLowerCase())),
  );
}

export type RetrievalCaseResult = {
  id: string;
  /** 本条所有启用检查是否通过 */
  ok: boolean;
  keywordOk: boolean | null;
  docOk: boolean | null;
  titleOk: boolean | null;
  gradeOk: boolean | null;
  gradeReason?: string;
  keywords: string[];
  missingKeywords: string[];
  mustDocIds: string[];
  hitDocIds: string[];
  hitCount: number;
  topK: number;
};

function rate(okCount: number, n: number): number | null {
  if (n === 0) return null;
  return okCount / n;
}

export function summarizeRetrievalResults(rows: RetrievalCaseResult[]) {
  const scored = {
    keyword: rows.filter((r) => r.keywordOk !== null),
    doc: rows.filter((r) => r.docOk !== null),
    title: rows.filter((r) => r.titleOk !== null),
    grade: rows.filter((r) => r.gradeOk !== null),
  };
  return {
    total: rows.length,
    overallAccuracy: rows.length ? rows.filter((r) => r.ok).length / rows.length : 0,
    keywordHitAtK: rate(
      scored.keyword.filter((r) => r.keywordOk).length,
      scored.keyword.length,
    ),
    docHitAtK: rate(scored.doc.filter((r) => r.docOk).length, scored.doc.length),
    titleHitAtK: rate(scored.title.filter((r) => r.titleOk).length, scored.title.length),
    gradeAccuracy: rate(scored.grade.filter((r) => r.gradeOk).length, scored.grade.length),
    failures: rows.filter((r) => !r.ok),
  };
}
