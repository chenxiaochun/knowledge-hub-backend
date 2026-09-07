export const PermissionCode = {
  systemUser: 'system:user',
  documentList: 'document:list',
  documentCreate: 'document:create',
  documentReview: 'document:review',
  search: 'search',
} as const;

export const PermissionName = {
  [PermissionCode.systemUser]: '系统用户',
  [PermissionCode.documentList]: '文档列表',
  [PermissionCode.documentCreate]: '文档创建',
  [PermissionCode.documentReview]: '文档审核',
  [PermissionCode.search]: '搜索',
};

export type PermissionCodeValue = (typeof PermissionCode)[keyof typeof PermissionCode];
