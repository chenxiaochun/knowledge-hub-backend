import { Client } from '@elastic/elasticsearch';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { InjectRepository } from '@nestjs/typeorm';
import { Model } from 'mongoose';
import { Repository } from 'typeorm';
import { DocumentStatus } from '../document/document-status';
import { DocumentEntity } from '../document/entities/document.entity';
import {
  DocumentContent,
  DocumentContentDocument,
} from '../document/schemas/document-content.schema';

const ES_INDEX = 'kh_document';

@Injectable()
export class SearchIndexService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SearchIndexService.name);
  private es: Client | null = null;
  private esEnabled: boolean;

  constructor(
    private readonly configService: ConfigService,

    @InjectRepository(DocumentEntity)
    private readonly docRepository: Repository<DocumentEntity>,

    @InjectModel(DocumentContent.name)
    private readonly documentContentModel: Model<DocumentContentDocument>,
  ) {
    this.esEnabled = this.configService.get('ELASTICSEARCH_ENABLED') === 'true';
  }

  async onModuleInit() {
    if (!this.esEnabled) {
      this.logger.log('Elasticsearch 已被禁用');
      return;
    }
    // get 方法的第二个参数是什么意思？
    // 第二个参数是默认值，如果第一个参数不存在，则返回第二个参数
    const node = this.configService.get('ELASTICSEARCH_NODE', 'http://localhost:9200');
    this.es = new Client({ node });

    try {
      await this.es.cluster.health();
      await this.ensureIndex();
    } catch (error) {
      this.es = null;
      this.logger.error('Elasticsearch 初始化失败', error);
    }
  }

  async onModuleDestroy() {
    this.es?.close();
  }

  private async ensureIndex() {
    if (!this.es) {
      return;
    }
    const exists = await this.es.indices.exists({ index: ES_INDEX });
    if (exists) {
      return;
    }

    await this.es.indices.create({
      index: ES_INDEX,
      mappings: {
        properties: {
          id: { type: 'keyword' },
          title: { type: 'text' },
          summary: { type: 'text' },
          content: { type: 'text' },
          authorId: { type: 'keyword' },
          status: { type: 'integer' },
          publishTime: { type: 'date' },
          indexedAt: { type: 'date' },
        },
      },
    });
  }

  /** 供 MQ Consumer 调用：按文档 ID 重建全文索引 */
  async indexFromDocumentId(documentId: string) {
    if (!this.es) {
      this.logger.error('Elasticsearch 未初始化');
      return;
    }
    const doc = await this.docRepository.findOne({ where: { id: documentId, deleted: false } });
    if (!doc || doc.status !== DocumentStatus.Published) {
      this.logger.warn(`文档 ${documentId} 不存在或还未发布`);
      return;
    }

    // Mongoose 条件直接传字段，不要写成 TypeORM 的 { where: ... }，否则永远查不到正文
    const content = await this.documentContentModel.findOne({ documentId, deleted: false }).lean();
    const body = {
      id: doc.id,
      title: doc.title,
      summary: content?.contentSummary || '',
      content: content?.content || '',
      authorId: doc.authorId ?? null,
      status: doc.status,
      publishTime: doc.publishTime ?? null,
      indexedAt: new Date().toISOString(),
    };
    await this.es.index({
      index: ES_INDEX,
      id: doc.id,
      document: body,
      refresh: true,
    });
    this.logger.log(`搜索索引已写入：documentId=${doc.id}`);
  }

  async deleteDocument(documentId: string) {
    if (!this.es) {
      this.logger.error('Elasticsearch 未初始化');
      return;
    }
    try {
      await this.es.delete({
        index: ES_INDEX,
        id: documentId,
        refresh: true,
      });
    } catch (error) {
      this.logger.error(`删除文档 ${documentId} 失败`, error);
      throw error;
    }
  }

  async searchDocuments(params: { keyword: string; page: number; pageSize: number }) {
    const page = params.page || 1;
    const pageSize = Math.min(params.pageSize || 10, 50);
    const from = (page - 1) * pageSize;

    if (!this.es) {
      return {
        total: 0,
        page,
        pageSize,
        items: [],
      };
    }

    const keyword = params.keyword.trim();
    const response = await this.es.search({
      index: ES_INDEX,
      from,
      size: pageSize,
      query: {
        multi_match: {
          query: keyword,
          fields: ['title^3', 'summary^2', 'content'],
        },
      },
      _source: { excludes: ['content'] },
      highlight: {
        fields: {
          title: { number_of_fragments: 0 },
          content: { fragment_size: 160, number_of_fragments: 3 },
        },
      },
    });
    const totalRaw = response.hits.total;
    const total = typeof totalRaw === 'number' ? totalRaw : (totalRaw?.value ?? 0);

    // 下面这段代码是什么意思？
    // 这段代码是将 Elasticsearch 的搜索结果转换为数组，其中 h._id 是文档 ID，h._score 是文档得分，h._source 是文档内容，h.highlight 是文档高亮部分
    const items = response.hits.hits.map((h) => ({
      id: h._id,
      score: h._score,
      ...(h._source as object),
      highlight: h.highlight,
    }));
    return { items, total, page, pageSize };
  }
}
