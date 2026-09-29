import type { Response } from 'express';

import { Injectable, Logger } from '@nestjs/common';
import { Inject } from '@nestjs/common';

import { toUIMessageStream } from '@ai-sdk/langchain';
import { Tool } from '@langchain/core/tools';
import { ChatOpenAI } from '@langchain/openai';
import { createUIMessageStream, pipeUIMessageStreamToResponse, type UIMessage } from 'ai';
import {
  BaseMessage,
  createAgent,
  HumanMessage,
  modelCallLimitMiddleware,
  summarizationMiddleware,
} from 'langchain';
import { AuthUser } from 'src/auth/auth-user.interface';
import { ChunkHit } from 'src/pipeline/types/pipeline.types';
import { TtsStreamPublisher } from 'src/speech/tts-stream.publisher';

import { excerptRagContent, lastUserText, mapReasoningStream } from './ai-stream.util';
import { ChatLongMemoryService } from './chat-long-memory.service';
import { dbRowsToMessages } from './chat-memory.util';
import { ChatQueryRewriteService } from './chat-query-rewrite.service';
import { ChatSessionService } from './chat-session.service';
import { ChatShortMemoryService } from './chat-short-memory.service';
import { ChatSourceDto } from './dto/chat-response.dto';
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
  }
>;

const SYSTEM =
  '你是企业知识库助手。结合对话历史与长期记忆理解用户意图。' +
  '制度/流程/负责人等事实优先根据本轮「检索到的资料」回答，不要用记忆替代文档。' +
  '资料不足、需要时效性或外部公开信息时，调用 web_search。' +
  '依据资料的陈述句末标 [n]，与资料编号一致。' +
  '联网结果用标题+链接说明，不要编造。资料不够就明确说不知道。';

@Injectable()
export class AiStreamService {
  private readonly logger = new Logger(AiStreamService.name);
  private readonly agent: ReturnType<typeof createAgent>;

  constructor(
    @Inject('WEB_SEARCH_TOOL') private readonly webSearchTool: Tool,
    @Inject('LLM_TOOL') private readonly llmTool: ChatOpenAI,
    private readonly sessions: ChatSessionService,
    private readonly retrieval: HybridRetrievalService,
    private readonly ttsPublisher: TtsStreamPublisher,
    private readonly shortMemory: ChatShortMemoryService,
    private readonly queryRewrite: ChatQueryRewriteService,
    private readonly longMemory: ChatLongMemoryService,
  ) {
    this.agent = createAgent({
      model: this.llmTool,
      tools: [this.webSearchTool],
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

        // ——— 2) 记忆 + 改写 + 检索 ———
        writer.write({
          type: 'data-status',
          data: { stage: 'rewrite', text: '正在理解问题…' },
        });

        const turn = await this.prepareAgentTurn({
          userId: user.userId,
          sessionId,
          question,
          topK,
        });
        workingHistory = turn.history;

        writer.write({
          type: 'data-status',
          data: { stage: 'retrieve', text: '正在检索知识库…' },
        });

        const sources = this.toSources(turn.hits);
        persistSources = sources;
        writer.write({
          type: 'data-retrieve',
          data: {
            query: turn.plan.query,
            items: sources.map((src) => ({
              index: src.index,
              documentId: src.documentId,
              documentTitle: src.documentTitle,
              heading: src.heading,
              excerpt: src.excerpt,
              score: src.score,
            })),
          },
        });
        writer.write({ type: 'data-sources', data: sources });
        for (const src of sources) {
          writer.write({
            type: 'source-document',
            sourceId: src.documentId,
            mediaType: 'text/markdown',
            title: `[${src.index}] ${src.documentTitle}`,
          });
        }

        if (!this.agent) {
          writer.write({
            type: 'error',
            errorText: '未配置 LLM Key，无法生成回答',
          });
          writer.write({ type: 'finish' });
          return;
        }

        // ——— 3) Agent 流 → UI Message 流 ———
        const langchainStream = await this.agent.stream(
          {
            messages: [
              ...(turn.memoryMsg ? [turn.memoryMsg] : []),
              ...turn.history,
              new HumanMessage(turn.prompt),
            ],
          },
          // messages：token/思考；tools：tool 调用（第 6 步挂上后才有）
          { streamMode: ['messages', 'tools'] },
        );

        writer.merge(
          toUIMessageStream(mapReasoningStream(langchainStream) as never, {
            // 外层已写 start；结束由 createUIMessageStream 收口
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
        if (!question || !persistSessionId) return;
        const finalAnswer = answer || '未能生成回答。';
        try {
          await this.sessions.appendTurn(
            user.userId,
            persistSessionId,
            question,
            finalAnswer,
            sources,
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
