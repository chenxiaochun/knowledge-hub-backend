import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthUser } from './auth-user.interface';
import { ROLES_KEY } from './decorators/roles.decorator';
import { RoleCodeValue } from '../common/constant/roles';

/**
 * 角色鉴权守卫（RBAC）。
 * 配合 @Roles(...) 使用：读取路由/控制器上声明的角色要求，
 * 与当前登录用户（request.user，通常由 JwtAuthGuard + JwtStrategy 写入）的 roles 比对。
 * 注意：本守卫只做「有没有角色」检查，不负责验 JWT；需放在 JwtAuthGuard 之后执行。
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  /** 校验当前用户是否具备接口要求的任一角色 */
  canActivate(context: ExecutionContext): boolean {
    // 读取 handler / class 上的 @Roles() 元数据（方法级优先于类级）
    const requiredRoles = this.reflector.getAllAndOverride<RoleCodeValue[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // 未声明 @Roles：不做角色限制，直接放行
    if (!requiredRoles?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = request.user;
    // 已登录但没有任何角色，或尚未经过 JWT 守卫写入 user
    if (!user?.roles?.length) {
      throw new ForbiddenException('权限不足');
    }

    // 只要命中 requiredRoles 中的任意一个即可（OR）
    const ok = requiredRoles.some((role) => user.roles.includes(role));
    if (!ok) {
      throw new ForbiddenException('权限不足');
    }
    return true;
  }
}
