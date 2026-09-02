import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectEntityManager } from '@nestjs/typeorm';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EntityManager, IsNull } from 'typeorm';
import { nextSnowflakeId } from '../common/snowflake-id';
import { DocumentPipelinePublisher } from '../mq/document-pipeline.publisher';
import { canSubmitReview, DocumentStatus } from './document-status';
import { DocumentEntity } from './entities/document.entity';
import { DocumentReviewEntity, ReviewResult } from './entities/document-review.entity';
import { DocumentContent, DocumentContentDocument } from './schemas/document-content.schema';
import { QueryReviewTasksDto } from './dto/review.dto';

/**
 * 文档发布审核服务
 *
 * 与 kh_document_review 表对应：每次 submit 插入一条记录，approve/reject 回填结果。
 * 开关：环境变量 DOCUMENT_REQUIRE_APPROVAL（默认 true；false 时 publish 跳过本服务直接发布）。
 */
@Injectable()
export class DocumentReviewService {
  private readonly logger = new Logger(DocumentReviewService.name);

  constructor(
    @InjectEntityManager()
    private readonly em: EntityManager,
    @InjectModel(DocumentContent.name)
    private readonly contentModel: Model<DocumentContentDocument>,
    private readonly pipelinePublisher: DocumentPipelinePublisher,
    private readonly config: ConfigService,
  ) {}

  /** 是否开启发布审核（默认 true，DOCUMENT_REQUIRE_APPROVAL=false 时免审） */
  isRequireApproval(): boolean {
    return this.config.get<string>('DOCUMENT_REQUIRE_APPROVAL', 'true') !== 'false';
  }

  /**
   * 提交审核：Draft / Published → PendingReview
   * 若来自 Published，先清索引（审核期间不可检索）
   */
  async submitForReview(documentId: string): Promise<DocumentEntity> {
    const doc = await this.findDocumentOrThrow(documentId);

    if (!canSubmitReview(doc.status)) {
      throw new BadRequestException('只有草稿或已发布状态的文档才能提交审核');
    }

    const pending = await this.em.findOne(DocumentReviewEntity, {
      where: { documentId, reviewResult: IsNull() },
    });
    // 同一文档同时只能有一条待审记录
    if (pending) {
      throw new BadRequestException('该文档已有待审核任务');
    }

    const beforeStatus = doc.status;
    // 写入审核流水；review_result 留空表示待审
    const review = this.em.create(DocumentReviewEntity, {
      id: nextSnowflakeId(),
      documentId,
      beforeStatus,
    });
    await this.em.save(review);

    doc.status = DocumentStatus.PendingReview;
    const saved = await this.em.save(doc);

    if (beforeStatus === DocumentStatus.Published) {
      await this.safeUnpublish(documentId);
    }

    this.logger.log(
      `文档已提交审核：documentId=${documentId}, reviewId=${review.id}, beforeStatus=${beforeStatus}`,
    );
    return saved;
  }

  /** 审核通过 → Published + 重建索引 */
  async approveReview(
    reviewId: string,
    reviewerId?: string,
    reviewerName?: string,
    reviewComment?: string,
  ): Promise<DocumentEntity> {
    const review = await this.findPendingReviewOrThrow(reviewId);

    review.reviewResult = ReviewResult.Approved;
    review.reviewerId = reviewerId ?? null;
    review.reviewerName = reviewerName ?? '审核员';
    review.reviewComment = reviewComment ?? null;
    review.reviewedAt = new Date();
    await this.em.save(review);

    const doc = await this.findDocumentOrThrow(review.documentId);
    doc.status = DocumentStatus.Published;
    doc.publishTime = new Date();
    const saved = await this.em.save(doc);

    const content = await this.loadContent(doc.contentId);
    await this.safePublish(saved, content);

    this.logger.log(`审核通过：reviewId=${reviewId}, documentId=${doc.id}`);
    return saved;
  }

  /** 审核驳回 → Draft */
  async rejectReview(
    reviewId: string,
    reviewComment: string,
    reviewerId?: string,
    reviewerName?: string,
  ): Promise<DocumentEntity> {
    if (!reviewComment?.trim()) {
      throw new BadRequestException('驳回意见不能为空');
    }

    const review = await this.findPendingReviewOrThrow(reviewId);

    review.reviewResult = ReviewResult.Rejected;
    review.reviewerId = reviewerId ?? null;
    review.reviewerName = reviewerName ?? '审核员';
    review.reviewComment = reviewComment.trim();
    review.reviewedAt = new Date();
    await this.em.save(review);

    const doc = await this.findDocumentOrThrow(review.documentId);
    doc.status = DocumentStatus.Draft;
    const saved = await this.em.save(doc);

    this.logger.log(`审核驳回：reviewId=${reviewId}, documentId=${doc.id}`);
    return saved;
  }

  /** 待办 / 已通过 / 已驳回 列表 */
  async listTasks(query: QueryReviewTasksDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const qb = this.em.createQueryBuilder(DocumentReviewEntity, 'r');

    if (query.status === 'pending' || !query.status) {
      qb.andWhere('r.review_result IS NULL');
    } else if (query.status === 'approved') {
      qb.andWhere('r.review_result = :result', {
        result: ReviewResult.Approved,
      });
    } else if (query.status === 'rejected') {
      qb.andWhere('r.review_result = :result', {
        result: ReviewResult.Rejected,
      });
    }

    qb.orderBy('r.created_at', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const [items, total] = await qb.getManyAndCount();
    return { items, total, page, pageSize };
  }

  async getPendingCount(): Promise<number> {
    return this.em.count(DocumentReviewEntity, {
      where: { reviewResult: IsNull() },
    });
  }

  /** 该文档当前待审任务（无则 null） */
  async getCurrentReview(documentId: string) {
    return this.em.findOne(DocumentReviewEntity, {
      where: { documentId, reviewResult: IsNull() },
      order: { createdAt: 'DESC' },
    });
  }

  /** 该文档全部审核记录（含已通过、已驳回） */
  async getReviewHistory(documentId: string) {
    return this.em.find(DocumentReviewEntity, {
      where: { documentId },
      order: { createdAt: 'DESC' },
    });
  }

  private async findPendingReviewOrThrow(reviewId: string) {
    const review = await this.em.findOne(DocumentReviewEntity, {
      where: { id: reviewId },
    });
    if (!review) {
      throw new NotFoundException(`Review ${reviewId} not found`);
    }
    if (review.reviewResult != null) {
      throw new BadRequestException('该审核任务已处理');
    }
    return review;
  }

  private async findDocumentOrThrow(id: string) {
    const doc = await this.em.findOne(DocumentEntity, {
      where: { id, deleted: false },
    });
    if (!doc) {
      throw new NotFoundException(`Document ${id} not found`);
    }
    return doc;
  }

  private async loadContent(contentId: string): Promise<string> {
    const contentDoc = await this.contentModel.findOne({ _id: contentId, deleted: false }).lean();
    return contentDoc?.content ?? '';
  }

  private async safePublish(doc: DocumentEntity, content: string) {
    try {
      await this.pipelinePublisher.afterPublish(doc, content);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`审核通过后索引投递失败：documentId=${doc.id}, ${message}`);
    }
  }

  private async safeUnpublish(documentId: string) {
    try {
      await this.pipelinePublisher.afterUnpublish(documentId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`提交审核后索引清理失败：documentId=${documentId}, ${message}`);
    }
  }
}
