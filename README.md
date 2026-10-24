# rune-langium

> A TypeScript-native toolchain for the [Rune DSL](https://github.com/finos/rune-dsl) — parser, AST, language server, codegen, visual editor, and the Studio IDE — so you can work with ISDA CDM and DRR models in any browser or Node environment. No Eclipse. No Java. No setup.

> **⚠️ Pre-1.0 software** — APIs are subject to change between minor versions. Pin to exact versions in production. See the [CHANGELOG](./CHANGELOG.md) for breaking changes between releases.

<p align="center">
  <a href="https://github.com/pradeepmouli/rune-langium/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/pradeepmouli/rune-langium/ci.yml?style=flat-square" alt="ci" /></a>
  <img src="https://img.shields.io/badge/core-MIT-blue?style=flat-square" alt="core license" />
  <img src="https://img.shields.io/badge/studio-FSL--1.1--ALv2-orange?style=flat-square" alt="studio license" />
  <img src="https://img.shields.io/badge/node-%5E22.22.2%20%7C%7C%20%5E24.15.0%20%7C%7C%20%3E%3D26.0.0-brightgreen?style=flat-square" alt="Node ^22.22.2 || ^24.15.0 || >=26.0.0" />
  <img src="https://img.shields.io/badge/TypeScript-7-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="ts" />
</p>

<p align="center">
  <img src="site/assets/screenshot-graph.png" alt="Rune Studio — graph view showing CDM type inheritance trees with grouped layout, namespace explorer, and type filtering" width="900">
</p>

🌐 **Deployment surfaces:** landing at [www.daikonic.dev/rune-studio/](https://www.daikonic.dev/rune-studio/), docs at [www.daikonic.dev/rune-studio/docs/](https://www.daikonic.dev/rune-studio/docs/), studio at [www.daikonic.dev/rune-studio/studio/](https://www.daikonic.dev/rune-studio/studio/)

## Overview

The [Rune DSL](https://github.com/finos/rune-dsl) is the language behind ISDA's [Common Domain Model (CDM)](https://www.finos.org/common-domain-model) and the Digital Regulatory Reporting (DRR) framework — a domain-specific language for describing financial products, events, lifecycle transitions, and the rule logic that drives post-trade processing and regulatory reporting. The canonical Rune toolchain is a JVM stack built on Xtext and Eclipse; rich, but heavy, hard to embed, and impossible to run in a browser.

`rune-langium` is a from-scratch reimplementation of the Rune language in pure TypeScript on top of [Langium](https://langium.org/). Grammar, AST, scope provider, validator, serializer, LSP server, code generators, and visual editor all run as ESM modules in Node, in a web worker, or bundled into an SPA — so you can `pnpm add @rune-langium/core` and load a `.rosetta` file in the same process that renders your UI.

Use `rune-langium` if you are building a browser-based model explorer, a VS Code / Monaco integration for CDM, a CI validator for Rune files, a codegen pipeline targeting TypeScript / JSON Schema / Zod, or a form-driven editor that reads and writes Rune models. Use the [Rune Studio](apps/studio) application if you want the batteries-included three-panel IDE (graph + form + code) ready to run.

## Deployment

The repository ships a unified Cloudflare Pages deployment at `www.daikonic.dev/rune-studio/`, built from three sources into one static tree:

- `/rune-studio/` — static landing page from `site/`
- `/rune-studio/docs/` — VitePress documentation (`apps/docs/`)
- `/rune-studio/studio/` — Rune Studio SPA (`apps/studio/`)

Build the combined artifact locally with:

```bash
pnpm run build:cloudflare
```

(Equivalent to `pnpm --filter @rune-langium/docs run build:combined`.) The output tree lands at `apps/docs/.vitepress/dist/`.

Cloudflare Pages project settings (`daikonic-dev`):

- Build command: `pnpm install --frozen-lockfile && pnpm run build && pnpm --filter @rune-langium/docs run build:combined`
- Build output directory: `apps/docs/.vitepress/dist`
- Production branch: `master`
- Environment: `CF_PAGES=1` is set automatically by Cloudflare Pages; it switches VitePress and Vite to their subpath-baked bases.

GitHub Actions in this repo verify that the combined build succeeds on push and pull request. Production deployment is driven by Cloudflare Pages' git integration, not the workflow.

**Gotcha — env var changes need a manual redeploy.** Cloudflare Pages deployments triggered by a GitHub push (`deployment_trigger.type = "github:push"`) do NOT pick up changes to `deployment_configs.{production,preview}.env_vars` made via the Pages API/dashboard after the last such deployment — the new value silently doesn't reach the build, even though `GET`ting the project immediately shows it "set." Only an `ad_hoc` (manually triggered, e.g. `POST /accounts/{id}/pages/projects/{name}/deployments`) deployment actually bakes in a fresh env var value. Confirmed empirically 2026-07-31 by diffing `env_vars` on individual `GET .../deployments/{id}` responses across trigger types — not documented behavior found in Cloudflare's own docs, just observed. **After changing any Pages project env var, always trigger one `ad_hoc` deployment immediately afterward** (don't assume the next `git push` will pick it up) — this is how `VITE_ENABLE_TELEMETRY` silently reverted twice in the same session despite being confirmed "set" each time.

### Codegen service: local vs hosted

Studio's **Export Code** button has two deployment paths with intentionally different trade-offs:

| | Local development | Hosted (`www.daikonic.dev/rune-studio/`) |
|---|---|---|
| **Backend** | `pnpm codegen:start` — Node server spawning `codegen-cli.sh` (Java 21 + `rosetta-code-generators`) | Cloudflare Container running the same Java stack, fronted by a CF Worker |
| **Target languages** | Full matrix — whatever `codegen-cli --list-languages` returns | Same matrix, parity with local |
| **Auth** | None — localhost is trusted | CF Turnstile challenge on first generation per session; session cookie afterwards |
| **Rate limits** | None | 10 generations / hour / IP, 100 / day / IP |
| **Cost** | Free (your machine) | Free CF tier at demo scale; $25/month alert as safety net |
| **Studio env var** | `VITE_CODEGEN_URL=http://localhost:8377` (default) | `VITE_CODEGEN_URL=/rune-studio` (set by `build-combined.mjs` when `CF_PAGES=1`) |

The hosted path lives under [`apps/codegen-worker/`](apps/codegen-worker/) (Worker + Durable Object rate limiter) and [`apps/codegen-container/`](apps/codegen-container/) (container image + HTTP wrapper). Feature design: [`specs/011-export-code-cf/`](specs/011-export-code-cf/).

**Heavy users should run Studio locally.** The rate limits exist to protect the free-tier CF budget, not to push anyone away — the local path has no limits and stays in lock-step with upstream `rosetta-code-generators`.

## Features

- **Pure TypeScript, browser-ready** — the parser, language server, and every downstream tool run anywhere JavaScript runs; no JVM, no Eclipse headless, no Docker.
- **Langium-based grammar** — full Rune surface syntax with a clean AST, scope provider, validator, and serializer that round-trips `.rosetta` source.
- **Full LSP support** — completion, diagnostics, hover, go-to-definition, find-references, document symbols, formatting — served by `@rune-langium/lsp-server` over stdio or a web worker.
- **CDM & DRR out of the box** — vendored fixtures and parsing paths cover ISDA CDM, the FINOS Rune DSL, and Rune FpML; load a namespace and explore thousands of types without any preprocessing.
- **Visual graph editor** — a `@xyflow/react`-powered component (`@rune-langium/visual-editor`) that renders type inheritance, rule call graphs, and model structure with grouped layouts, namespace filtering, and live synchronization to the underlying AST.
- **Codegen pipeline** — `@rune-langium/codegen` targets TypeScript types, JSON Schema, Zod schemas, and form descriptors derived from Rune model structure; scriptable from CI.
- **CLI for scripting** — `@rune-langium/cli` exposes parse, validate, serialize, and codegen as a commander-based CLI for build pipelines.
- **Design system** — `@rune-langium/design-system` ships the theme, tokens, and UI primitives used by Studio so downstream apps inherit the same look.
- **Studio IDE** — IDE-style dockable panels (`dockview-react`) with persistent layouts; OPFS-backed workspaces (browser-only / local-folder / GitHub-backed via Device Flow); curated CDM/FpML/rune-dsl mirrors served from R2 nightly; cross-app design tokens shared with the docs site; opt-out anonymous telemetry.
- **Langium-native extensibility** — because everything is Langium services, you can subclass `RuneDslValidator`, `RuneDslScopeProvider`, or the parser and plug your extension into the same DI container.

## Install

```bash
pnpm add @rune-langium/core
# optional pieces
pnpm add @rune-langium/cli @rune-langium/codegen @rune-langium/lsp-server
```

Requires **Node.js `^22.22.2 || ^24.15.0 || >=26.0.0`** and **pnpm ≥ 11** for local development. Use the
`packageManager` version in `package.json` (currently `pnpm@11.5.0`).

## Quick Start

Parse a Rune file and walk the AST:

```typescript
import { parse } from '@rune-langium/core';
import { renderModel } from '@rune-langium/codegen/rosetta';

const source = `
namespace demo
type Trade:
  tradeId string (1..1)
  notional number (1..1)
`;

const { model, diagnostics } = await parse(source);

if (diagnostics.length) {
  console.error(diagnostics);
  process.exit(1);
}

for (const element of model.elements) {
  console.log(element.$type, element.name);
}

// Render the model back to .rosetta source
console.log(renderModel(model));
```

Validate a workspace of `.rosetta` files from the CLI:

```bash
pnpm dlx @rune-langium/cli validate ./path/to/cdm
```

Embed the LSP server in a web worker for an in-browser Monaco editor, or spawn it over stdio for a desktop editor — the same `@rune-langium/lsp-server` package drives both.

## How it works

```
┌───────────────────────────────────────────────────────┐
│                     apps/studio                       │  ← FSL-1.1-ALv2
│   Three-panel IDE: graph | form | code (browser-only) │
└──────────────┬──────────────────┬─────────────────────┘
               │                  │
   ┌───────────▼──────┐   ┌───────▼────────────┐
   │ @rune-langium/   │   │ @rune-langium/     │
   │ visual-editor    │   │ design-system      │
   └───────┬──────────┘   └────────┬───────────┘
           │                       │
           └─────────┬─────────────┘
                     │
        ┌────────────▼────────────┐     ┌─────────────────────┐
        │   @rune-langium/core    │◄────┤ @rune-langium/      │
        │ (Langium services, AST, │     │ lsp-server          │
        │  parser, validator,     │     └─────────────────────┘
        │  scope, serializer)     │     ┌─────────────────────┐
        │                         │◄────┤ @rune-langium/      │
        └────────────┬────────────┘     │ codegen             │
                     │                  └─────────────────────┘
                     │                  ┌─────────────────────┐
                     └──────────────────┤ @rune-langium/cli   │
                                        └─────────────────────┘
                                        ▲
                                        │  ← MIT
```

`@rune-langium/core` is the single source of truth — grammar, generated AST, and Langium services. Every other package consumes it. Studio wires them together with React 19, `@xyflow/react`, zustand, Tailwind 4, and a browser-only workspace backed by the File System Access API and IndexedDB.

## Packages

| Package | License | Description |
|---|---|---|
| [`@rune-langium/core`](packages/core) | MIT | Grammar, AST, parser, validator, scope provider, serializer |
| [`@rune-langium/lsp-server`](packages/lsp-server) | MIT | LSP server (stdio + worker) for editor integration |
| [`@rune-langium/codegen`](packages/codegen) | MIT | TypeScript / JSON Schema / Zod / form-descriptor generators |
| [`@rune-langium/cli`](packages/cli) | MIT | Parse / validate / serialize / codegen from the command line |
| [`@rune-langium/visual-editor`](packages/visual-editor) | MIT | React Flow graph editor component |
| [`@rune-langium/design-system`](packages/design-system) | MIT | Theme, tokens, UI primitives |
| [`apps/studio`](apps/studio) | **FSL-1.1-ALv2** | Rune Studio — the three-panel IDE web application |

## Portable workspace example

[`examples/workspaces/model-authoring`](examples/workspaces/model-authoring/) is
an MIT-licensed local Rune starter with typed examples, an expected result, named
workflow, shared form presentation and two explicit native build targets. It has
no default target and needs no reference download. Proposed remote starter
repositories remain unpublished; copying this example does not configure a
writable Git remote. See its README for execution and capability limits.

## Development

```bash
git clone https://github.com/pradeepmouli/rune-langium.git
cd rune-langium
pnpm install

pnpm dev        # run Studio + watch packages
pnpm test       # vitest across the workspace
pnpm lint
pnpm format
```

Integration tests and Studio scenarios use vendored `.rosetta` fixtures under `.resources/`. Refresh them with:

```bash
bash scripts/update-fixtures.sh
# or pin specific tags
bash scripts/update-fixtures.sh --cdm-tag 7.0.0-dev.83 --rune-tag 9.76.2 --fpml-tag master
```

See [docs/WORKSPACE.md](docs/WORKSPACE.md), [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md), and [docs/TESTING.md](docs/TESTING.md) for more.

## Ecosystem

rune-langium builds on these libraries from the same author:

| Library | Purpose | npm |
|---|---|---|
| [lspeasy](https://github.com/pradeepmouli/lspeasy) | LSP framework powering rune-langium's language server | [![npm](https://img.shields.io/npm/v/@lspeasy/server?style=flat-square)](https://www.npmjs.com/package/@lspeasy/server) |
| [langium-zod](https://github.com/pradeepmouli/langium-zod) | Generate Zod schemas from Langium grammars | [![npm](https://img.shields.io/npm/v/langium-zod?style=flat-square)](https://www.npmjs.com/package/langium-zod) |
| [zod-to-form](https://github.com/pradeepmouli/zod-to-form) | Generate React forms from Zod schemas — runtime or CLI codegen | [![npm](https://img.shields.io/npm/v/@zod-to-form/core?style=flat-square)](https://www.npmjs.com/package/@zod-to-form/core) |
| [x-to-zod](https://github.com/pradeepmouli/x-to-zod) | Convert JSON Schema to Zod schemas | [![npm](https://img.shields.io/npm/v/x-to-zod?style=flat-square)](https://www.npmjs.com/package/x-to-zod) |

Together these form a pipeline: **Grammar → Zod schemas → React forms**, with [lspeasy](https://github.com/pradeepmouli/lspeasy) providing the LSP layer and JSON Schema as an alternative input path via x-to-zod.

## License

This repository uses a split licensing model:

- **Core packages** (`packages/*`) — [MIT](./LICENSE). Free for any use, commercial or otherwise.
- **Rune Studio** (`apps/studio/`) — [FSL-1.1-ALv2](./apps/studio/LICENSE). Source-available under the Functional Source License v1.1 with an Apache 2.0 Future License: you may use, copy, modify, and redistribute the Studio source for any purpose **except** offering a commercial product that competes with Rune Studio. Each release converts to Apache 2.0 after the `Change Date` specified in `apps/studio/LICENSE` for that release (typically two years after publication).

The core grammar, language server, codegen, CLI, visual editor, and design-system packages are and will remain MIT-licensed. Rune Studio is **source-available**, not open source.

See [NOTICE](./NOTICE) for third-party attribution.
Pinned [third-party test fixtures](./test/fixtures/third-party/README.md) retain their upstream licenses.

## Contributing

Please see [CONTRIBUTING.md](CONTRIBUTING.md).

---

ISDA® is a registered trademark of the International Swaps and Derivatives Association, Inc. CDM is hosted by FINOS under the Community Specification License. `rune-langium` and Rune Studio are not affiliated with or endorsed by ISDA or FINOS.

**Author**: [Pradeep Mouli](https://github.com/pradeepmouli)
