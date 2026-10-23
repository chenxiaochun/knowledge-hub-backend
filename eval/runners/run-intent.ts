/**
 * 意图金标跑分：优先 Nest ApplicationContext；若 AppModule 因缺中间件失败，
 * 则降级为 ChatOpenAI（同 LlmService 读 env）+ new ChatQueryRewriteService(llm)。
 */
import 'reflect-metadata';
import { config } from 'dotenv';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ChatOpenAI } from '@langchain/openai';
import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';

import { AppModule } from '../../src/app.module';
import { ChatQueryRewriteService } from '../../src/ai/chat-query-rewrite.service';
import {
  summarizeIntentResults,
  type ChatIntent,
  type IntentCaseResult,
} from '../lib/metrics';

config({ path: resolve(process.cwd(), '.env') });

type GoldenLine = {
  id: string;
  question: string;
  expect: { intent: ChatIntent; allowGraph: boolean; allowWeb: boolean };
  skip?: boolean;
};

type RewriteHandle = {
  rewrite: ChatQueryRewriteService;
  close: () => Promise<void>;
  mode: 'nest' | 'standalone';
};

function buildStandaloneLlm(): ChatOpenAI {
  const apiKey = process.env.OPENAI_API_KEY || process.env.DASHSCOPE_API_KEY;
  const modelName = process.env.MODEL_NAME;
  const baseUrl = process.env.OPENAI_BASE_URL;
  if (!apiKey || !modelName) {
    throw new Error(
      '缺少 OPENAI_API_KEY/DASHSCOPE_API_KEY 或 MODEL_NAME，无法启动意图评测',
    );
  }
  return new ChatOpenAI({
    apiKey,
    model: modelName,
    timeout: 45_000,
    maxRetries: 1,
    configuration: { baseURL: baseUrl },
    modelKwargs: { enable_thinking: false },
  });
}

async function createRewrite(): Promise<RewriteHandle> {
  try {
    const app: INestApplicationContext = await NestFactory.createApplicationContext(
      AppModule,
      { logger: ['error', 'warn'] },
    );
    const rewrite = app.get(ChatQueryRewriteService);
    return {
      rewrite,
      mode: 'nest',
      close: async () => {
        await app.close();
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[eval:intent] Nest ApplicationContext 失败，降级 standalone LLM：${msg}`);
    const llm = buildStandaloneLlm();
    const rewrite = new ChatQueryRewriteService(llm);
    return {
      rewrite,
      mode: 'standalone',
      close: async () => undefined,
    };
  }
}

async function main() {
  const lines = readFileSync('eval/datasets/golden-v1.jsonl', 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as GoldenLine);

  const handle = await createRewrite();
  console.log(`[eval:intent] mode=${handle.mode}`);

  const rows: IntentCaseResult[] = [];
  try {
    for (const item of lines) {
      if (item.skip) continue;
      const plan = await handle.rewrite.classify(item.question, []);
      rows.push({
        id: item.id,
        expectIntent: item.expect.intent,
        predIntent: plan.intent,
        expectAllowGraph: item.expect.allowGraph,
        predAllowGraph: plan.allowGraph,
        expectAllowWeb: item.expect.allowWeb,
        predAllowWeb: plan.allowWeb,
      });
      console.log(
        `${item.id}\texpect=${item.expect.intent}\tpred=${plan.intent}\t${
          item.expect.intent === plan.intent ? 'OK' : 'FAIL'
        }`,
      );
    }
  } finally {
    await handle.close();
  }

  const summary = summarizeIntentResults(rows);
  mkdirSync('eval/reports', { recursive: true });
  const out = `eval/reports/${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  writeFileSync(
    out,
    JSON.stringify({ generatedAt: new Date().toISOString(), mode: handle.mode, summary, rows }, null, 2),
  );
  console.log(
    `\nintentAccuracy=${(summary.intentAccuracy * 100).toFixed(1)}% ` +
      `allowGraph=${(summary.allowGraphAccuracy * 100).toFixed(1)}% ` +
      `allowWeb=${(summary.allowWebAccuracy * 100).toFixed(1)}%`,
  );
  console.log(`report: ${out}`);
  // Nest 半初始化或 LLM 连接可能占住事件循环
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
