# Backend module decomposition follow-up

## Generation jobs API

`backend/app/api/jobs.py` remains above the repository's 600-line review threshold. This change moved job listing, detail, output-version queries, and output serialization into focused modules without changing their API paths or response shapes. The job creation route still coordinates several modality-specific validation and provider workflows, so moving the full implementation in one pass would create a large behavior-change surface.

Follow-up decomposition:

- [ ] Extract text generation and candidate validation into a focused service.
- [ ] Extract image and reference generation handling into a focused service.
- [ ] Extract speech generation and dialogue resolution into a focused service.
- [x] Extract video polling and candidate persistence into a focused route module; the poll now rechecks stage state after provider calls and uses a conditional stage transition before promoting a video candidate.
- [ ] Extract video submission into a focused service.
- [ ] Keep `jobs.py` as a thin HTTP boundary that validates input, delegates, and maps domain errors.
- [ ] Preserve stage gates, idempotency checks, provider URL/secret handling, audit records, and transaction boundaries during each extraction.

Each extraction should be a separate commit with behavior checks for the affected route before removing the old branch.
