import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { nextSnowflakeId } from '../common/snowflake-id';
import { RoleCode, RoleName } from '../common/constant/roles';
import { PermissionCode, PermissionName } from '../common/constant/permissions';
import { RoleEntity } from './entities/role.entity';
import { PermissionEntity } from './entities/permission.entity';
import { RolePermissionEntity } from './entities/role-permission.entity';

@Injectable()
export class RbacSeedService implements OnModuleInit {
  constructor(
    @InjectRepository(RoleEntity) private readonly roleRepository: Repository<RoleEntity>,

    @InjectRepository(PermissionEntity)
    private readonly permissionRepository: Repository<PermissionEntity>,

    @InjectRepository(RolePermissionEntity)
    private readonly rolePermissionRepository: Repository<RolePermissionEntity>,
  ) {}

  async onModuleInit() {
    await this.ensureRoles();
    await this.ensurePermissions();
    await this.ensureEditorDefaults();
  }

  private async ensureRoles() {
    for (const d of Object.values(RoleCode)) {
      const exists = await this.roleRepository.findOne({ where: { roleCode: d } });
      if (exists) continue;
      await this.roleRepository.save(
        this.roleRepository.create({
          id: nextSnowflakeId(),
          roleCode: d,
          roleName: RoleName[d],
          status: 1,
        }),
      );
    }
  }

  private async ensurePermissions() {
    for (const d of Object.values(PermissionCode)) {
      const exists = await this.permissionRepository.findOne({ where: { permissionCode: d } });
      if (exists) continue;
      await this.permissionRepository.save(
        this.permissionRepository.create({
          id: nextSnowflakeId(),
          permissionCode: d,
          permissionName: PermissionName[d],
          permissionType: 3,
          status: 1,
        }),
      );
    }
  }

  /** EDITOR 默认只有 document:list（验收时再给个别用户加 system:user） */
  private async ensureEditorDefaults() {
    const editor = await this.roleRepository.findOne({
      where: { roleCode: RoleCode.REVIEWER },
    });
    if (!editor) return;
    const count = await this.rolePermissionRepository.count({ where: { roleId: editor.id } });
    if (count > 0) return;

    const list = await this.permissionRepository.findOne({
      where: { permissionCode: PermissionCode.documentList },
    });
    if (!list) return;
    await this.rolePermissionRepository.save(
      this.rolePermissionRepository.create({
        id: nextSnowflakeId(),
        roleId: editor.id,
        permissionId: list.id,
      }),
    );
  }
}
