import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InjectRepository } from '@nestjs/typeorm';
import { Model } from 'mongoose';
import { Repository } from 'typeorm';
import { DocumentEntity } from '../document/entities/document.entity';
import {
  DocumentContent,
  DocumentContentDocument,
} from '../document/schemas/document-content.schema';
import { ChunkingService } from './chunking.service';
import { EmbeddingService } from './embedding.service';
import { VectorIndexService } from './vector-index.service';

/**
 * RAG 编排：读库 → 分块 → Embedding → 写 kh_chunk。
 * 由 MQ Consumer 调用，不直接碰 RabbitMQ。
 */
@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);

  constructor(
    @InjectRepository(DocumentEntity)
    private readonly docRepo: Repository<DocumentEntity>,

    @InjectModel(DocumentContent.name)
    private readonly contentModel: Model<DocumentContentDocument>,

    private readonly chunking: ChunkingService,
    private readonly embedding: EmbeddingService,
    private readonly vectorIndex: VectorIndexService,
  ) {}

  async reindexByIds(documentIds: string[]) {
    for (const id of documentIds) {
      try {
        await this.reindexOne(id);
      } catch (error) {
        this.logger.error(`Error reindexing document ${id}: ${error}`);
      }
    }
  }

  async deleteByDocIds(documentIds: string[]) {
    for (const id of documentIds) {
      try {
        await this.vectorIndex.deleteByDocId(id);
      } catch (error) {
        this.logger.error(`Error deleting document ${id}: ${error}`);
      }
    }
  }

  async reindexOne(documentId: string) {
    const doc = await this.docRepo.findOne({ where: { id: documentId, deleted: false } });
    if (!doc) {
      this.logger.error(`Document ${documentId} not found`);
      return;
    }

    // Mongoose 用普通 filter，不是 TypeORM 的 { where: ... }
    const contentDoc = await this.contentModel.findOne({ documentId, deleted: false }).lean();
    const content = contentDoc?.content?.trim() ?? '';
    if (!content) {
      this.logger.error(`Content for document ${documentId} is empty`);
      return;
    }

    await this.vectorIndex.deleteByDocId(documentId);
    const chunks = await this.chunking.chunk({
      content,
      documentId,
      documentTitle: doc.title,
    });
    if (!chunks.length) {
      return;
    }
    const vectors = await this.embedding.embedBatch(chunks.map((chunk) => chunk.content));
    await this.vectorIndex.bulkIndex(chunks, vectors);
    this.logger.log(`Reindexed document ${documentId}`);
  }

  async semanticSearch(query: string, topK: number = 5) {
    const [vec] = await this.embedding.embedBatch([query]);
    return this.vectorIndex.knnSearch(vec, topK);
  }
}
