import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { AuthUser } from 'src/auth/auth-user.interface';
import { WebSearchResult, WebSearchService } from 'src/tools/web-search.service';

import { accessFromUser } from '../document/document-access';
import { formatGraphSystemText, GraphBuildService } from '../graph/graph-build.service';
import { ChunkHit } from '../pipeline/types/pipeline.types';
import { retrieveUntilRelevant } from './agentic-retrieve';
import { ChatLongMemoryService } from './chat-long-memory.service';
import { dbRowsToMessages } from './chat-memory.util';
import { ChatQueryRewriteService, ChatRoutePlan } from './chat-query-rewrite.service';
import { ChatSessionService } from './chat-session.service';
import { ChatShortMemoryService } from './chat-short-memory.service';
import { applyMermaidDiagramPlan, wantsMermaidDiagram } from './diagram-intent';
import { ChatGraphDto, ChatResponseDto, ChatSourceDto } from './dto/chat-response.dto';
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
    private readonly graph: GraphBuildService,
    private readonly shortMemory: ChatShortMemoryService,
    private readonly queryRewrite: ChatQueryRewriteService,
    private readonly longMemory: ChatLongMemoryService,
    private readonly webSearchService: WebSearchService,
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

    const history = user ? await this.loadWorkingHistory(user.userId, sessionId) : [];
    const plan = applyMermaidDiagramPlan(
      await this.queryRewrite.classify(trimmed, history),
      trimmed,
    );
    const wantMermaid = wantsMermaidDiagram(trimmed);
    const access = user ? accessFromUser(user) : undefined;

    const kbP = plan.allowRetrieve
      ? retrieveUntilRelevant({
          question: trimmed,
          query: plan.query,
          topK,
          user,
          retrieval: this.retrieval,
          rewrite: this.queryRewrite,
        })
      : Promise.resolve(undefined);
    const graphP =
      plan.allowGraph && user && access && plan.graphQueries.length
        ? this.graph.retrieveForChat(plan.graphQueries, 8, access)
        : Promise.resolve(undefined);

    const [retrieved, graphHit] = await Promise.all([kbP, graphP]);

    let hits = [] as ChunkHit[];
    let kbInsufficient = false;
    let searchQuery = plan.query || trimmed;
    if (retrieved) {
      hits = retrieved.hits;
      kbInsufficient = !retrieved.eval.ok;
      searchQuery = retrieved.usedQuery || searchQuery;
    }

    const hasGraph = Boolean(graphHit?.entities.length || graphHit?.relations.length);

    // 仅当知识库不足且图谱也空时，才直接返回「没有相关内容」
    if (plan.intent === 'kb' && kbInsufficient && !hasGraph) {
      const emptyAnswer = '知识库里没有相关内容。';
      return this.persistAndReturn({
        user,
        sessionId,
        history,
        question: trimmed,
        answer: emptyAnswer,
        sources: [],
        graph: graphHit ?? null,
      });
    }

    const web =
      plan.allowWeb && (!plan.allowRetrieve || kbInsufficient)
        ? await this.webSearchService.search({ query: searchQuery })
        : undefined;

    const memHits = user
      ? await this.longMemory.search(user.userId, sessionId, trimmed)
      : { user: [] as string[], session: [] as string[] };
    const memoryMsg = this.longMemory.buildSystemMessage(memHits);
    const graphMsg = graphHit ? formatGraphSystemText(graphHit) : '';

    const userTurn = this.buildUserTurn(trimmed, hits, web);
    const response = await this.llm.invoke([
      new SystemMessage(
        systemPromptForPlan(
          plan,
          Boolean(hits.length),
          Boolean(web?.items?.length),
          hasGraph,
          wantMermaid,
        ),
      ),
      ...(memoryMsg ? [memoryMsg] : []),
      ...(graphMsg ? [new SystemMessage(graphMsg)] : []),
      ...history,
      new HumanMessage(userTurn),
    ]);

    const answer =
      typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
    const sources = hits.length ? this.toCitedSources(answer, hits) : [];

    return this.persistAndReturn({
      user,
      sessionId,
      history,
      question: trimmed,
      answer,
      sources,
      graph: graphHit ?? null,
    });
  }

  private async persistAndReturn(params: {
    user?: AuthUser;
    sessionId?: string;
    history: BaseMessage[];
    question: string;
    answer: string;
    sources: ChatSourceDto[];
    graph?: ChatGraphDto | null;
  }): Promise<ChatResponseDto> {
    const { user, sessionId, history, question, answer, sources, graph = null } = params;
    const session = user
      ? await this.sessions.appendTurn(
          user.userId,
          sessionId,
          question,
          answer,
          sources,
          [],
          graph,
        )
      : null;

    if (user && session) {
      await this.shortMemory.appendTurn(user.userId, session.id, history, question, answer);
      void this.longMemory.rememberTurn(user.userId, session.id, question, answer);
    }

    return { sessionId: session?.id ?? sessionId ?? null, answer, sources };
  }

  private buildUserTurn(question: string, hits: ChunkHit[], web?: WebSearchResult): string {
    const parts: string[] = [];
    if (hits.length) {
      parts.push(`检索到的资料：\n${this.buildContext(hits)}`);
    }
    if (web?.items?.length) {
      parts.push(
        `联网搜索结果：\n${web.items
          .map((item, i) => `${i + 1}. ${item.title}\n${item.url}\n${item.snippet}`)
          .join('\n\n')}`,
      );
    } else if (web?.error) {
      parts.push(`联网搜索失败：${web.error}`);
    }
    parts.push(`用户问题：${question}`);
    return parts.join('\n\n');
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

/** 非流式按意图拼系统提示（与流式 systemForPlan 语义对齐，但不谈工具名）。 */
function systemPromptForPlan(
  plan: ChatRoutePlan,
  hasKb: boolean,
  hasWeb: boolean,
  hasGraph: boolean,
  wantMermaid = false,
): string {
  let prompt =
    '你是企业知识库助手。结合对话历史与长期记忆理解用户意图。' + `本轮意图：${plan.label}。`;

  if (plan.intent === 'chitchat') {
    prompt += '这是闲聊，直接自然回应，不要编造制度或外部事实。';
    return prompt;
  }
  if (plan.intent === 'profile') {
    prompt += '这是个人偏好或身份问题，根据记忆回答，不要编造制度。';
    return prompt;
  }

  if (hasKb) {
    prompt +=
      '制度/流程/负责人等事实只根据本轮「检索到的资料」回答，不要用记忆替代文档。' +
      '依据某条资料必须在句末标注 [1]、[2]。编号与资料列表一致，不要编造标题或链接。';
  }
  if (hasGraph && !wantMermaid) {
    prompt +=
      '若有「本轮知识图谱」，只可用来理解实体关系与来源线索，不能当制度原文；制度以知识库检索资料为准。';
  }
  if (wantMermaid) {
    prompt +=
      '用户要求流程图/mermaid：必须输出完整 ```mermaid 代码块（flowchart），内容依据检索资料；不要用知识图谱代替。';
  }
  if (hasWeb) {
    prompt += '联网结果用标题+链接说明，不要编造，不要把网页写成内部制度。';
  }
  if (plan.intent === 'kb' && !hasKb && !hasGraph) {
    prompt += '知识库没有相关内容时明确说不知道，禁止编造制度。';
  }
  if (plan.intent === 'web' && !hasWeb) {
    prompt += '若没有可用的联网结果，明确说明无法查到，不要编造。';
  }
  if (plan.intent === 'kb_then_web' && !hasKb && !hasWeb && !hasGraph) {
    prompt += '知识库与联网均无可靠资料时，明确说不知道，不要编造。';
  }
  prompt += '资料不够就明确说不知道。';
  return prompt;
}
