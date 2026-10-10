import type { AuthUser } from '../auth/auth-user.interface';
import type { ChunkHit } from '../pipeline/types/pipeline.types';
import type { ChatQueryRewriteService, HitGrade } from './chat-query-rewrite.service';
import type { HybridRetrievalService } from './hybrid-retrieval.service';

/** 推给前端 data-eval；ok 表示资料切题，不是「有条数」。 */
export type RetrieveEvalReason =
  /** 首轮检索切题 */
  | 'ok'
  /** 改写后再查切题 */
  | 'retried_ok'
  /** 首轮无命中 */
  | 'empty'
  /** 改写后再查仍无命中 */
  | 'retried_empty'
  /** 首轮有命中但不切题 */
  | 'irrelevant'
  /** 改写后再查仍不切题 */
  | 'retried_irrelevant'
  /** 检索接口失败 */
  | 'error';

export type RetrieveEval = {
  /** 是否可作为制度依据 */
  ok: boolean;
  reason: RetrieveEvalReason;
  /** 给过程条看的一句中文 */
  text: string;
  /** 是否已经走过改写再查 */
  retried: boolean;
  /** 首轮检索词 */
  query: string;
  /** 改写后的检索词（仅再查时有） */
  retryQuery?: string;
};

export type GradedRetrieve = {
  /** 原始命中，给改写器用；不切题时不要当制度依据 */
  rawHits: ChunkHit[];
  /** 切题才有，给模型引用 */
  hits: ChunkHit[];
  grade: HitGrade; // 切题判断原文
  eval: RetrieveEval; // 推给前端过程条
  usedQuery: string; // 本轮实际用来检索的词
};

/** 无命中时的评估占位，不再调模型 */
const EMPTY_GRADE: HitGrade = { ok: false, reason: 'empty', text: '未检索到资料' };

/** 单次检索 + 切题评估。Agent loop 每次工具调用走这里。 */
export async function retrieveAndGrade(opts: {
  question: string; // 用户原问题，评估切题时对照这个
  query: string; // 本轮检索词（建议词或改写后的词）
  topK: number; // 返回条数
  user?: AuthUser; // 可见范围：公开 / 所在团队 / 自己写的
  retrieval: HybridRetrievalService; // ES 混合检索
  rewrite: ChatQueryRewriteService; // 只用来 gradeHits，这里不改写
  retried?: boolean; // 是否已是改写后的第二次检索
  previousQuery?: string; // 首轮检索词，填 eval.query 用
}): Promise<GradedRetrieve> {
  const usedQuery = opts.query.trim() || opts.question;
  const retried = Boolean(opts.retried);
  const displayQuery = retried ? opts.previousQuery || usedQuery : usedQuery;
  const retryQuery = retried ? usedQuery : undefined;

  try {
    const rawHits = await opts.retrieval.retrieve(usedQuery, opts.topK);
    const grade = await opts.rewrite.gradeHits(opts.question, rawHits);
    return {
      rawHits,
      hits: grade.ok ? rawHits : [],
      grade,
      eval: toEval(grade, displayQuery, retried, retryQuery),
      usedQuery,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      rawHits: [],
      hits: [],
      grade: { ...EMPTY_GRADE, text: `检索失败：${detail}` },
      eval: {
        ok: false,
        reason: 'error',
        text: retried ? '改写后再次检索失败' : '检索失败',
        retried,
        query: displayQuery,
        retryQuery,
      },
      usedQuery,
    };
  }
}

/**
 * 无 Agent 时的等价环：查一次 → 评估 → 不足则改写再查一次。
 * 给非流式 /ai/chat 用。
 */
export async function retrieveUntilRelevant(opts: {
  question: string; // 用户原问题
  query: string; // 首轮检索词（一般是意图改写后的建议词）
  topK: number; // 返回条数
  user?: AuthUser; // 文档可见范围
  retrieval: HybridRetrievalService; // ES 混合检索
  rewrite: ChatQueryRewriteService; // 评估切题 + 不足时改写
  onEval?: (data: RetrieveEval) => void; // 每次评估后回调（流式可推过程条）
  onRewrite?: (retryQuery: string) => void; // 即将用新词再查时回调
}): Promise<{ hits: ChunkHit[]; eval: RetrieveEval; usedQuery: string }> {
  const first = await retrieveAndGrade({
    question: opts.question,
    query: opts.query,
    topK: opts.topK,
    user: opts.user,
    retrieval: opts.retrieval,
    rewrite: opts.rewrite,
  });
  opts.onEval?.(first.eval);
  if (first.eval.ok || first.eval.reason === 'error') {
    return { hits: first.hits, eval: first.eval, usedQuery: first.usedQuery };
  }

  const retryQuery = await opts.rewrite.rewriteAfterRetrieve(
    opts.question,
    first.usedQuery,
    first.grade,
    first.rawHits,
  );
  if (!retryQuery) {
    return { hits: [], eval: first.eval, usedQuery: first.usedQuery };
  }

  opts.onRewrite?.(retryQuery);
  const second = await retrieveAndGrade({
    question: opts.question,
    query: retryQuery,
    topK: opts.topK,
    user: opts.user,
    retrieval: opts.retrieval,
    rewrite: opts.rewrite,
    retried: true,
    previousQuery: first.usedQuery,
  });
  opts.onEval?.(second.eval);
  return { hits: second.hits, eval: second.eval, usedQuery: second.usedQuery };
}

function toEval(
  grade: HitGrade, // gradeHits 的结果
  query: string, // 首轮检索词，展示在 eval.query
  retried: boolean, // 是否改写后再查
  retryQuery?: string, // 第二次用的词
): RetrieveEval {
  if (grade.reason === 'relevant') {
    return {
      ok: true,
      reason: retried ? 'retried_ok' : 'ok',
      text: retried ? `已改写再查，${grade.text}` : grade.text,
      retried,
      query,
      retryQuery,
    };
  }
  if (grade.reason === 'empty') {
    return {
      ok: false,
      reason: retried ? 'retried_empty' : 'empty',
      text: retried ? '改写后仍无结果' : grade.text,
      retried,
      query,
      retryQuery,
    };
  }
  return {
    ok: false,
    reason: retried ? 'retried_irrelevant' : 'irrelevant',
    text: retried ? `改写后仍不切题：${grade.text}` : grade.text,
    retried,
    query,
    retryQuery,
  };
}
