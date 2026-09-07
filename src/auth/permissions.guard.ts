import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthUser } from './auth-user.interface';
import { PERMISSION_KEY } from './decorators/require-permission.decorator';
import { RoleCode } from '../common/constant/roles';
import { PermissionEntity } from 'src/user/entities/permission.entity';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    /** 获取请求所需的权限 */
    const required = this.reflector.getAllAndOverride<PermissionEntity[]>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required) {
      return true;
    }

    /** 获取请求用户 */
    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = request.user;
    if (!user) {
      throw new ForbiddenException('权限不足');
    }

    if (user.roles.includes(RoleCode.ADMIN)) {
      return true;
    }

    const owned = new Set(user.permissions ?? []);
    if (!required.some((p) => owned.has(p.permissionCode))) {
      throw new ForbiddenException('权限不足');
    }

    return true;
  }
}
