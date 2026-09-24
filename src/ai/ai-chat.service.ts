import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { AuthUser } from 'src/auth/auth-user.interface';

import { ChunkHit } from '../pipeline/types/pipeline.types';
import { ChatSessionService } from './chat-session.service';
import { ChatResponseDto, ChatSourceDto } from './dto/chat-response.dto';
import { HybridRetrievalService } from './hybrid-retrieval.service';

const EXCERPT_LEN = 200;
const CITATION_RE = /\[(\d+)\]/g;

@Injectable()
export class AiChatService {
  private readonly logger = new Logger(AiChatService.name);
  private readonly llm?: ChatOpenAI;

  constructor(
    config: ConfigService,
    private readonly retrieval: HybridRetrievalService,
    private readonly sessions: ChatSessionService,
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

    const hits = await this.retrieval.retrieve(trimmed, topK);
    if (!hits.length) {
      const empty = { answer: '知识库里没有相关内容。', sources: [] as ChatSourceDto[] };
      const session = user
        ? await this.sessions.appendTurn(
            user.userId,
            sessionId,
            trimmed,
            empty.answer,
            empty.sources,
          )
        : null;
      return { sessionId: session?.id ?? sessionId ?? null, ...empty };
    }
    if (!this.llm) {
      throw new ServiceUnavailableException('未配置 LLM API Key');
    }

    const context = this.buildContext(hits);
    const response = await this.llm.invoke([
      new SystemMessage(
        '你是企业知识库助手。只根据「检索到的资料」回答。' +
          '依据某条资料必须在句末标注 [1]、[2]。' +
          '编号与资料列表一致，不要编造标题或链接。',
      ),
      new HumanMessage(`检索到的资料：\n${context}\n\n用户问题：${trimmed}`),
    ]);

    const answer =
      typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
    const sources = this.toCitedSources(answer, hits);

    const session = user
      ? await this.sessions.appendTurn(user.userId, sessionId, trimmed, answer, sources)
      : null;

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
}
