import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';
import { DocumentEntity } from './entities/document.entity';
import { FileParserService } from './parser/file-parser.service';
import { DocumentContent, DocumentContentSchema } from './schemas/document-content.schema';

@Module({
  imports: [
    TypeOrmModule.forFeature([DocumentEntity]),
    // 为什么使用 MongooseModule.forFeature？
    // 1. 方便使用 Mongoose 的 Model
    MongooseModule.forFeature([{ name: DocumentContent.name, schema: DocumentContentSchema }]),
  ],
  controllers: [DocumentController],
  providers: [DocumentService, FileParserService],
  exports: [DocumentService],
})
export class DocumentModule {}
