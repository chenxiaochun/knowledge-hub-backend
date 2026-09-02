import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectEntityManager } from '@nestjs/typeorm';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EntityManager } from 'typeorm';
import { nextSnowflakeId } from '../common/snowflake-id';
import { CreateDocumentDto } from './dto/create-document.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { QueryDocumentDto } from './dto/query-document.dto';
import { UploadParseDto } from './dto/upload-parse.dto';
import { DocumentEntity } from './entities/document.entity';
import { canArchive, canEditContent, canPublishFrom, DocumentStatus } from './document-status';
import { DocumentContent, DocumentContentDocument } from './schemas/document-content.schema';
import { RustfsService } from '../storage/rustfs.service';
import { DocumentPipelinePublisher } from '../mq/document-pipeline.publisher';
import { FileParserService } from './parser/file-parser.service';
import {
  decodeUploadFilename,
  getExtension,
  titleFromFilename,
} from './parser/utils/markdown.util';
import { DocumentReviewService } from './document-review.service';
import { AuthUser } from '../auth/auth-user.interface';

/**
 * 文档服务
 * - 元数据：PostgreSQL（kh_document）
 * - 正文：MongoDB（document_content）
 * - 关联：content_id ↔ Mongo _id，documentId ↔ 文档 id
 */
@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name);

  constructor(
    /** Postgres 实体管理器 */
    @InjectEntityManager()
    private readonly em: EntityManager,

    /** Mongo 正文模型 */
    @InjectModel(DocumentContent.name)
    private readonly contentModel: Model<DocumentContentDocument>,
    private readonly fileParserService: FileParserService,
    private readonly rustfs: RustfsService,
    private readonly pipelinePublisher: DocumentPipelinePublisher,
    /** 发布审核：是否需审、提交/通过/驳回 */
    private readonly reviewService: DocumentReviewService,
  ) {}

  /**
   * 创建文档
   * 流程：生成雪花 ID → 写 Mongo 正文（拿 ObjectId）→ 写 Postgres 元数据
   * 若 Postgres 写入失败，回滚删除已写入的 Mongo 正文，避免脏数据
   */
  async create(dto: CreateDocumentDto, actor: AuthUser) {
    const requestedStatus = dto.status ?? DocumentStatus.Draft;
    // 创建时不允许直接设为 Archived / PendingReview
    if (requestedStatus !== DocumentStatus.Draft && requestedStatus !== DocumentStatus.Published) {
      throw new BadRequestException('创建文档仅允许草稿或已发布状态');
    }
    // DOCUMENT_REQUIRE_APPROVAL=true 时必须先草稿，再通过 publish/submit 走审核
    if (requestedStatus === DocumentStatus.Published && this.reviewService.isRequireApproval()) {
      throw new BadRequestException('开启审核时请先创建草稿，再提交发布/审核');
    }

    const id = nextSnowflakeId();
    const wordCount = this.countWords(dto.content);
    const status = requestedStatus;
    // 未传 summary 时，从正文截取预览作为 contentSummary
    const contentSummary = dto.summary ?? this.buildContentSummary(dto.content);

    // 先写 Mongo，_id 由驱动自动生成 ObjectId
    const contentDoc = await this.contentModel.create({
      documentId: id,
      content: dto.content,
      contentLength: dto.content.length,
      contentSummary,
      version: 1,
      deleted: false,
    });
    // ObjectId 转字符串，存入 Postgres content_id
    const contentId = String(contentDoc._id);

    try {
      const doc = this.em.create(DocumentEntity, {
        id,
        title: dto.title,
        contentId,
        summary: dto.summary,
        categoryId: dto.categoryId,
        teamId: dto.teamId,
        authorId: actor.userId,
        coverImage: dto.coverImage,
        tags: dto.tags,
        status,
        remark: dto.remark,
        isPublic: dto.isPublic ?? false,
        wordCount,
        // 创建即发布时，记录发布时间
        publishTime: status === DocumentStatus.Published ? new Date() : null,
        createBy: actor.userId,
        updateBy: actor.userId,
        deleted: false,
      });

      const saved = await this.em.save(doc);

      // 仅 Published 才建索引。需审时创建即 Published 已在上方拒绝，
      // 能走到这里的 Published 一定是免审；草稿不投 MQ。
      if (status === DocumentStatus.Published) {
        await this.safePublish(saved);
      }

      return { ...saved, content: dto.content };
    } catch (error) {
      // Postgres 失败：物理删除刚写入的 Mongo 正文
      await this.contentModel.deleteOne({ _id: contentDoc._id });
      throw error;
    }
  }

  /**
   * 分页查询文档列表（只返回 Postgres 元数据，不含正文）
   * 支持按标题模糊、分类 / 团队 / 作者 / 状态筛选
   */
  async findAll(query: QueryDocumentDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    // 默认排除已软删记录
    const qb = this.em
      .createQueryBuilder(DocumentEntity, 'doc')
      .where('doc.deleted = :deleted', { deleted: false });

    // 标题模糊匹配（不区分大小写）
    if (query.title) {
      qb.andWhere('doc.title ILIKE :title', { title: `%${query.title}%` });
    }
    if (query.categoryId) {
      qb.andWhere('doc.category_id = :categoryId', {
        categoryId: query.categoryId,
      });
    }
    if (query.teamId) {
      qb.andWhere('doc.team_id = :teamId', { teamId: query.teamId });
    }
    if (query.authorId) {
      qb.andWhere('doc.author_id = :authorId', { authorId: query.authorId });
    }
    if (query.status !== undefined) {
      qb.andWhere('doc.status = :status', { status: query.status });
    }

    // 按创建时间倒序，再分页
    qb.orderBy('doc.created_at', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const [items, total] = await qb.getManyAndCount();

    return {
      items,
      total,
      page,
      pageSize,
    };
  }

  /**
   * 查询文档详情
   * @param withContent 是否附带 Mongo 正文，默认 true
   */
  async findOne(id: string, withContent = true) {
    const doc = await this.em.findOne(DocumentEntity, {
      where: { id, deleted: false },
    });
    if (!doc) {
      throw new NotFoundException(`Document ${id} not found`);
    }

    if (!withContent) {
      return doc;
    }

    // 通过 content_id 拉取未删除的正文
    const contentDoc = await this.contentModel
      .findOne({ _id: doc.contentId, deleted: false })
      .lean();
    return {
      ...doc,
      content: contentDoc?.content ?? '',
    };
  }

  /**
   * 更新文档
   * - 有 content：同步更新 Mongo 正文，并递增 version
   * - 仅改 summary：同步更新 Mongo contentSummary
   * - 其余字段只更新 Postgres 元数据
   */
  async update(id: string, dto: UpdateDocumentDto, actor: AuthUser) {
    const doc = await this.em.findOne(DocumentEntity, {
      where: { id, deleted: false },
    });
    if (!doc) {
      throw new NotFoundException(`Document ${id} not found`);
    }

    const oldStatus = doc.status;

    // —— 状态与编辑权限（待审核中不可改正文）——
    if (doc.status === DocumentStatus.PendingReview) {
      if (dto.content !== undefined || dto.title !== undefined) {
        throw new BadRequestException('审核中的文档不可编辑');
      }
    } else if (!canEditContent(doc.status)) {
      throw new BadRequestException('当前文档状态不允许编辑');
    }

    // PATCH 不允许随意改 status；仅兼容 Published→Draft，其余走专用接口
    if (dto.status !== undefined && dto.status !== doc.status) {
      if (dto.status === DocumentStatus.Draft && doc.status === DocumentStatus.Published) {
        doc.status = DocumentStatus.Draft;
      } else {
        throw new BadRequestException(
          '请使用 publish / archive / save-draft / 审核接口变更文档状态',
        );
      }
    }

    let contentChanged = false;
    let newContent: string | undefined;

    // —— 正文变更 ——
    if (dto.content !== undefined) {
      contentChanged = true;
      newContent = dto.content;
      const contentSummary = dto.summary ?? this.buildContentSummary(dto.content);
      const result = await this.contentModel.updateOne(
        { _id: doc.contentId, deleted: false },
        {
          $set: {
            content: dto.content,
            contentLength: dto.content.length,
            contentSummary,
          },
          $inc: { version: 1 }, // 版本号 +1
        },
      );
      if (result.matchedCount === 0) {
        throw new BadRequestException(`Document content ${doc.contentId} not found`);
      }
      doc.wordCount = this.countWords(dto.content);
    } else if (dto.summary !== undefined) {
      // 只改摘要时，同步 Mongo 侧预览字段
      await this.contentModel.updateOne(
        { _id: doc.contentId, deleted: false },
        { $set: { contentSummary: dto.summary } },
      );
    }

    // —— 元数据字段（有传才覆盖）——
    if (dto.title !== undefined) doc.title = dto.title;
    if (dto.summary !== undefined) doc.summary = dto.summary;
    if (dto.categoryId !== undefined) doc.categoryId = dto.categoryId;
    if (dto.teamId !== undefined) doc.teamId = dto.teamId;
    if (dto.coverImage !== undefined) doc.coverImage = dto.coverImage;
    if (dto.tags !== undefined) doc.tags = dto.tags;
    if (dto.remark !== undefined) doc.remark = dto.remark;
    if (dto.isPublic !== undefined) doc.isPublic = dto.isPublic;
    doc.updateBy = actor.userId;

    const saved = await this.em.save(doc);
    const finalContent = newContent ?? (await this.loadContent(doc.contentId));

    // 已发布文档改内容/下架时，同步 RAG/Search/KG（需审核模式下已发布改稿不立即重建索引）
    await this.syncPipelineAfterUpdate(saved, oldStatus, saved.status, contentChanged);

    return { ...saved, content: finalContent };
  }

  /**
   * 发布文档
   * - 需审核：Draft / Published → PendingReview（不索引）
   * - 免审：Draft / Published / Archived → Published + 索引
   */
  async publish(id: string, actor: AuthUser) {
    this.logger.log(`发布文档：documentId=${id}`);

    const doc = await this.em.findOne(DocumentEntity, {
      where: { id, deleted: false },
    });
    if (!doc) {
      throw new NotFoundException(`Document ${id} not found`);
    }

    if (!canPublishFrom(doc.status)) {
      throw new BadRequestException('当前文档状态不允许发布');
    }

    if (doc.status === DocumentStatus.PendingReview) {
      throw new BadRequestException('文档审核中，请等待审核结果');
    }

    if (this.reviewService.isRequireApproval()) {
      // 草稿或已发布：进入待审，不建索引；来自 Published 时 submitForReview 内会清旧索引
      if (doc.status === DocumentStatus.Draft || doc.status === DocumentStatus.Published) {
        const saved = await this.reviewService.submitForReview(id, actor);
        const content = await this.loadContent(saved.contentId);
        return { ...saved, content };
      }
    }

    return this.directPublish(id, actor);
  }

  /**
   * 免审直接发布
   * 也供 DocumentReviewService.approveReview 间接使用（审核通过后 status→Published）
   */
  async directPublish(id: string, actor?: AuthUser) {
    const doc = await this.em.findOne(DocumentEntity, {
      where: { id, deleted: false },
    });
    if (!doc) {
      throw new NotFoundException(`Document ${id} not found`);
    }

    if (
      doc.status !== DocumentStatus.Draft &&
      doc.status !== DocumentStatus.Published &&
      doc.status !== DocumentStatus.Archived &&
      doc.status !== DocumentStatus.PendingReview
    ) {
      throw new BadRequestException('当前文档状态不允许发布');
    }

    doc.status = DocumentStatus.Published;
    doc.publishTime = new Date();
    if (actor?.userId) doc.updateBy = actor.userId;
    const saved = await this.em.save(doc);
    const content = await this.loadContent(saved.contentId);
    await this.safePublish(saved);

    this.logger.log(`文档发布成功：documentId=${id}`);
    return { ...saved, content };
  }

  /** 归档：Published → Archived，清索引 */
  async archive(id: string, actor: AuthUser) {
    const doc = await this.em.findOne(DocumentEntity, {
      where: { id, deleted: false },
    });
    if (!doc) {
      throw new NotFoundException(`Document ${id} not found`);
    }
    if (!canArchive(doc.status)) {
      throw new BadRequestException('只有已发布文档可以归档');
    }

    doc.status = DocumentStatus.Archived;
    doc.updateBy = actor.userId;
    const saved = await this.em.save(doc);
    await this.safeUnpublish(id);

    this.logger.log(`文档已归档：documentId=${id}`);
    return saved;
  }

  /** 已发布 → 草稿（保存草稿），清索引 */
  async saveAsDraft(id: string, actor: AuthUser) {
    const doc = await this.em.findOne(DocumentEntity, {
      where: { id, deleted: false },
    });
    if (!doc) {
      throw new NotFoundException(`Document ${id} not found`);
    }
    if (doc.status !== DocumentStatus.Published) {
      throw new BadRequestException('只有已发布文档可以保存为草稿');
    }

    doc.status = DocumentStatus.Draft;
    doc.updateBy = actor.userId;
    const saved = await this.em.save(doc);
    await this.safeUnpublish(id);

    this.logger.log(`文档已保存为草稿：documentId=${id}`);
    return saved;
  }

  /**
   * 软删除文档
   * Postgres、Mongo 两侧都将 deleted 置为 true（不物理删正文），
   * 已发布文档会异步清理 ES 搜索索引、向量块与 Neo4j 图谱。
   */
  async remove(id: string, actor: AuthUser) {
    const doc = await this.em.findOne(DocumentEntity, {
      where: { id, deleted: false },
    });
    if (!doc) {
      throw new NotFoundException(`Document ${id} not found`);
    }

    if (doc.status === DocumentStatus.Published) {
      // 仅已发布需要清索引；草稿/待审/归档删除时不投递 unpublish
      await this.safeUnpublish(id);
    }

    doc.deleted = true;
    doc.updateBy = actor.userId;
    await this.em.save(doc);
    await this.contentModel.updateOne({ _id: doc.contentId }, { $set: { deleted: true } });

    return { id, deleted: true };
  }

  /** 上传并解析文件 → 创建草稿文档 */
  async uploadAndCreateDocument(
    file: Express.Multer.File,
    meta: UploadParseDto = {},
    actor: AuthUser,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('文件不能为空');
    }

    const originalFilename = decodeUploadFilename(file.originalname);
    const extension = getExtension(originalFilename);

    if (!this.fileParserService.isSupported(extension)) {
      throw new BadRequestException(
        `不支持的文件格式: ${extension}，支持的格式: ${this.fileParserService.supportedList()}`,
      );
    }

    this.logger.log(
      `上传并解析文件：name=${originalFilename}, size=${file.size}, ext=${extension}`,
    );

    let parsedContent: string;
    try {
      parsedContent = await this.fileParserService.parse({
        originalname: originalFilename,
        buffer: file.buffer,
        size: file.size,
      });
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`文件解析失败：name=${originalFilename}, error=${message}`);
      throw new BadRequestException(`文件解析失败: ${message}`);
    }

    let fileUrl: string | null = null;
    if (this.rustfs.isEnabled()) {
      try {
        fileUrl = await this.rustfs.uploadBytes(file.buffer, {
          fileName: originalFilename,
          contentType: file.mimetype || 'application/octet-stream',
          prefix: 'documents',
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`原文件上传 RustFS 失败：${message}`);
        throw new BadRequestException(`原文件上传失败: ${message}`);
      }
    } else {
      this.logger.warn('RustFS 未启用，跳过原文件上传');
    }

    const title = titleFromFilename(originalFilename);

    const created = await this.create(
      {
        title,
        content: parsedContent,
        categoryId: meta.categoryId,
        teamId: meta.teamId,
        tags: meta.tags,
        remark: meta.remark,
        isPublic: meta.isPublic,
        status: DocumentStatus.Draft,
      },
      actor,
    );

    const previewLen = Math.min(200, parsedContent.length);
    const result = {
      documentId: created.id,
      title,
      fileUrl,
      fileSize: file.size,
      fileExtension: extension,
      contentLength: parsedContent.length,
      contentPreview: parsedContent.slice(0, previewLen),
      status: DocumentStatus.Draft,
    };

    this.logger.log(
      `文件解析并创建文档成功：documentId=${created.id}, title=${title}, ext=${extension}, chars=${parsedContent.length}, fileUrl=${fileUrl}`,
    );

    return result;
  }

  /**
   * 更新后根据状态变化同步索引
   * - Published → 非 Published：清索引
   * - 仍为 Published 且正文变了：免审模式下重建索引；需审核模式下等再次发布/审核通过
   */
  private async syncPipelineAfterUpdate(
    doc: DocumentEntity,
    oldStatus: DocumentStatus,
    newStatus: DocumentStatus,
    contentChanged: boolean,
  ) {
    const wasPublished = oldStatus === DocumentStatus.Published;
    const isPublished = newStatus === DocumentStatus.Published;

    if (wasPublished && !isPublished) {
      await this.safeUnpublish(doc.id);
      return;
    }

    if (isPublished && contentChanged) {
      if (!this.reviewService.isRequireApproval()) {
        await this.safePublish(doc);
      }
    }
  }

  /** 从 Mongo 读取正文（详情 / 发布响应） */
  private async loadContent(contentId: string): Promise<string> {
    const contentDoc = await this.contentModel.findOne({ _id: contentId, deleted: false }).lean();
    return contentDoc?.content ?? '';
  }

  /** 投递 MQ：RAG 分块向量 + 全文搜索 + KG 建图（失败不回滚文档状态） */
  private async safePublish(doc: DocumentEntity) {
    try {
      await this.pipelinePublisher.afterPublish(doc);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`索引投递失败（不影响文档状态）：documentId=${doc.id}, ${message}`);
    }
  }

  /** 投递 MQ：删除该文档在 ES / Neo4j 等侧的索引数据 */
  private async safeUnpublish(documentId: string) {
    try {
      await this.pipelinePublisher.afterUnpublish(documentId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`索引清理投递失败：documentId=${documentId}, ${message}`);
    }
  }

  /**
   * 从正文截取预览摘要
   * 压缩连续空白后截断到 maxLen，超出则追加省略号
   */
  private buildContentSummary(content: string, maxLen = 200): string {
    const trimmed = content.trim().replace(/\s+/g, ' ');
    return trimmed.length <= maxLen ? trimmed : `${trimmed.slice(0, maxLen)}...`;
  }

  /**
   * 统计正文字数（中英混合）
   * - 中日韩汉字：每个字符计 1 字
   * - 英文等拉丁文本：按空白分词，每个单词计 1 字
   */
  private countWords(content: string): number {
    const trimmed = content.trim();
    if (!trimmed) return 0;

    // 匹配所有 CJK 统一汉字（U+4E00–U+9FFF），每个汉字算 1
    const cjk = (trimmed.match(/[\u4e00-\u9fff]/g) ?? []).length;

    // 去掉汉字后，剩余按空白切分为英文单词再计数
    const latin = trimmed
      .replace(/[\u4e00-\u9fff]/g, ' ') // 汉字替换为空格，避免与英文粘连
      .trim()
      .split(/\s+/) // 按连续空白分词
      .filter(Boolean).length; // 去掉空串

    return cjk + latin;
  }
}
