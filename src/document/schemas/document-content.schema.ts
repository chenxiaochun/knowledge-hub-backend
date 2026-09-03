import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type DocumentContentDocument = HydratedDocument<DocumentContent>;

@Schema({
  collection: 'document_content',
  /**
   * 为什么要自动添加 createdAt 和 updatedAt 字段？
   * 1. 方便查询和排序
   */
  timestamps: true,
  /** 为什么禁用版本号？
   * 1. 版本号是用于记录文档内容的变更历史，但我们不需要这个功能
   * 2. 版本号会增加数据库的复杂度，降低性能
   * 3. 版本号会增加开发和维护的复杂度
   * 4. 版本号会增加数据库的存储空间占用
   * 5. 版本号会增加数据库的查询复杂度
   * 6. 版本号会增加数据库的更新复杂度
   * 7. 版本号会增加数据库的删除复杂度
   * 8. 版本号会增加数据库的备份复杂度
   * 9. 版本号会增加数据库的恢复复杂度
   */
  versionKey: false,
})
export class DocumentContent {
  // 为什么 _id 是必需的？
  // 1. 方便查询和排序
  _id!: Types.ObjectId;

  @Prop({ type: String, required: true, index: true })
  documentId!: string;

  @Prop({ type: String, required: true, default: '' })
  content!: string;

  @Prop({ type: Number, default: 0 })
  contentLength!: number;

  @Prop({ type: String, default: '' })
  contentSummary!: string;

  @Prop({ type: Boolean, default: false })
  deleted!: boolean;
}

export const DocumentContentSchema = SchemaFactory.createForClass(DocumentContent);
