import { Client } from '@elastic/elasticsearch';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentChunk } from './chunking.service';

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
      await this.ensureIndex();
    } catch (error) {
      this.logger.error(`${node} 无法连接，请检查 Elasticsearch 是否已启动`);
      this.es = null;
      throw error;
    }
  }

  private async ensureIndex() {
    if (!this.es) return;
    const exists = await this.es.indices.exists({ index: CHUNK_INDEX });
    if (exists) return;
    await this.es.indices.create({
      index: CHUNK_INDEX,
      mappings: {
        properties: {
          chunk_id: { type: 'keyword' },
          document_id: { type: 'keyword' },
          document_title: { type: 'text' },
          content: { type: 'text' },
          chunk_index: { type: 'integer' },
          embedding: {
            type: 'dense_vector',
            dims: this.dims,
            index: true,
            similarity: 'cosine', // 余弦相似度，最常用的向量相似度计算方法
          },
        },
      },
    });
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

  async knnSearch(vector: number[], topK: number) {
    if (!this.es) return [];
    const res = await this.es.search({
      index: CHUNK_INDEX,
      knn: {
        field: 'embedding',
        query_vector: vector,
        k: topK,
        num_candidates: Math.max(topK * 10, 50), // 备选候选数，避免漏过真正相近的块
      },
      _source: ['document_id', 'document_title', 'content', 'chunk_index'],
    });

    // 返回 hits 数组，每个元素包含 _id、_score 和 _source 字段, _id 是 chunkId，_score 是相似度得分，_source 是 chunk 的原始数据
    // 这里 _source 字段是可选的，如果不需要原始数据，可以去掉
    return res.hits.hits.map((h) => ({
      id: h._id,
      score: h._score,
      ...(h._source as object),
    }));
  }
}
