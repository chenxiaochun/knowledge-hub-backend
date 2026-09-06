import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentEntity } from '../document/entities/document.entity';
import {
  DocumentContent,
  DocumentContentSchema,
} from '../document/schemas/document-content.schema';
import { ChunkingService } from './chunking.service';
import { EmbeddingService } from './embedding.service';
import { ExtractionService } from './extraction.service';
import { RagService } from './rag.service';
import { SearchIndexService } from './search-index.service';
import { VectorIndexService } from './vector-index.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([DocumentEntity]),
    MongooseModule.forFeature([
      { name: DocumentContent.name, schema: DocumentContentSchema },
    ]),
  ],
  providers: [
    SearchIndexService,
    ChunkingService,
    EmbeddingService,
    VectorIndexService,
    RagService,
    ExtractionService,
  ],
  exports: [
    SearchIndexService,
    ChunkingService,
    EmbeddingService,
    VectorIndexService,
    RagService,
    ExtractionService,
  ],
})
export class PipelineModule {}
