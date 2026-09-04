import { Module } from '@nestjs/common';
import { DocumentPipelineConsumer } from './document-pipeline.consumer';
import { DocumentPipelinePublisher } from './document-pipeline.publisher';
import { RabbitMQService } from './rabbitmq.service';

@Module({
  providers: [RabbitMQService, DocumentPipelinePublisher, DocumentPipelineConsumer],
  exports: [DocumentPipelinePublisher, RabbitMQService],
})
export class MqModule {}
