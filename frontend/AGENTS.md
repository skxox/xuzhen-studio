# Frontend engineering and product UI rules

## Visual language

- Design this as a story production suite, not a generic SaaS admin dashboard. Use the visual vocabulary of an edit bay, script desk, and production dossier: restrained warm metal accents, confident typography, fine separators, compact timelines, cinematic preview frames, and clearly ranked editorial content.
- Dark and light themes are first-class. Every color must come from `src/styles/tokens.css`; both themes need readable contrast and complete component states.
- Avoid default AI product clichés: purple gradients, glowing blobs, gratuitous sparkle icons, oversized KPI cards, and repeated rounded cards with identical hierarchy. Use iconography only when it helps navigation or action recognition.
- Use CSS artwork for nonessential sample media. Label illustrative or local-only content as such; never present a placeholder as generated output.

## Component boundaries

- `src/components/ui/` contains generic controls and layout primitives. Keep these free of project workflow rules.
- `src/components/workspace/` contains reusable production-domain components such as shot cards, stage progression, previews, and reference assets.
- `src/pages/` composes business components into routes. Do not copy/paste the same workflow panel into multiple pages; extract it when it has a stable domain meaning.
- `src/app/` owns routing, application shell, global providers, and route-level state.
- `src/lib/` contains API clients and shared frontend types. Keep fetch logic out of page components.

## Interaction and accessibility

- Every visible control must perform its stated action, be disabled with a reason, or say that the API capability is not connected. Never simulate a successful provider run.
- Distinguish persisted server state from local draft state in labels and feedback. Model output is always a candidate until a review decision is persisted.
- Use semantic buttons/links, visible keyboard focus, associated field labels, status announcements for toasts, and reduced-motion support.
- Prefer focused dialogs with a clear cancel/confirm pair for destructive or irreversible changes. Forms must validate and show actionable errors.

## Code and dependency policy

- TypeScript stays strict; avoid `any`, implicit response shapes, and untyped API payloads.
- Pin the selected compatible toolchain exactly in `frontend/package.json` and commit `pnpm-lock.yaml` once registry access is available. Do not solve peer conflicts by disabling strict peer checks.
- Keep the dependency set small. Use the in-repo component system before adding another component library.
- Keep API routes, app state, page composition, and domain components separated. Add or change API payloads through `src/lib/types.ts` and `src/lib/api.ts`.
- Before merging, run `pnpm lint`, `pnpm typecheck`, and `pnpm build` from the repository root in a network-enabled development environment.
