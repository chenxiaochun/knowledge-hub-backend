import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { InjectRepository } from '@nestjs/typeorm';

import { Client } from '@elastic/elasticsearch';
import { Model } from 'mongoose';
import { Repository } from 'typeorm';

import { DocumentStatus } from '../document/document-status';
import { DocumentEntity } from '../document/entities/document.entity';
import {
  DocumentContent,
  DocumentContentDocument,
} from '../document/schemas/document-content.schema';
import type { SearchDocumentsResultDto } from '../search/dto/search-result.dto';

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
          tags: { type: 'keyword' },
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
      publishTime: doc.publishTime?.toISOString() ?? null,
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
      this.logger.warn(`跳过搜索索引删除（ES 不可用）：documentId=${documentId}`);
      return;
    }
    try {
      await this.es.delete({ index: ES_INDEX, id: documentId, refresh: true });
      this.logger.log(`搜索索引已删除：documentId=${documentId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // 幂等：没有这篇就当删除成功
      if (message.includes('404')) {
        this.logger.warn(`ES 中无此文档，视为已删除：documentId=${documentId}`);
        return;
      }
      this.logger.warn(`ES 删除失败：documentId=${documentId}, ${message}`);
      // 不要 throw —— 避免毒消息
    }
  }

  async searchDocuments(params: {
    keyword: string;
    page: number;
    pageSize: number;
  }): Promise<SearchDocumentsResultDto> {
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
      // 不返回 content 字段
      _source: { excludes: ['content'] },
      // 高亮显示 title 和 content 字段
      highlight: {
        fields: {
          title: { number_of_fragments: 0 },
          content: { fragment_size: 160, number_of_fragments: 3 },
        },
      },
    });
    const totalRaw = response.hits.total;
    const total = typeof totalRaw === 'number' ? totalRaw : (totalRaw?.value ?? 0);

    const items = response.hits.hits.map((h) => {
      const source = (h._source ?? {}) as {
        title?: string;
        summary?: string;
        authorId?: string | null;
        status?: number;
        publishTime?: string | null;
        indexedAt?: string | null;
        tags?: string | null;
      };
      return {
        id: String(h._id ?? source.title ?? ''),
        score: h._score ?? null,
        title: source.title ?? '',
        summary: source.summary,
        authorId: source.authorId ?? null,
        status: source.status ?? 0,
        publishTime: source.publishTime ?? null,
        indexedAt: source.indexedAt ?? null,
        tags: source.tags ?? null,
        highlight: h.highlight
          ? {
              title: h.highlight.title,
              content: h.highlight.content,
            }
          : undefined,
      };
    });
    return { items, total, page, pageSize };
  }
}
