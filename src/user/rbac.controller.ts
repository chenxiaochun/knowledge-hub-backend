import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { PermissionCode } from '../common/constant/permissions';
import { RbacService } from './rbac.service';
import { UserService } from './user.service';
import { QueryUserDto } from './dto/query-user.dto';

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

  // 管理接口：给用户设角色
  @Put(':id/roles')
  @RequirePermission(PermissionCode.systemUser)
  setRoles(@Param('id') id: string, @Body() body: { roleCodes: string[] }) {
    return this.rbacService.setUserRoles(id, body.roleCodes ?? []);
  }

  // 给角色设权限码
  @Put('roles/:roleCode/permissions')
  @RequirePermission(PermissionCode.systemUser)
  setRolePerms(@Param('roleCode') roleCode: string, @Body() body: { permissionCodes: string[] }) {
    return this.rbacService.setRolePermissions(roleCode, body.permissionCodes ?? []);
  }

  @Get('rbac/roles')
  @RequirePermission(PermissionCode.systemUser)
  listRoles() {
    return this.rbacService.listRoles();
  }
}
