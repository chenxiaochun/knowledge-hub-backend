import { PartialType } from '@nestjs/mapped-types';
import { CreateDocumentDto } from './create-document.dto';

/** 更新文档（字段均可选；作者 / 更新人从登录态写入） */
export class UpdateDocumentDto extends PartialType(CreateDocumentDto) {}
