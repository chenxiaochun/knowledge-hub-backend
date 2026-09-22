/** 全文检索高亮片段 */
export class SearchHighlightDto {
  title?: string[];
  content?: string[];
}

/** 全文检索单条命中 */
export class SearchDocumentHitDto {
  id!: string;
  score!: number | null;
  title!: string;
  summary?: string;
  authorId?: string | null;
  status!: number;
  publishTime?: string | null;
  indexedAt?: string | null;
  tags?: string | null;
  highlight?: SearchHighlightDto;
}

/** 全文检索分页结果 */
export class SearchDocumentsResultDto {
  items!: SearchDocumentHitDto[];
  total!: number;
  page!: number;
  pageSize!: number;
}
