import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
/**
 * LangChain 用 Node AsyncLocalStorage 保存当前 Runnable 的 config（含 callbacks/tags）。
 * Agent 流式跑起来后，子 invoke 会继承这套上下文，structured output 的 token 可能进 messages 流。
 * runWithConfig 在回调里临时换成空 callbacks，跑完恢复；第三参 true 表示不再挂 tracing 根节点。
 */
import { AsyncLocalStorageProviderSingleton } from '@langchain/core/singletons';
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';

import type { ChunkHit } from '../pipeline/types/pipeline.types';

import { compactRewriteContext } from './chat-memory.util';

/**
 * Agent 流式运行时，当前 callbacks 存在 AsyncLocalStorage 里。
 * 工具里再 invoke 评估/改写模型会默认继承这套上下文，内部 JSON 会进 messages 流、变成回答正文。
 * runWithConfig 在这段调用里换成空 callbacks，跑完自动恢复；第三个 true 表示不要再挂 tracing 根节点。
 * tags / metadata 是双保险，万一还有事件漏出，流过滤能按 kh-internal 丢掉。
 */
function invokeIsolated<T>(run: () => Promise<T>): Promise<T> {
  return AsyncLocalStorageProviderSingleton.runWithConfig(
    {
      callbacks: [],
      tags: ['kh-internal'],
      metadata: { khInternal: true },
    },
    run,
    true,
  );
}

/** 本轮路由意图。kb = knowledge base（知识库） */
export const CHAT_INTENTS = [
  'chitchat', // 问好、致谢、与库无关的闲聊
  'profile', // 只问/改用户自己的名字、部门、回答偏好
  'kb', // 公司制度、流程、岗位、内部系统
  'web', // 只要公开时效信息
  'kb_then_web', // 先查知识库，不够再联网
] as const;

export type ChatIntent = (typeof CHAT_INTENTS)[number];

/** 意图识别结果：同时给出改写检索词，以及本轮允许哪些工具。 */
export type ChatRoutePlan = {
  intent: ChatIntent;
  label: string;
  /** 消解指代后的独立短查询，给 RAG / 联网用 */
  query: string;
  /** kb / kb_then_web 才挂 retrieve_knowledge */
  allowRetrieve: boolean;
  /** web / kb_then_web 才挂 web_search */
  allowWeb: boolean;
};

/** JSON 对话接口用的精简形态；流式走 ChatRoutePlan */
export type RetrieveQueryPlan = {
  query: string;
  needRetrieve: boolean;
};

/** 一轮检索后的切题判断。empty 不调模型。 */
export type HitGrade = {
  ok: boolean;
  reason:
    /** 没有 chunk 命中 */
    | 'empty'
    /** 命中能支撑作答 */
    | 'relevant'
    /** 有命中但主题不是同一件事 */
    | 'irrelevant';
  text: string;
};

/** 意图在过程条上的中文名 */
const INTENT_LABEL: Record<ChatIntent, string> = {
  chitchat: '闲聊',
  profile: '个人偏好',
  kb: '知识库',
  web: '联网搜索',
  kb_then_web: '知识库，不足则联网',
};

/** 意图识别的结构化输出 */
const routeSchema = z.object({
  intent: z
    .enum(CHAT_INTENTS)
    .describe(
      'chitchat=寒暄闲聊；profile=只改用户自己的名字/偏好；kb=制度流程岗位系统；web=只要公开时效信息；kb_then_web=先查库不够再搜网',
    ),
  standalone_query: z.string().describe('可独立检索的一句中文短查询，消解指代。闲聊/偏好可原样'),
});

/** 检索切题评估的结构化输出 */
const gradeSchema = z.object({
  relevant: z
    .boolean()
    .describe('只要有能支撑作答的资料即为 true；仅关键词沾边、主题不是同一件事为 false'),
  reason: z.string().describe('一句中文：为何切题或不切题'),
});

/** 不足后改写检索词的结构化输出 */
const retryRewriteSchema = z.object({
  query: z.string().describe('与上次不同的一句中文检索词，不超过 40 字，针对用户原问题'),
});

const rewriteSchema = z.object({
  standalone_query: z.string().describe('可独立检索的一句中文短查询，消解指代和省略，不含寒暄'),
  need_retrieve: z.boolean().describe('是否需要查知识库。寒暄、致谢、与制度无关的闲聊为 false'),
});

const REWRITE_PROMPT =
  '你是企业知识库的检索改写器。根据对话把当前问题改写成一条可独立检索的短查询。\n' +
  '\n' +
  '## 要求\n' +
  '- 消解「这个 / 那个 / 谁负责 / 怎么办」等指代，补全省略的主题\n' +
  '- 只保留检索需要的实体、事项、动作，一句中文，尽量不超过 40 字\n' +
  '- 不要编造上文没出现的专有名词、条款号、系统名\n' +
  '- 不要复述助手给出的制度条文、时限、流程细节\n' +
  '- 当前问题已经完整、不依赖上文时，standalone_query 用原问题略作精炼即可\n' +
  '- 寒暄、致谢、与知识库无关 → need_retrieve=false，standalone_query 仍给原问题\n' +
  '- 输出不要解释\n' +
  '\n' +
  '请严格以 JSON 对象格式输出，字段：standalone_query（string）、need_retrieve（boolean）。' +
  '不要 markdown 代码块，不要额外解释。';

/** 判断命中资料是否针对用户问题 */
const GRADE_PROMPT =
  '你是企业知识库的检索评估器。判断命中资料能否回答用户问题。\n' +
  '\n' +
  '- 切题：同一主题、同一制度/岗位/流程，能支撑作答（不必覆盖每个细节）\n' +
  '- 不切题：只是词沾边（如问加班餐补却命中差旅报销）、或完全另一件事\n' +
  '- 只根据给定标题和摘录判断，不要假设库里还有别的文档\n' +
  '- 输出不要解释字段以外的内容\n' +
  '\n' +
  '请严格以 JSON 对象格式输出，字段：relevant（boolean）、reason（string）。' +
  '不要 markdown 代码块，不要额外解释。';

/** 不足时换一种问法再查知识库 */
const RETRY_REWRITE_PROMPT =
  '你是企业知识库的检索改写器。上次检索不足，请换一种问法再查。\n' +
  '\n' +
  '- 紧扣用户原问题，不要跑题\n' +
  '- 不要重复上次检索词\n' +
  '- 可换同义、补全制度/岗位/补贴类型等核心实体\n' +
  '- 不要编造条款号、专有名词\n' +
  '- 一句中文，尽量不超过 40 字\n' +
  '\n' +
  '请严格以 JSON 对象格式输出，字段：query（string）。' +
  '不要 markdown 代码块，不要额外解释。';

/** 本轮意图 + 建议检索词（进 Agent 前只跑一次） */
const ROUTE_PROMPT =
  '你是企业知识库的意图与检索改写器。根据对话判断本轮意图，并给出一条可检索短查询。\n' +
  '\n' +
  '## intent\n' +
  '- chitchat：问好、致谢、与库无关的闲聊（如「你好」「谢谢」「在吗」）\n' +
  '- profile：只问/改「我自己」的名字、我所在部门、回答长短偏好。主语必须是用户本人\n' +
  '- kb：公司制度、流程、岗位、内部系统、文档\n' +
  '- web：只要最新公开信息，明显不是内部制度\n' +
  '- kb_then_web：像内部问题但也可能要外部时效（政策新闻+内部流程）\n' +
  '\n' +
  '## 易混\n' +
  '- 「你好 / 谢谢 / 在吗」→ chitchat，不要查知识库\n' +
  '- 「我是哪个部门 / 以后回答短一点」→ profile\n' +
  '- 「预算审核员属于哪个部门」→ kb，不要因为出现「部门」就判 profile\n' +
  '- 记忆里的用户部门不能改变本题意图\n' +
  '\n' +
  '## standalone_query\n' +
  '- 消解「这个 / 谁负责 / 怎么办」，补全省略主题，一句中文，尽量不超过 40 字\n' +
  '- 不要编造上文没有的专有名词、条款号\n' +
  '- 不要复述助手已给出的制度条文\n' +
  '- 闲聊/偏好：用原问题即可\n' +
  '- 输出不要解释\n' +
  '\n' +
  '请严格以 JSON 对象格式输出，字段：intent（string）、standalone_query（string）。' +
  '不要 markdown 代码块，不要额外解释。';

@Injectable()
export class ChatQueryRewriteService {
  private readonly logger = new Logger(ChatQueryRewriteService.name);
  private readonly router?: {
    invoke: (messages: unknown[]) => Promise<z.infer<typeof routeSchema>>;
  };
  private readonly rewriter?: {
    invoke: (messages: unknown[]) => Promise<z.infer<typeof rewriteSchema>>;
  };
  private readonly grader?: {
    invoke: (messages: unknown[]) => Promise<z.infer<typeof gradeSchema>>;
  };
  private readonly retryWriter?: {
    invoke: (messages: unknown[]) => Promise<z.infer<typeof retryRewriteSchema>>;
  };

  constructor(@Inject('LLM_TOOL') private readonly llmTool: ChatOpenAI) {
    this.router = llmTool.withStructuredOutput(routeSchema) as ChatQueryRewriteService['router'];
    this.grader = llmTool.withStructuredOutput(gradeSchema) as ChatQueryRewriteService['grader'];
    this.retryWriter = llmTool.withStructuredOutput(
      retryRewriteSchema,
    ) as ChatQueryRewriteService['retryWriter'];
    this.rewriter = llmTool.withStructuredOutput(
      rewriteSchema,
    ) as ChatQueryRewriteService['rewriter'];
  }

  /** 失败时：明显闲聊走 chitchat，否则按 kb，宁可多检索也不漏内部制度。 */
  async classify(question: string, history: BaseMessage[]): Promise<ChatRoutePlan> {
    if (isObviousChitchat(question)) {
      const plan = this.toPlan('chitchat', question);
      this.logger.log(`意图：${plan.intent}（规则） query=${plan.query.slice(0, 80)}`);
      return plan;
    }

    const fallback = this.toPlan('kb', question);
    if (!this.router) return fallback;

    const context = compactRewriteContext(history);
    try {
      const result = await invokeIsolated(() =>
        this.router!.invoke([
          new SystemMessage(ROUTE_PROMPT),
          new HumanMessage(
            context ? `对话：\n${context}\n\n当前问题：${question}` : `当前问题：${question}`,
          ),
        ]),
      );
      const query = result.standalone_query.trim() || question;
      const plan = this.toPlan(result.intent, query);
      this.logger.log(`意图：${plan.intent} query=${plan.query.slice(0, 80)}`);
      return plan;
    } catch (error) {
      this.logger.warn(
        `意图识别失败，按知识库处理：${error instanceof Error ? error.message : error}`,
      );
      return fallback;
    }
  }

  /**
   * 检索改写,如果对话历史为空，则返回原问题
   * @param question - 问题
   * @param history - 对话历史
   * @returns 检索改写计划
   */
  async rewrite(question: string, history: BaseMessage[]): Promise<RetrieveQueryPlan> {
    const fallback: RetrieveQueryPlan = { query: question, needRetrieve: true };
    if (!history.length || !this.rewriter) return fallback;

    const context = compactRewriteContext(history);
    if (!context) return fallback;

    try {
      const result = await invokeIsolated(() =>
        this.rewriter!.invoke([
          new SystemMessage(REWRITE_PROMPT),
          new HumanMessage(`对话：\n${context}\n\n当前问题：${question}`),
        ]),
      );
      const query = result.standalone_query.trim() || question;
      this.logger.log(`检索改写：needRetrieve=${result.need_retrieve} query=${query.slice(0, 80)}`);
      return { query, needRetrieve: result.need_retrieve };
    } catch (error) {
      this.logger.warn(
        `检索改写失败，使用原问题：${error instanceof Error ? error.message : error}`,
      );
      return fallback;
    }
  }

  /** 有命中再判切题；空结果不调模型。评估失败时有召回则放行，避免误杀。 */
  async gradeHits(question: string, hits: ChunkHit[]): Promise<HitGrade> {
    if (!hits.length) {
      return { ok: false, reason: 'empty', text: '未检索到资料' };
    }
    if (!this.grader) {
      return { ok: true, reason: 'relevant', text: '有召回（未配置评估模型）' };
    }
    try {
      const result = await invokeIsolated(() =>
        this.grader!.invoke([
          new SystemMessage(GRADE_PROMPT),
          new HumanMessage(`用户问题：${question}\n\n命中资料：\n${summarizeHits(hits)}`),
        ]),
      );
      const ok = result.relevant;
      const text = result.reason.trim() || (ok ? '资料切题' : '资料不切题');
      this.logger.log(`检索评估：${ok ? '切题' : '不切题'} ${text.slice(0, 80)}`);
      return { ok, reason: ok ? 'relevant' : 'irrelevant', text };
    } catch (error) {
      this.logger.warn(
        `检索评估失败，按有召回放行：${error instanceof Error ? error.message : error}`,
      );
      return { ok: true, reason: 'relevant', text: '评估失败，按有召回处理' };
    }
  }

  /**
   * 首轮空或不切题后改写检索词。
   * 失败或与上次相同则回退用户原问题；原问题也相同则返回空字符串表示无法再查。
   */
  async rewriteAfterRetrieve(
    question: string,
    previousQuery: string,
    grade: HitGrade,
    hits: ChunkHit[],
  ): Promise<string> {
    const fallback = distinctQuery(question, previousQuery);
    if (!this.retryWriter) return fallback;

    try {
      const hitBlock = hits.length
        ? `\n上次命中（不切题）：\n${summarizeHits(hits, 3)}`
        : '\n上次无命中。';
      const result = await invokeIsolated(() =>
        this.retryWriter!.invoke([
          new SystemMessage(RETRY_REWRITE_PROMPT),
          new HumanMessage(
            `用户问题：${question}\n上次检索词：${previousQuery}\n不足原因：${grade.text}${hitBlock}`,
          ),
        ]),
      );
      const query = distinctQuery(result.query.trim(), previousQuery);
      if (query) {
        this.logger.log(`检索改写：${previousQuery.slice(0, 40)} → ${query.slice(0, 40)}`);
        return query;
      }
      return fallback;
    } catch (error) {
      this.logger.warn(
        `检索改写失败，回退原问题：${error instanceof Error ? error.message : error}`,
      );
      return fallback;
    }
  }

  /** 意图 → 工具开关。识别失败时 classify 会落到 kb，避免内部问题漏检。 */
  private toPlan(intent: ChatIntent, query: string): ChatRoutePlan {
    const kb = intent === 'kb' || intent === 'kb_then_web';
    return {
      intent,
      label: INTENT_LABEL[intent],
      query,
      allowRetrieve: kb,
      allowWeb: intent === 'web' || intent === 'kb_then_web',
    };
  }
}

function summarizeHits(hits: ChunkHit[], limit = 5): string {
  return hits
    .slice(0, limit)
    .map((hit, i) => {
      const heading = hit.heading ? ` / ${hit.heading}` : '';
      const snippet = hit.content.replace(/\s+/g, ' ').trim().slice(0, 180);
      const score = Number.isFinite(hit.score) ? hit.score.toFixed(2) : '-';
      return `${i + 1}. ${hit.documentTitle}${heading}（分=${score}）\n${snippet}`;
    })
    .join('\n');
}

function distinctQuery(next: string, previous: string): string {
  const query = next.replace(/\s+/g, ' ').trim();
  if (!query) return '';
  if (query === previous.replace(/\s+/g, ' ').trim()) return '';
  return query;
}

/** 纯寒暄短句，不调模型也不挂检索工具 */
function isObviousChitchat(question: string): boolean {
  const text = question.replace(/\s+/g, '').replace(/[!！?？.。,~～]+$/g, '');
  if (!text || text.length > 12) return false;
  return /^(你好|您好|嗨|哈喽|hello|hi|在吗|在不在|早上好|中午好|下午好|晚上好|谢谢|多谢|感谢|拜拜|再见|ok|好的|嗯|哦)$/i.test(
    text,
  );
}
