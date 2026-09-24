/** 问答引用溯源 */
export class ChatSourceDto {
  index!: number;
  documentId!: string;
  documentTitle!: string;
  heading!: string | null;
  excerpt!: string;
  score!: number;
}

/** POST /ai/chat 响应 */
export class ChatResponseDto {
  sessionId!: string | null;
  answer!: string;
  sources!: ChatSourceDto[];
}
