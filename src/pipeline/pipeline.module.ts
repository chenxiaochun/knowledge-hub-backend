import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentEntity } from '../document/entities/document.entity';
import {
  DocumentContent,
  DocumentContentSchema,
} from '../document/schemas/document-content.schema';
import { SearchIndexService } from './search-index.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([DocumentEntity]),
    // 下面这行代码是什么意思？
    // 这行代码是注册一个 Mongoose 的模型，用于定义 DocumentContent 模型的结构
    MongooseModule.forFeature([{ name: DocumentContent.name, schema: DocumentContentSchema }]),
  ],
  providers: [SearchIndexService],
  exports: [SearchIndexService],
})
export class PipelineModule {}
