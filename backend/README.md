# Xuzhen Studio API

The first backend increment for the novel-to-video workspace. See the repository-level [architecture](../ARCHITECTURE.md) for boundaries, deployment target, and milestones.

## Run locally

```bash
uv sync
cp .env.example .env
uv run uvicorn app.main:app --reload
```

Open `http://127.0.0.1:8000/docs` for the OpenAPI UI. Development persistence uses SQLite under `var/`; upload storage is also under `var/`. Adaptation, original-creation, and commercial projects receive different stage paths. Stage actions follow start → candidate generation → review/accept/reject, with upstream gate checks. The original-creation story-bible, long-outline, literary-character, per-chapter draft, and scoped continuity review steps can call the OpenAI-compatible text adapter. Chapter candidates are bound to a requested ordinal; acceptance creates a versioned chapter and updates the stage in the same transaction. Continuity reports are scoped to one through twenty consecutive chapters, must cite exact source text, and are version-checked before acceptance. High-severity open findings block acceptance; unresolved medium findings require a documented risk acknowledgement. Manuscript release appends an immutable version record containing chapter IDs, versions and hashes, the continuity report revision, rights snapshot, and previous release reference. `GET /projects/{id}/manuscript-releases` lists these records and identifies whether a record is still current. These calls currently run synchronously in the API request; a durable background worker and resumable long-running jobs are not implemented.

## Provider secrets and connectivity

The browser stores only a secret reference, never an API key. Configure references in the backend environment, for example:

```dotenv
XZ_PROVIDER_SECRETS='{"openai-main":"replace-with-a-server-side-secret"}'
```

The profile connection check currently supports the OpenAI-compatible text adapter. It calls the provider's `/models` endpoint and verifies the configured model ID. A successful check enables the profile. Story-bible, long-outline, literary-character, chapter-draft, and continuity-review requests call `/chat/completions`; the user must authorize data processing for each specific request. Request parameters and provider/model snapshots are saved with the job, and generated text is stored separately for review. Reviewers can edit candidates, retain prior revisions, preview earlier revisions, and accept or reject them. Chapter acceptance materializes an immutable chapter version. Editing a chapter invalidates its downstream continuity report and manuscript release snapshot. Image, video, and audio connectivity checks and generation adapters are not implemented yet. Until workspace authentication is available, the connection-check endpoint accepts loopback clients only.

Provider checks block non-public IP targets by default. For a self-hosted service on a private network, set `XZ_ALLOW_PRIVATE_PROVIDER_ENDPOINTS=true` only in a trusted local deployment. Loopback endpoints are allowed for local/self-hosted profiles.

The checked-in `uv.lock` pins the backend runtime and development tools. Use `uv sync --locked` to create or update the local environment.
