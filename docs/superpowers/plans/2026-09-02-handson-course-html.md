# 从零手敲课程讲义（HTML）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在练习仓 `docs/course/` 落地可浏览器打开的 HTML 讲义（课 0–8 + 目录页），正文含完整步骤与代码。

**Architecture:** 每课一个独立 HTML（自带样式，可单独打开）；`index.html` 作总大纲与导航；`authoring.html` 记录编写思路以免后续漂移。对照仓 origin 只引用路径，不写入 origin。练习版允许相对 origin 简化（课内「差异说明」写清）。写课体例以 `authoring.html` + 课 1 样张为准。

**Tech Stack:** 静态 HTML/CSS/少量 JS（目录高亮、代码复制）；课程内容对齐 NestJS 11 + TypeORM + Postgres 等按课渐进依赖。

## Global Constraints

- 输出格式：全部为 `.html`（不是 Markdown）
- 路径：`/Users/chenxiaochun/Documents/MyProject/knowledge-hub-backend/docs/course/`
- 答案位置：完整代码写在正文步骤下，不藏文末
- 不强制删除练习仓现有 `src/`；步骤写「新建或核对到一致」
- 不写入 `knowledge-hub-backend-origin`
- 每课骨架：目标+验收 → 概念 → 文件清单 → 逐步实现 → 与 origin 差异 → 常见报错

---

### Task 1: 更新设计约定为 HTML + 课程目录页

**Files:**
- Modify: `docs/superpowers/specs/2026-09-02-handson-course-design.md`（产出物改为 `.html`）
- Create: `docs/course/index.html`

**Interfaces:**
- Produces: 九课文件名列表与链接约定（`00-….html` … `08-….html`）

- [ ] **Step 1:** 改 design：所有 `docs/course/*.md` 改为 `*.html`；README 改为 `index.html`
- [ ] **Step 2:** 写 `index.html`：九课表、依赖顺序、如何使用、与现有 src 关系；课 1 可点，其余可标「待写」
- [ ] **Step 3:** Commit

```bash
git add docs/superpowers/specs/2026-09-02-handson-course-design.md docs/course/index.html
git commit -m "docs(course): 约定 HTML 讲义并添加课程目录页"
```

---

### Task 2: 课 1 样张 `01-user-crud.html`（本轮先交付预览）

**Files:**
- Create: `docs/course/01-user-crud.html`

**Interfaces:**
- Consumes: 练习仓已有 `ValidationPipe`、`snowflake-id`、`common` bigint transformer；docker postgres
- Produces: 读者可按讲义实现 User CRUD（无 RBAC，RBAC 留课 2）

- [ ] **Step 1:** 写完整 HTML 讲义（练习版简化 User：创建/分页/详情/更新/软删；密码 bcrypt；TypeORM+Config）
- [ ] **Step 2:** 正文含 curl 验收与 origin 对照路径
- [ ] **Step 3:** Commit

```bash
git add docs/course/01-user-crud.html
git commit -m "docs(course): 添加第 1 课 User CRUD HTML 讲义"
```

---

### Task 3: 课 0 `00-scaffold-config.html`

**Files:**
- Create: `docs/course/00-scaffold-config.html`
- Modify: `docs/course/index.html`（链到课 0）

- [ ] 写课 0：入口、Config、目录约定、健康检查
- [ ] Commit: `docs(course): 添加第 0 课脚手架讲义`

---

### Task 4: 课 2 `02-auth-rbac.html`

**Files:**
- Create: `docs/course/02-auth-rbac.html`
- Modify: `docs/course/index.html`

- [ ] JWT + Guard + 简化 RBAC；可选 Redis
- [ ] Commit

---

### Task 5: 课 3–4（文档同步 + 审核 MQ）

**Files:**
- Create: `docs/course/03-document-sync.html`, `docs/course/04-review-mq.html`
- Modify: `docs/course/index.html`

- [ ] 课 3：上传解析 Postgres+Mongo+存储
- [ ] 课 4：审核发布 + RabbitMQ
- [ ] Commit（可按课各一次）

---

### Task 6: 课 5–7（ES / RAG / KG）

**Files:**
- Create: `05-pipeline-search-index.html`, `06-pipeline-rag.html`, `07-pipeline-kg.html`
- Modify: `docs/course/index.html`

- [ ] 按课引入 ES、Embedding(含 mock)、Neo4j
- [ ] Commit

---

### Task 7: 课 8 + 收尾

**Files:**
- Create: `docs/course/08-team-mail-align.html`
- Modify: `docs/course/index.html`（全部可点、去掉「待写」）

- [ ] Team + Mailer 收尾对齐说明
- [ ] Commit
