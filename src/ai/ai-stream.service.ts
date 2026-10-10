import type { StructuredToolInterface } from '@langchain/core/tools';
import type { Response } from 'express';

import { Injectable, Logger } from '@nestjs/common';
import { Inject } from '@nestjs/common';

import { toUIMessageStream } from '@ai-sdk/langchain';
import { Tool } from '@langchain/core/tools';
import { ChatOpenAI } from '@langchain/openai';
import {
  createUIMessageStream,
  pipeUIMessageStreamToResponse,
  UIMessageStreamWriter,
  type UIMessage,
} from 'ai';
import {
  BaseMessage,
  createAgent,
  HumanMessage,
  modelCallLimitMiddleware,
  summarizationMiddleware,
  tool,
  toolCallLimitMiddleware,
} from 'langchain';
import { AuthUser } from 'src/auth/auth-user.interface';
import { ChunkHit } from 'src/pipeline/types/pipeline.types';
import { TtsStreamPublisher } from 'src/speech/tts-stream.publisher';
import { MailService } from 'src/tools/mail.service';
import { WebSearchService } from 'src/tools/web-search.service';
import z from 'zod';

import { retrieveAndGrade, RetrieveEval } from './agentic-retrieve';
import {
  excerptRagContent,
  extractGeneratedImagesFromParts,
  lastUserText,
  mapReasoningStream,
} from './ai-stream.util';
import { ChatLongMemoryService } from './chat-long-memory.service';
import { dbRowsToMessages } from './chat-memory.util';
import { ChatQueryRewriteService, ChatRoutePlan } from './chat-query-rewrite.service';
import { ChatSessionService } from './chat-session.service';
import { ChatShortMemoryService } from './chat-short-memory.service';
import { ChatImageDto, ChatSourceDto } from './dto/chat-response.dto';
import { ChatStreamDto } from './dto/chat-stream.dto';
import { HybridRetrievalService } from './hybrid-retrieval.service';
import { titleFromQuestion } from './titleFromQuestion';

// KhUIMessage：用 data-* 扩展自定义 part（与前端类型对齐）
type KhUIMessage = UIMessage<
  unknown,
  {
    status: { stage: string; text: string };
    sources: ChatSourceDto[];
    retrieve: { query: string; items: Array<ChatSourceDto> };
    session: { sessionId: string };
    image: ChatImageDto;
    intent: {
      intent: ChatRoutePlan['intent'];
      label: string;
      query: string;
      allowRetrieve: boolean;
      allowWeb: boolean;
    };
    eval: RetrieveEval;
  }
>;

const SYSTEM =
  '你是企业知识库助手。结合对话历史与长期记忆理解用户意图。' +
  '制度/流程/负责人等事实优先根据本轮「检索到的资料」回答，不要用记忆替代文档。' +
  '资料不足、需要时效性或外部公开信息时，调用 web_search。' +
  '用户明确要求生成配图、海报、示意图且与知识库无关时，调用 generate_image，并在回复中给出返回的 url。' +
  '依据资料的陈述句末标 [n]，与资料编号一致。' +
  '联网结果用标题+链接说明，不要编造。资料不够就明确说不知道。';

@Injectable()
export class AiStreamService {
  private readonly logger = new Logger(AiStreamService.name);
  private readonly agent: ReturnType<typeof createAgent>;

  constructor(
    @Inject('WEB_SEARCH_TOOL') private readonly webSearchTool: Tool,
    @Inject('LLM_TOOL') private readonly llmTool: ChatOpenAI,
    @Inject('MAIL_TOOL') private readonly mailTool: MailService,
    @Inject('GENERATE_IMAGE_TOOL') private readonly generateImageTool: Tool,

    private readonly sessions: ChatSessionService,
    private readonly retrieval: HybridRetrievalService,
    private readonly ttsPublisher: TtsStreamPublisher,
    private readonly shortMemory: ChatShortMemoryService,
    private readonly queryRewrite: ChatQueryRewriteService,
    private readonly longMemory: ChatLongMemoryService,

    private readonly webSearchService: WebSearchService,
  ) {
    this.agent = createAgent({
      model: this.llmTool,
      tools: [this.webSearchTool, this.mailTool.tool, this.generateImageTool],
      systemPrompt: SYSTEM,
      middleware: [
        // 单次最多调 4 次模型，避免 web_search 循环打爆；超限正常结束
        modelCallLimitMiddleware({ runLimit: 4, exitBehavior: 'end' }),
        summarizationMiddleware({
          model: this.llmTool,
          trigger: { messages: 12 },
          keep: { messages: 6 },
          summaryPrompt:
            '用中文简洁总结对话：话题、已确认结论、待办。不要写入知识库条文。\n\n待摘要的对话：\n{messages}\n\n摘要：',
        }),
      ],
    });
  }

  /**
   * 按本轮意图挂工具。检索、改写、再检索由 Agent 循环调度，工具本身只做一步。
   */
  private createTurnAgent(
    user: AuthUser,
    topK: number,
    persistSources: ChatSourceDto[],
    writer: UIMessageStreamWriter<KhUIMessage>,
    plan: ChatRoutePlan,
    question: string,
  ) {
    if (!this.llmTool) return undefined;
    const retrieval = this.retrieval;
    const queryRewrite = this.queryRewrite;
    const search = this.webSearchService;
    const logger = this.logger;
    const tools: StructuredToolInterface[] = [];
    let retrieveCount = 0;
    let rewriteCount = 0;
    let webSearchCount = 0;
    let lastRetrieve: Awaited<ReturnType<typeof retrieveAndGrade>> | undefined;

    if (plan.allowRetrieve) {
      tools.push(
        tool(
          async (input: { query: string; topK?: number }) => {
            if (retrieveCount >= 2) {
              logger.warn(`retrieve_knowledge 已达上限仍被调用：query=${input.query.slice(0, 60)}`);
              return {
                query: input.query,
                items: [],
                insufficient: true,
                error: '本轮知识库最多检索两次，请停止调用检索/改写工具，直接作答或 web_search',
                stopTools: true,
              };
            }
            retrieveCount += 1;
            logger.log(`retrieve_knowledge #${retrieveCount}：query=${input.query.slice(0, 80)}`);
            const result = await retrieveAndGrade({
              question,
              query: input.query,
              topK: input.topK ?? topK,
              user,
              retrieval,
              rewrite: queryRewrite,
              retried: retrieveCount > 1,
              previousQuery: lastRetrieve?.usedQuery,
            });
            lastRetrieve = result;
            writer.write({ type: 'data-eval', data: result.eval });
            if (result.eval.reason === 'error') {
              logger.warn(`RAG 检索失败：${result.eval.text}`);
              return {
                query: result.usedQuery,
                items: [],
                error: result.eval.text,
                insufficient: true,
                eval: result.eval,
              };
            }
            if (!result.eval.ok) {
              return packRetrieveResult([], result.usedQuery, persistSources, writer, {
                insufficient: true,
                eval: result.eval,
                next:
                  retrieveCount < 2
                    ? '可调用 rewrite_query 后再 retrieve_knowledge 一次'
                    : plan.allowWeb
                      ? '知识库已两次不足，请 web_search 一次后作答，勿再检索'
                      : '知识库已两次不足，请直接说明没有相关内容，勿再检索',
              });
            }
            return packRetrieveResult(result.hits, result.usedQuery, persistSources, writer, {
              eval: result.eval,
              next: '资料已切题，请用 context 作答并标 [n]，勿再调用工具',
            });
          },
          {
            name: 'retrieve_knowledge',
            description:
              '检索企业知识库一次（仅当前用户可见文档）并评估是否切题。不会自动再查。eval.ok 为 false 时先 rewrite_query，再用新词再调本工具。本轮最多两次；达上限后禁止再调。',
            schema: z.object({
              query: z.string().min(1).describe('适合检索的关键词或短句'),
              topK: z.number().int().min(1).max(10).optional().describe('条数，默认与请求一致'),
            }),
          },
        ),
      );
      tools.push(
        tool(
          async (input: { focus?: string }) => {
            if (!lastRetrieve) {
              return { error: '请先调用 retrieve_knowledge' };
            }
            if (lastRetrieve.eval.ok) {
              return {
                error: '当前资料已切题，无需改写，请直接作答',
                query: lastRetrieve.usedQuery,
              };
            }
            if (retrieveCount >= 2) {
              return {
                error: '知识库已检索两次，禁止再改写；请作答或 web_search',
                previousQuery: lastRetrieve.usedQuery,
              };
            }
            if (rewriteCount >= 1) {
              logger.warn('rewrite_query 已达上限仍被调用');
              return {
                error: '本轮最多改写一次，请用已有 query 再 retrieve_knowledge，或作答/联网',
                previousQuery: lastRetrieve.usedQuery,
              };
            }
            rewriteCount += 1;
            writer.write({
              type: 'data-status',
              data: { stage: 'rewrite', text: '正在改写检索词…' },
            });
            const retryQuery = await queryRewrite.rewriteAfterRetrieve(
              question,
              lastRetrieve.usedQuery,
              lastRetrieve.grade,
              lastRetrieve.rawHits,
            );
            if (!retryQuery) {
              return {
                error: '无法改写出与上次不同的检索词，请直接作答或 web_search',
                previousQuery: lastRetrieve.usedQuery,
                reason: lastRetrieve.eval.text,
              };
            }
            return {
              query: retryQuery,
              previousQuery: lastRetrieve.usedQuery,
              reason: lastRetrieve.eval.text,
              focus: input.focus,
              next: '请立刻用返回的 query 再调用一次 retrieve_knowledge',
            };
          },
          {
            name: 'rewrite_query',
            description:
              '根据上次检索评估改写检索词。仅在首次 retrieve_knowledge 返回 insufficient 后调用一次，再把返回的 query 交给 retrieve_knowledge。本轮最多一次。',
            schema: z.object({
              focus: z.string().optional().describe('希望改写时强调的缺口，可空'),
            }),
          },
        ),
      );
    }

    if (plan.allowWeb) {
      tools.push(
        tool(
          async (input: { query: string; count?: number }) => {
            if (webSearchCount >= 1) {
              logger.warn(`web_search 已达上限仍被调用：query=${input.query.slice(0, 60)}`);
              return {
                query: input.query,
                items: [],
                error: '本轮最多联网一次，请根据已有结果直接作答，勿再调用工具',
              };
            }
            webSearchCount += 1;
            const result = await search.search({ query: input.query, count: input.count ?? 5 });
            return {
              ...result,
              next: '请根据以上联网结果作答，勿再调用任何工具',
            };
          },
          {
            name: 'web_search',
            description:
              '联网搜索公开信息（Bocha）。仅在知识库循环结束后仍 insufficient，或本轮只需公开时效信息时调用一次。调用后必须作答，不要重复搜索。',
            schema: z.object({
              query: z.string().min(1).describe('搜索关键词'),
              count: z.number().int().min(1).max(10).optional().describe('条数，默认 5'),
            }),
          },
        ),
      );
    }

    return createAgent({
      model: this.llmTool,
      tools,
      systemPrompt: systemForPlan(plan),
      middleware: [
        summarizationMiddleware({
          model: this.llmTool,
          trigger: { messages: 12 },
          keep: { messages: 6 },
          summaryPrompt:
            '用中文简洁总结对话：话题、已确认结论、待办。不要写入知识库条文。\n\n待摘要的对话：\n{messages}\n\n摘要：',
        }),
        // 业务预算：模型/工具次数；recursionLimit 另作图步数兜底
        modelCallLimitMiddleware({ runLimit: 6, exitBehavior: 'end' }),
        toolCallLimitMiddleware({ runLimit: 8, exitBehavior: 'end' }),
      ],
    });
  }

  async streamChat(dto: ChatStreamDto, user: AuthUser, res: Response) {
    const question = lastUserText(dto.messages);
    const topK = dto.topK ?? 5;
    const enableTts = dto.enableTts === true;

    let persistSessionId = dto.sessionId;
    let persistSources: ChatSourceDto[] = [];
    let workingHistory: BaseMessage[] = [];

    // TTS 需前端先用同一 sessionId 连 WS；新建会话时提前落库拿到 id
    if (enableTts && question) {
      const session = dto.sessionId
        ? await this.sessions.touchTitle(user.userId, dto.sessionId, question)
        : await this.sessions.create(user.userId, {
            title: titleFromQuestion(question),
          });
      persistSessionId = session.id;
    }

    // SDK 只管 UI Message 协议；会话 / RAG / data-* / Agent 流在 execute 里编排
    let stream = createUIMessageStream<KhUIMessage>({
      execute: async ({ writer }) => {
        writer.write({ type: 'start' });

        if (!question) {
          writer.write({ type: 'text-start', id: 'empty' });
          writer.write({
            type: 'text-delta',
            id: 'empty',
            delta: '请输入问题。',
          });
          writer.write({ type: 'text-end', id: 'empty' });
          writer.write({ type: 'finish' });
          return;
        }

        // ——— 1) 会话 ———
        if (!persistSessionId) {
          const session = dto.sessionId
            ? await this.sessions.touchTitle(user.userId, dto.sessionId, question)
            : await this.sessions.create(user.userId, {
                title: titleFromQuestion(question),
              });
          persistSessionId = session.id;
        }
        writer.write({
          type: 'data-session',
          data: { sessionId: persistSessionId },
        });

        const sessionId = persistSessionId!;

        // ——— 2) 历史 + 意图路由（检索改由 Agent 工具环调度）———
        const history = await this.loadWorkingHistory(user.userId, sessionId);
        workingHistory = history;

        writer.write({
          type: 'data-status',
          data: { stage: 'intent', text: '正在识别意图…' },
        });
        const plan = await this.queryRewrite.classify(question, history);
        writer.write({
          type: 'data-intent',
          data: {
            intent: plan.intent,
            label: plan.label,
            query: plan.query,
            allowRetrieve: plan.allowRetrieve,
            allowWeb: plan.allowWeb,
          },
        });

        const memHits = await this.longMemory.search(user.userId, sessionId, question);
        const agent = this.createTurnAgent(user, topK, persistSources, writer, plan, question);

        if (!agent) {
          writer.write({
            type: 'error',
            errorText: '未配置 LLM Key，无法生成回答',
          });
          writer.write({ type: 'finish' });
          return;
        }

        // ——— 3) 按意图挂工具的 Agent 流 → UI Message 流 ———
        const memoryMsg = this.longMemory.buildSystemMessage(memHits);
        const human = [
          plan.allowRetrieve ? `建议检索词（可按问题改写后再检索）：${plan.query}` : '',
          `用户问题：${question}`,
        ]
          .filter(Boolean)
          .join('\n\n');

        // recursionLimit：LangGraph 超步数（默认 25）。beforeModel 摘要会额外占步，
        // 须明显高于 model/tool 业务上限，避免空转时先抛 GRAPH_RECURSION_LIMIT。
        const langchainStream = await agent.stream(
          {
            messages: [
              ...(memoryMsg ? [memoryMsg] : []),
              ...history,
              new HumanMessage(human),
            ],
          },
          { streamMode: ['messages', 'tools'], recursionLimit: 40 },
        );

        writer.merge(
          toUIMessageStream(mapReasoningStream(langchainStream) as never, {
            sendStart: false,
            sendFinish: false,
            onError: (error) => {
              this.logger.warn(`LangChain 流失败：${error.message}`);
            },
          }) as never,
        );
      },

      // ——— 4) 流结束后落库（课 16）———
      onFinish: async ({ responseMessage }) => {
        const parts = responseMessage?.parts ?? [];
        const answer = parts
          .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
          .map((p) => p.text)
          .join('')
          .trim();
        const used = new Set([...answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])));
        const sources = used.size ? persistSources.filter((s) => used.has(s.index)) : [];
        const images = extractGeneratedImagesFromParts(parts);
        if (!question || !persistSessionId) return;
        const finalAnswer = answer || '未能生成回答。';
        try {
          await this.sessions.appendTurn(
            user.userId,
            persistSessionId,
            question,
            finalAnswer,
            sources,
            images,
          );
          await this.shortMemory.appendTurn(
            user.userId,
            persistSessionId,
            workingHistory,
            question,
            finalAnswer,
          );
          void this.longMemory.rememberTurn(user.userId, persistSessionId, question, finalAnswer);
        } catch (error) {
          this.logger.warn(`流式对话落库失败：${error instanceof Error ? error.message : error}`);
        }
      },
      onError: (error) => (error instanceof Error ? error.message : String(error)),
    });

    if (enableTts && persistSessionId && question) {
      stream = this.ttsPublisher.pipeUiMessageStream(stream, persistSessionId, question);
    }

    await pipeUIMessageStreamToResponse({ response: res, stream });
  }

  private toSources(hits: ChunkHit[]): ChatSourceDto[] {
    return hits.map((hit, i) => ({
      index: i + 1,
      documentId: hit.documentId,
      documentTitle: hit.documentTitle,
      heading: hit.heading,
      excerpt: excerptRagContent(hit.content),
      score: hit.score,
    }));
  }

  private buildContext(hits: ChunkHit[]): string {
    return hits
      .map((src, i) => {
        const heading = src.heading ? ` / ${src.heading}` : '';
        const snippet = src.content.length > 800 ? `${src.content.slice(0, 800)}...` : src.content;
        return `[${i + 1}] ${src.documentTitle}${heading}\n${snippet}`;
      })
      .join('\n\n');
  }

  /** load → rewrite → 并行 RAG/Mem0 → 拼 prompt，供 Agent 流使用 */
  private async prepareAgentTurn(params: {
    userId: string;
    sessionId: string;
    question: string;
    topK: number;
  }) {
    const { userId, sessionId, question, topK } = params;

    const history = await this.loadWorkingHistory(userId, sessionId);
    const plan = await this.queryRewrite.rewrite(question, history);

    let hits: ChunkHit[] = [];
    let memHits = { user: [] as string[], session: [] as string[] };
    try {
      [hits, memHits] = await Promise.all([
        plan.needRetrieve
          ? this.retrieval.retrieve(plan.query, topK)
          : Promise.resolve([] as ChunkHit[]),
        this.longMemory.search(userId, sessionId, plan.query),
      ]);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn(`RAG/Mem0 准备失败：${detail}`);
    }

    const memoryMsg = this.longMemory.buildSystemMessage(memHits);
    const prompt = hits.length
      ? `检索到的资料：\n${this.buildContext(hits)}\n\n用户问题：${question}`
      : `用户问题：${question}`;

    return { history, plan, hits, memHits, memoryMsg, prompt };
  }

  private async loadWorkingHistory(
    userId: string,
    sessionId: string | undefined,
  ): Promise<BaseMessage[]> {
    if (!sessionId) return [];
    const cached = await this.shortMemory.tryLoad(userId, sessionId);
    if (cached) return cached;
    const rows = await this.sessions.listRecentMessages(
      userId,
      sessionId,
      this.shortMemory.windowSize,
    );
    const history = dbRowsToMessages(rows);
    if (history.length) {
      await this.shortMemory.save(userId, sessionId, history);
    }
    return history;
  }
}

/** 命中写入 citations，并推 data-sources；context 给模型，excerpt 给前端。 */
function packRetrieveResult(
  hits: ChunkHit[],
  query: string,
  persistSources: ChatSourceDto[],
  writer: UIMessageStreamWriter<KhUIMessage>,
  extra: Record<string, unknown> = {},
) {
  const offset = persistSources.length;
  const sources = hits.map((hit, i) => ({
    index: offset + i + 1,
    documentId: hit.documentId,
    documentTitle: hit.documentTitle,
    heading: hit.heading,
    excerpt: excerptRagContent(hit.content),
    score: hit.score,
  }));
  persistSources.push(...sources);
  writer.write({
    type: 'data-sources',
    data: persistSources,
  });
  for (const src of sources) {
    writer.write({
      type: 'source-document',
      sourceId: src.documentId,
      mediaType: 'text/markdown',
      title: `[${src.index}] ${src.documentTitle}`,
    });
  }
  return {
    query,
    items: sources.map((src) => ({
      index: src.index,
      documentId: src.documentId,
      documentTitle: src.documentTitle,
      heading: src.heading,
      excerpt: src.excerpt,
    })),
    context: hits
      .map((hit, i) => {
        const src = sources[i];
        const heading = hit.heading ? ` / ${hit.heading}` : '';
        const snippet = hit.content.length > 800 ? `${hit.content.slice(0, 800)}...` : hit.content;
        return `[${src.index}] ${hit.documentTitle}${heading}\n${snippet}`;
      })
      .join('\n\n'),
    ...extra,
  };
}

/** Agent 循环：检索 → 评估 → 不足则改写再检索 → 仍不足才联网 → 作答。 */
function systemForPlan(plan: ChatRoutePlan) {
  let prompt =
    '你是企业知识库助手，必须按 Agentic RAG 循环作答，不要跳步。' +
    '结合对话历史和记忆里的用户背景，但制度/流程以本轮检索资料为准。' +
    `本轮意图：${plan.label}。`;
  if (plan.allowRetrieve) {
    prompt +=
      `建议检索词「${plan.query}」，可改写成更准的 query。` +
      '循环：① retrieve_knowledge；② 若 eval.ok 则用 context 作答并标 [n]，立刻停止调工具；' +
      '③ 若 insufficient，rewrite_query 最多一次，再用新词 retrieve_knowledge 一次（知识库总共最多两次）；' +
      '④ 两次后仍不足再 web_search 最多一次，然后必须作答。' +
      '禁止在工具返回 error/stopTools/next 要求停止后继续调工具。不要第三次检索，不要第二次改写或联网。' +
      '不要用记忆替代文档。';
  } else {
    prompt += '不要调用 retrieve_knowledge 或 rewrite_query。';
  }
  if (plan.intent === 'chitchat') {
    prompt += '这是闲聊，直接回应，不要调用任何工具。';
  }
  if (plan.intent === 'profile') {
    prompt += '这是个人偏好或身份问题，根据记忆回答，不要检索知识库。';
  }
  if (plan.intent === 'kb') {
    prompt += '两次检索后仍 insufficient：明确说知识库没有相关内容，禁止编造制度，不要联网。';
  }
  if (plan.intent === 'web') {
    prompt += '用 web_search 查一次公开信息后作答，用标题+链接说明，不要编造，不要重复搜索。';
  }
  if (plan.intent === 'kb_then_web') {
    prompt +=
      '先走完知识库循环；两次后仍 insufficient 再 web_search 一次后作答。联网结果用标题+链接说明，不要把网页写成内部制度。';
  }
  if (!plan.allowWeb) {
    prompt += '不要调用 web_search。';
  }
  prompt += '资料不够就明确说不知道。';
  return prompt;
}
