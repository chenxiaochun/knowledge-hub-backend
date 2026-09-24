/** POST /rag/search 单条召回块 */
export class RagChunkHitDto {
  chunkId!: string;
  documentId!: string;
  documentTitle!: string;
  content!: string;
  heading!: string | null;
  score!: number;
  bm25Score?: number;
  vectorScore?: number;
}
