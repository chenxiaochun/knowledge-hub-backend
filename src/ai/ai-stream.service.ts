import type { Response } from 'express';

import { Injectable, Logger } from '@nestjs/common';
import { Inject } from '@nestjs/common';

import { toUIMessageStream } from '@ai-sdk/langchain';
import { Tool } from '@langchain/core/tools';
import { ChatOpenAI } from '@langchain/openai';
import { createUIMessageStream, pipeUIMessageStreamToResponse, type UIMessage } from 'ai';
import { createAgent, HumanMessage, modelCallLimitMiddleware } from 'langchain';
import { AuthUser } from 'src/auth/auth-user.interface';
import { ChunkHit } from 'src/pipeline/types/pipeline.types';

import { ChatSessionService } from './chat-session.service';
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

const EXCERPT_LEN = 200;

const SYSTEM =
  '你是企业知识库助手。优先根据「检索到的资料」回答。' +
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
  ) {
    this.agent = createAgent({
      model: this.llmTool,
      tools: [this.webSearchTool],
      systemPrompt: SYSTEM,
      middleware: [
        // 单次最多调 4 次模型，避免 web_search 循环打爆；超限正常结束
        modelCallLimitMiddleware({ runLimit: 4, exitBehavior: 'end' }),
      ],
    });
  }

  async streamChat(dto: ChatStreamDto, user: AuthUser, res: Response) {
    const question = lastUserText(dto.messages);
    const topK = dto.topK ?? 5;

    let persistSessionId = dto.sessionId;
    let persistSources: ChatSourceDto[] = [];

    // SDK 只管 UI Message 协议；会话 / RAG / data-* / Agent 流在 execute 里编排
    const stream = createUIMessageStream<KhUIMessage>({
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
        const session = dto.sessionId
          ? await this.sessions.touchTitle(user.userId, dto.sessionId, question)
          : await this.sessions.create(user.userId, {
              title: titleFromQuestion(question),
            });
        persistSessionId = session.id;
        writer.write({
          type: 'data-session',
          data: { sessionId: session.id },
        });

        // ——— 2) 检索 ———
        writer.write({
          type: 'data-status',
          data: { stage: 'retrieve', text: '正在检索知识库…' },
        });

        let hits: ChunkHit[] = [];
        try {
          hits = await this.retrieval.retrieve(question, topK);
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          this.logger.warn(`RAG 检索失败：${detail}`);
        }

        const sources = this.toSources(hits);
        persistSources = sources;
        writer.write({
          type: 'data-retrieve',
          data: {
            query: question,
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
        const prompt = hits.length
          ? `检索到的资料：\n${this.buildContext(hits)}\n\n用户问题：${question}`
          : `知识库没有召回到相关内容。\n\n用户问题：${question}`;

        const langchainStream = await this.agent.stream(
          { messages: [new HumanMessage(prompt)] },
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
        try {
          await this.sessions.appendTurn(
            user.userId,
            persistSessionId,
            question,
            answer || '未能生成回答。',
            sources,
          );
        } catch (error) {
          this.logger.warn(`流式对话落库失败：${error instanceof Error ? error.message : error}`);
        }
      },
      onError: (error) => (error instanceof Error ? error.message : String(error)),
    });

    await pipeUIMessageStreamToResponse({ response: res, stream });
  }

  private toSources(hits: ChunkHit[]): ChatSourceDto[] {
    return hits.map((hit, i) => ({
      index: i + 1,
      documentId: hit.documentId,
      documentTitle: hit.documentTitle,
      heading: hit.heading,
      excerpt: excerpt(hit.content),
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
}

/**
 *
 * @param messages - 消息列表
 * @returns 最后一个用户消息的文本
 */
function lastUserText(messages: ChatStreamDto['messages'] | undefined): string {
  if (!messages?.length) return '';
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg.role !== 'user') continue;
    const text = (msg.parts ?? [])
      .filter((p) => p.type === 'text' && p.text)
      .map((p) => p.text)
      .join('');
    return text.trim();
  }
  return '';
}

/**
 * 百炼兼容口把思考放在 reasoning_content；
 * @ai-sdk/langchain 只认 additional_kwargs.reasoning.summary，这里转一下。
 */
async function* mapReasoningStream(stream: AsyncIterable<unknown>): AsyncIterable<unknown> {
  for await (const event of stream) {
    attachDashScopeReasoning(event);
    yield event;
  }
}

/** 递归改写；seen 防循环引用 */
function attachDashScopeReasoning(value: unknown, seen = new Set<object>()): void {
  if (value == null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) attachDashScopeReasoning(item, seen);
    return;
  }
  const obj = value as Record<string, unknown>;
  const kwargs = obj.additional_kwargs as Record<string, unknown> | undefined;
  if (typeof kwargs?.reasoning_content === 'string' && kwargs.reasoning_content) {
    kwargs.reasoning = {
      summary: [{ type: 'summary_text', text: kwargs.reasoning_content }],
    };
  }
  attachDashScopeReasoning(obj.chunk, seen);
  attachDashScopeReasoning(obj.data, seen);
  attachDashScopeReasoning(obj.kwargs, seen);
  attachDashScopeReasoning(obj.messages, seen);
}

function excerpt(content: string) {
  const text = content.replace(/\s+/g, ' ').trim();
  if (text.length <= EXCERPT_LEN) return text;
  return `${text.slice(0, EXCERPT_LEN)}...`;
}
