import { CallbackHandler } from '@langfuse/langchain';

import { isLangfuseEnabled } from './langfuse';

export function createLangfuseHandler(opts: {
  userId?: string;
  sessionId?: string;
  tags?: string[];
}): CallbackHandler | undefined {
  if (!isLangfuseEnabled()) return undefined;
  return new CallbackHandler({
    userId: opts.userId,
    sessionId: opts.sessionId,
    tags: opts.tags,
  });
}
