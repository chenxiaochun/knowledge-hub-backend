/** kh_chunk 检索命中（关键词 / 向量 / RRF / rerank 共用） */
export interface ChunkHit {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  content: string;
  heading: string | null;
  /** 当前阶段得分：原始检索分、RRF 分或 rerank 分 */
  score: number;
  bm25Score?: number;
  vectorScore?: number;
}
