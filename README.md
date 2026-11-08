# 叙帧（Xuzhen）

AI 主导、人工审阅的小说到视频制作工作台产品原型与研发规格。

## 当前内容

- `outputs/index.html`：可交互原型，包含“已有小说改编”和“从创意原创”两种入口；覆盖原文/创意输入、AI 阶段候选审阅、角色与美术设定、分集剧本、分镜、关键帧、视频、声音/字幕/合成、审片交付和交付后修订。
- `outputs/PRODUCT_SPEC.md`：双入口工作流、各阶段门禁、交接/汇合契约、Provider API、任务状态、质量规则、按钮行为约定与端到端研发验收规格。
- `ARCHITECTURE.md`：MVP 技术架构、领域边界、安全策略和研发里程碑。
- `backend/`：FastAPI 后端代码，包含项目与阶段状态、服务档案、文本 Provider 连通检查、OpenAI 兼容文本生成、候选持久化和审计 API。当前原创入口的“故事圣经”和“长篇大纲”可真实生成；图片/视频/语音 Adapter 与后台 Worker 尚未接入。
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

API 文档地址：`http://127.0.0.1:8000/docs`。开发数据库使用 SQLite；已支持 OpenAI 兼容文本服务连通检查，并可从原创简报依次生成故事圣经与长篇大纲候选。图片、视频和语音仍需对应 Adapter；后台 Worker 与长任务恢复机制尚未完成，见 `ARCHITECTURE.md`。

## 代码质量

仓库统一使用 Prettier 格式化前端、Ruff 格式化和检查 Python。安装依赖后，可在仓库根目录运行 `pnpm format` 自动格式化，`pnpm format:check` 检查格式，`pnpm lint` 检查前后端，`pnpm typecheck` 检查 TypeScript。提交代码前请阅读 [工程质量规范](docs/skills/code-quality/SKILL.md)；新增模块应职责单一，避免继续堆入超长页面或路由文件。

## 产品原则

AI 先提出内容和执行计划，用户逐阶段审阅、修改、接受或退回。已有原著的事实需保留出处；原创小说逐阶段形成并锁版；两条路径都须通过当前版本的分集剧本验收后，才能进入共用分镜、图像、视频、后期和交付流程。阶段、候选、任务、版本和修订按项目/分集隔离。
