# @rune-langium/studio

Web-based visual editor for Rune DSL models with integrated LSP support.

## Features

- **ReactFlow Graph** — Interactive DAG visualization of Rune DSL types, enums, and choice types
- **CodeMirror 6 Editor** — Full-featured source editor with Rune DSL syntax highlighting
- **LSP Integration** — Real-time diagnostics, hover information, code completion, and go-to-definition
- **Dual Transport** — WebSocket to a local `rune-lsp-server` for development, or to the production `rune-lsp-worker` (Cloudflare Worker + Durable Object hosting langium server-side)
- **Diagnostics Bridge** — LSP errors appear as inline editor underlines _and_ as badges on graph nodes
- **Multi-file Support** — Tab bar for switching between `.rosetta` files with per-file LSP document lifecycle
- **Search** — Click Search or press ⌘K / Ctrl+K to open declarations, workspace files, or a Studio destination. Use arrow keys and Enter to choose a result; Escape closes search.
- **Type explorer** — Click a declaration name or its arrow to navigate. Drag its row into a type field to change an association. Export checkboxes control inclusion independently of navigation; the count shows available declarations.
- **Compact namespaces** — Shared prefixes form branches: `com.rosetta.math` and `com.rosetta.model` appear beneath `com.rosetta`. Unbranched paths use a single dotted label; namespaces with their own declarations remain expandable boundaries. Labels retain the full path and truncate from the beginning when narrow, with the complete path available on hover.
- **Companion panes** — Graph and Structure choose the main view; the wider gap in the pane selector separates Source and Inspector, which toggle alongside it. Structure fits again when its pane resizes.
- **Export workspace** — Selection has room to browse before generation. Generated output starts compact and expands for the first artifact unless its layout was restored or manually rearranged.
- **Workspaces** — IDE-style dockable panels with persistent layouts. Three workspace kinds:
  - *Browser-only* — files live in OPFS only; no roundtrips
  - *Folder-backed* — files mirrored to a local directory via the File System Access API
  - *GitHub-backed* — full clone/push/pull against any GitHub repo via Device-Flow auth (no tokens leave the browser)
- **Curated model mirror** — CDM / FpML / rune-dsl archives served from R2 via `www.daikonic.dev/curated/*` (refreshed nightly), so first-load is fast and offline-friendly
- **Anonymous telemetry (opt-out)** — closed-schema events power the SC-009 success-rate gate. No PII, no IPs, no file paths. Toggle in Settings.

## Architecture

```text
App (LSP client lifecycle)
├── ConnectionStatus (pill indicator)
├── EditorPage
│   ├── SourceEditor (CodeMirror 6 + LSP)
│   │   ├── Tab bar (file tabs)
│   │   └── EditorView per tab
│   ├── RuneTypeGraph (visual editor)
│   │   └── Node error badges (from diagnostics-store)
│   └── DiagnosticsPanel (error/warning list)
```

### Transport

The studio connects to a langium server over WebSocket. Two hosts:

| Mode | Host | When |
|---|---|---|
| **Dev** | `ws://localhost:3001` (`rune-lsp-server` running locally) | `pnpm dev` workflows |
| **Prod** | `wss://www.daikonic.dev/rune-studio/api/lsp/ws/<sessionToken>` (`rune-lsp-worker` Cloudflare Worker + `RuneLspSession` Durable Object) | deployed Studio |

The host URL is sourced from `config.lspWsUrl`, which reads
`VITE_LSP_WS_URL` (overridable per build per FR-021). On a connection
failure or 5xx during session-token mint, the studio drops to a
"language services unavailable" status — read-only editing continues,
no localhost host:port leaks into production copy (FR-014, SC-006).

The earlier "embedded SharedWorker fallback" path is **not shipped** —
running langium in a browser worker would require shimming
`node:events` / `node:crypto`, which `nodejs_compat` already resolves
in the CF isolate. See `specs/014-studio-prod-ready/research.md` R1
for the architecture decision.

### Data Flow

```text
User types in editor
    → CodeMirror (textDocument/didChange) → @codemirror/lsp-client
    → Transport (WS or Worker) → rune-lsp-server (Langium)
    → Langium validates → textDocument/publishDiagnostics
    → @codemirror/lsp-client → editor underlines
    → diagnostics-bridge → diagnostics-store → graph node badges
```

## Development

```bash
# From monorepo root
pnpm install

# Start dev server
pnpm --filter @rune-langium/studio dev

# Run tests (94 tests across 13 files)
pnpm --filter @rune-langium/studio test

# Type-check
pnpm --filter @rune-langium/studio run type-check
```

For local visual comparisons, add `?design-preview` to the dev-server URL. The
floating **Design preferences** control compares all five polish priorities:
navigation text, calmer chrome, collapsing auxiliary panels, a responsive top bar,
and consistent control details, plus pane-pill spacing. Explore's Type explorer
and shared Form/Code preview use explicit header chevrons and vertical labels when hidden; their drafts and expanded widths remain
in memory. Other auxiliary panels start pinned and can be unpinned. Disabling
that option restores the original arrangement without replacing existing panel
instances. Comparison layouts are never saved to the workspace. Changes last
only for that page session; reset or reload restores the current design. The
controls are excluded from production. This uses constrained grid rails for
Explore's side panels and free native edge-group collapse/expand elsewhere;
Dockview's slide-out
overlay auto-hide requires its separate enterprise module.

Explore's location path is part of the normal interface, including production.
It shows the selected declaration after its namespace, aligns with the center
stack, and truncates from the beginning when space is tight.

### Prototype workflows

Prototype presents equal input nodes, an optional function, and a separate output.
Parameter and return-variable names lead the headers; declared types are secondary.
Select a compatible function in the compact chooser, or drag its name onto the
function node. Object parameters have their own nodes; primitive parameters stay
inline. **Execute** runs the function explicitly. Without a function, the input
is the output. Input edits invalidate prior results; scalar and object results
remain separate from the stored source objects. **Save as example…** saves an
object result, including a passthrough input, through the existing creation dialog.

Each input has a clickable validation status. The function status combines input
requirements and applicable preconditions, independently of execution. Pending
and unavailable checks stay distinct from passing checks. A diagnostic can focus
its field. Validation never runs function assignments or postconditions.

**Add** creates an object in the main header. Node menus contain **Edit layout**,
**Import input…**, and compatible stored-object bindings. Grid **Import examples…**
accepts one JSON object or an array for the chosen type; imported objects stay in
the grid until explicitly bound. Workflow edits use detached copies and do not
overwrite their stored sources.

Workflow uses smooth connectors and constrained node positions. **New workflow**
starts without predetermined input types. **Object builder** provides a separate
type chooser and object form for creation, import and export, without a function
panel. Each surface retains its own draft. Divider widths and view choice are saved
per workspace. Narrow panes stack the nodes in reading order. A visited Prototype
stays mounted while using other perspectives in the same workspace; workspace
changes dispose its active sessions. Workflows and execution results are session
state; reloading restores stored objects and presentation preferences. See
[validation, clearing inputs and starter origin](../../docs/prototype-workflows.md)
for recovery behavior and the distinction between a starter copy and Git sync.

### Form layouts and formats

Use **Edit layout** in Form Preview or Prototype to drag fields into reading
order. Handles also support arrow keys, Home and End. Choose one to three
columns and a width for each field; narrow panels automatically use one column.
**Reset layout** restores the current object's source order and default widths.

**Format** on numeric fields configures decimal or currency display, currency
code, decimal places and thousands grouping. Formats follow the declared Rune
type, so an `Amount` alias can be formatted without changing unrelated numbers.
Inputs show the original value when focused; payloads and validation retain that
value even when the display rounds it.

Object layouts and type formats are reused in nested objects and item detail
views, and shared between Preview and Prototype. They are saved per workspace in
this browser's local database. They do not sync to a signed-in identity or change
Rune source. Save/load failures offer **Retry** without discarding local edits.

### With external LSP server

For full LSP features via WebSocket:

```bash
# Terminal 1: Start the LSP server
pnpm --filter @rune-langium/lsp-server start

# Terminal 2: Start the studio
pnpm --filter @rune-langium/studio dev
```

The studio will connect to `ws://localhost:3001` automatically. If no server is running, the editor remains usable for syntax-highlighted editing but live diagnostics, hover, and autocomplete go offline. Set `VITE_LSP_WS_URL` to point at a remote dev LSP host instead.

### Environment Variables

Studio loads its build-time configuration from `import.meta.env` and validates the result with Zod in `src/config.ts`; a malformed value crashes the bundle at module-init rather than degrading silently. Copy `.env.example` to `.env.local` and uncomment the fields you want to override. The deployment-facing vars are `VITE_LSP_WS_URL` (LSP host base, same-origin default `wss://www.daikonic.dev/rune-studio/api/lsp` in prod; set to `ws://localhost:8790/rune-studio/api/lsp` for `pnpm dev:full`), `VITE_LSP_SESSION_URL` (token-mint endpoint, resolved independently of the WS URL — set both together for local overrides), `VITE_ENABLE_LSP` (deployment-level switch for remote language services; defaults `true`), `VITE_TELEMETRY_ENDPOINT` (defaults to `${location.origin}/api/telemetry/v1/event`), `VITE_ENABLE_TELEMETRY` (deployment-level telemetry switch; defaults `false`), `VITE_ENABLE_GITHUB_AUTH` (deployment-level switch for the GitHub Device Flow-backed workspace flow; defaults `true`), `VITE_ENABLE_CURATED_MIRROR` (deployment-level switch for built-in curated reference models; defaults `true`), and `VITE_DEV_MODE` (gates dev-only status copy; defaults to `import.meta.env.DEV`). See [`specs/014-studio-prod-ready/contracts/studio-config.md`](../../specs/014-studio-prod-ready/contracts/studio-config.md) for the full contract.

## Export Code

The **Export Code** toolbar button generates source code in a selected target language (Java, TypeScript, JSON Schema, Zod, Python, …) from the currently loaded Rune model. It has two deployment modes — local development and the hosted CF deploy at `www.daikonic.dev/rune-studio/studio/` — with different backends:

### Local development

Run the Java-backed codegen server alongside the studio:

```bash
# Terminal 3 (in addition to LSP + studio dev):
pnpm codegen:start   # serves http://localhost:8377
```

With this running, Export Code supports the **full** generator matrix (whatever `codegen-cli --list-languages` returns locally, including JVM-only targets like Java and CDM-specific generators). No Turnstile challenge, no rate-limit — local dev is friction-free.

### Hosted deployment (`www.daikonic.dev/rune-studio/`)

Same features, but behind a Cloudflare Worker that enforces light abuse protection:

- **CF Turnstile** — a one-off invisible challenge on the first generation per browser session. Subsequent generations in the session use an `HttpOnly` cookie and skip the widget.
- **Per-IP rate limits** — 10 generations per hour, 100 per day. Errors surface a clear "Try again in N minutes" message and point heavy users to local dev for unlimited use.
- **Transient failures** — if the container is cold or briefly unhealthy, the dialog shows a "warming up" message with auto-retry. The response time SLA is ≤5s warm / ≤15s cold.

Under the hood, Studio reads two build-time env vars:

- `VITE_CODEGEN_URL` — base URL for the codegen service. Default: `http://localhost:8377`. The CF build sets it to `/rune-studio` so Export Code calls `/rune-studio/api/generate` (same-origin, no CORS).
- `VITE_TURNSTILE_SITE_KEY` — Turnstile public site key. Defaults to Turnstile's "always-pass" dummy key for preview builds; set explicitly for the production deploy.

See [`specs/011-export-code-cf/`](../../specs/011-export-code-cf/) for the full design. The Worker + container live under [`apps/codegen-worker/`](../codegen-worker/) and [`apps/codegen-container/`](../codegen-container/).

## Workspaces & GitHub backing

Studio's start page exposes **Open a folder…**, **New blank workspace**, and **Open a GitHub repo…** entry points. The three kinds map to:

| Kind | Storage | Sync surface |
|---|---|---|
| browser-only | OPFS (Origin Private File System) | none |
| folder-backed | OPFS mirrored to a chosen local directory via FSA | manual save / load handle |
| git-backed | OPFS + isomorphic-git over OPFS | clone / fetch / push / status |

Auth for git-backed uses **GitHub Device Flow** mediated by `apps/github-auth-worker`. Tokens never reach the Worker — the user enters the code in their browser, GitHub returns the token to the Studio page directly, and Studio stores it in the workspace's OPFS data at `<workspace-id>/.studio/token`. The Worker only brokers the Device Flow handshake (`device_code`) and token polling; it does not receive or persist the resulting access token.

State on disk:
- File contents → OPFS
- GitHub access token for git-backed workspaces → OPFS (`<workspace-id>/.studio/token`)
- Workspace metadata, tabs, recent list, settings → IndexedDB
- Serialised FSA folder handles → IndexedDB (`handles` store)

`pnpm dev` works without any of the new Workers; it routes telemetry/curated calls back to the dev origin (no-op or bundled fixtures).

## Telemetry (FR-T01–T05)

Studio emits closed-schema events (see `specs/012-studio-workspace-ux/contracts/telemetry-event.md`) to `apps/telemetry-worker`. Privacy invariants enforced both in the client and the server:

- No file paths, names, or contents can ever appear in a body — the schema is `.strict()` enums + bounded strings.
- The server hashes `cf-connecting-ip` with a daily-rotating salt (deterministic per UTC day via HMAC, no storage); raw IPs never log, never persist.
- Studio's `services/telemetry.ts` no-ops on `localhost` and when the user has set `telemetry-enabled=false` in Settings.
- A single `429` response from the server drops the event silently — telemetry never blocks the user.

Settings → **Diagnostics** has a single toggle. Builds also expose `VITE_ENABLE_TELEMETRY` so production can be hard-disabled until the telemetry worker is actually deployed.

## Key Files

| File | Purpose |
|------|---------|
| `src/components/SourceEditor.tsx` | CodeMirror 6 editor with multi-tab support |
| `src/components/DiagnosticsPanel.tsx` | Error/warning list with click-to-navigate |
| `src/components/ConnectionStatus.tsx` | Transport status indicator |
| `src/services/lsp-client.ts` | LSPClient lifecycle management |
| `src/services/transport-provider.ts` | WebSocket + Worker failover logic |
| `src/services/ws-transport.ts` | WebSocket → CM Transport adapter |
| `src/services/worker-transport.ts` | Worker → CM Transport adapter |
| `src/services/diagnostics-bridge.ts` | LSP diagnostics → type name mapping |
| `src/services/semantic-diff.ts` | Structural AST comparison |
| `src/workers/lsp-worker.ts` | SharedWorker/Worker entry point |
| `src/store/diagnostics-store.ts` | Zustand diagnostics state |
| `src/lang/rune-dsl.ts` | Rune DSL syntax highlighting |

## Non-Functional Requirements

| NFR | Target | Implementation |
|-----|--------|----------------|
| Diagnostics latency | < 500ms | Direct LSP pipeline, no intermediate buffering |
| LSP handshake | < 2s | 2s connection timeout to dev/prod WS host |
| Editor load | < 500ms | Lazy CodeMirror initialization per tab |
| SharedWorker memory | < 50MB | Langium ~2MB bundled, well within budget |
| Reconnection | 3 attempts with exponential backoff | Configurable via `TransportProviderOptions` |
| WebSocket security | Origin allowlist + signed session token | Token minted by `POST /rune-studio/api/lsp/session`; HMAC-SHA256 with daily-rotating server key; 24h expiry; per-isolate nonce ring buffer for replay protection |

## Testing

Tests use vendored Rune DSL fixtures under `.resources/` for realistic integration testing:

- `.resources/cdm/` — CDM model corpus
- `.resources/rune-dsl/` — built-in base model files
- `.resources/rune-fpml/` — FpML imported model dependencies

Refresh snapshots with:

```bash
bash scripts/update-fixtures.sh
```

```bash
# Run all studio tests
pnpm --filter @rune-langium/studio test

# Run specific test file
pnpm --filter @rune-langium/studio exec vitest run test/components/SourceEditor.test.tsx
```

## Local development with Pages Functions

The studio's Download (spec 018) and LSP (spec 019) endpoints are hosted as
Cloudflare Pages Functions under `apps/studio/functions/api/`. Three
workflows depending on what you're iterating on:

### A. UI-only iteration → `pnpm dev`

Fast HMR, vite only. Visit `http://localhost:5173/rune-studio/studio/`.
LSP + curated parse endpoints will 404 in the status bar (no Pages
Functions are running), but every other UI surface works and changes
reflect instantly. Use this for component / styling / state-machine
work.

### B. Full backend stack → `pnpm dev:full`

One command, four processes: vite (5173) + lsp-worker (8790) +
curated-mirror-worker (8789) + wrangler pages dev (8788). Visit
`http://localhost:8788/rune-studio/studio/`. The CURATED_MIRROR service
binding shows `[connected]`; `/api/parse` works end-to-end.

LSP now connects directly to apps/lsp-worker's own dev server at `:8790`
(no Pages Function proxy — see apps/studio/wrangler.toml's comment and
apps/lsp-worker/.dev.vars.example). Set in your own `.env.local`:

```
VITE_LSP_WS_URL=ws://localhost:8790/rune-studio/api/lsp
VITE_LSP_SESSION_URL=http://localhost:8790/rune-studio/api/lsp/session
```

and copy `apps/lsp-worker/.dev.vars.example` to `apps/lsp-worker/.dev.vars`
so the Worker's local `ALLOWED_ORIGIN` accepts the studio's dev origins
(production's `ALLOWED_ORIGIN` in `apps/lsp-worker/wrangler.toml` stays
locked to `https://www.daikonic.dev` — `.dev.vars` only applies to
`wrangler dev`, never to `wrangler deploy`).

> **Gotcha:** wrangler's `env.ASSETS.fetch` (used by the SPA catch-all
> Pages Function) serves the LOCAL `dist/` directory, NOT vite's dev
> modules. This means HMR doesn't reach the browser at `:8788` —
> wrangler keeps serving the built bundle. The `predev:full` hook
> runs `pnpm build` so the bundle is at least FRESH at startup; UI
> changes made during a `dev:full` session won't appear until you
> either (a) restart `dev:full` or (b) run `pnpm build` in another
> terminal. For tight UI iteration use workflow A above; switch to
> workflow B when you need to test LSP / curated parse integration.

### Curated mirror — local fixture seeding

The curated-mirror-worker starts with an EMPTY in-memory R2 bucket. To
exercise the curated CDM/FpML/rune-dsl flow locally, seed the bucket
in a separate terminal after `dev:full` is up:

```bash
pnpm --filter @rune-langium/curated-mirror-worker run seed:local
```

Populate `.resources/cdm`, `.resources/rune-fpml`, and `.resources/rune-dsl`
with repository-root clones of the corresponding upstream projects. The seed
preserves repository-relative paths beneath one archive wrapper, so CDM sources
retain `rosetta-source/src/main/rosetta/` exactly once. The artifact builder
selects production sources and excludes test fixtures.

The seed writes source archives and serialized JSON artifacts to local R2.
Then click the CDM / FpML / rune-dsl chips in the loader to browse their types.

### Workflow choice cheat-sheet

| Iterating on | Use | URL |
|---|---|---|
| UI components, styling, state | `pnpm dev` | `http://localhost:5173/rune-studio/studio/` |
| Pages Functions (`/api/*`) | `pnpm dev:pages` (vite must be running separately) | `http://localhost:8788/` |
| LSP + curated + Pages Functions all together | `pnpm dev:full` (+ seed:local for curated) | `http://localhost:8788/rune-studio/studio/` |

### Named project targets

The Export workspace keeps ad hoc declaration selection separate from named
`build-config.yml` targets. Each saved target has a tab beside **One-off**;
**Add target** creates another target and each tab retains its own unsaved options
while switching. **Save target settings** updates the working
copy with revision checks; it does not commit or push. Selection roots and the
last selected target remain personal preferences, never a repository default.
**Reload project files** picks up external YAML edits; dirty option drafts remain
available until explicitly saved or the workspace changes. Removing a target
removes its configuration only; generated files remain in the workspace.

**Generate target** and **Generate all** use saved namespace scopes and options and
write staged output to each target's configured output directory. The same
preflight, toolchain checks, path guards and byte-preserving writer are used by
`rune-cli build`. Studio obtains generated code through the existing network
service; it does not add a local language-service fallback. Named builds use
strict library defaults, while one-off exports retain their existing layouts.
Source/configuration/lock/resource/example changes invalidate captured output.
Generated output itself does not change the input revision. Working-copy Save,
Git commit/push and ordinary artifact downloads remain distinct actions.

### Workspace settings and references

Settings shows the active workspace's real configuration and links to its reference
models, export targets and Git perspective. The schema-generated directories form
uses the canonical Studio configuration contract and shared Input controls. Save
preserves `.yml`/`.yaml` spelling, comments and unknown keys through the normal
revision-checked transaction. Directory changes do not move existing files.

Reference settings show saved selections immediately, while release catalogs and
the active dependency closure load separately. Nightly dependencies carry their
verified runtime labels without adding pins or locks. **Recheck references**
explicitly verifies the current closure; an unchanged selected release does not
offer another change. Starter lists show readable names and descriptions rather
than raw source commit hashes; verified provenance remains attached internally.

### GitHub project initialization

Opening a GitHub repository with a POM and no native build configuration offers
an optional inline settings review. Select profiles explicitly, inspect proposed
files and unsupported tooling, then **Initialize project settings** or **Keep
browsing**. Both preserve the cloned repository, POM, remote and branch. A stale
proposal refuses Save; **Review profiles** reloads current files for a fresh review.
Existing build-config.yml or .yaml is authoritative and skips this detection.

Export settings retains a **Saved initialization report** after reopen. It records
the original POM evidence and selected profiles, while current target diagnostics
and function capabilities determine what can run. Unavailable targets cannot be
included in a build; other native targets remain usable. Missing or malformed
historical evidence is reported separately from otherwise usable type generation.
Subsequent POM changes do not silently synchronize native configuration.

The pinned CDM/FpML journeys verify metadata import, pure type generation and a
small local Rune execution repair. They do not implement upstream Java tooling,
business calendars or production payment-schedule generation. Maven versions are
not inferred Git release tags; unresolved external references need explicit native
reference selections and locks. There is no standalone Maven import action.

Working-copy Save remains local. Use Git / Sync's explicit **Commit and push** to
publish repository changes; it flushes editor Save barriers first.

### Portable examples

Prototype **Create example**, duplication, edits and deletion use the active
ProjectController working-copy Save. Descriptors and payloads live under
`studio.examples` (default `examples/`), so cloning the repository restores distinct
examples without the original browser database. **Saved** means the descriptor and
payload passed the shared transaction readback; **Retry** retains edits after failure.
A missing or ambiguous type retains its payload and reports a diagnostic.

Existing typed `.studio/instances/*.json` records migrate by exact ID when their
full declaration identity is unique. A backing-private migration marker is written
only after repository readback; legacy files remain intact. Credentials, scratch
files and personal dock/filter state are never copied. Unsupported serialization
formats refuse Save rather than silently writing JSON. Repository Save remains
separate from explicit Git commit/push. Internal InstanceRecord APIs retain their
names and optionally carry the full type identity for portable adapters.

### Named workflows and shared presentation

Use **Save workflow…** to name the current input bindings, optional function and
output definitions. **Saved workflow** opens a recipe from the working copy.
Unchanged examples remain bound by stable ID; edited detached inputs are captured
as literals. Results stay transient until **Save as example…**. Missing symbols or
examples produce diagnostics while the original recipe files remain intact.

Object layout/order/spans and monetary formats save beneath `studio.layouts` using
full declaration identities and stable source-property paths. Clones restore these
settings without the original browser database. Formatting retains exact semantic
numbers. Existing browser preferences are offered through **Review browser
presentation…**; **Save in repository** copies only uniquely bound settings after
review, and leaves the private originals intact. Repository files take precedence.
Personal docking, filters, selected rows and scratch workflow state remain local.

### Workspace launcher

**Workspaces** opens editable projects; **Reference models** is a separate
launcher section for read-only dependencies. New workspace, Open folder, Open
GitHub and file import share the existing activation and Save flows. A live
folder stays bound to the selected directory: source edits, portable examples
and configuration use guarded project IO. Reopening/retrying recovers the shared
Save journal before exposing source, and external file edits produce conflicts.
Removing its recent workspace disconnects the folder without deleting its files.

**Start from example** lists proposed GitHub starter projects separately from
reference bundles. Proposed daikonic-org repositories remain unavailable until
publication and content verification. A verified public starter opens as an
editable browser copy without authentication, with the exact source commit kept
as workspace provenance. That origin is not Git backing or push permission;
clone/fork/connect a writable repository through the existing GitHub flow.
The source reader accepts bounded UTF-8 file trees and verifies Git blob IDs;
binary files, symlinks, submodules, truncated trees and private storage paths are
rejected before copying. See GitHub's [tree](https://docs.github.com/en/rest/git/trees#get-a-tree)
and [blob](https://docs.github.com/en/rest/git/blobs#get-a-blob) APIs.

Recent-workspace backing and recorded repository status are distinct from a
current Save result. Missing sync evidence is shown as unknown, not as unpublished
or synced. No repository creation, Maven execution or automatic push occurs.

### Reference models: Nightly and tagged releases

In **Workspaces → Reference models**, choose a model and an exact published
release. **Review change** verifies the full dependency closure and shows selected
and required releases before **Save reference change** updates `build-config.yml`
and `build-config.lock.json` together. Selecting another release replaces that
model's request; a workspace cannot load two releases of the same model. Cancel
or verification failure leaves the active request and lock unchanged.

The same chooser offers **Nightly**. It saves `release: nightly` in
`build-config.yml` and follows the current curated mirror on open or refresh.
There is no saved Nightly commit or lock entry, and an all-Nightly workspace has
no lockfile. Nightly provides no stability or reproducibility guarantees. Its
current dependency set is still checked for compatible cohorts and valid bytes;
an interrupted publication reports an error for retry. A model cannot be both
Nightly and a tagged dependency in the same workspace.

Normal reopen uses the locked commits and verified content cache, without a tag
lookup or a latest-release fallback. Missing locks, conflicting requirements,
unavailable bytes and checksum failures retain their diagnostics; **Review
configured references** repairs an unresolved request, while **Retry reference
loading** retries an unavailable locked load. Invalid configuration must be
repaired before a new selection can be saved. Dependency compatibility does not
establish compatibility of local overrides, examples or business implementations.
Explorer and parser hydration consume the same captured documents as preview,
LSP and exports. The legacy model-loading panel is removed. Unconverted examples
retain their original data and recovery status without blocking unrelated
reference changes; actual failed saves still need to be retried.

### Runnable model-authoring example

[`examples/workspaces/model-authoring`](../../examples/workspaces/model-authoring/)
contains local Rune source, two named native build targets, a typed quote example,
expected fixture, named workflow and shared presentation. Its standalone version
requires no reference service. The separate project-implementation browser journey
uses a checked tiny reference cohort to execute an explicit local Rune override,
then saves input/output examples and reopens the recipe in a fresh clone. Neither
fixture implements CDM schedules, observations, calendars or decimal parity.
