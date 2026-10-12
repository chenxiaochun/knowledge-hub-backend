/** 问答引用溯源 */
export class ChatSourceDto {
  index!: number;
  documentId!: string;
  documentTitle!: string;
  heading!: string | null;
  excerpt!: string;
  score!: number;
}

/** 助手消息中的生图结果（GET /ai/sessions/:id/messages 的 images，前端可转为 data-image part） */
export class ChatImageDto {
  url!: string;
  prompt?: string;
  mode?: string;
  size?: string;
}

/** 图谱命中实体（避免内联对象类型导致 Swagger 误判循环依赖） */
export class ChatGraphEntityDto {
  name!: string;
  type!: string | null;
  description!: string | null;
}

export class ChatGraphRelationDto {
  source!: string;
  relation!: string;
  target!: string;
}

export class ChatGraphDocumentDto {
  documentId!: string;
  title!: string;
}

/** 助手消息中的本轮图谱命中（GET messages 的 graph，前端可转为 data-graph part） */
export class ChatGraphDto {
  query!: string;
  entities!: ChatGraphEntityDto[];
  relations!: ChatGraphRelationDto[];
  documents!: ChatGraphDocumentDto[];
}

/** POST /ai/chat 响应 */
export class ChatResponseDto {
  sessionId!: string | null;
  answer!: string;
  sources!: ChatSourceDto[];
}
