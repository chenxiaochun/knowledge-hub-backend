/** 对外返回的用户视图（永不带 password） */
export class UserVO {
  id!: string;
  username!: string;
  email?: string | null;
  realName?: string | null;
  avatar?: string | null;
  status!: number;
  createdAt!: Date;
  updatedAt!: Date;
  roleCodes!: string[];
}
