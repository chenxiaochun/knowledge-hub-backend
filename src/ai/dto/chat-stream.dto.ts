import { Type } from 'class-transformer';
import {
  Allow,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

/** useChat / DefaultChatTransport 会带 messages + 若干扩展字段 */
export class ChatStreamDto {
  @IsArray()
  messages!: Array<{
    role?: string;
    parts?: Array<{ type?: string; text?: string }>;
  }>;

  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  topK?: number;

  /** 为 true 时同步将 AI 文本流推送给 TTS（需前端先连 WS） */
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  enableTts?: boolean;

  @IsOptional()
  @IsString()
  id?: string;

  @IsOptional()
  @Allow()
  trigger?: unknown;

  @IsOptional()
  @Allow()
  messageId?: unknown;
}
