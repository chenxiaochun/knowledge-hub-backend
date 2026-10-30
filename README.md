# Knowledge Hub Backend

企业知识库后端：文档全生命周期、混合检索、Graph RAG 流式问答、知识图谱与语音能力。

基于 [NestJS](https://nestjs.com/) + TypeScript，配套前端 [`knowledge-hub-frontend`](https://github.com/chenxiaochun/knowledge-hub-frontend)。

## 能力概览

| 能力 | 说明 |
|------|------|
| 文档管理 | 多格式解析（PDF/Word/PPT/Excel 等）、审核发布、团队可见性 |
| 检索 | Elasticsearch 全文（IK）+ 向量混合检索（RRF），可选重排 |
| Graph RAG | 意图路由 → 知识库 / 图谱预取 / 联网；流式 SSE；图谱命中落库可回放 |
| 知识图谱 | Neo4j 实体关系；发布后经 MQ 异步构建；对话与全景图查询 |
| 会话记忆 | Redis 短记忆 + Mem0 长记忆 |
| 语音 | 腾讯云 ASR；TTS WebSocket 流式播放（可按会话打断） |
| 鉴权 | JWT + RBAC、邮箱激活与密码重置 |
| Agent 评测 / 观测 | L1 `pnpm eval:intent`；L2 检索 `pnpm eval:retrieval`；可选 Langfuse Cloud 看流式 trace（见下） |

## 系统架构

交互式架构图（Archify）：

- **[系统架构图 HTML](docs/architecture/knowledge-hub.html)** — 克隆后用浏览器打开，可切换主题并导出 PNG/SVG
- 源规格：[docs/architecture/candidate.json](docs/architecture/candidate.json)

| 层次 | 说明 |
|------|------|
| API | NestJS，全局前缀 `/api`；非生产环境 Swagger：`/docs` |
| 业务 | Auth / User / Document / Search / Graph / AI / Speech / Team |
| 流水线 | 文档发布 → RabbitMQ → ES 索引 + 向量 + Neo4j 图谱 |
| 存储与中间件 | PostgreSQL、MongoDB、Elasticsearch、Neo4j、Redis、RustFS（S3）、RabbitMQ |
| 外部 | LLM（OpenAI 兼容 / 百炼）、腾讯云 ASR/TTS、可选联网搜索 |

## 技术栈

- **框架**：NestJS 11、TypeORM、Mongoose
- **检索**：Elasticsearch 8（IK + dense_vector）
- **图谱**：Neo4j 5
- **AI**：LangChain Agent、AI SDK UI Message 流、混合 RAG + Graph RAG
- **消息**：RabbitMQ
- **语音**：腾讯云 SDK + WebSocket 中继
- **对象存储**：RustFS（S3 兼容）

## 快速开始

### 1. 启动基础设施

```bash
docker compose up -d
```

首次拉 ES 镜像会现场安装 IK 插件，可能较慢。

| 服务 | 端口 | 说明 |
|------|------|------|
| PostgreSQL | 5432 | 主业务库（pgvector 镜像） |
| pgAdmin | 8088 | `admin@admin.com` / `admin` |
| MongoDB | 27017 | 文档正文等 |
| mongo-express | 8081 | `me_admin` / `me_123456` |
| Elasticsearch | 9200 | 全文 + 向量 |
| Neo4j | 7474 / 7687 | Browser / Bolt，`neo4j` / `12345678` |
| Redis | 6379 | 短记忆、验证码等 |
| RedisInsight | 5540 | Redis GUI |
| RabbitMQ | 5672 / 15672 | AMQP / 管理台 `guest`/`guest` |
| RustFS | 9000 / 9001 | S3 API / Console |

### 2. 配置环境变量

在项目根目录自行准备 `.env`（**勿提交仓库**）。本地联调时，中间件账号/端口与上方 `docker compose` 表一致即可；具体键名以代码中的 `ConfigService` 读取为准，常见分组：

| 分组 | 用途 |
|------|------|
| `POSTGRES_*` / `MONGO_URI` | 业务库、文档正文 |
| `JWT_*` | 鉴权 |
| `ELASTICSEARCH_*` / `RABBITMQ_*` / `REDIS_*` / `NEO4J_*` / `RUSTFS_*` | 检索、消息、缓存、图谱、对象存储 |
| `OPENAI_*` / `DASHSCOPE_*` / `MODEL_NAME` / `EMBEDDING_*` | LLM、嵌入、图谱抽取 |
| `MEM0_*` / `BOCHA_*` / `TENCENT_CLOUD_*` / `MAIL_*` / `RAG_*` | 长记忆、联网、语音、邮件、检索调参（可选） |
| `LANGFUSE_ENABLED` / `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` / `LANGFUSE_BASE_URL` | 可选观测；默认关闭。`BASE_URL` 不设则为 `https://cloud.langfuse.com`（**勿提交真实 key**） |

### 3. 安装并启动

```bash
pnpm install
pnpm run start:dev
```

### 数据库 Migration（PostgreSQL / TypeORM）

默认 **关闭** `synchronize`（`TYPEORM_SYNCHRONIZE` 未设或非 `true`）。表结构走 migration：

| 命令 | 说明 |
|------|------|
| `pnpm migration:generate` | 按实体与当前库差异生成 migration |
| `pnpm migration:run` | 执行待执行 migration |
| `pnpm migration:revert` | 回滚最近一次 |
| `pnpm migration:show` | 查看执行状态 |

- **空库**：`pnpm migration:run` 即可（含 baseline：`src/database/migrations/*-BaselineSchema.ts`）。
- **已有库（此前靠 synchronize）**：勿直接对生产库跑 baseline（会 `CREATE TABLE` 冲突）。本地可暂时 `TYPEORM_SYNCHRONIZE=true`；或对齐 schema 后，把 baseline 记为已执行再只跑后续增量。
- 生产务必 `TYPEORM_SYNCHRONIZE=false`（或不设），只用 `migration:run`。

### 4. 访问

| 地址 | 说明 |
|------|------|
| http://localhost:3000/api | REST API |
| http://localhost:3000/api/health | 健康检查 |
| http://localhost:3000/docs | Swagger（非 production） |
| `ws://localhost:3000/api/speech/tts/ws?sessionId={id}` | TTS 流式音频（与 AI 会话 id 一致） |

## 主要 API

全局前缀 `/api`，鉴权接口需 `Authorization: Bearer <accessToken>`。

| 模块 | 路径示例 | 说明 |
|------|----------|------|
| Auth | `POST /auth/login`、`GET /auth/me` | 登录、当前用户 |
| Document | `POST /document/upload/parse`、`GET /document` | 上传解析、列表与审核 |
| Search | `GET /search`、`GET /search/semantic` | 全文 / 语义检索 |
| Graph | `GET /graph/search`、`/search/subgraph`、`/overview` | 实体搜索、子图、全景 |
| AI | `POST /ai/chat/stream` | 流式 Graph RAG（推荐） |
| AI | `POST /ai/chat` | 同步问答 |
| AI | `GET /ai/sessions/:id/messages` | 历史（含 `sources` / `images` / `graph`） |
| Speech | `POST /speech/asr`、`POST /speech/tts` | 识别 / 非流式合成 |

流式协议为 AI SDK UI Message（含 `data-intent`、`data-sources`、`data-graph`、工具过程卡等），前端按 parts 渲染。

## 目录结构

```
src/
├── auth/          # JWT、RBAC、邮箱激活与密码重置
├── user/          # 用户与权限
├── document/      # 上传、解析、审核发布、可见性
├── database/      # TypeORM DataSource、entities、migrations
├── search/        # 全文 / 语义检索入口
├── graph/         # 图谱构建、对话检索、全景图
├── ai/            # 意图路由、混合检索、流式 Agent、会话与记忆
├── speech/        # ASR、TTS WebSocket
├── pipeline/      # 分块、嵌入、ES/向量索引
├── mq/            # 文档 pipeline 消费
├── storage/       # RustFS / 本地存储
└── team/          # 团队树与成员
```

## 文档与课程

- [系统架构图](docs/architecture/knowledge-hub.html)
- [动手课程索引](docs/course/index.html) — 从脚手架到 RAG、图谱、流式 UI、TTS、Graph RAG 等分步讲义
- [课 22 · Agent 分层评测与 Langfuse](docs/course/22-agent-eval-langfuse.html) — 金标造题、`pnpm eval:intent`、Cloud trace

### Agent 评测与 Langfuse（速查）

| 项 | 说明 |
|----|------|
| 金标数据 | `eval/datasets/golden-v1.jsonl` |
| 跑分 | `pnpm eval:intent`（意图）；`pnpm eval:retrieval`（Hit@k，需 ES 有索引）→ `eval/reports/` |
| 开关 | `LANGFUSE_ENABLED=true` 且配置 Public/Secret Key 后，仅流式（`ai-stream` / UI Message）挂 `createLangfuseHandler`；同步 `POST /ai/chat` 尚未埋点 |
| 教程 | [docs/course/22-agent-eval-langfuse.html](docs/course/22-agent-eval-langfuse.html) |

## 常用命令

```bash
pnpm run build            # 编译
pnpm run start:dev        # 开发热重载
pnpm run start:prod       # 生产运行（需先 build）
pnpm run lint             # oxlint
pnpm run format           # oxfmt
pnpm run test             # 单元测试
pnpm run test:e2e         # E2E
pnpm eval:intent          # L1 意图 / 工具开关金标评测
pnpm eval:retrieval       # L2 检索 Hit@k（需 Elasticsearch）
pnpm migration:show       # 查看 migration 状态
pnpm migration:run        # 执行待执行 migration（空库）
```

## License

UNLICENSED（私有项目）
