# Agent 分层评测 + Langfuse Cloud Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 P0——对话主路径可选接入 Langfuse Cloud 观测，并提供金标意图评测脚本 + 小白教程。

**Architecture:** 启动时按开关注册 `LangfuseSpanProcessor`；流式对话用 `CallbackHandler` +（必要时）`startActiveObservation` 包住整轮，且不破坏 `invokeIsolated` 对 SSE 的隔离。离线 `eval:intent` 通过 Nest `ApplicationContext` 调用真实 `ChatQueryRewriteService.classify`，对 `golden-v1.jsonl` 计算意图/开关准确率与混淆矩阵。

**Tech Stack:** NestJS 11、LangChain (`@langchain/openai`)、`@langfuse/langchain` + `@langfuse/otel`、OpenTelemetry、ts-node、现有 `.env`。

## Global Constraints

- 规格：`docs/superpowers/specs/2026-10-23-agent-eval-langfuse-design.md`
- `LANGFUSE_ENABLED` 未设为 `true` 时行为与现网一致（零强制依赖）
- 不提交真实 Langfuse / LLM key；README 只写键名
- P0 不做自托管 Langfuse、不做 L2/L3 检索与答案评测、不打通 Langfuse Dataset
- 开启 Langfuse 后流式响应不得泄漏 route/grade 的 structured JSON
- 金标 `intent` 枚举：`chitchat` | `profile` | `kb` | `web` | `kb_then_web`
- `allowGraph` / `allowWeb` 期望与 `ChatQueryRewriteService` 的 `toPlan` 派生规则一致（kb 族开图谱与检索；web / kb_then_web 开联网）

## File map

| 路径 | 职责 |
|------|------|
| `src/observability/langfuse.ts` | 启动注册 / shutdown；`isLangfuseEnabled()` |
| `src/observability/langfuse-handler.ts` | 按请求创建 `CallbackHandler` |
| `src/main.ts` | 调用 register / flush on shutdown |
| `src/ai/ai-stream.service.ts` | 流式主路径挂 handler / observation |
| `eval/datasets/golden-v1.jsonl` | P0 样例金标（≥15） |
| `eval/lib/metrics.ts` | 纯函数：准确率、混淆矩阵（可单测） |
| `eval/runners/run-intent.ts` | CLI 跑分入口 |
| `eval/reports/.gitignore` | 忽略本地报告 |
| `eval/reports/sample-report.json` | 样例报告结构 |
| `docs/course/22-agent-eval-langfuse.html` | 小白教程 |
| `docs/course/index.html` | 课表入口 |
| `README.md` | 简短 Langfuse / eval 入口 |
| `package.json` | 依赖 + `eval:intent` 脚本 |

---

### Task 1: 纯函数指标库（TDD）

**Files:**
- Create: `eval/lib/metrics.ts`
- Create: `eval/lib/metrics.spec.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `type ChatIntent = 'chitchat' | 'profile' | 'kb' | 'web' | 'kb_then_web'`
  - `type IntentCaseResult = { id: string; expectIntent: ChatIntent; predIntent: ChatIntent; expectAllowGraph: boolean; predAllowGraph: boolean; expectAllowWeb: boolean; predAllowWeb: boolean }`
  - `function summarizeIntentResults(rows: IntentCaseResult[]): { total: number; intentAccuracy: number; allowGraphAccuracy: number; allowWebAccuracy: number; confusion: Record<string, Record<string, number>>; failures: IntentCaseResult[] }`

- [ ] **Step 1: Write the failing test**

```ts
// eval/lib/metrics.spec.ts
import { summarizeIntentResults } from './metrics';

describe('summarizeIntentResults', () => {
  it('computes accuracies and confusion', () => {
    const summary = summarizeIntentResults([
      {
        id: '1',
        expectIntent: 'kb',
        predIntent: 'kb',
        expectAllowGraph: true,
        predAllowGraph: true,
        expectAllowWeb: false,
        predAllowWeb: false,
      },
      {
        id: '2',
        expectIntent: 'kb',
        predIntent: 'web',
        expectAllowGraph: true,
        predAllowGraph: false,
        expectAllowWeb: false,
        predAllowWeb: true,
      },
    ]);
    expect(summary.total).toBe(2);
    expect(summary.intentAccuracy).toBe(0.5);
    expect(summary.allowGraphAccuracy).toBe(0.5);
    expect(summary.allowWebAccuracy).toBe(0.5);
    expect(summary.confusion.kb.kb).toBe(1);
    expect(summary.confusion.kb.web).toBe(1);
    expect(summary.failures).toHaveLength(1);
    expect(summary.failures[0].id).toBe('2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec jest eval/lib/metrics.spec.ts --rootDir . --testRegex 'eval/.*\\.spec\\.ts$' -v`  
（若现有 jest `rootDir: src` 拦不住，可在本步把该 spec 放到 `src/ai/eval-metrics.spec.ts` 并实现到 `src/ai/eval-metrics.ts`，再在 Task 3 从 `eval/lib` re-export；**优先**调整 jest 调用参数使 `eval/` 可测。）  
Expected: FAIL（module not found 或函数未定义）

- [ ] **Step 3: Write minimal implementation**

```ts
// eval/lib/metrics.ts
export type ChatIntent = 'chitchat' | 'profile' | 'kb' | 'web' | 'kb_then_web';

export type IntentCaseResult = {
  id: string;
  expectIntent: ChatIntent;
  predIntent: ChatIntent;
  expectAllowGraph: boolean;
  predAllowGraph: boolean;
  expectAllowWeb: boolean;
  predAllowWeb: boolean;
};

export function summarizeIntentResults(rows: IntentCaseResult[]) {
  const confusion: Record<string, Record<string, number>> = {};
  let intentOk = 0;
  let graphOk = 0;
  let webOk = 0;
  const failures: IntentCaseResult[] = [];

  for (const row of rows) {
    if (!confusion[row.expectIntent]) confusion[row.expectIntent] = {};
    confusion[row.expectIntent][row.predIntent] =
      (confusion[row.expectIntent][row.predIntent] ?? 0) + 1;
    if (row.expectIntent === row.predIntent) intentOk += 1;
    if (row.expectAllowGraph === row.predAllowGraph) graphOk += 1;
    if (row.expectAllowWeb === row.predAllowWeb) webOk += 1;
    if (
      row.expectIntent !== row.predIntent ||
      row.expectAllowGraph !== row.predAllowGraph ||
      row.expectAllowWeb !== row.predAllowWeb
    ) {
      failures.push(row);
    }
  }

  const total = rows.length || 1;
  return {
    total: rows.length,
    intentAccuracy: intentOk / total,
    allowGraphAccuracy: graphOk / total,
    allowWebAccuracy: webOk / total,
    confusion,
    failures,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: 同 Step 2  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add eval/lib/metrics.ts eval/lib/metrics.spec.ts
git commit -m "$(cat <<'EOF'
test(eval): 增加意图评测指标纯函数与单测

EOF
)"
```

---

### Task 2: Langfuse 开关与启动注册

**Files:**
- Create: `src/observability/langfuse.ts`
- Create: `src/observability/langfuse-handler.ts`
- Modify: `src/main.ts`
- Modify: `package.json`（deps）

**Interfaces:**
- Consumes: `process.env.LANGFUSE_*`
- Produces:
  - `function isLangfuseEnabled(): boolean`
  - `async function registerLangfuse(): Promise<void>`
  - `async function shutdownLangfuse(): Promise<void>`
  - `function createLangfuseHandler(opts: { userId?: string; sessionId?: string; tags?: string[] }): CallbackHandler | undefined`

- [ ] **Step 1: Install deps**

```bash
pnpm add @langfuse/langchain @langfuse/otel @langfuse/tracing @opentelemetry/sdk-node
```

（若官方 peer 要求额外 `@opentelemetry/sdk-trace-node`，一并安装；以安装时 peer 提示为准。）

- [ ] **Step 2: Implement register helpers**

```ts
// src/observability/langfuse.ts
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
```

```ts
// src/observability/langfuse-handler.ts
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
```

- [ ] **Step 3: Wire main.ts**

在 `bootstrap` 开头 `await registerLangfuse()`；`app.enableShutdownHooks()`；监听 `beforeApplicationShutdown` / `close` 时 `await shutdownLangfuse()`（Nest 可用 `app.close` 前手动调用，或：

```ts
async function bootstrap() {
  await registerLangfuse();
  const app = await NestFactory.create(AppModule);
  // ... existing setup ...
  const server = await app.listen(port);
  const shutdown = async () => {
    await app.close();
    await shutdownLangfuse();
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}
```

保持现有 Swagger / ValidationPipe 不变。

- [ ] **Step 4: Smoke without keys**

Run: `LANGFUSE_ENABLED=false pnpm run start:dev`（或短暂启动后 Ctrl+C）  
Expected: 日志出现「Langfuse 未启用」；对话链路正常。

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml src/observability src/main.ts
git commit -m "$(cat <<'EOF'
feat(observability): 可选注册 Langfuse Cloud OTel 导出

EOF
)"
```

---

### Task 3: 流式对话挂 Langfuse（不污染 SSE）

**Files:**
- Modify: `src/ai/ai-stream.service.ts`（`agent.stream` 与 classify 外围）
- Verify: `src/ai/chat-query-rewrite.service.ts` 的 `invokeIsolated` 保持空 LangChain callbacks

**Interfaces:**
- Consumes: `createLangfuseHandler`, 可选 `@langfuse/tracing` 的 `startActiveObservation` / `propagateAttributes`
- Produces: 每轮 stream 在 Cloud 可见；`data-intent` 等 UI 事件不变

- [ ] **Step 1: 在 stream 执行处创建 handler**

在已有 `persistSessionId` / `user` 可用之后：

```ts
const langfuseHandler = createLangfuseHandler({
  userId: String(user.userId),
  sessionId: String(sessionId),
  tags: ['stream', 'ai-chat'],
});
```

- [ ] **Step 2: 将 handler 传入 agent.stream**

把现有：

```ts
const langchainStream = await agent.stream(
  { messages: [...] },
  { streamMode: ['messages', 'tools'], recursionLimit: 40, signal },
);
```

改为（示意）：

```ts
const langchainStream = await agent.stream(
  { messages: [...] },
  {
    streamMode: ['messages', 'tools'],
    recursionLimit: 40,
    signal,
    callbacks: langfuseHandler ? [langfuseHandler] : undefined,
    metadata: {
      intent: plan.intent,
      allowGraph: plan.allowGraph,
      allowWeb: plan.allowWeb,
      query: plan.query.slice(0, 200),
    },
    tags: langfuseHandler ? [`intent:${plan.intent}`] : undefined,
  },
);
```

若官方推荐整轮包在 observation 内，用：

```ts
import { startActiveObservation, propagateAttributes } from '@langfuse/tracing';

// 在 classify → agent.stream 外层：
await propagateAttributes({ userId, sessionId }, async () => {
  await startActiveObservation('ai-chat-stream', async (span) => {
    span.update({ input: { question: question.slice(0, 500) } });
    // ... existing body; agent.stream with callbacks ...
    span.update({ output: { intent: plan.intent } });
  });
});
```

实现时选**一种**能出 trace 且不破坏 abort/落库的写法；优先少改控制流。

- [ ] **Step 3: 回归「无 JSON 泄漏」**

手动：`LANGFUSE_ENABLED=true`（配好 Cloud key）打一轮「你好」与一轮制度类问题。  
Expected:
- 前端/SSE 仍只有正常 UI parts，无 route schema 原始 JSON
- Langfuse UI 出现 trace（sessionId 可检索）

- [ ] **Step 4: Commit**

```bash
git add src/ai/ai-stream.service.ts
git commit -m "$(cat <<'EOF'
feat(ai): 流式对话接入 Langfuse CallbackHandler

EOF
)"
```

---

### Task 4: 金标数据集 + `eval:intent` runner

**Files:**
- Create: `eval/datasets/golden-v1.jsonl`（≥15 行）
- Create: `eval/runners/run-intent.ts`
- Create: `eval/reports/.gitignore`（内容：`*` 与 `!.gitignore` 与 `!sample-report.json`）
- Create: `eval/reports/sample-report.json`
- Modify: `package.json` scripts

**Interfaces:**
- Consumes: `ChatQueryRewriteService.classify`, `summarizeIntentResults`
- Produces: 终端摘要 + `eval/reports/<timestamp>.json`

- [ ] **Step 1: 写入样例金标（覆盖五类 intent）**

至少包含：`chitchat`×3、`profile`×2、`kb`×5、`web`×2、`kb_then_web`×3（可微调，总数 ≥15）。每行 JSONL 字段对齐规格 §4.1。

`expect.allowGraph` / `allowWeb` 必须与 `toPlan` 一致：
- chitchat/profile：graph=false, web=false
- kb：graph=true, web=false
- web：graph=false, web=true
- kb_then_web：graph=true, web=true

- [ ] **Step 2: 实现 runner**

```ts
// eval/runners/run-intent.ts（结构示意）
import 'reflect-metadata';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { HumanMessage } from '@langchain/core/messages';

import { AppModule } from '../../src/app.module';
import { ChatQueryRewriteService } from '../../src/ai/chat-query-rewrite.service';
import { summarizeIntentResults, type ChatIntent, type IntentCaseResult } from '../lib/metrics';

config({ path: resolve(process.cwd(), '.env') });

async function main() {
  const lines = readFileSync('eval/datasets/golden-v1.jsonl', 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as {
      id: string;
      question: string;
      expect: { intent: ChatIntent; allowGraph: boolean; allowWeb: boolean };
      skip?: boolean;
    });

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const rewrite = app.get(ChatQueryRewriteService);
  const rows: IntentCaseResult[] = [];

  for (const item of lines) {
    if (item.skip) continue;
    const plan = await rewrite.classify(item.question, [] as never);
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

  const summary = summarizeIntentResults(rows);
  mkdirSync('eval/reports', { recursive: true });
  const out = `eval/reports/${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), summary, rows }, null, 2));
  console.log(
    `\nintentAccuracy=${(summary.intentAccuracy * 100).toFixed(1)}% ` +
      `allowGraph=${(summary.allowGraphAccuracy * 100).toFixed(1)}% ` +
      `allowWeb=${(summary.allowWebAccuracy * 100).toFixed(1)}%`,
  );
  console.log(`report: ${out}`);
  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

（若 `AppModule` 启动过重/缺中间件导致失败：改为只手动 `new ChatOpenAI` + `new ChatQueryRewriteService(llm)`，与 `LlmService` 读同样 env；计划允许这一降级，但优先 ApplicationContext。）

- [ ] **Step 3: package.json script**

```json
"eval:intent": "TS_NODE_PROJECT=tsconfig.json node -r ts-node/register -r tsconfig-paths/register eval/runners/run-intent.ts"
```

- [ ] **Step 4: 跑通一次**

Run: `pnpm eval:intent`  
Expected: 每行 OK/FAIL；末尾打印三份准确率；`eval/reports/` 生成 json。

- [ ] **Step 5: 写入 sample-report.json（可基于一次真实跑分脱敏拷贝结构）并 commit**

```bash
git add eval package.json
git commit -m "$(cat <<'EOF'
feat(eval): 增加意图金标集与 eval:intent 跑分脚本

EOF
)"
```

---

### Task 5: 小白教程 + README / 课表入口

**Files:**
- Create: `docs/course/22-agent-eval-langfuse.html`
- Modify: `docs/course/index.html`（课表增加第 22 课）
- Modify: `README.md`（「能力概览」或新小节：Langfuse 键名 + `pnpm eval:intent`）

**Interfaces:**
- Consumes: 规格教程大纲 §8
- Produces: 浏览器可打开的完整讲义（概念 → Cloud → 造题 → 跑分 → 回归直觉）

- [ ] **Step 1: 写教程 HTML**

对齐课 20/21 的视觉骨架（header、callout、表格、代码块）。必须覆盖：
1. 分层评测 vs Langfuse 分工  
2. 准确率 / 混淆矩阵 / 金标白话解释  
3. Cloud 注册与 `.env` 键名（无真实值）  
4. 如何在 UI 用 sessionId 找 trace  
5. 标 10 题练习（指向 `golden-v1.jsonl` 格式）  
6. `pnpm eval:intent` 读报告  
7. 「故意改坏再跑」回归练习（只描述步骤，不要求真改生产 prompt）  
8. P1/P2 预告；附录改 `LANGFUSE_BASE_URL` 指自托管  

- [ ] **Step 2: index + README**

`index.html` 增加课 22 行；README 增加 5～10 行操作入口，链到该 HTML。

- [ ] **Step 3: 打开教程自检**

用浏览器打开 `docs/course/22-agent-eval-langfuse.html`，确认无死链、代码块可复制。

- [ ] **Step 4: Commit**

```bash
git add docs/course/22-agent-eval-langfuse.html docs/course/index.html README.md
git commit -m "$(cat <<'EOF'
docs(course): 增加 Agent 评测与 Langfuse 入门课

EOF
)"
```

---

### Task 6: P0 验收清单

- [ ] **Step 1: 默认关闭 Langfuse 启动与对话** — 正常  
- [ ] **Step 2: 开启 Langfuse + Cloud key** — UI 可见 trace；SSE 无 JSON 泄漏  
- [ ] **Step 3: `pnpm eval:intent`** — 有准确率数字与报告文件  
- [ ] **Step 4: `pnpm exec jest`（metrics 相关）** — PASS  
- [ ] **Step 5: 对照规格审阅清单全部勾选**  

若有缺口，开 follow-up commit 修完，勿留「半接入」。

---

## Spec coverage (self-review)

| 规格项 | 任务 |
|--------|------|
| L1 金标 + intent/开关准确率 + 混淆矩阵 | Task 1, 4 |
| Langfuse Cloud 开关 / env / OTel 注册 | Task 2 |
| 流式主路径 handler + 防 SSE 泄漏 | Task 3 |
| 目录 `eval/`、`eval:intent`、sample report | Task 4 |
| 教程 + course index + README | Task 5 |
| 非目标（自托管优先、L2/L3、Dataset） | 未排入 P0（符合规格） |
| `invokeIsolated` 约定 | Task 3 步骤与验收 |

## Placeholder scan

无 TBD/TODO 步骤；SDK API 若与安装版本微调，以官方 README 为准，但文件职责不变。
