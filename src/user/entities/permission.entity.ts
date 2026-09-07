import { Column, Entity, PrimaryColumn } from 'typeorm';
import { bigintTransformer } from '../../common/transformers/bigint.transformer';

@Entity('kh_permission')
export class PermissionEntity {
  @PrimaryColumn({ type: 'bigint', transformer: bigintTransformer })
  id!: string;

  @Column({ name: 'permission_name', type: 'varchar', length: 50 })
  permissionName!: string;

  @Column({ name: 'permission_code', type: 'varchar', length: 100, unique: true })
  permissionCode!: string;

  /** 练习版固定 3=接口 */
  @Column({ name: 'permission_type', type: 'smallint', default: 3 })
  permissionType!: number;

  @Column({ type: 'smallint', default: 1 })
  status!: number;
}
