import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

import type { ChatSourceDto } from '../dto/chat-response.dto';

import { bigintTransformer } from '../../common/transformers/bigint.transformer';

@Entity('kh_ai_message')
export class AiMessageEntity {
  @PrimaryColumn({ type: 'bigint', transformer: bigintTransformer })
  id!: string;

  @Column({
    name: 'session_id',
    type: 'bigint',
    transformer: bigintTransformer,
  })
  sessionId!: string;

  @Column({ type: 'varchar', length: 16 })
  role!: 'user' | 'assistant';

  @Column({ type: 'text' })
  content!: string;

  /** 仅 assistant：引用溯源列表；user 行一般为 null */
  @Column({ type: 'jsonb', nullable: true })
  sources?: ChatSourceDto[] | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;
}
