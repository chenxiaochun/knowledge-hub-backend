import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SEARCH_INDEX_EXCHANGE, SEARCH_RK_DELETE, SEARCH_RK_INDEX } from './mq.constant';
import { SearchIndexMessage } from './messages/pipeline.messages';
import { RabbitMQService } from './rabbitmq.service';

@Injectable()
export class DocumentPipelinePublisher {
  private readonly logger = new Logger(DocumentPipelinePublisher.name);

  constructor(private readonly rabbit: RabbitMQService) {}

  // 发布后索引, 文档更新后需要重新索引
  async afterPublish(documentId: string) {
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

  // 删除后删除索引, 文档删除后需要删除索引
  async afterUnpublish(documentId: string) {
    const message: SearchIndexMessage = {
      taskId: randomUUID(),
      type: 'DELETE',
      documentId,
    };
    await this.rabbit.publish(SEARCH_INDEX_EXCHANGE, SEARCH_RK_DELETE, message);
  }
}
