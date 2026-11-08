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

当前文本/图片生成在 API 请求内同步调用 Provider。视频 Adapter 在请求中提交远端异步任务并持久化任务 ID，由前端轮询 refresh API；任务状态与媒体结果可在页面重开后恢复，但服务端没有常驻 Worker、webhook、独立 Attempt/outbox、SSE 断线续传和取消能力。

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
- `POST/GET /projects/{id}/service-profiles`、`POST /projects/{id}/service-profiles/{profile_id}/test`（支持 OpenAI-compatible 文本、图片、视频和语音档案；协议检查不代表厂商能力验证）
- `POST/GET /projects/{id}/jobs`、`PUT /projects/{id}/jobs/{job_id}/output`、`GET /projects/{id}/jobs/{job_id}/output/versions`（原创故事圣经、长篇大纲、文学角色圣经和逐章正文支持真实文本生成；正文任务绑定章节序号；请求需数据处理授权并要求阶段处于 running；候选可人工修订并保留旧版本）
- `GET /projects/{id}/manuscript-releases`、`GET /projects/{id}/manuscript-releases/{release_id}`（作者验收原创稿锁版时追加范围快照；记录章节版本/哈希、连续性报告修订、权利状态和前序发布；章节或权利变更后保留记录但不再标记为当前有效）
- `GET /delivery/runtime`、`GET/POST /projects/{id}/delivery-masters`、`GET /projects/{id}/delivery-masters/{master_id}/file`（检查 FFmpeg 编码器能力；仅已验收剪辑包且项目权利状态可交付时可生成版本化 MP4 母版候选；通过人工审片后才可验收）
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

项目双入口和不同阶段路径、章节导入/修订/恢复、逐章原创正文生成与候选审阅、范围连续性审校、ManuscriptRelease、分集映射/大纲/剧本/分镜不可变版本、逐镜关键帧及视频审阅、阶段门禁、Provider profile 与审计事件。文本使用 OpenAI 兼容 Chat；关键帧使用返回 `b64_json` 的 OpenAI 兼容 Images API；视频使用异步 `/v1/videos` submit、`/{id}` 状态查询和 `/{id}/content` 下载协议。服务端固定 DNS 解析目标，视频只接受 MP4 签名并保存媒体。连接检查只验证 `/models` 模型 ID，无法证明视频能力兼容。视频任务轮询由工作台触发，用户离开期间远端继续生成，但没有本地后台轮询。范围报告最多覆盖 20 个连续章节；全书长期记忆与 finding 单项修订跟踪仍需后续实现。

### M1：创作纵切片

补 SourceSpan 与导入拆分预览；扩展文本 Adapter 到原文分析、改编大纲和剧本结构化输出；实现来源证据、候选逐项接受/拒绝和结构化实体物化。首个验收项目：有权文本章节 → 可审阅故事卡/剧本候选 → 接受后可编辑。

### M2：镜头与图片

仍需引入正式 Postgres/Redis/Object Storage、worker/outbox/webhook、ComfyUI Adapter 和资产生命周期。现有图片 Adapter 只覆盖 OpenAI 兼容 Images API 的 base64 响应；关键帧与视频可逐镜生成、审阅、退回和重做，验收候选引用原分镜版本，不会反写或改动已锁定镜头。逐镜视频全部验收是后期阶段的服务端门禁。

### M3：异步视频（首版已接入）

当前支持 OpenAI-compatible `/v1/videos` 的 submit/poll/content 子集，按镜头创建候选，采用已验收关键帧，并逐项审阅与重做。后续仍需增加后台 Worker/webhook、取消、队列限流、成本快照和多厂商能力声明/适配；“兼容协议”不等于所有服务商实现一致。

### M4：成片交付

已接入逐句配音、剪辑交接包和 FFmpeg 最终母版合成首版：语音任务绑定当前已验收剧本和对白哈希，逐句生成、试听、验收或退回；后期需同时满足全部镜头视频和全部剧本对白配音已验收。交接包按锁定分镜顺序打包 MP4、按对白生成 SRT、附带独立音频片段和版本/素材哈希 manifest；每句对白只允许关联到一个镜头，以保持配音和字幕的一对一映射；交接包需要人工验收后才解锁交付；字幕可修订时间码，但台词文本必须与锁定剧本和已验收配音一致。交付阶段将视频归一化后拼接、按 SRT cue 起点混合 TTS、以 MP4 soft subtitle 轨写入中文字幕，并生成可预览/验收/下载的版本化母版。FFprobe 会检查 MP4 容器、H.264 画幅、AAC 音频、mov_text 字幕轨、流数据包、字幕条数及实测音画时长与计划时长偏差（≤ max(0.5 秒，1%)）；渲染前逐句测量对白时长并对照字幕窗口，最多加速 20%，超限时要求调整字幕时间或重生成配音；最终仍需人工检查台词同步和表演质量。母版生成和扫描在 API 请求中同步执行，不支持长片后台任务或局部片段重渲染。

## 当前不具备的生产条件

当前实现是后端开发基线，不是可部署生产系统：尚无认证/权限、Alembic、PostgreSQL/Redis/对象存储部署、后台 worker、密钥库、SSE、媒体安全扫描和分布式任务恢复。视频仅接入特定 OpenAI-compatible 异步 API 子集，语音仅接入 `/v1/audio/speech` 子集；已支持的协议不代表任意厂商可直接使用。图片只接受经过格式签名校验的 base64 PNG/JPEG/WebP 响应，视频只接受 MP4。FFmpeg 母版合成要求系统安装带 `libx264`、`aac`、`mov_text` 编码器的 FFmpeg 和配套 FFprobe；合成前后的请求时长差与轨道元数据会自动检查，但对白定位仍基于估算 cue，须经人工审片。长片合成和扫描仍在 API 请求中同步执行。
