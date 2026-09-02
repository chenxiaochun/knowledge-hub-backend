# Knowledge Hub 后端「从零手敲」课程设计

**日期**：2026-09-02  
**状态**：已确认设计，待写讲义  
**练习仓**：`/Users/chenxiaochun/Documents/MyProject/knowledge-hub-backend`  
**对照仓**：`/Users/chenxiaochun/Documents/MyProject/knowledge-hub-backend-origin`

## 背景与目标

读者已会 Nest 简单 CRUD，弱项在鉴权、多存储、MQ 与检索流水线。目标是：在练习仓按课从零（或按讲义核对现有代码）手敲实现，最终能力对齐对照仓完整主链路。

成功后读者能：

1. 在独立 Nest 项目中按模块复现本仓库核心逻辑；
2. 说清同步（上传入库）与异步（MQ → pipeline → 可搜）分界；
3. 只读某课讲义 + origin 对照路径即可动手，无需依赖聊天记录。

## 约束与约定（已确认）

| 项 | 选择 |
|---|---|
| 范围 | 完整能力，分期多课（方案 C） |
| 动手位置 | 另起/使用练习仓；origin 只当对照 |
| 依赖引入 | 按课渐进（先 Postgres，再 Mongo/存储，再 MQ，再 ES/向量/图） |
| 上课方式 | 先写完整讲义文档，自学；卡住再问 |
| 答案位置 | **正文内**直接给完整步骤与代码，不藏文末 |
| 课表组织 | 按本仓库目录拆课（方案 1） |
| Nest 基础 | 已会简单 CRUD，课 0 可略读 |

## 产出物位置

全部落在练习仓，**不写入 origin**：

| 路径 | 用途 |
|---|---|
| `docs/course/index.html` | 总大纲、依赖顺序、如何使用、与现有 `src/` 关系 |
| `docs/course/00-scaffold-config.html` … `08-team-mail-align.html` | 各课讲义（静态 HTML，浏览器直接打开） |
| 根目录 `docker-compose.yml` | 沿用；每课注明本课需 `up` 的服务 |

设计本文档路径：`docs/superpowers/specs/2026-09-02-handson-course-design.md`。

## 与练习仓现有代码的关系

练习仓已有部分 `document` / `mq` / `storage` 等实现。约定：

- 讲义按「从零写清」编写，不假设读者已完成 Auth/User。
- 不强制删除现有 `src/`；步骤写成「按讲义新建或核对/改到一致」。
- 读者可选新分支重做，或对照讲义改现有代码。
- 每课标明应对齐的 origin 路径。

## 九课课表

| 课 | 文件 | 学完能做 | 本课新依赖 | 对照 origin |
|---|---|---|---|---|
| 0 | `00-scaffold-config.html` | 入口、Config、健康检查、目录约定 | 无 | `main.ts`、`app.module.ts` |
| 1 | `01-user-crud.html` | User：Entity/DTO/Controller/Service/分页 | Postgres + TypeORM | `src/user/` |
| 2 | `02-auth-rbac.html` | JWT 登录、Guard、角色/权限装饰器（可简化 RBAC） | Redis（可选） | `src/auth/`、user 权限相关 |
| 3 | `03-document-sync.html` | 上传→解析→元数据 Postgres + 正文 Mongo + 文件存储 | Mongo + 对象存储（可先本地盘再换 S3） | `src/document/`、`storage/` |
| 4 | `04-review-mq.html` | 审核发布后发 MQ；消费者处理 | RabbitMQ | `src/mq/`、document 审核 |
| 5 | `05-pipeline-search-index.html` | ES 全文索引 + 简单搜索 API | Elasticsearch | `pipeline/search-index`、`search/` |
| 6 | `06-pipeline-rag.html` | 分块→Embedding→向量检索 | OpenAI（或 mock） | `chunking`、`embedding`、`vector-index` |
| 7 | `07-pipeline-kg.html` | 抽实体关系→Neo4j + 图查询 API | Neo4j | `extraction`、`graph-build`、`graph/` |
| 8 | `08-team-mail-align.html` | Team、邮件激活/重置等收尾对齐 | Mailer | `team/`、auth 邮件相关 |

**顺序**：串行；未完成 N 不建议跳到 N+2。课 0 若脚手架已熟可略读。课 6 正文同时给真实 Embedding 与 mock 两套。

## 每课固定骨架

1. 一句话目标 + 自测验收（curl/预期）
2. 概念（前端类比 + 为何这样拆）
3. 本课文件清单
4. 逐步实现（命令 → **完整文件内容写在正文步骤下**）
5. 与 origin 差异说明（练习版允许的简化）
6. 常见报错

## 范围

**做**

- 新增 `docs/course/` 大纲（`index.html`）+ 课 0–8 HTML 讲义。
- 每课自测示例与预期现象。
- 说明如何用现有 compose 只起本课服务。

**不做**

- 写讲义阶段不替读者改业务代码（除非另行要求带练改码）。
- 不深入 LLM/图谱算法原理。
- 不做测验站、文档站构建、CI 改造。
- 课程不写入 `knowledge-hub-backend-origin`。

## 成功标准

- 完成 0–2：能登录并管理用户/权限（简化 RBAC 可接受）。
- 完成 3–4：上传解析入库，发布后 MQ 可消费。
- 完成 5–7：全文搜、向量搜、图查询可演示。
- 完成 8：能对照 origin 说出练习版仍简化了什么。
- 任意一课可仅凭该课讲义 + origin 对照路径独立完成。

## 实现阶段备注

确认本 spec 后，用 writing-plans 拆分「撰写 `docs/course/*.html`」任务；按课文件逐个落地，优先 `index.html` + 课 1 样张，再 0/2，然后 3–8。
