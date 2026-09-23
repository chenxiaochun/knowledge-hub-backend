import { Module } from '@nestjs/common';

import { GraphModule } from '../graph/graph.module';
import { PipelineModule } from '../pipeline/pipeline.module';
import { DocumentPipelineConsumer } from './document-pipeline.consumer';
import { DocumentPipelinePublisher } from './document-pipeline.publisher';
import { RabbitMQService } from './rabbitmq.service';

@Module({
  imports: [PipelineModule, GraphModule],
  providers: [RabbitMQService, DocumentPipelinePublisher, DocumentPipelineConsumer],
  exports: [DocumentPipelinePublisher, RabbitMQService],
})
export class MqModule {}
