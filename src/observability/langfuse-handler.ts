import { CallbackHandler } from '@langfuse/langchain';

import { isLangfuseEnabled } from './langfuse';

export function createLangfuseHandler(opts: {
  userId?: string;
  sessionId?: string;
  tags?: string[];
  /** 写入 Langfuse trace 的元数据（脱敏后的 intent / 开关等） */
  traceMetadata?: Record<string, unknown>;
}): CallbackHandler | undefined {
  if (!isLangfuseEnabled()) return undefined;
  return new CallbackHandler({
    userId: opts.userId,
    sessionId: opts.sessionId,
    tags: opts.tags,
    traceMetadata: opts.traceMetadata,
  });
}
