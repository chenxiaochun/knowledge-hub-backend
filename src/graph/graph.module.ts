import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TypeOrmModule } from '@nestjs/typeorm';

import { DocumentEntity } from '../document/entities/document.entity';
import {
  DocumentContent,
  DocumentContentSchema,
} from '../document/schemas/document-content.schema';
import { PipelineModule } from '../pipeline/pipeline.module';
import { ExtractionService } from './extraction.service';
import { GraphBuildService } from './graph-build.service';
import { GraphController } from './graph.controller';

@Module({
  imports: [
    PipelineModule,
    TypeOrmModule.forFeature([DocumentEntity]),
    MongooseModule.forFeature([{ name: DocumentContent.name, schema: DocumentContentSchema }]),
  ],
  controllers: [GraphController],
  providers: [ExtractionService, GraphBuildService],
  exports: [GraphBuildService],
})
export class GraphModule {}
