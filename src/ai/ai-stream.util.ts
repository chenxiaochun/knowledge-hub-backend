import { getToolName, isToolUIPart, type UIMessage } from 'ai';

import type { ChatImageDto } from './dto/chat-response.dto';
import type { ChatStreamDto } from './dto/chat-stream.dto';

export const RAG_EXCERPT_LEN = 200;

/** UI Message 数组里取最后一条用户文本，供流式入口解析当前问题 */
export function lastUserText(messages: ChatStreamDto['messages'] | undefined): string {
  if (!messages?.length) return '';
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg.role !== 'user') continue;
    const text = (msg.parts ?? [])
      .filter((p) => p.type === 'text' && p.text)
      .map((p) => p.text)
      .join('');
    return text.trim();
  }
  return '';
}

/** 百炼 reasoning_content → @ai-sdk/langchain 可识别的 reasoning.summary */
export async function* mapReasoningStream(stream: AsyncIterable<unknown>): AsyncIterable<unknown> {
  for await (const event of stream) {
    attachDashScopeReasoning(event);
    yield event;
  }
}

function attachDashScopeReasoning(value: unknown, seen = new Set<object>()): void {
  if (value == null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) attachDashScopeReasoning(item, seen);
    return;
  }
  const obj = value as Record<string, unknown>;
  const kwargs = obj.additional_kwargs as Record<string, unknown> | undefined;
  if (typeof kwargs?.reasoning_content === 'string' && kwargs.reasoning_content) {
    kwargs.reasoning = {
      summary: [{ type: 'summary_text', text: kwargs.reasoning_content }],
    };
  }
  attachDashScopeReasoning(obj.chunk, seen);
  attachDashScopeReasoning(obj.data, seen);
  attachDashScopeReasoning(obj.kwargs, seen);
  attachDashScopeReasoning(obj.messages, seen);
}

/** 检索来源卡片展示用，压缩空白并截断过长正文 */
export function excerptRagContent(content: string, maxLen = RAG_EXCERPT_LEN): string {
  const text = content.replace(/\s+/g, ' ').trim();
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}...`;
}

/** 从流式结束时的 assistant parts 提取 generate_image 成功结果，供落库 images */
export function extractGeneratedImagesFromParts(
  parts: UIMessage['parts'] | undefined,
): ChatImageDto[] {
  if (!parts?.length) return [];
  const images: ChatImageDto[] = [];
  for (const part of parts) {
    if (!isToolUIPart(part)) continue;
    if (getToolName(part) !== 'generate_image') continue;
    if (part.state !== 'output-available') continue;
    const payload = parseToolResultPayload(part.output);
    if (!payload || typeof payload.url !== 'string' || typeof payload.error === 'string') continue;
    images.push({
      url: payload.url,
      prompt: typeof payload.prompt === 'string' ? payload.prompt : undefined,
      mode: typeof payload.mode === 'string' ? payload.mode : undefined,
      size: typeof payload.size === 'string' ? payload.size : undefined,
    });
  }
  return images;
}

function parseToolResultPayload(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      return parseToolResultPayload(JSON.parse(value));
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object') return null;
  const rec = value as Record<string, unknown>;
  if (typeof rec.content === 'string') {
    const nested = parseToolResultPayload(rec.content);
    if (nested) return nested;
  }
  return rec;
}
