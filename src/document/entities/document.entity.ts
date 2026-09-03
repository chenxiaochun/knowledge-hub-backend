import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { bigintTransformer } from '../../common/transformers/bigint.transformer';
import { DocumentStatus } from '../document-status';

@Entity('kh_document')
export class DocumentEntity {
  @PrimaryColumn({ type: 'bigint', transformer: bigintTransformer })
  id!: string;

  @Column({ type: 'varchar' })
  title!: string;

  /** 对应 Mongo document_content._id */
  @Column({ name: 'content_id', type: 'varchar', unique: true })
  contentId!: string;

  @Column({
    name: 'author_id',
    type: 'bigint',
    nullable: true,
    transformer: bigintTransformer,
  })
  authorId?: string | null;

  @Column({ name: 'file_url', type: 'varchar', nullable: true })
  fileUrl?: string | null;

  @Column({ name: 'file_ext', type: 'varchar', length: 20, nullable: true })
  fileExt?: string | null;

  @Column({ type: 'smallint', default: DocumentStatus.Draft })
  status!: DocumentStatus;

  @Column({ name: 'word_count', type: 'int', default: 0 })
  wordCount!: number;

  @Column({ type: 'varchar', nullable: true })
  tags?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @Column({ type: 'boolean', default: false })
  deleted!: boolean;
}
