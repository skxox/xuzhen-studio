# 叙帧工作台前端

React + TypeScript + Vite SPA，服务于叙帧小说到视频工作台。当前使用自建组件层，不依赖通用组件库，以保持制作工具的密度、层级和双主题一致性。

## 目录

```text
frontend/
├── src/
│   ├── app/                 # 应用壳、路由、全局 providers
│   ├── components/
│   │   ├── ui/              # Button、Badge、Dialog、Field、Panel 等基础组件
│   │   └── workspace/       # 镜头、阶段、预览、素材引用等业务组件
│   ├── lib/                 # API 客户端和共享类型
│   ├── pages/               # 总览、小说/创意、剧本、分镜、画布、素材、交付、服务设置
│   └── styles/              # Design tokens、通用样式、工作台与响应式布局
├── package.json
└── vite.config.ts
```

## 开发

在仓库根目录运行：

```bash
pnpm install
pnpm dev
```

前端地址为 `http://localhost:5173`。Vite 将 `/api` 代理至本地 FastAPI `http://127.0.0.1:8000`。后端不可用时，工作台仍可浏览演示内容；所有本地状态与尚未接入的能力会明确标记。

## 质量门

- `pnpm lint`：ESLint 10 + TypeScript ESLint。
- `pnpm typecheck`：严格 TypeScript 检查。
- `pnpm build`：先类型检查，再生成静态资源。

依赖使用精确版本，并通过根目录 `pnpm-lock.yaml` 固定完整依赖图。TypeScript 使用 6.0.2：虽然 TypeScript 7 已发布，但当前 typescript-eslint 官方支持范围为 `<6.1.0`，因此采用最新兼容稳定线。Node.js 最低版本为 20.19.0，以满足 Vite 8 与 ESLint 10 的运行要求。
