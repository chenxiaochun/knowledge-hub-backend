import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import { bigintTransformer } from '../../common/transformers/bigint.transformer';

@Entity('kh_ai_session')
export class AiSessionEntity {
  @PrimaryColumn({ type: 'bigint', transformer: bigintTransformer })
  id!: string;

  @Column({
    name: 'user_id',
    type: 'bigint',
    transformer: bigintTransformer,
  })
  userId!: string;

  @Column({ type: 'varchar', length: 80 })
  title!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;
}
