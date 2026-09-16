/** 与 origin / kh_document.status 一致；本课主要用 Draft */
export enum DocumentStatus {
  Draft = 0,
  Published = 1,
  Archived = 2,
  PendingReview = 3,
}

export const DOCUMENT_STATUS_LABEL: Record<DocumentStatus, string> = {
  [DocumentStatus.Draft]: '草稿',
  [DocumentStatus.Published]: '已发布',
  [DocumentStatus.Archived]: '已归档',
  [DocumentStatus.PendingReview]: '待审核',
};

export function canPublishFrom(status: DocumentStatus): boolean {
  return (
    status === DocumentStatus.Draft ||
    status === DocumentStatus.Published ||
    status === DocumentStatus.Archived ||
    status === DocumentStatus.PendingReview
  );
}

export function canSubmitReview(status: DocumentStatus): boolean {
  return status === DocumentStatus.Draft || status === DocumentStatus.Published;
}

export function canArchive(status: DocumentStatus): boolean {
  return status === DocumentStatus.Published;
}

/** 待审核期间禁止改正文/标题 */
export function canEditContent(status: DocumentStatus): boolean {
  return (
    status === DocumentStatus.Draft ||
    status === DocumentStatus.Published ||
    status === DocumentStatus.Archived
  );
}
