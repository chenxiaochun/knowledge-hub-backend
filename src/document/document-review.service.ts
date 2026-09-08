import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { IsNull, Repository } from 'typeorm';

import type { AuthUser } from '../auth/auth-user.interface';

import { nextSnowflakeId } from '../common/snowflake-id';
import { DocumentPipelinePublisher } from '../mq/document-pipeline.publisher';
import { DocumentStatus, DOCUMENT_STATUS_LABEL } from './document-status'; // 或你课 3/4 的枚举文件
import { DocumentReviewEntity, ReviewResult } from './entities/document-review.entity';
import { DocumentEntity } from './entities/document.entity';

@Injectable()
export class DocumentReviewService {
  private readonly logger = new Logger(DocumentReviewService.name);

  constructor(
    @InjectRepository(DocumentReviewEntity)
    private readonly documentReviewRepository: Repository<DocumentReviewEntity>,

    @InjectRepository(DocumentEntity)
    private readonly documentRepository: Repository<DocumentEntity>,

    private readonly documentPipelinePublisher: DocumentPipelinePublisher,
  ) {}

  private async findDoc(id: string) {
    const doc = await this.documentRepository.findOne({ where: { id } });
    if (!doc) {
      throw new NotFoundException('文档不存在');
    }
    return doc;
  }

  async submitForReview(documentId: string, actor: AuthUser) {
    const doc = await this.findDoc(documentId);
    if (doc.status !== DocumentStatus.Draft && doc.status !== DocumentStatus.Published) {
      throw new BadRequestException('只有草稿或已发布文档可以提交审核');
    }

    const pending = await this.documentReviewRepository.findOne({
      where: { documentId, reviewerId: IsNull() },
    });
    if (pending) {
      throw new BadRequestException('文档正在审核中');
    }

    const beforeStatus = doc.status;
    const review = await this.documentReviewRepository.create({
      id: nextSnowflakeId(),
      documentId,
      beforeStatus,
    });
    await this.documentReviewRepository.save(review);

    doc.status = DocumentStatus.PendingReview;
    await this.documentRepository.save(doc);

    this.logger.log(
      `文档 ${documentId} 提交审核，审核人：${actor.realName}，审核结果：${DOCUMENT_STATUS_LABEL[DocumentStatus.PendingReview]}`,
    );
    return {
      document: doc,
      review,
    };
  }

  async approveReview(reviewId: string, actor: AuthUser, comment: string) {
    const review = await this.documentReviewRepository.findOne({
      where: { id: reviewId },
    });
    if (!review || review.reviewResult !== null) {
      throw new BadRequestException('审核不存在或已审核');
    }

    review.reviewResult = ReviewResult.Approved;
    review.reviewerId = actor.userId;
    review.reviewerName = actor.username;
    review.reviewComment = comment ?? null;
    review.reviewedAt = new Date();
    await this.documentReviewRepository.save(review);

    const doc = await this.findDoc(review.documentId);
    doc.status = DocumentStatus.Published;
    doc.publishTime = new Date();
    const saved = await this.documentRepository.save(doc);

    await this.documentPipelinePublisher.afterPublish(saved.id);

    this.logger.log(`文档 ${review.documentId} 审核通过，审核人：${actor.realName}`);
    return saved;
  }

  async rejectReview(reviewId: string, actor: AuthUser, comment: string) {
    const review = await this.documentReviewRepository.findOne({
      where: { id: reviewId },
    });

    if (!review || review.reviewResult !== null) {
      throw new BadRequestException('审核不存在或已审核');
    }

    review.reviewResult = ReviewResult.Rejected;
    review.reviewerId = actor.userId;
    review.reviewerName = actor.username;
    review.reviewComment = comment ?? null;
    review.reviewedAt = new Date();
    await this.documentReviewRepository.save(review);

    const doc = await this.findDoc(review.documentId);
    doc.status = DocumentStatus.Draft;
    await this.documentRepository.save(doc);

    this.logger.log(`文档 ${review.documentId} 审核拒绝，审核人：${actor.realName}`);
    return doc;
  }

  async listPending() {
    return this.documentReviewRepository.find({
      where: { reviewerId: IsNull() },
      order: { createdAt: 'DESC' },
    });
  }
}
