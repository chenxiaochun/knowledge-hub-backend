/** 预置角色编码（练习版；origin 与 kh_role.role_code 一致） */
export const RoleCode = {
  ADMIN: 'ROLE_ADMIN',
  REVIEWER: 'ROLE_REVIEWER',
  USER: 'ROLE_USER',
} as const;

export const RoleName = {
  [RoleCode.ADMIN]: '管理员',
  [RoleCode.REVIEWER]: '审核员',
  [RoleCode.USER]: '用户',
};

export type RoleCodeValue = (typeof RoleCode)[keyof typeof RoleCode];
