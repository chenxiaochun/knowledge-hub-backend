import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** 标记接口无需 JWT */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
