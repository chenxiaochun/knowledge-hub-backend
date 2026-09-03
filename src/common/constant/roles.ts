/** 预置角色编码（练习版；origin 与 kh_role.role_code 一致） */
export const RoleCode = {
  ADMIN: 'ROLE_ADMIN',
  REVIEWER: 'ROLE_REVIEWER',
  USER: 'ROLE_USER',
} as const;

export type RoleCodeValue = (typeof RoleCode)[keyof typeof RoleCode];
