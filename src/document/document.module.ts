import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MqModule } from '../mq/mq.module';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';
import { DocumentEntity } from './entities/document.entity';
import { FileParserService } from './parser/file-parser.service';
import { DocumentContent, DocumentContentSchema } from './schemas/document-content.schema';

@Module({
  imports: [
    TypeOrmModule.forFeature([DocumentEntity]),
    MongooseModule.forFeature([{ name: DocumentContent.name, schema: DocumentContentSchema }]),
    // DocumentService 依赖 DocumentPipelinePublisher，需导入并复用 MqModule 的 exports
    MqModule,
  ],
  controllers: [DocumentController],
  providers: [DocumentService, FileParserService],
  exports: [DocumentService],
})
export class DocumentModule {}
