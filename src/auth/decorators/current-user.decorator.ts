import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthUser } from '../auth-user.interface';

/** 下面函数是什么意思？
 * 创建一个参数装饰器，用于获取当前用户
 * 参数装饰器用于获取请求中的用户信息
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    // 获取请求对象，并断言请求对象的 user 属性类型为 AuthUser
    const request = ctx.switchToHttp().getRequest<{ user: AuthUser }>();
    // 返回请求对象的 user 属性
    return request.user;
  },
);
