export interface SearchIndexMessage {
  taskId: string;
  type: 'INDEX' | 'DELETE';
  documentId: string;
}
