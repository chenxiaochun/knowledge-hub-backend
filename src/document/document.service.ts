import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectRepository } from '@nestjs/typeorm';
import { Model, Types } from 'mongoose';
import { Repository } from 'typeorm';
import type { AuthUser } from '../auth/auth-user.interface';
import { nextSnowflakeId } from '../common/snowflake-id';
import { LocalStorageService } from '../storage/local-storage.service';
import { DocumentStatus } from './document-status';
import { QueryDocumentDto } from './dto/query-document.dto';
import { UploadParseDto } from './dto/upload-parse.dto';
import { DocumentEntity } from './entities/document.entity';
import { FileParserService } from './parser/file-parser.service';
import { DocumentPipelinePublisher } from '../mq/document-pipeline.publisher';
import { DocumentContent, DocumentContentDocument } from './schemas/document-content.schema';

@Injectable()
export class DocumentService {
  constructor(
    @InjectRepository(DocumentEntity) private readonly docRepo: Repository<DocumentEntity>,

    /** 为什么使用 InjectModel？
     * 1. 方便使用 Mongoose 的 Model
     *
     * Mongoose 的 Model 是什么？
     * 1. Mongoose 的 Model 是 Mongoose 的模型，用于操作 MongoDB 的集合
     */
    @InjectModel(DocumentContent.name)
    private readonly contentModel: Model<DocumentContentDocument>,

    /** 正文在 Mongo，用 InjectModel；FileParser / Storage 是普通 Provider，直接注入即可 */
    private readonly fileParser: FileParserService,
    private readonly storage: LocalStorageService,
    private readonly pipelinePublisher: DocumentPipelinePublisher,
  ) {}

  async uploadAndCreateDocument(file: Express.Multer.File, meta: UploadParseDto, actor: AuthUser) {
    if (!file.buffer?.length) {
      throw new BadRequestException('文件内容不能为空');
    }

    /** 为什么需要将 originalname 转换为 utf8？
     * 1. 避免文件名中的特殊字符导致文件无法访问
     */
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const ext = this.fileParser.getExtension(originalName);
    const markdown = await this.fileParser.parse({
      originalname: originalName,
      buffer: file.buffer,
    });

    const fileUrl = await this.storage.saveDocument(file.buffer, originalName);

    const documentId = nextSnowflakeId();
    const contentId = new Types.ObjectId();
    const title = originalName.replace(/\.[^.]+$/, '') || `文档-${documentId.slice(-6)}`;
    const summary = markdown.slice(0, 200);

    await this.contentModel.create({
      _id: contentId,
      documentId,
      content: markdown,
      contentLength: markdown.length,
      contentSummary: summary,
      deleted: false,
    });

    const entity = this.docRepo.create({
      id: documentId,
      title,
      contentId: String(contentId),
      authorId: actor.userId,
      fileUrl,
      fileExt: ext,
      status: DocumentStatus.Draft,
      wordCount: markdown.length,
      tags: meta.tags ?? null,
      deleted: false,
    });
    await this.docRepo.save(entity);

    return {
      documentId,
      title,
      fileUrl,
      fileSize: file.size,
      fileExtension: ext,
      contentLength: markdown.length,
      contentPreview: summary,
      status: DocumentStatus.Draft,
    };
  }

  async pageDocuments(query: QueryDocumentDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;
    const qb = this.docRepo.createQueryBuilder('d').where('d.deleted = false');

    if (query.keyword) {
      // ILIKE 是 PostgreSQL 的模糊查询，类似于 SQL 的 LIKE
      // :kw 是参数名，%${query.keyword}% 是查询条件
      qb.andWhere('d.title ILIKE :kw', { kw: `%${query.keyword}%` });
    }

    qb.orderBy('d.created_at', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const [list, total] = await qb.getManyAndCount();
    return { list, total, page, pageSize };
  }

  async getDetail(id: string) {
    const doc = await this.docRepo.findOne({
      where: { id, deleted: false },
    });
    if (!doc) {
      throw new NotFoundException('文档不存在');
    }
    /** 为什么使用 lean()？
     * 1. 方便将 Mongoose 的 Document 转换为普通的 JavaScript 对象
     */
    const content = await this.contentModel.findOne({ documentId: id, deleted: false }).lean();
    return {
      ...doc,
      content: content?.content ?? '',
      contentLength: content?.contentLength ?? 0,
    };
  }

  async publish(id: string, _actor: AuthUser) {
    const doc = await this.docRepo.findOne({ where: { id, deleted: false } });
    if (!doc) throw new NotFoundException('文档不存在');
    if (
      doc.status !== DocumentStatus.Draft &&
      doc.status !== DocumentStatus.Published &&
      doc.status !== DocumentStatus.Archived
    ) {
      throw new BadRequestException('当前状态不允许发布');
    }

    doc.status = DocumentStatus.Published;
    doc.publishTime = new Date();
    const saved = await this.docRepo.save(doc);

    // 投递失败不回滚（与 origin 一致）
    await this.pipelinePublisher.afterPublish(saved.id);
    return saved;
  }

  /**
   * 软删除文档：Postgres / Mongo 均标记 deleted。
   * 已发布文档会异步清理搜索索引。
   */
  async remove(id: string, _actor: AuthUser) {
    const doc = await this.docRepo.findOne({ where: { id, deleted: false } });
    if (!doc) {
      throw new NotFoundException('文档不存在');
    }

    if (doc.status === DocumentStatus.Published) {
      await this.pipelinePublisher.afterUnpublish(id);
    }

    doc.deleted = true;
    await this.docRepo.save(doc);
    await this.contentModel.updateOne({ documentId: id }, { $set: { deleted: true } });

    return { id, deleted: true };
  }
}
