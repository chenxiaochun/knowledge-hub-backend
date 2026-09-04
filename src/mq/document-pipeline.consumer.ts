import { Injectable, Logger } from '@nestjs/common';
import { ConsumeMessage } from 'amqplib';
import { SEARCH_INDEX_QUEUE } from './mq.constant';
import { SearchIndexMessage } from './messages/pipeline.messages';
import { RabbitMQService } from './rabbitmq.service';

/** 本课只打日志；第 5 课在此调用 SearchIndexService */
@Injectable()
export class DocumentPipelineConsumer {
  private readonly logger = new Logger(DocumentPipelineConsumer.name);

  constructor(private readonly rabbit: RabbitMQService) {
    this.rabbit.registerHandler(SEARCH_INDEX_QUEUE, (msg) => this.handleSearch(msg));
  }

  private async handleSearch(msg: ConsumeMessage) {
    const body = JSON.parse(msg.content.toString('utf8')) as SearchIndexMessage;
    this.logger.log(
      `[Search] type=${body.type}, taskId=${body.taskId}, documentId=${body.documentId}`,
    );
  }
}
