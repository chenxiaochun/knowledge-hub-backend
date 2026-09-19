import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Client } from '@elastic/elasticsearch';

import { DocumentChunk } from './chunking.service';
import { ChunkHit } from './types/pipeline.types';

const CHUNK_INDEX = 'kh_chunk';

@Injectable()
export class VectorIndexService implements OnModuleInit {
  private readonly logger = new Logger(VectorIndexService.name);
  private es: Client | null = null;
  private dims: number | undefined = undefined;

  constructor(private readonly config: ConfigService) {
    this.dims = Number(config.get('EMBEDDING_DIMENSION', 64));
  }

  async onModuleInit() {
    const node = this.config.get('ELASTICSEARCH_NODE', 'http://localhost:9200');
    this.es = new Client({ node });

    try {
      await this.es.cluster.health({});
      await this.createIndexIfNotExists();
    } catch (error) {
      this.logger.error(`${node} 无法连接，请检查 Elasticsearch 是否已启动`);
      this.es = null;
      throw error;
    }
  }

  /**
   * 创建 ES 索引 `kh_chunk`（dense_vector + IK）。
   * document_id 用 keyword：雪花 ID 以字符串传递，避免 JS long 精度问题。
   */
  private async createIndexIfNotExists() {
    if (!this.es) return;

    const exists = await this.es.indices.exists({ index: CHUNK_INDEX });
    if (exists) return;

    try {
      await this.es.indices.create({
        index: CHUNK_INDEX,
        settings: {
          number_of_shards: 1,
          number_of_replicas: 0,
          refresh_interval: '5s',
        },
        mappings: {
          properties: {
            chunk_id: { type: 'keyword' },
            document_id: { type: 'keyword' },
            document_title: {
              type: 'text',
              analyzer: 'ik_max_word',
              search_analyzer: 'ik_smart',
              fields: { keyword: { type: 'keyword' } },
            },
            content: {
              type: 'text',
              analyzer: 'ik_max_word',
              search_analyzer: 'ik_smart',
            },
            heading: { type: 'keyword' },
            chunk_index: { type: 'integer' },
            total_chunks: { type: 'integer' },
            category_id: { type: 'keyword' },
            author_id: { type: 'keyword' },
            team_id: { type: 'keyword' },
            doc_status: { type: 'integer' },
            publish_time: { type: 'date' },
            indexed_at: { type: 'date' },
            embedding: {
              type: 'dense_vector',
              dims: this.dims,
              index: true,
              similarity: 'cosine',
            },
          },
        },
      });
      this.logger.log(`ES 索引创建成功：index=${CHUNK_INDEX}, dims=${this.dims}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('resource_already_exists')) {
        return;
      }
      this.logger.error(`ES 索引创建失败：${message}`);
      throw error;
    }
  }

  async deleteByDocId(documentId: string) {
    if (!this.es) return;
    await this.es.deleteByQuery({
      index: CHUNK_INDEX,
      query: { term: { document_id: documentId } },
      refresh: true,
    });
  }

  /**
   * 把「文本块 + 对应向量」批量写入 ES 索引 `kh_chunk`，供后续向量检索。
   * 约定 chunks[i] 与 vectors[i] 一一对应（通常来自 EmbeddingService.embedBatch）。
   * bulk 格式是成对 NDJSON：先 action（index/_id），再 document body。
   */
  async bulkIndex(chunks: DocumentChunk[], vectors: number[][]) {
    if (!this.es || !chunks.length) return;
    const ops: object[] = [];
    chunks.forEach((c, i) => {
      // 动作行：指定写入哪个索引、用 chunkId 作为文档 _id（重复发布会覆盖）
      ops.push({ index: { _index: CHUNK_INDEX, _id: c.chunkId } });
      // 数据行：正文 + 元数据 + dense_vector
      ops.push({
        chunk_id: c.chunkId,
        document_id: c.documentId,
        document_title: c.documentTitle,
        content: c.content,
        chunk_index: c.chunkIndex,
        embedding: vectors[i],
      });
    });
    // refresh: true 让写入立刻可搜（课练方便；生产可关掉以提高吞吐）
    await this.es.bulk({ refresh: true, operations: ops });
    this.logger.log(`写入向量块 ${chunks.length} 条`);
  }

  /**
   * 混合检索，返回合并后的命中块列表
   * @param params - 检索参数
   * @param params.query - 查询关键词
   * @param params.queryVector - 查询向量
   * @param params.hybridTopK - 返回的命中块数量
   * @param params.rrfC - RRF 参数
   * @returns 合并后的命中块列表
   * @returns
   */
  async searchHybrid(params: {
    query: string;
    queryVector?: number[] | null;
    hybridTopK?: number;
    rrfC?: number;
  }): Promise<ChunkHit[]> {
    const hybridTopK = this.clampTopK(params.hybridTopK ?? 20);
    const rrfC = params.rrfC && params.rrfC > 0 ? params.rrfC : 60;
    const [keywordHits, vectorHits] = await Promise.all([
      this.keywordSearch(params.query, hybridTopK),
      params.queryVector?.length
        ? this.knnSearch(params.queryVector, hybridTopK)
        : Promise.resolve([] as ChunkHit[]),
    ]);
    return this.rrfFuse(keywordHits, vectorHits, rrfC);
  }

  /**
   * 向量检索，返回命中块列表
   * @param queryVector - 查询向量
   * @param topK - 返回的命中块数量
   * @returns 命中块列表
   */
  async knnSearch(queryVector: number[], topK = 20): Promise<ChunkHit[]> {
    if (!this.es || !queryVector.length) return [];
    const k = this.clampTopK(topK);
    const response = await this.es.search({
      index: CHUNK_INDEX,
      size: k,
      knn: {
        field: 'embedding',
        query_vector: queryVector,
        k,
        num_candidates: Math.max(k * 10, 50),
      },
      _source: ['chunk_id', 'document_id', 'document_title', 'content', 'heading'],
    });
    return this.mapHits(response.hits.hits);
  }

  /**
   * 关键词检索，返回命中块列表
   * @param query - 查询关键词
   * @param topK - 返回的命中块数量
   * @returns 命中块列表
   */
  async keywordSearch(query: string, topK = 20): Promise<ChunkHit[]> {
    if (!this.es) return [];
    const trimmed = query.trim();
    if (!trimmed) return [];
    const k = this.clampTopK(topK);
    const response = await this.es.search({
      index: CHUNK_INDEX,
      size: k,
      query: {
        multi_match: {
          query: trimmed,
          fields: ['document_title^2', 'content'],
          analyzer: 'ik_smart',
        },
      },
      _source: ['chunk_id', 'document_id', 'document_title', 'content', 'heading'],
    });
    return this.mapHits(response.hits.hits);
  }

  /**
   * 限制返回的命中块数量
   * @param topK - 返回的命中块数量
   * @returns
   */
  private clampTopK(topK: number) {
    return Math.min(Math.max(topK, 1), 50);
  }

  /**
   * 映射命中块列表
   * @param hits - 命中块列表
   * @returns
   */
  private mapHits(
    hits: Array<{
      _id?: string;
      _score?: number | null;
      _source?: unknown;
    }>,
  ): ChunkHit[] {
    return hits.map((hit) => {
      const src = (hit._source ?? {}) as Record<string, unknown>;
      return {
        chunkId: String(src.chunk_id ?? hit._id),
        documentId: String(src.document_id ?? ''),
        documentTitle: String(src.document_title ?? ''),
        content: String(src.content ?? ''),
        heading: (src.heading as string | null) ?? null,
        score: hit._score ?? 0,
      };
    });
  }

  /** Reciprocal Rank Fusion：score(d) = Σ 1 / (C + rank(d)) */
  /**
   * 合并关键词和向量检索结果
   * @param keywordHits - 关键词检索结果
   * @param vectorHits - 向量检索结果
   * @param rrfC - RRF 参数
   * @returns 合并后的命中块列表
   */
  private rrfFuse(keywordHits: ChunkHit[], vectorHits: ChunkHit[], rrfC: number): ChunkHit[] {
    const fused = new Map<string, ChunkHit>();
    const addChannel = (hits: ChunkHit[], channel: 'keyword' | 'vector') => {
      const sorted = [...hits].sort((a, b) => b.score - a.score);
      sorted.forEach((hit, rank) => {
        const rrf = 1 / (rrfC + rank + 1);
        const existing = fused.get(hit.chunkId);
        if (!existing) {
          fused.set(hit.chunkId, {
            ...hit,
            score: rrf,
            bm25Score: channel === 'keyword' ? hit.score : 0,
            vectorScore: channel === 'vector' ? hit.score : 0,
          });
          return;
        }
        existing.score += rrf;
        if (channel === 'keyword') existing.bm25Score = hit.score;
        if (channel === 'vector') existing.vectorScore = hit.score;
      });
    };
    addChannel(keywordHits, 'keyword');
    addChannel(vectorHits, 'vector');
    return [...fused.values()].sort((a, b) => b.score - a.score);
  }
}
