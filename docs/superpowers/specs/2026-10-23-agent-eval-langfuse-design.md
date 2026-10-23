# Agent 分层评测 + Langfuse Cloud 观测设计

日期：2026-10-23  
状态：待用户审阅  
范围：knowledge-hub-backend（Graph RAG / 意图路由 Agent）

## 1. 背景与目标

当前对话链路包含：意图路由（`ChatQueryRewriteService`）→ 可选图谱预取 / RAG / 联网 → Agent 流式作答。仓库内**尚未**接入 Langfuse；也没有离线金标评测。

本设计同时交付两件事，并写清分工，避免「接了 Langfuse = 有了准确率」的误解：

| 能力 | 回答的问题 | 依赖 |
|------|------------|------|
| **分层金标评测（路线 ①）** | 这类题对了百分之几？改 prompt 后有没有回退？ | 人工小金标 + 离线脚本 |
| **Langfuse Cloud 观测** | 这一轮调了哪些模型/工具、耗时与 token、失败卡在哪？ | Cloud 项目 + SDK 打点 |

**成功标准（P0）**

1. 小白能按教程造 ≥15 条金标，跑通意图准确率与工具开关一致率。
2. 打开 `LANGFUSE_ENABLED=true` 并配置 Cloud key 后，一次流式对话能在 Langfuse UI 看到对应 trace（含 session/user）。
3. 教程讲清概念、造题、跑分、读 Langfuse，风格对齐 `docs/course/`。

## 2. 非目标（第一期不做）

- 不上自托管 Langfuse（教程可附录；默认 Cloud）。
- 不以 LLM-as-judge 作为准确率唯一来源。
- 不在 P0 把 Langfuse Dataset / Score 与离线 eval 打通（列为 P2）。
- 不为文档解析、图谱抽取等非对话主路径强制打点（可后续扩展）。
- 不替代人工线上抽检。

## 3. 总体架构

```
                    ┌─────────────────────────────┐
  离线回归          │  eval/datasets/*.jsonl       │
  （算准确率）       │  eval/runners/run-intent.ts  │──► reports/*.json
                    └──────────────┬──────────────┘
                                   │ 调用 route 逻辑
                                   ▼
                    ┌─────────────────────────────┐
  在线对话          │  ai-stream / rewrite / agent │
  （看链路）         │  + Langfuse CallbackHandler  │──► Langfuse Cloud
                    └─────────────────────────────┘
```

- **Eval 脚本**：优先直接调用路由服务（或抽成可测的纯函数入口），**不**强制走完整 SSE，降低成本与抖动。
- **Langfuse**：进程启动注册 OTel `LangfuseSpanProcessor`；每个对话请求挂 `CallbackHandler`。

## 4. 金标数据模型

文件：`eval/datasets/golden-v1.jsonl`（一行一条 JSON）。

### 4.1 P0 必填

```json
{
  "id": "kb-001",
  "question": "差旅报销需要谁审批？",
  "expect": {
    "intent": "kb",
    "allowGraph": true,
    "allowWeb": false
  },
  "notes": "制度类；图谱可选开启"
}
```

`intent` 枚举与代码一致：`chitchat` | `profile` | `kb` | `web` | `kb_then_web`。

`allowGraph` / `allowWeb` 的期望值由标注人按业务约定填写；跑分时与 `ChatRoutePlan` 派生字段比对（与线上 `allowRetrieve` 等规则一致，脚本内复用同一派生逻辑，避免双份真理）。

### 4.2 P1+ 可选字段

- `must_retrieve_keywords: string[]` — 检索 top-k 拼接文本是否覆盖
- `answer_must_include: string[]` — 最终回答要点覆盖（字符串包含或规范化后匹配）
- `skip: boolean` — 暂不计入准确率

### 4.3 造题原则（教程展开）

- 五类 intent 尽量均衡；故意加易混题（闲聊 vs 制度、要不要联网）。
- 只标有把握的；不确定标 `skip` 或放进 `notes` 待议。
- 第一批 15 题样例入库；教程引导读者扩到 30～50。

## 5. 指标定义

| 层级 | 指标 | 定义 |
|------|------|------|
| L1 | Intent Accuracy | `pred.intent === expect.intent` 的比例 |
| L1 | allowGraph / allowWeb Accuracy | 各开关与期望一致的比例 |
| L1 | Confusion matrix | 真实 intent × 预测 intent 计数 |
| L2（P1） | Hit@k | top-k 命中文本是否覆盖 `must_retrieve_keywords` |
| L3（P2） | 要点覆盖率 | `answer_must_include` 命中比例；辅以人工抽检 |

报告：终端摘要 + `eval/reports/<ISO-time>.json`（`eval/reports/` 默认 gitignore，可提交一份 `sample-report.json`）。

## 6. Langfuse Cloud 接入

### 6.1 依赖与环境

- 包：`@langfuse/langchain`、`@langfuse/otel`、以及官方要求的 OpenTelemetry trace SDK。
- 环境变量（键名写入 README / `.env.example` 说明，**不**提交真实 key）：
  - `LANGFUSE_ENABLED` — `true` 才初始化与挂 handler
  - `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY`
  - `LANGFUSE_BASE_URL` — 默认 `https://cloud.langfuse.com`（按账号区域可改）

未开启或缺 key：应用行为与现网一致，零强制依赖。

### 6.2 初始化

- 在应用启动早期（如 `main.ts`）若启用：注册 `LangfuseSpanProcessor`。
- 关闭时不注册，避免空导出。

### 6.3 请求级打点

- 流式对话主路径（`AiStreamService`）创建 `CallbackHandler`，传入：
  - `userId`、`sessionId`
  - `tags`：如 `stream`、`intent:<name>`（意图识别完成后可更新/子 span）
  - metadata：standalone query、allowGraph/allowWeb 等（**脱敏**，禁止密码、完整邮件正文等）
- 同步 `ai-chat` 路径若仍使用，同等挂载或明确标注「仅 stream 观测」并在教程说明。

### 6.4 与 `runWithConfig` 空 callbacks 的关系

`ChatQueryRewriteService` 使用空 callbacks 隔离内部 LLM，防止 structured output 泄漏进 SSE。约定：

1. **外层**对话 / Agent invoke 携带 Langfuse handler。
2. **内部** route/grade：继续隔离 messages 流；观测上采用其一（实现时选更稳的一种并写进教程）：
   - **推荐**：外层用 Langfuse `startActiveObservation` / propagateAttributes 包住整轮，内部 invoke 仍空 LangChain callbacks，但落在同一 OTel 上下文；或
   - 内部单独 handler + tag `kh-internal`，且保证不写入 UI message 流。
3. 回归测试：开启 Langfuse 后，流式响应中不得出现改写用的原始 JSON。

### 6.5 隐私与安全

- 默认不把完整知识库 chunk 明文刷进 Langfuse（可截断或只记 id/标题）。
- 生产关闭时不发任何 span。
- Key 仅环境变量，不进仓库。

## 7. 目录与脚本

```
eval/
  datasets/golden-v1.jsonl
  runners/run-intent.ts
  reports/.gitignore
  reports/sample-report.json   # 可选样例
docs/course/<nn>-agent-eval-langfuse.html   # 小白教程
docs/superpowers/specs/2026-10-23-agent-eval-langfuse-design.md
```

`package.json`：

- `pnpm eval:intent` — 跑 L1 意图/开关评测

实现时优先 `ts-node` + 现有 `tsconfig-paths`，复用 `.env`。

## 8. 教程大纲

单页（或分节）HTML，对齐现有 course 风格：

1. 为什么要测 Agent（分层：路由 / 检索 / 答案）
2. 准确率、混淆矩阵、金标是什么
3. Langfuse 是什么；和金标差在哪
4. 注册 Cloud → 配 env → 打一轮对话 → UI 里找 trace
5. 按五类 intent 标 10～15 题
6. 跑 `eval:intent`，读报告
7. 故意改坏路由相关提示，再跑看掉点（建立回归直觉）
8. 如何加题；P1/P2 预告
9. 附录：自托管 BASE_URL 怎么改（不强制）

## 9. 分阶段交付

| 阶段 | 交付物 |
|------|--------|
| **P0** | 本设计审阅通过 → 实现计划 → Langfuse 开关接入（对话主路径）+ `golden-v1` 样例 + `eval:intent` + 教程 HTML + README 简短入口 |
| **P1** | 金标扩到 ~50 的指引；混淆矩阵更易读；Langfuse tags/metadata 补全 |
| **P2** | 检索 Hit@k；答案要点；可选 Langfuse Dataset 与离线分同步 |

## 10. 风险与缓解

| 风险 | 缓解 |
|------|------|
| Langfuse handler 与空 callbacks 冲突导致无 trace 或污染 SSE | P0 必做流式回归；隔离策略写死在实现与教程 |
| 金标过少导致准确率虚高/虚低 | 教程强调类别均衡与易混题；报告输出分 intent 准确率 |
| Cloud 区域 / BASE_URL 配错无数据 | 启动时 debug 日志提示 enabled + baseURL（不打 secret） |
| 费用与隐私 | 可开关；截断 metadata；eval 默认短跑 |

## 11. 已确认决策

- 评测主路线：**分层金标（①）**
- 标注现状：几乎无现成答案 → 教程教造小金标
- 观测：**Langfuse Cloud（A）**，非本机自托管优先
- 第一期准确率以 **L1 意图 + 工具开关** 为主

## 12. 审阅清单（给实现用）

- [ ] `LANGFUSE_ENABLED` 默认不影响现有行为
- [ ] 流式对话可见 Cloud trace，且无 JSON 泄漏
- [ ] `pnpm eval:intent` 对样例集产出可读准确率
- [ ] 教程可独立跟完（不假定读者懂评测 jargon）
