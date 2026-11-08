# 叙帧技术架构（MVP 基线）

## 决策摘要

- **语言与框架：Python 3.11+、FastAPI、Pydantic 2、SQLAlchemy 2。** AI 编排、文档抽取、媒体处理及供应商 SDK 主要集中在 Python 生态；FastAPI 同时提供 OpenAPI 文档，便于原型前端和后续客户端共用契约。
- **开发存储：SQLite + 本地文件目录。** 当前阶段便于单人启动和验证领域接口；不承诺并发生产运行。
- **Python 环境：uv。** 项目依赖与虚拟环境统一由 `backend/pyproject.toml` 管理；FastAPI 应用代码直接位于 `backend/app/`，按 api/core/domain/infrastructure/services 分层。
- **目标部署：PostgreSQL + Redis 队列 + S3 兼容对象存储。** 视频/图像生成必须由独立 worker 执行，不能依赖 HTTP 请求或浏览器存活。部署拓扑在真正启用异步 provider 前升级。
- **服务端统一调用模型。** 浏览器不持有供应商密钥；Provider Adapter 负责能力声明、参数校验、提交、轮询/取消、结果归一化和错误分类。
- **结果先候选、后验收。** 模型生成不能直接覆盖已确认内容；每次任务冻结输入版本和 Provider 配置快照。

## 分层

```text
Web 工作台（现有原型，后续替换为 API 驱动前端）
                 │ REST / SSE
FastAPI：项目、创作分支、阶段门禁、候选审阅、服务配置、审计
                 │ domain services / outbox
PostgreSQL（领域数据、版本、任务、审计）   S3/MinIO（原文及媒体）
                 │ Redis queue
Workers：文本 / 图片 / 视频 / 音频 / FFmpeg 合成
                 │ Provider Adapter
远程 API、私有 API、本机 Agent（ComfyUI 等）
```

本机 Agent 采用设备配对和出站 WSS；云端 worker 不应直接探测用户局域网或 `localhost`。开发版目前没有 Agent 通道。

## 领域边界

1. **Project & Source**：项目创作模式、版权/权利声明、原文版本、章节、内容哈希和可回跳段落位置。
2. **Creative Production**：原创简报/故事圣经与改编大纲、角色/美术设定、剧本、场次、节拍、对白和分镜。每项候选保留来源引用与版本；`ManuscriptRelease` 追加保存被作者锁定的章节范围、章节哈希、连续性审校版本与权利状态快照。
3. **Workflow**：阶段状态机、依赖图、门禁决定、豁免理由、下游 stale 传播。
4. **Generation**：Run/Batch、Job/Attempt、幂等键、不可变输入快照、Provider 快照、Candidate 和 ReviewDecision。
5. **Assets & Delivery**：Asset/AssetVersion/Reference、时间线、字幕、导出及交付清单。
6. **Integration**：Provider profile、能力清单、SecretRef、适配器协议、Asset Gateway 和本机 Agent。

关键原则：领域实体按关系保存，不用单个 JSON 保存整个项目；JSON 只用于有版本的输入/参数快照和扩展字段。审计事件追加写入。媒体文件与领域记录分开保存，并由哈希关联。

## 任务生命周期

目标任务生命周期为 `draft → validating → queued → submitting → submitted → running → collecting → needs_review`。

当前已落地的文本纵切片在 API 请求内同步调用 Provider，任务状态为 `running → succeeded/failed/stale`，输出单独持久化为候选；幂等键可重放相同请求。后台 Worker、独立 Attempt/outbox、SSE 断线续传和取消尚未实现。视频/图像等长任务必须迁移到持久 Worker 后再开放。

## 数据与安全

- 原文和用户媒体使用对象存储；数据库只存元数据、版本、哈希与受控 URI。
- Provider 密钥不得进入浏览器持久化、日志、任务快照和导出包。当前通过后端 `XZ_PROVIDER_SECRETS` 环境配置解析 `secret_ref`；尚未接入独立密钥库/加密主密钥。OpenAI 兼容文本档案会检查 `/models`，原创故事圣经、大纲、角色圣经、逐章正文和范围连续性审校使用 `/chat/completions` 生成候选；逐章候选校验 JSON 结构与目标序号，连续性报告校验范围、问题字段及逐字证据。只有作者处理风险并接受后才会记录章节版本快照作为范围锁版。远程 API 默认阻止非公网 IP 目标。身份认证上线前，不允许远端客户端触发带密钥的连通检查。
- 上传按扩展名、大小、内容 MIME、哈希校验；生产版还要做恶意文件扫描、压缩炸弹限制与安全下载。
- 远程 URL 仅 HTTPS；本地 HTTP 仅允许 loopback。生产部署还需配置域名白名单和 DNS/IP 防 SSRF。
- 改编原文门禁要求记录项目权利状态；每次文本生成还要求显式数据处理授权字段。该授权目前是单用户本地工作区内的请求确认，不是法律权利验证，也不替代后续的身份认证与多用户权限。

## 已落地的 API 范围

- `GET /health`
- `POST/GET /projects`、`GET /projects/{id}`
- `GET /projects/{id}/stages`、`POST /projects/{id}/stages/{stage}/start`、`POST /projects/{id}/stages/{stage}/submit-review`、`POST /projects/{id}/stages/{stage}/decision`
- `POST/GET /projects/{id}/chapters`、`POST /projects/{id}/chapters/upload`、`PUT /projects/{id}/chapters/{chapter_id}`、`GET /projects/{id}/chapters/{chapter_id}/versions`、`POST /projects/{id}/chapters/{chapter_id}/restore`（TXT/MD 导入、章节修订与恢复）
- `PATCH /projects/{id}/rights`（原作权利状态）
- `GET/PUT /projects/{id}/creative-brief`（仅原创项目；保存简报修订与权利确认声明，并进入作者确认门禁）
- `GET/POST /projects/{id}/character-references`（角色锚点、服装规则与固定四视图清单；仅保存草稿，不生成图片）
- `POST/GET /projects/{id}/service-profiles`、`POST /projects/{id}/service-profiles/{profile_id}/test`（目前仅 OpenAI 兼容文本服务）
- `POST/GET /projects/{id}/jobs`、`PUT /projects/{id}/jobs/{job_id}/output`、`GET /projects/{id}/jobs/{job_id}/output/versions`（原创故事圣经、长篇大纲、文学角色圣经和逐章正文支持真实文本生成；正文任务绑定章节序号；请求需数据处理授权并要求阶段处于 running；候选可人工修订并保留旧版本）
- `GET /projects/{id}/manuscript-releases`、`GET /projects/{id}/manuscript-releases/{release_id}`（作者验收原创稿锁版时追加范围快照；记录章节版本/哈希、连续性报告修订、权利状态和前序发布；章节或权利变更后保留记录但不再标记为当前有效）
- Swagger UI：`/docs`

后端按 `api/`（HTTP 应用与路由）、`core/`（配置）、`domain/`（实体）、`infrastructure/`（数据库）和 `services/`（用例）分层。OpenAI 兼容文本调用位于 `services/openai_compatible.py`；其他未注册 Adapter fail closed。Provider 调用转为长任务后应迁入独立 `workers/`。

## 开发启动

```bash
cd backend
uv sync
cp .env.example .env
uv run uvicorn app.main:app --reload
```

首次启动会在 `backend/var/` 下创建 SQLite 数据库 `xuzhen.db` 和媒体目录 `assets/`。使用 `XZ_DATABASE_URL` 可切换到 PostgreSQL SQLAlchemy URL。表结构目前由开发启动时创建；在多人协作或部署前要加 Alembic 迁移，不能依赖 `create_all` 升级现有生产库。

## 研发里程碑与退出条件

### M0：领域 API 基础（当前）

项目双入口和不同阶段路径、章节导入/修订/恢复、逐章原创正文生成与候选审阅、范围连续性审校、独立且追加写入的 ManuscriptRelease 版本、阶段启动/送审/决定状态机、上游门禁、Provider profile、原创故事圣经/长篇大纲/文学角色圣经文本候选、任务快照、输出持久化和审计事件。范围报告最多覆盖 20 个连续章节；全书长期记忆与 finding 单项修订跟踪仍需后续实现。退出：API 对外契约固定、结构化候选与 stage version 迁移设计完成。

### M1：创作纵切片

补 SourceSpan 与导入拆分预览；扩展文本 Adapter 到原文分析、改编大纲和剧本结构化输出；实现来源证据、候选逐项接受/拒绝和结构化实体物化。首个验收项目：有权文本章节 → 可审阅故事卡/剧本候选 → 接受后可编辑。

### M2：镜头与图片

引入正式 Postgres/Redis/Object Storage、worker/outbox、候选与素材引用、ComfyUI 和一个真实图片 API Adapter。镜头字段及连续性 Finding 逐项闭环；关键帧审阅能回写镜头版本。

### M3：异步视频

实现视频供应商 Adapter、submit/poll/webhook、取消/重试/限流/成本快照、Asset Gateway。按镜头出视频候选，逐项审阅并只对失败镜头重跑。

### M4：成片交付

音频与字幕 Adapter、FFmpeg 时间线合成、局部返工影响预览、质量检查、MP4/SRT/manifest 导出和全链路可追溯。

## 当前不具备的生产条件

当前实现是后端开发基线，不是可部署生产系统：尚无认证/权限、Alembic、PostgreSQL/Redis/对象存储部署、后台 worker、密钥库、SSE、实际模型 Provider、图片/视频生成、媒体安全扫描和完整候选物化。不能用模拟任务宣称端到端已生成视频。每完成一项应更新规格差异表与 API schema。
