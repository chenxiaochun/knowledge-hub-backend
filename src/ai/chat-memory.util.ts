import { AIMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages';

import type { AiMessageEntity } from './entities/ai-message.entity';

/** LangChain 的 content 可能是 string / part 数组 / 其他类型，统一提取成可用的纯文本 */
export function messageText(message: BaseMessage): string {
  const content = message.content;
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return String(content ?? '').trim();
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part && typeof part === 'object' && 'text' in part) {
        return String((part as { text?: string }).text ?? '');
      }
      return '';
    })
    .join('')
    .trim();
}

/** Redis 反序列化可能含 tool/system 等消息，短期记忆只保留用户与助手轮次 */
export function isWorkingMessage(message: BaseMessage): boolean {
  return HumanMessage.isInstance(message) || AIMessage.isInstance(message);
}

/** 数据库会话是 role+content 扁平结构，需转成 LangChain 消息才能拼进历史与改写器 */
export function dbRowsToMessages(rows: AiMessageEntity[]): BaseMessage[] {
  const out: BaseMessage[] = [];
  for (const row of rows) {
    const text = row.content?.trim();
    if (!text) continue;
    if (row.role === 'user') out.push(new HumanMessage(text));
    if (row.role === 'assistant') out.push(new AIMessage(text));
  }
  return out;
}

/** 多轮检索改写只需最近几轮摘要，截断助手长答避免制度原文污染 standalone query */
export function compactRewriteContext(history: BaseMessage[]): string {
  if (!history.length) return '';
  const lines: string[] = [];
  for (const message of history.slice(-4)) {
    const text = messageText(message);
    if (!text) continue;
    if (HumanMessage.isInstance(message)) {
      lines.push(`用户：${text.slice(0, 200)}`);
    } else if (AIMessage.isInstance(message)) {
      lines.push(`助手：${text.slice(0, 120)}`);
    }
  }
  return lines.join('\n');
}
