import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DocumentEntity } from '../document/entities/document.entity';
import {
  KG_GRAPH_EXCHANGE,
  KG_RK_BUILD_BY_IDS,
  KG_RK_DELETE,
  RAG_REINDEX_EXCHANGE,
  RAG_RK_BY_IDS,
  RAG_RK_DELETE,
  SEARCH_INDEX_EXCHANGE,
  SEARCH_RK_DELETE,
  SEARCH_RK_INDEX,
} from './mq.constants';
import { KgBuildMessage, ReindexMessage, SearchIndexMessage } from './messages/pipeline.messages';
import { RabbitMqService } from './rabbitmq.service';

/**
 * 文档发布后的知识管线「生产者」
 *
 * <p>触发：RAG 向量化 + Search 全文索引 + KG 建图。</p>
 * <p>约定：投递失败只打日志，<b>不回滚</b>文档已发布状态。</p>
 */
@Injectable()
export class DocumentPipelinePublisher {
  private readonly logger = new Logger(DocumentPipelinePublisher.name);

  constructor(private readonly rabbit: RabbitMqService) {}

  /** 发布成功后调用：并行投递 RAG / Search / KG。 */
  async afterPublish(document: DocumentEntity) {
    await Promise.all([
      this.triggerRagReindex(document.id),
      this.triggerSearchIndex(document.id),
      this.triggerKgBuild(document.id),
    ]);
  }

  /** 归档/删除后：通知 RAG / Search / KG 按文档 ID 清理 */
  async afterUnpublish(documentId: string) {
    await Promise.all([
      this.triggerRagDelete(documentId),
      this.triggerSearchDelete(documentId),
      this.triggerKgDelete(documentId),
    ]);
  }

  /** RAG：按文档 ID 重建向量块 */
  private async triggerRagReindex(documentId: string) {
    const message: ReindexMessage = {
      taskId: randomUUID(),
      type: 'BY_DOC_IDS',
      documentIds: [documentId],
    };
    const ok = await this.rabbit.publish(RAG_REINDEX_EXCHANGE, RAG_RK_BY_IDS, message);
    this.logger.log(
      `RAG 重建索引${ok ? '已投递' : '投递失败'}：documentId=${documentId}, taskId=${message.taskId}`,
    );
  }

  private async triggerRagDelete(documentId: string) {
    const message: ReindexMessage = {
      taskId: randomUUID(),
      type: 'DELETE_BY_DOC_IDS',
      documentIds: [documentId],
    };
    await this.rabbit.publish(RAG_REINDEX_EXCHANGE, RAG_RK_DELETE, message);
  }

  /**
   * Search：只投 documentId。消费者从 Postgres + Mongo 拉全文再写 ES，
   * 避免 MQ 塞正文、也不再截断前 1000 字。
   */
  private async triggerSearchIndex(documentId: string) {
    const message: SearchIndexMessage = {
      taskId: randomUUID(),
      type: 'INDEX',
      documentId,
    };
    const ok = await this.rabbit.publish(SEARCH_INDEX_EXCHANGE, SEARCH_RK_INDEX, message);
    this.logger.log(
      `ES 搜索索引${ok ? '已投递' : '投递失败'}：documentId=${documentId}, taskId=${message.taskId}`,
    );
  }

  private async triggerSearchDelete(documentId: string) {
    const message: SearchIndexMessage = {
      taskId: randomUUID(),
      type: 'DELETE',
      documentId,
    };
    await this.rabbit.publish(SEARCH_INDEX_EXCHANGE, SEARCH_RK_DELETE, message);
  }

  /** KG：按文档 ID 建图谱 */
  private async triggerKgBuild(documentId: string) {
    const message: KgBuildMessage = {
      taskId: randomUUID(),
      type: 'BUILD_BY_DOC_IDS',
      documentIds: [documentId],
    };
    const ok = await this.rabbit.publish(KG_GRAPH_EXCHANGE, KG_RK_BUILD_BY_IDS, message);
    this.logger.log(
      `KG 建图${ok ? '已投递' : '投递失败'}：documentId=${documentId}, taskId=${message.taskId}`,
    );
  }

  private async triggerKgDelete(documentId: string) {
    const message: KgBuildMessage = {
      taskId: randomUUID(),
      type: 'DELETE_BY_DOC_IDS',
      documentIds: [documentId],
    };
    await this.rabbit.publish(KG_GRAPH_EXCHANGE, KG_RK_DELETE, message);
  }
}
