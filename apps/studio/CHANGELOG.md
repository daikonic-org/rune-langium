# @rune-langium/studio

## Unreleased

- Add Compose with an opt-in Rune function canvas, function/primitives palette,
  in-node argument/output bindings, searchable variable tray, guarded source edits
  and shared Inspector/Prototype navigation.
- Group decision, collection and aggregation starters into a compact icon palette,
  matching saved-node labels/icons to the linked expression kind. Preserve loaded
  arguments when reselecting a callee and allow replacing zero-argument calls.
- Retain the requested recipe when Try in Prototype opens that perspective for
  the first time, resetting workspace state before consuming navigation.
- Refresh the raw JavaScript bundle ceiling to 19,340,000 bytes, retaining about
  5% headroom above the measured 18,445,354-byte candidate. A parent-Studio-source
  build with the same installed dependencies/additive Core and Codegen exports
  measured 18,385,283 bytes; initial Compose added 52,496 bytes (0.29%). Primitive
  polish and navigation/call-state fixes add another 7,575 bytes (0.04%). The previous
  6,593,600-byte ceiling used a May 2026 baseline. No dependency was added and the
  guard remains enabled.

## 0.3.0

### Minor Changes

- [#161](https://github.com/pradeepmouli/rune-langium/pull/161) [`18c2972`](https://github.com/pradeepmouli/rune-langium/commit/18c297222be46203261c0c277b0b07ee4354534d) Thanks [@pradeepmouli](https://github.com/pradeepmouli)! - Migrate studio compute-heavy workers to Cloudflare Pages Functions (019)

  **Added**

  - `POST /api/parse` Pages Function: server-side `parseWorkspace` that
    fetches curated CDM corpus archives from `daikonic.dev/curated/...`
    server-to-server, parses them with Langium, and returns a
    `hydrationState` for the browser to deserialize. Browser no longer
    fetches or unpacks corpus archives.
  - `POST /api/lsp/session`, `GET /api/lsp/health`,
    `GET /api/lsp/ws/[token]` Pages Functions: same-origin LSP server,
    migrated from `apps/lsp-worker/`. HMAC token mint, origin check, rate
    limit, Durable Object session backend.
  - `LspConnectionBadge` editor-footer component with
    "Language services unavailable" copy + Retry button.
  - Studio bundle-size regression gate
    (`pnpm --filter @rune-langium/studio run bundle-size`) with a default
    ceiling of 6,593,600 bytes (~5% above the post-LSP-retirement
    baseline).
  - Studio browser-memory regression gate
    (`test/e2e/memory-baseline.spec.ts`) that compares CDM-corpus heap
    usage against `STUDIO_MEMORY_BASELINE_BYTES` + 5% headroom.

  **Changed**

  - LSP server is network-only. The in-browser LSP worker
    (`apps/studio/src/workers/lsp-worker.ts`) and the MessagePort
    transport (`apps/studio/src/services/worker-transport.ts`) were
    deleted — ~850 lines removed.
  - `transport-provider.ts` simplified from 3 tiers
    (embedded / websocket / cf-worker) to 2 tiers
    (websocket / pages-function). `preferEmbedded` option removed.
  - `lspWsUrl` / `lspSessionUrl` config defaults are now same-origin
    (`/api/lsp/ws`, `/api/lsp/session`). The
    `VITE_LSP_WS_URL` / `VITE_LSP_SESSION_URL` overrides still apply for
    cross-origin staging environments.
  - Browser `parseWorkspaceFiles` now POSTs to `/api/parse` and
    deserializes the returned hydration documents client-side. The
    in-browser corpus fetch + parse path is removed.

  **Removed**

  - `apps/studio/src/workers/lsp-worker.ts`
  - `apps/studio/src/services/worker-transport.ts`
  - `apps/studio/test/services/worker-transport.test.ts`

  **Operational notes (future PRs)**

  - Deploy verification of the new endpoints in a staging Pages preview
    is required before this branch is merged to production
    (Task 1.8 — operational, manual).
  - `apps/lsp-worker/` will be retired in a follow-up PR after one
    release cycle to soften the transition for any direct consumers of
    the old URL.

## 0.2.0

### Minor Changes

- [#159](https://github.com/pradeepmouli/rune-langium/pull/159) [`b78916e`](https://github.com/pradeepmouli/rune-langium/commit/b78916e7fbab4da8d385ab29074fa8aae1c71f84) Thanks [@pradeepmouli](https://github.com/pradeepmouli)! - Migrate studio compute-heavy workers to Cloudflare Pages Functions (019)

  **Added**

  - `POST /api/parse` Pages Function: server-side `parseWorkspace` that
    fetches curated CDM corpus archives from `daikonic.dev/curated/...`
    server-to-server, parses them with Langium, and returns a
    `hydrationState` for the browser to deserialize. Browser no longer
    fetches or unpacks corpus archives.
  - `POST /api/lsp/session`, `GET /api/lsp/health`,
    `GET /api/lsp/ws/[token]` Pages Functions: same-origin LSP server,
    migrated from `apps/lsp-worker/`. HMAC token mint, origin check, rate
    limit, Durable Object session backend.
  - `LspConnectionBadge` editor-footer component with
    "Language services unavailable" copy + Retry button.
  - Studio bundle-size regression gate
    (`pnpm --filter @rune-langium/studio run bundle-size`) with a default
    ceiling of 6,593,600 bytes (~5% above the post-LSP-retirement
    baseline).
  - Studio browser-memory regression gate
    (`test/e2e/memory-baseline.spec.ts`) that compares CDM-corpus heap
    usage against `STUDIO_MEMORY_BASELINE_BYTES` + 5% headroom.

  **Changed**

  - LSP server is network-only. The in-browser LSP worker
    (`apps/studio/src/workers/lsp-worker.ts`) and the MessagePort
    transport (`apps/studio/src/services/worker-transport.ts`) were
    deleted — ~850 lines removed.
  - `transport-provider.ts` simplified from 3 tiers
    (embedded / websocket / cf-worker) to 2 tiers
    (websocket / pages-function). `preferEmbedded` option removed.
  - `lspWsUrl` / `lspSessionUrl` config defaults are now same-origin
    (`/api/lsp/ws`, `/api/lsp/session`). The
    `VITE_LSP_WS_URL` / `VITE_LSP_SESSION_URL` overrides still apply for
    cross-origin staging environments.
  - Browser `parseWorkspaceFiles` now POSTs to `/api/parse` and
    deserializes the returned hydration documents client-side. The
    in-browser corpus fetch + parse path is removed.

  **Removed**

  - `apps/studio/src/workers/lsp-worker.ts`
  - `apps/studio/src/services/worker-transport.ts`
  - `apps/studio/test/services/worker-transport.test.ts`

  **Operational notes (future PRs)**

  - Deploy verification of the new endpoints in a staging Pages preview
    is required before this branch is merged to production
    (Task 1.8 — operational, manual).
  - `apps/lsp-worker/` will be retired in a follow-up PR after one
    release cycle to soften the transition for any direct consumers of
    the old URL.

## 0.1.1

### Patch Changes

- Updated dependencies [[`e199ec7`](https://github.com/pradeepmouli/rune-langium/commit/e199ec7dcd462c8396dd74bcab3aefc585ac7e69)]:
  - @rune-langium/visual-editor@0.2.0
