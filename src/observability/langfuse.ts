import { Logger } from '@nestjs/common';
import { LangfuseSpanProcessor } from '@langfuse/otel';
import { NodeSDK } from '@opentelemetry/sdk-node';

const logger = new Logger('Langfuse');
let sdk: NodeSDK | undefined;

export function isLangfuseEnabled(): boolean {
  return (
    process.env.LANGFUSE_ENABLED === 'true' &&
    Boolean(process.env.LANGFUSE_PUBLIC_KEY) &&
    Boolean(process.env.LANGFUSE_SECRET_KEY)
  );
}

export async function registerLangfuse(): Promise<void> {
  if (!isLangfuseEnabled()) {
    logger.log('Langfuse 未启用（LANGFUSE_ENABLED!=true 或缺少 key）');
    return;
  }
  sdk = new NodeSDK({
    spanProcessors: [new LangfuseSpanProcessor()],
  });
  await sdk.start();
  logger.log(
    `Langfuse 已注册 baseURL=${process.env.LANGFUSE_BASE_URL ?? 'https://cloud.langfuse.com'}`,
  );
}

export async function shutdownLangfuse(): Promise<void> {
  if (!sdk) return;
  await sdk.shutdown();
  sdk = undefined;
}
