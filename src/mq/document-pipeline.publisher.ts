import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  SEARCH_INDEX_EXCHANGE,
  SEARCH_RK_INDEX,
  SEARCH_RK_DELETE,
  RAG_REINDEX_EXCHANGE,
  RAG_RK_BY_IDS,
  RAG_RK_DELETE,
} from './mq.constant';
import { ReindexMessage, SearchIndexMessage } from './messages/pipeline.messages';
import { RabbitMQService } from './rabbitmq.service';

@Injectable()
export class DocumentPipelinePublisher {
  private readonly logger = new Logger(DocumentPipelinePublisher.name);

  constructor(private readonly rabbit: RabbitMQService) {}

  /** 发布后：全文检索索引 + RAG 向量重建 */
  async afterPublish(documentId: string) {
    await Promise.all([this.triggerSearchIndex(documentId), this.triggerRagReindex(documentId)]);
  }

  /** 删除/下架后：清理搜索索引与向量块 */
  async afterUnpublish(documentId: string) {
    await Promise.all([
      this.triggerSearchDelete(documentId),
      this.triggerRagDelete(documentId),
    ]);
  }

  private async triggerSearchIndex(documentId: string) {
    const message: SearchIndexMessage = {
      taskId: randomUUID(),
      type: 'INDEX',
      documentId,
    };
    const ok = await this.rabbit.publish(SEARCH_INDEX_EXCHANGE, SEARCH_RK_INDEX, message);
    this.logger.log(
      `Search 索引${ok ? '已投递' : '投递失败'}：documentId=${documentId}, taskId=${message.taskId}`,
    );
  }

  private async triggerSearchDelete(documentId: string) {
    const message: SearchIndexMessage = {
      taskId: randomUUID(),
      type: 'DELETE',
      documentId,
    };
    const ok = await this.rabbit.publish(SEARCH_INDEX_EXCHANGE, SEARCH_RK_DELETE, message);
    this.logger.log(
      `Search 删除${ok ? '已投递' : '投递失败'}：documentId=${documentId}, taskId=${message.taskId}`,
    );
  }

  private async triggerRagReindex(documentId: string) {
    const message: ReindexMessage = {
      taskId: randomUUID(),
      type: 'BY_DOC_IDS',
      documentIds: [documentId],
    };
    const ok = await this.rabbit.publish(RAG_REINDEX_EXCHANGE, RAG_RK_BY_IDS, message);
    this.logger.log(
      `RAG 重索引${ok ? '已投递' : '投递失败'}：documentId=${documentId}, taskId=${message.taskId}`,
    );
  }

  private async triggerRagDelete(documentId: string) {
    const message: ReindexMessage = {
      taskId: randomUUID(),
      type: 'DELETE_BY_DOC_IDS',
      documentIds: [documentId],
    };
    const ok = await this.rabbit.publish(RAG_REINDEX_EXCHANGE, RAG_RK_DELETE, message);
    this.logger.log(
      `RAG 删除${ok ? '已投递' : '投递失败'}：documentId=${documentId}, taskId=${message.taskId}`,
    );
  }
}
