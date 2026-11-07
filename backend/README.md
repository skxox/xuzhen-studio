# Xuzhen Studio API

The first backend increment for the novel-to-video workspace. See the repository-level [architecture](../ARCHITECTURE.md) for boundaries, deployment target, and milestones.

## Run locally

```bash
uv sync
cp .env.example .env
uv run uvicorn app.main:app --reload
```

Open `http://127.0.0.1:8000/docs` for the OpenAPI UI. Development persistence uses SQLite under `var/`; upload storage is also under `var/`. Adaptation, original-creation, and commercial projects receive different stage paths. Stage actions follow start → submit review → accept/waive/reject, with upstream gate checks. Model jobs are stored with immutable request/provider snapshots and remain blocked until a generation adapter is registered; the API never reports fake model output.

## Provider secrets and connectivity

The browser stores only a secret reference, never an API key. Configure references in the backend environment, for example:

```dotenv
XZ_PROVIDER_SECRETS='{"openai-main":"replace-with-a-server-side-secret"}'
```

The profile connection check currently supports the OpenAI-compatible text adapter. It calls the provider's `/models` endpoint and verifies the configured model ID. A successful check enables the profile for routing, but generation remains blocked until a generation worker/adapter is installed. Image, video, and audio connectivity checks are not implemented yet. Until workspace authentication is available, this endpoint accepts loopback clients only.

Provider checks block non-public IP targets by default. For a self-hosted service on a private network, set `XZ_ALLOW_PRIVATE_PROVIDER_ENDPOINTS=true` only in a trusted local deployment. Loopback endpoints are allowed for local/self-hosted profiles.

When the package index is reachable, run `uv lock` once to generate `uv.lock`, then commit that lock file. CI and reproducible environments should use `uv sync --locked`.
