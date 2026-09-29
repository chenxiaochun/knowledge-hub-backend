# Knowledge Hub Backend

企业知识库后端服务：文档管理、全文/向量检索、RAG 问答、知识图谱、流式 AI 对话与语音能力。

基于 [NestJS](https://nestjs.com/) + TypeScript，配套前端仓库 [`knowledge-hub-frontend`](https://github.com/chenxiaochun/knowledge-hub-frontend) 使用。

## 系统架构

交互式架构图（Archify 生成，含组件关系与代码引用）：

- **[Knowledge Hub 后端系统架构图](docs/architecture/knowledge-hub.html)** — 克隆仓库后用浏览器打开；支持深色/浅色主题与 PNG/SVG 导出
- 源规格：[docs/architecture/candidate.json](docs/architecture/candidate.json)

架构概览：

| 层次 | 说明 |
|------|------|
| API 入口 | NestJS，`/api` 全局前缀；开发环境 Swagger：`/docs` |
| 业务模块 | Auth / User / Document / Search / Graph / AI / Speech / Team |
| 索引流水线 | 文档发布后经 RabbitMQ 异步重建 ES 索引、向量与 Neo4j 图谱 |
| 数据与中间件 | PostgreSQL、MongoDB、Elasticsearch、Neo4j、Redis、RustFS（S3）、RabbitMQ |
| 外部服务 | LLM（OpenAI 兼容 / DashScope）、腾讯云 ASR/TTS |

## 技术栈

- **框架**：NestJS 11、TypeORM、Mongoose
- **检索**：Elasticsearch（IK 分词 + dense_vector）
- **图谱**：Neo4j
- **AI**：LangChain、AI SDK 流式输出、混合 RAG 检索
- **消息**：RabbitMQ（文档 pipeline）
- **语音**：腾讯云 ASR/TTS，TTS 经 WebSocket 中继（支持问答打断）
- **存储**：RustFS（S3 兼容对象存储）

## 快速开始

### 1. 启动基础设施

```bash
docker compose up -d
```

`docker-compose.yml` 包含：PostgreSQL、MongoDB、Elasticsearch、Neo4j、Redis、RabbitMQ、RustFS 及对应管理界面（pgAdmin、mongo-express、RedisInsight 等）。

### 2. 配置环境变量

在项目根目录准备 `.env`（可参考团队内文档或现有部署配置），至少需配置：

- 数据库：`POSTGRES_*`、`MONGO_URI`
- 检索：`ELASTICSEARCH_NODE`、`ELASTICSEARCH_ENABLED`
- 对象存储：`RUSTFS_*`
- 鉴权：`JWT_SECRET`
- AI（可选）：`OPENAI_API_KEY` / `DASHSCOPE_API_KEY`、`OPENAI_BASE_URL`
- 语音（可选）：`TENCENT_CLOUD_*`、`TTS_VOICE_TYPE`

### 3. 安装依赖并启动

```bash
pnpm install
pnpm run start:dev
```

默认端口 `3000`（可通过 `PORT` 覆盖）。

### 4. 访问

| 地址 | 说明 |
|------|------|
| http://localhost:3000/api | REST API |
| http://localhost:3000/docs | Swagger（非 production） |
| ws://localhost:3000/api/speech/tts/ws?sessionId={id} | TTS 流式音频（需与 AI 会话 id 一致） |

## 主要模块

```
src/
├── auth/          # JWT、RBAC、邮箱激活与密码重置
├── user/          # 用户与权限
├── document/      # 文档上传、解析、审核发布
├── search/        # 全文检索
├── graph/         # 知识图谱构建与查询
├── ai/            # RAG、流式对话、会话历史
├── speech/        # ASR 识别、TTS WebSocket 中继
├── pipeline/      # 分块、嵌入、ES/向量索引
├── mq/            # RabbitMQ 文档流水线
├── storage/       # RustFS / 本地存储
└── team/          # 团队与可见性
```

## 文档

- [系统架构图（HTML）](docs/architecture/knowledge-hub.html)
- [动手课程索引](docs/course/index.html) — 从脚手架到 RAG、图谱、流式 UI、TTS 等分步讲义

## 常用命令

```bash
pnpm run build          # 编译
pnpm run start:dev      # 开发热重载
pnpm run start:prod     # 生产运行（需先 build）
pnpm run lint           # oxlint
pnpm run format         # oxfmt
pnpm run test           # 单元测试
pnpm run test:e2e       # E2E 测试
```

## License

UNLICENSED（私有项目）
