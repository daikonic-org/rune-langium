# Portable Workspaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver reproducible repository-managed Rune workspaces and versioned reference models, followed by the approved launcher.

**Architecture:** Build portable configuration and file persistence first. Core and codegen retain their authoritative semantics; a host-neutral project runtime composes them with locked references. Studio and CLI consume the same snapshot and resolution contracts.

**Tech Stack:** Existing TypeScript/ESM, Zod 4, Langium, Vitest, React/Zustand, OPFS/IndexedDB and Playwright. Use the repository-pinned pnpm version and supported Node range.

**Spec:** [Approved design](../specs/2026-10-23-portable-workspaces-reference-models-design.md).

## Global Constraints

- DRY is the primary correctness rule.
- Upstream `rune-config.yml` stays compatible; build settings belong in `build-config.yml`, shared Studio settings in `studio-config.yml`.
- Multiple named targets, including several configurations of one generator, with no default target.
- Existing target settings load from and serialize to project files. One-off exports do not rewrite saved settings.
- One reference release per model per workspace; track its exact dependency lockfile.
- Maven is a one-way initialization adapter inside GitHub-open, with no standalone import action or export/synchronization.
- Save writes working-copy files; commit/push remain explicit. Ignore generated code and ordinary exports by default.
- Explicit overrides redirect all consumers; Extend is not an override. Keep original source immutable.
- Visible copy says example. Keep credentials, personal layout and scratch state private.
- Package source is MIT; Studio source is FSL-1.1-ALv2. New sources carry existing SPDX conventions.
- Preserve dirty owner checkouts, unrelated LSP work, processes, tabs and resource symlinks. No manual deployment, automatic push, repo publication or merge.

## Review Focus

1. Switching workspace while an async Save/resolve completes must not publish or write into the new workspace: P1/T3 and P2/T2.
2. Same generator used by two targets must retain independent options without creating a default: P1/T2 and P1/T6.
3. Existing companion files in a cloned Maven repo must never be overwritten: P3/T2.
4. A copied replacement must change curated callers, not only its own preview: P2/T3–T4.
5. Legacy hidden storage contains private state; migration must not blanket-copy it into Git: P4/T1.

## Execution order

These are separate implementation plans because each subsystem has its own reviewable acceptance boundary. Execute in dependency order, with a scoped PR and acceptance evidence per completed slice. Do not merge or publish without the user's authorization. A plan is not evidence of implemented support.

| Plan                                                                     | Deliverable                                                                                                                   | Dependencies             |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| [P1: portable foundation](2026-10-23-workspace-foundation.md)            | File-backed configuration, options, recoverable Save, explicit target CLI and Studio settings                                 | None                     |
| [P2: reference resolution](2026-10-23-reference-resolution.md)           | Releases/lock, effective graph, overrides, resource/provider capability contracts                                             | P1                       |
| [P3: GitHub initialization](2026-10-23-github-project-initialization.md) | POM detection and partial initialization within GitHub-open                                                                   | P1, P2 catalog contracts |
| [P4: Studio projects](2026-10-23-studio-projects.md)                     | Portable examples/workflows/layouts, launcher/starters, separate reference settings, one verified Rune implementation fixture | P1–P3                    |

Broad CDM native parity and full payment schedules remain follow-on work as the design states. P4 adds the capability boundary and a real fixture, not a claim that every CDM function executes.

## File and package ownership

- `packages/project-config`: host-neutral file contracts, CST-preserving codecs, snapshots and transaction contracts; no codegen/core/React dependency.
- `packages/project-runtime`: composes project-config, core, codegen and curated-schema; owns local/project build orchestration and reference resolution.
- `packages/core`: canonical declaration identity and injected resolution hook; never imports project-runtime or Studio.
- `packages/codegen`: generator option validation, effective graph consumers and emission; never imports project-runtime.
- `packages/curated-schema`: release/catalog/artifact schemas shared with publisher and consumers.
- `packages/cli`: new explicit `build` command consumes project-runtime. Existing legacy `generate` and native `rune-codegen` routes are preserved; do not create a codegen → runtime → codegen cycle.
- Studio: backing adapters, project controller, UI and migration; browser preferences are caches/personal state, not portable authority.

Each task specifies new paths; all existing modification paths were checked against current source. Before execution, recheck the target branch and use Infigraph for affected symbol context/impact. Reconcile changed paths with current master, preserving interfaces and tests in these plans.

## Approval and execution

The user approved the design and clarified that Maven detection belongs within GitHub import. This plan has been self-reviewed for coverage, dependency direction and contract consistency; implementation has not started. Review the linked plans and choose the execution method before product edits.
