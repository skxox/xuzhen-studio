---
name: xuzhen-code-quality
description: Apply Xuzhen Studio's code quality, formatting, modularity, and review standards when implementing or reviewing repository code.
---

# Xuzhen Studio code quality

Use this skill for every feature, refactor, bug fix, and code review in this repository.

## Design and module boundaries

- Keep one clear responsibility per module. Pages compose workflow UI; reusable business components live under `frontend/src/components/workspace`; generic controls live under `frontend/src/components/ui`; API calls and shared types live under `frontend/src/lib`.
- Backend HTTP routers validate and translate requests. Put reusable business rules in service modules, persistence concerns in infrastructure, and shared domain policy in focused modules.
- Treat 400 lines as a review threshold for source files. At 400 lines, check whether the file contains multiple responsibilities and extract cohesive modules. A source file over 600 lines needs a written reason in the change and an explicit follow-up decomposition item; do not keep appending endpoints or unrelated UI to it.
- Prefer named types, small functions, explicit state transitions, and descriptive names. Avoid `any`, unexplained casts, broad exception handling, hidden side effects, duplicate business rules, and placeholder success behavior.
- Keep abstractions tied to repeated behavior or a stable domain concept. Do not build speculative frameworks or generic wrappers that obscure the workflow.

## Formatting and lint

- Frontend formatting is defined by `.prettierrc.json`. Run `pnpm format` for changed frontend source and `pnpm format:check` before committing.
- Python formatting is defined by `[tool.ruff.format]` in `backend/pyproject.toml`. After `uv sync --project backend`, run `uv run --project backend --no-sync ruff format backend/app` and `uv run --project backend --no-sync ruff format --check backend/app` from the repository root.
- Run `pnpm lint` and `pnpm typecheck` for frontend changes. Run `uv run --project backend ruff check app` for backend changes.
- Do not silence a lint rule globally to hide an issue. Use a narrow suppression with a reason only when the rule is genuinely inapplicable.
- Keep imports deterministic and remove unused imports. Do not leave dead branches, debug output, commented-out implementations, or formatting-only exceptions.

## Product and API correctness

- Every visible control must perform the stated action, explain why it is disabled, or state that the capability is not connected.
- Keep server-persisted state distinct from local drafts. Generated content remains a candidate until a persisted review decision accepts it.
- Preserve stage gates, idempotency, optimistic concurrency, explicit model data consent, and safe provider handling when touching generation flows.
- Update `src/lib/types.ts`, `src/lib/api.ts`, backend schemas, and API documentation together when an API contract changes.
- Never log provider secrets, raw credentials, or private user source content. Do not bypass provider URL validation or expose secret values to the browser.

## Review and commits

- Review the full diff for behavior, accessibility, stale-state handling, errors, and unintended formatting churn before committing.
- Do not claim an API flow works against a live provider unless it was actually exercised. State which checks ran and which were not run.
- Make one focused commit per completed feature. Use Angular Conventional Commit types and a concise Chinese subject, for example `feat: 拆分阶段路由模块` or `fix: 阻止重复提交生成任务`.
