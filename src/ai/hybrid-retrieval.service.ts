import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { EmbeddingService } from '../pipeline/embedding.service';
import { ChunkHit } from '../pipeline/types/pipeline.types';
import { VectorIndexService } from '../pipeline/vector-index.service';
import { RerankerService } from './reranker.service';

@Injectable()
export class HybridRetrievalService {
  private readonly logger = new Logger(HybridRetrievalService.name);
  private readonly hybridTopK: number;
  private readonly rrfC: number;

  constructor(
    config: ConfigService,
    private readonly embedding: EmbeddingService,
    private readonly vectorIndex: VectorIndexService,
    private readonly reranker: RerankerService,
  ) {
    this.hybridTopK = Number(config.get('RAG_HYBRID_TOP_K', 20));
    this.rrfC = Number(config.get('RAG_RRF_C', 60));
  }

  /**
   * 混合检索，返回合并后的命中块列表
   * @param query - 查询关键词
   * @param topK - 返回的命中块数量
   * @returns 合并后的命中块列表
   */
  async retrieve(query: string, topK = 5): Promise<ChunkHit[]> {
    const queryVector = await this.embedQuery(query);
    const fused = await this.vectorIndex.searchHybrid({
      query,
      queryVector,
      hybridTopK: this.hybridTopK,
      rrfC: this.rrfC, // RRF 参数是重排的权重，越大越重视原始检索分
    });
    if (!fused.length) return [];

    const reranked = await this.reranker.rerank(query, fused, topK);
    if (reranked?.length) return reranked.slice(0, topK);
    return fused.slice(0, topK);
  }

  private async embedQuery(query: string): Promise<number[] | null> {
    try {
      return await this.embedding.embed(query);
    } catch (error) {
      this.logger.warn(`查询向量化失败，仅走关键词：${error}`);
      return null;
    }
  }
}
