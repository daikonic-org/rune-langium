# Agent Guide

Rune-langium is a TypeScript-native Rune DSL toolchain and the Rune Studio IDE.
This file is the shared instruction source for Codex, Claude, Copilot, and other agents.

## Ground Rules

- DRY is the primary correctness rule: reuse authoritative implementations across packages. Do not maintain parallel approximations for UI validation, previews, or codegen.
- Prefer non-destructive changes; never reset user work. Use conventional commits.
- Keep formatting consistent with `.editorconfig` and `.oxfmtrc.json`.
- Keep public API docs concise; test public behavior and shared architecture seams.
- When architecture, scripts, workflows, or agent configuration change, update the relevant documentation and durable repository context in the same change.
- New source files must use the directory's SPDX header: `packages/` is MIT; `apps/studio/` is FSL-1.1-ALv2. Describe Studio as source-available.
- Pinned upstream test corpora belong in [test/fixtures/third-party](test/fixtures/third-party/README.md). Preserve upstream source headers, licenses, notices, provenance and integrity hashes; these test inputs retain their upstream licenses.

## Setup and Verification

- `package.json` and `pnpm-workspace.yaml` are authoritative for versions, scripts, overrides, and patches. Development/CI: Node 26.13.0 LTS (pinned in `.node-version`), pnpm >=11, package manager `pnpm@11.5.0`.
- Install: `pnpm install`; build: `pnpm run build`; development: `pnpm dev`.
- Check code changes with `pnpm run lint`, `pnpm test`, `pnpm run format:check`, and `pnpm run type-check`, scoped to the affected packages when appropriate.
- Codegen-only changes: `pnpm --filter @rune-langium/codegen test` and `pnpm --filter @rune-langium/codegen run type-check`. Rebuild codegen after render changes; Studio and visual-editor consume its dist output.
- Documentation/configuration-only changes: validate links, syntax, and the changed configuration; application tests are unnecessary unless runtime behavior changes.
- Summaries must state what changed, where, and how it was verified. Automation runs should report commands and results.

## Required Context

- [Architecture and invariants](docs/agents/architecture.md): read before changing package boundaries, Studio, language services, or codegen.
- [Development workflow](docs/agents/workflow.md): read before generation, dependency changes, testing, hooks, or skill installation.
- [Infigraph and session continuity](docs/agents/infigraph.md): read at session start. Use Infigraph FIRST for code exploration, symbol context, and refactoring impact; use direct reads for configs/docs or when Infigraph is unavailable or returns no relevant results.

Claude imports this guide from `CLAUDE.md`; Copilot links here from `.github/copilot-instructions.md`. Keep shared instructions here and in the linked documents instead of copying them into agent-specific files.
