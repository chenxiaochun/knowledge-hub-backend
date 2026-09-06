export interface SearchIndexMessage {
  taskId: string;
  type: 'INDEX' | 'DELETE';
  documentId: string;
}

export interface SearchIndexMessage {
  taskId: string;
  type: 'INDEX' | 'DELETE';
  documentId: string;
}

/** RAG 重建 / 删除 */
export interface ReindexMessage {
  taskId: string;
  type: 'BY_DOC_IDS' | 'DELETE_BY_DOC_IDS';
  documentIds: string[];
}

export interface KgBuildMessage {
  taskId: string;
  type: 'BY_DOC_IDS' | 'DELETE_BY_DOC_IDS';
  documentIds: string[];
}
