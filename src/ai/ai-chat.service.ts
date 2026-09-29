import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { AuthUser } from 'src/auth/auth-user.interface';

import { ChunkHit } from '../pipeline/types/pipeline.types';
import { ChatLongMemoryService } from './chat-long-memory.service';
import { dbRowsToMessages } from './chat-memory.util';
import { ChatQueryRewriteService } from './chat-query-rewrite.service';
import { ChatSessionService } from './chat-session.service';
import { ChatShortMemoryService } from './chat-short-memory.service';
import { ChatResponseDto, ChatSourceDto } from './dto/chat-response.dto';
import { HybridRetrievalService } from './hybrid-retrieval.service';

const EXCERPT_LEN = 200;
const CITATION_RE = /\[(\d+)\]/g;
const CHAT_SYSTEM =
  '你是企业知识库助手。结合对话历史与长期记忆理解用户意图。' +
  '制度/流程/负责人等事实只根据本轮「检索到的资料」回答，不要用记忆替代文档。' +
  '依据某条资料必须在句末标注 [1]、[2]。编号与资料列表一致，不要编造标题或链接。';

@Injectable()
export class AiChatService {
  private readonly logger = new Logger(AiChatService.name);
  private readonly llm?: ChatOpenAI;

  constructor(
    config: ConfigService,
    private readonly retrieval: HybridRetrievalService,
    private readonly sessions: ChatSessionService,
    private readonly shortMemory: ChatShortMemoryService,
    private readonly queryRewrite: ChatQueryRewriteService,
    private readonly longMemory: ChatLongMemoryService,
  ) {
    const apiKey = config.get('OPENAI_API_KEY') || config.get('DASHSCOPE_API_KEY') || undefined;
    if (!apiKey) return;
    this.llm = new ChatOpenAI({
      apiKey,
      model: config.get('MODEL_NAME', 'qwen-plus'),
      temperature: 0.2,
      timeout: Number(config.get('AI_CHAT_TIMEOUT_MS', 60000)),
      configuration: {
        baseURL: config.get('OPENAI_BASE_URL', 'https://dashscope.aliyuncs.com/compatible-mode/v1'),
      },
      modelKwargs: {
        enable_thinking: true,
      },
    });
  }

  async chat(
    question: string,
    topK = 5,
    user?: AuthUser,
    sessionId?: string,
  ): Promise<ChatResponseDto> {
    const trimmed = question.trim();
    if (!trimmed) return { sessionId: sessionId ?? null, answer: '请输入问题。', sources: [] };
    if (!this.llm) {
      throw new ServiceUnavailableException('未配置 LLM API Key');
    }

    const history = user
      ? await this.loadWorkingHistory(user.userId, sessionId)
      : [];
    const plan = await this.queryRewrite.rewrite(trimmed, history);
    const [hits, memHits] = await Promise.all([
      plan.needRetrieve
        ? this.retrieval.retrieve(plan.query, topK)
        : Promise.resolve([] as ChunkHit[]),
      user
        ? this.longMemory.search(user.userId, sessionId, plan.query)
        : Promise.resolve({ user: [] as string[], session: [] as string[] }),
    ]);

    const memoryMsg = this.longMemory.buildSystemMessage(memHits);
    const userTurn = hits.length
      ? `检索到的资料：\n${this.buildContext(hits)}\n\n用户问题：${trimmed}`
      : `用户问题：${trimmed}`;

    const response = await this.llm.invoke([
      new SystemMessage(CHAT_SYSTEM),
      ...(memoryMsg ? [memoryMsg] : []),
      ...history,
      new HumanMessage(userTurn),
    ]);

    const answer =
      typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
    const sources = hits.length ? this.toCitedSources(answer, hits) : [];

    const session = user
      ? await this.sessions.appendTurn(user.userId, sessionId, trimmed, answer, sources)
      : null;

    if (user && session) {
      await this.shortMemory.appendTurn(user.userId, session.id, history, trimmed, answer);
      void this.longMemory.rememberTurn(user.userId, session.id, trimmed, answer);
    }

    return { sessionId: session?.id ?? sessionId ?? null, answer, sources };
  }

  /**
   * 从回答中解析 [n] 引用，映射为命中块来源列表。
   * 若回答里没有任何合法引用，则兜底返回全部命中块。
   */
  private toCitedSources(answer: string, hits: ChunkHit[]): ChatSourceDto[] {
    const cited = new Set<number>();
    for (const match of answer.matchAll(CITATION_RE)) {
      const n = Number(match[1]);
      if (n >= 1 && n <= hits.length) cited.add(n);
    }
    const indexes = cited.size > 0 ? [...cited].sort((a, b) => a - b) : hits.map((_, i) => i + 1);
    return indexes.map((index) => ({
      index,
      documentId: hits[index - 1].documentId,
      documentTitle: hits[index - 1].documentTitle,
      heading: hits[index - 1].heading,
      excerpt: this.excerpt(hits[index - 1].content),
      score: hits[index - 1].score,
    }));
  }

  private excerpt(content: string) {
    const text = content.replace(/\s+/g, ' ').trim();
    return text.length <= EXCERPT_LEN ? text : `${text.slice(0, EXCERPT_LEN)}...`;
  }

  private buildContext(hits: ChunkHit[]) {
    return hits
      .map((src, i) => {
        const heading = src.heading ? ` / ${src.heading}` : '';
        const snippet = src.content.length > 800 ? `${src.content.slice(0, 800)}...` : src.content;
        return `[${i + 1}] ${src.documentTitle}${heading}\n${snippet}`;
      })
      .join('\n\n');
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
