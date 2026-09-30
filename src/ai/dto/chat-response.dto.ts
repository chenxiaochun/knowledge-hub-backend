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

/** POST /ai/chat 响应 */
export class ChatResponseDto {
  sessionId!: string | null;
  answer!: string;
  sources!: ChatSourceDto[];
}
