import { Module } from '@nestjs/common';

import { PipelineModule } from '../pipeline/pipeline.module';
import { DocumentPipelineConsumer } from './document-pipeline.consumer';
import { DocumentPipelinePublisher } from './document-pipeline.publisher';
import { RabbitMQService } from './rabbitmq.service';

@Module({
  imports: [PipelineModule],
  providers: [RabbitMQService, DocumentPipelinePublisher, DocumentPipelineConsumer],
  exports: [DocumentPipelinePublisher, RabbitMQService],
})
export class MqModule {}
