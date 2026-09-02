import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type DocumentContentDocument = HydratedDocument<DocumentContent>;

/**
 * 文档正文（MongoDB）
 * 与 Postgres kh_document 一对一：_id ↔ content_id，documentId ↔ id
 */
@Schema({
  collection: 'document_content',
  timestamps: true,
  versionKey: false,
})
export class DocumentContent {
  /** ObjectId，对应 kh_document.content_id */
  _id!: Types.ObjectId;

  /** 关联的文档元数据 ID（kh_document.id） */
  @Prop({ type: String, required: true, index: true })
  documentId!: string;

  /** Markdown 正文 */
  @Prop({ type: String, required: true, default: '' })
  content!: string;

  /** 正文字符数 */
  @Prop({ type: Number, default: 0 })
  contentLength!: number;

  /** 正文摘要 / 预览 */
  @Prop({ type: String, default: '' })
  contentSummary!: string;

  /** 版本号 */
  @Prop({ type: Number, default: 1 })
  version!: number;

  /** 逻辑删除 */
  @Prop({ type: Boolean, default: false })
  deleted!: boolean;
}

export const DocumentContentSchema = SchemaFactory.createForClass(DocumentContent);
