import { bigintTransformer } from 'src/common/transformers/bigint.transformer';
import { Column, Entity, PrimaryColumn, CreateDateColumn } from 'typeorm';

export enum ReviewResult {
  Approved = 1,
  Rejected = 2,
}
@Entity('kh_document_review')
export class DocumentReviewEntity {
  @PrimaryColumn({ type: 'bigint', transformer: bigintTransformer })
  id!: string;

  @Column({ name: 'document_id', type: 'bigint', transformer: bigintTransformer })
  documentId!: string;

  @Column({ name: 'review_id', type: 'bigint', nullable: true, transformer: bigintTransformer })
  reviewerId!: string;

  @Column({ name: 'reviewer_name', type: 'varchar', length: 255, nullable: true })
  reviewerName!: string;

  @Column({ name: 'review_result', type: 'smallint', nullable: true })
  reviewResult!: ReviewResult;

  @Column({ name: 'review_comment', type: 'text', nullable: true })
  reviewComment!: string;

  @Column({ name: 'before_status', type: 'smallint', nullable: true })
  beforeStatus!: number;

  @Column({ name: 'review_at', type: 'timestamp', nullable: true })
  reviewedAt!: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
