export const PermissionCode = {
  systemUser: 'system:user',
  documentList: 'document:list',
  documentCreate: 'document:create',
  documentReview: 'document:review',
  search: 'search',
} as const;

export type PermissionCodeValue = (typeof PermissionCode)[keyof typeof PermissionCode];
