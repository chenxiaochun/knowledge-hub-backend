import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ChunkHit } from '../pipeline/types/pipeline.types';

@Injectable()
export class RerankerService {
  private readonly logger = new Logger(RerankerService.name);
  private readonly enabled: boolean;
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly endpoint: string;

  constructor(config: ConfigService) {
    this.enabled = config.get('RAG_RERANK_ENABLED', 'true') !== 'false';
    this.apiKey =
      config.get('RERANK_API_KEY') ||
      config.get('DASHSCOPE_API_KEY') ||
      config.get('OPENAI_API_KEY') ||
      undefined;
    this.model = config.get('RAG_RERANK_MODEL', 'qwen3-rerank');
    const host = config.get('RERANK_BASE_URL', 'https://dashscope.aliyuncs.com');
    this.endpoint = `${host.replace(/\/$/, '')}/api/v1/services/rerank/text-rerank/text-rerank`;
  }

  isEnabled() {
    return this.enabled && Boolean(this.apiKey);
  }

  /**
   * 重排，返回重排后的命中块列表
   * @param query - 查询关键词
   * @param candidates - 候选命中块列表
   * @param topN - 返回的命中块数量
   * @returns 重排后的命中块列表
   */
  async rerank(query: string, candidates: ChunkHit[], topN: number): Promise<ChunkHit[] | null> {
    if (!candidates.length) return [];
    if (!this.isEnabled()) {
      this.logger.warn('Reranker 未启用或未配置 Key，跳过重排');
      return null;
    }
    const documents = candidates.map((hit) => {
      const heading = hit.heading ? `${hit.heading}\n` : '';
      const text = `${hit.documentTitle}\n${heading}${hit.content}`.trim();
      return text.length > 2000 ? `${text.slice(0, 2000)}...` : text;
    });
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          input: { query, documents },
          parameters: { return_documents: false, top_n: Math.min(topN, candidates.length) },
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        this.logger.warn(`Rerank 调用失败：status=${response.status}`);
        return null;
      }
      const results = body.output?.results ?? [];
      if (!results.length) return null;
      return results
        .filter((item: { index: number }) => item.index >= 0 && item.index < candidates.length)
        .map((item: { index: number; relevance_score: number }) => ({
          ...candidates[item.index],
          score: item.relevance_score,
        }));
    } catch (error) {
      this.logger.warn(`Rerank 异常，降级为 RRF：${error}`);
      return null;
    }
  }
}
