import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from './decorators/public.decorator';

/**
 * 全局/路由级 JWT 鉴权守卫。
 * 继承 AuthGuard('jwt')，会触发同名策略 JwtStrategy：
 * 验签通过后，validate() 的返回值经本 Guard 处理后由 Passport 写入 request.user。
 * 若接口标了 @Public()，则跳过鉴权直接放行。
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  /** 决定本次请求是否需要走 JWT 校验 */
  canActivate(context: ExecutionContext) {
    // 读取 handler / class 上的 @Public() 元数据
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // 公开接口：不验 token，直接放行
    if (isPublic) {
      return true;
    }
    // 非公开：交给父类执行 JwtStrategy（取 token → 验签 → validate）
    return super.canActivate(context);
  }

  /**
   * Passport 回调：校验结束后拿到 user（即 JwtStrategy.validate 的返回值）。
   * 返回的 user 会被框架挂到 request.user；失败则统一抛 401。
   */
  handleRequest<TUser>(err: Error | null, user: TUser): TUser {
    if (err || !user) {
      throw err ?? new UnauthorizedException('未登录或 token 已失效');
    }
    return user;
  }
}
