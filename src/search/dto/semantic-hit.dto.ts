/** 语义检索命中块（与 pipeline ChunkHit 字段对齐） */
export class SemanticSearchHitDto {
  chunkId!: string;
  documentId!: string;
  documentTitle!: string;
  content!: string;
  heading!: string | null;
  /** 当前阶段得分 */
  score!: number;
  bm25Score?: number;
  vectorScore?: number;
}
