import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { PermissionCode } from '../common/constant/permissions';
import { SetRolePermissionsDto } from './dto/set-role-permissions.dto';
import { QueryUserDto } from './dto/query-user.dto';
import { RbacService } from './rbac.service';
import { UserService } from './user.service';

@Controller('rbac')
export class RbacController {
  constructor(
    private readonly rbacService: RbacService,
    private readonly userService: UserService,
  ) {}

  @Get('page')
  @RequirePermission(PermissionCode.systemUser)
  page(@Query() query: QueryUserDto) {
    return this.userService.pageUsers(query);
  }

  @Get('permissions')
  @RequirePermission(PermissionCode.systemUser)
  listPermissions() {
    return this.rbacService.listPermissions();
  }

  @Get('roles')
  @RequirePermission(PermissionCode.systemUser)
  listRoles() {
    return this.rbacService.listRoles();
  }

  /** 兼容旧路径 */
  @Get('rbac/roles')
  @RequirePermission(PermissionCode.systemUser)
  listRolesLegacy() {
    return this.rbacService.listRoles();
  }

  @Get('roles/:roleCode/permissions')
  @RequirePermission(PermissionCode.systemUser)
  getRolePerms(@Param('roleCode') roleCode: string) {
    return this.rbacService.getRolePermissionCodes(roleCode);
  }

  @Put('roles/:roleCode/permissions')
  @RequirePermission(PermissionCode.systemUser)
  setRolePerms(@Param('roleCode') roleCode: string, @Body() body: SetRolePermissionsDto) {
    return this.rbacService.setRolePermissions(roleCode, body.permissionCodes ?? []);
  }

  // 管理接口：给用户设角色（须放在 roles/* 之后，避免路由歧义）
  @Put(':id/roles')
  @RequirePermission(PermissionCode.systemUser)
  setRoles(@Param('id') id: string, @Body() body: { roleCodes: string[] }) {
    return this.rbacService.setUserRoles(id, body.roleCodes ?? []);
  }
}
