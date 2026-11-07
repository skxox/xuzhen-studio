# Xuzhen Studio API

The first backend increment for the novel-to-video workspace. See the repository-level [architecture](../ARCHITECTURE.md) for boundaries, deployment target, and milestones.

## Run locally

```bash
uv sync
cp .env.example .env
uv run uvicorn app.main:app --reload
```

Open `http://127.0.0.1:8000/docs` for the OpenAPI UI. Development persistence uses SQLite under `var/`; upload storage is also under `var/`. Adaptation and original-creation projects receive different stage paths. Only TXT and Markdown chapter uploads are enabled in this increment. Stage actions follow start → submit review → accept/waive/reject, with upstream gate checks. Model jobs are stored with immutable request/provider snapshots and remain blocked until a real adapter is registered; the API never reports fake model output.

When the package index is reachable, run `uv lock` once to generate `uv.lock`, then commit that lock file. CI and reproducible environments should use `uv sync --locked`.
