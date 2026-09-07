import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { nextSnowflakeId } from '../common/snowflake-id';
import { RoleEntity } from './entities/role.entity';
import { PermissionEntity } from './entities/permission.entity';
import { UserRoleEntity } from './entities/user-role.entity';
import { RolePermissionEntity } from './entities/role-permission.entity';
import { UserEntity } from './entities/user.entity';

@Injectable()
export class RbacService {
  constructor(
    @InjectRepository(RoleEntity) private readonly roleRepository: Repository<RoleEntity>,

    @InjectRepository(PermissionEntity)
    private readonly permissionRepository: Repository<PermissionEntity>,

    @InjectRepository(UserRoleEntity)
    private readonly userRoleRepository: Repository<UserRoleEntity>,

    @InjectRepository(RolePermissionEntity)
    private readonly rolePermissionRepository: Repository<RolePermissionEntity>,

    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
  ) {}

  async listRoles() {
    return this.roleRepository.find({ where: { status: 1 } });
  }

  async listPermissions() {
    return this.permissionRepository.find({ where: { status: 1 } });
  }

  async loadRolesAndPermissions(
    userId: string,
  ): Promise<{ roles: string[]; permissions: string[] }> {
    const urs = await this.userRoleRepository.find({ where: { userId } });
    if (!urs.length) {
      return { roles: [], permissions: [] };
    }

    const roleIds = urs.map((ur) => ur.roleId);
    // 获取角色,并关联权限
    const roles = await this.roleRepository.find({ where: { id: In(roleIds) } });
    const roleCodes = roles.map((r) => r.roleCode);

    const rps = await this.rolePermissionRepository.find({ where: { roleId: In(roleIds) } });
    if (!rps.length) {
      return { roles: roleCodes, permissions: [] };
    }

    // 下面是为为获取当前在角色下的所有权限
    const perms = await this.permissionRepository.find({
      where: {
        id: In(rps.map((rp) => rp.permissionId)),
      },
    });
    return {
      roles: roleCodes,
      permissions: [...new Set(perms.map((p) => p.permissionCode))],
    };
  }

  async setUserRoles(userId: string, roleIds: string[]) {
    const user = await this.userRepository.findOne({ where: { id: userId, deleted: false } });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    const roles = await this.roleRepository.find({ where: { id: In(roleIds) } });
    if (roles.length !== roleIds.length) {
      throw new NotFoundException('存在未知角色');
    }
  }

  async setRolePermissions(roleCode: string, permissionCodes: string[]) {
    const role = await this.roleRepository.findOne({ where: { roleCode } });
    if (!role) {
      throw new NotFoundException('角色不存在');
    }

    const perms = await this.permissionRepository.find({
      where: {
        permissionCode: In(permissionCodes),
      },
    });
    if (perms.length !== permissionCodes.length) {
      throw new NotFoundException('存在未知权限');
    }

    // 这里为什么需要删除？
    // 因为一个角色可以有多个权限，所以需要删除旧的权限
    await this.rolePermissionRepository.delete({ roleId: role.id });

    // 插入新的权限
    // 这里为什么需要插入？
    // 因为一个角色可以有多个权限，所以需要插入新的权限
    const rows = perms.map((p) => {
      return {
        id: nextSnowflakeId(),
        roleId: role.id,
        permissionId: p.id,
      };
    });
    await this.rolePermissionRepository.save(rows);
    return {
      roleCode,
      permissionCodes,
    };
  }
}
