import type { ChatRoutePlan } from './chat-query-rewrite.service';

/**
 * 用户要的是 Markdown mermaid 流程图，不是 Neo4j 知识图谱预取卡。
 * 「画流程图 / mermaid」与图谱检索抢注意力，需关掉 allowGraph。
 */
export function wantsMermaidDiagram(question: string): boolean {
  const q = question.replace(/\s+/g, '').toLowerCase();
  if (!q) return false;
  if (q.includes('mermaid')) return true;
  if (/流程图|时序图|状态图|类图|甘特图|er图|思维导图/.test(q)) return true;
  if (/flowchart|sequencediagram|statediagram/.test(q)) return true;
  // 「画一个/画成/画个 … 图」且非海报配图类
  if (/画(一[个张]|成|个).{0,12}图/.test(q) && !/海报|插画|配图|示意图片|生图/.test(q)) {
    return true;
  }
  return false;
}

/** 画 mermaid 时关闭图谱工具与预取，避免前端只出知识图谱卡 */
export function applyMermaidDiagramPlan(plan: ChatRoutePlan, question: string): ChatRoutePlan {
  if (!wantsMermaidDiagram(question)) return plan;
  if (!plan.allowGraph && !plan.graphQueries.length) return plan;
  return {
    ...plan,
    allowGraph: false,
    graphQueries: [],
  };
}
