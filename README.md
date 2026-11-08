# 叙帧（Xuzhen）

AI 主导、人工审阅的小说到视频制作工作台产品原型与研发规格。

## 当前内容

- `outputs/index.html`：可交互原型，包含“已有小说改编”和“从创意原创”两种入口；覆盖原文/创意输入、AI 阶段候选审阅、角色与美术设定、分集剧本、分镜、关键帧、视频、声音/字幕/合成、审片交付和交付后修订。
- `outputs/PRODUCT_SPEC.md`：双入口工作流、各阶段门禁、交接/汇合契约、Provider API、任务状态、质量规则、按钮行为约定与端到端研发验收规格。
- `ARCHITECTURE.md`：MVP 技术架构、领域边界、安全策略和研发里程碑。
- `backend/`：FastAPI 后端代码，包含项目与阶段状态、服务档案、OpenAI 兼容文本/图片/异步视频生成、候选持久化和审计 API。原创入口支持逐章正文、范围连续性审校、剧本/分镜锁版、关键帧及逐镜视频候选审阅，并可生成带 SRT 和来源清单的剪辑交接包。
- `frontend/`：React + TypeScript 工作台，含深浅主题、制片总览、小说/创意、剧本、分镜、流程画布、素材、交付和 Provider 设置页面。

## 预览

用浏览器打开 `outputs/index.html`。当前是交互演示原型：任务队列中的“演示完成”会产生标明为模拟的候选，不会调用真实模型 API，也不会生成真实媒体文件。文本、图片、视频和语音 API 接入方式与安全边界见研发规格。

## 启动工作台

先在仓库根目录启动前端：

```bash
pnpm install
pnpm dev
```

Vite 地址为 `http://localhost:5173`。页面支持深浅主题切换，API 代理到本地 FastAPI 服务。前端工程与交互规则见 `frontend/README.md` 和 `frontend/AGENTS.md`。

## 启动后端

```bash
cd backend
uv sync
cp .env.example .env
uv run uvicorn app.main:app --reload
```

API 文档地址：`http://127.0.0.1:8000/docs`。开发数据库使用 SQLite。文本、图片 API 可生成并审阅候选；逐镜视频使用 OpenAI-compatible `/v1/videos` submit/poll/content 协议，引用已验收关键帧；对白配音使用 OpenAI-compatible `/v1/audio/speech`，按已锁定剧本逐句生成、试听并验收。所有镜头和对白均验收后才解锁后期。后期阶段可下载逐镜素材、对白 SRT、逐句配音音频和版本来源 manifest 组成的剪辑交接包；音频按对白独立交付，不含混音或最终母版，SRT 时间码按视频请求时长估算。视频/语音服务商必须实际实现相应协议子集；连接检查只验证 `/models` 中的模型 ID，不代表厂商已验证支持媒体生成。当前由前端轮询驱动任务刷新，还没有常驻后台 Worker/webhook。详见 `ARCHITECTURE.md`。

## 代码质量

仓库统一使用 Prettier 格式化前端、Ruff 格式化和检查 Python。安装依赖后，可在仓库根目录运行 `pnpm format` 自动格式化，`pnpm format:check` 检查格式，`pnpm lint` 检查前后端，`pnpm typecheck` 检查 TypeScript。提交代码前请阅读 [工程质量规范](docs/skills/code-quality/SKILL.md)；新增模块应职责单一，避免继续堆入超长页面或路由文件。

## 产品原则

AI 先提出内容和执行计划，用户逐阶段审阅、修改、接受或退回。已有原著的事实需保留出处；原创小说逐阶段形成并锁版；两条路径都须通过当前版本的分集剧本验收后，才能进入共用分镜、图像、视频、后期和交付流程。阶段、候选、任务、版本和修订按项目/分集隔离。
