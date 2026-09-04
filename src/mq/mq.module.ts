import { Module } from '@nestjs/common';
import { DocumentPipelineConsumer } from './document-pipeline.consumer';
import { DocumentPipelinePublisher } from './document-pipeline.publisher';
import { RabbitMQService } from './rabbitmq.service';
import { PipelineModule } from '../pipeline/pipeline.module';

@Module({
  imports: [PipelineModule],
  providers: [RabbitMQService, DocumentPipelinePublisher, DocumentPipelineConsumer],
  exports: [DocumentPipelinePublisher, RabbitMQService],
})
export class MqModule {}
