# Workspace dependency refresh — 2026-11-13

Started from master `df8693b175ab841b3c2f19b985ed64ec432db768` with Node 26.13.0
and pnpm 11.5.0. The recursive outdated scan identified **44 package names**;
**42 are updated**, leaving only the two deliberate compatibility holds below.
The lockfile also advances Miniflare's scoped Undici 7 patch to **7.30.2**.

## Updated groups

| Area | Result |
| --- | --- |
| Language/runtime tooling | Langium 4.4.2; langium-cli 4.4.1; commander 15.1.0; semver 7.8.6 |
| Test runners | Vitest, UI and V8 coverage 5.1.0; Playwright 1.65.0; jsdom 31.0.0 |
| Build and styles | Vite 8.3.8; React plugin 6.3.0; Tailwind/Vite integration 4.3.5; Stylelint 18 and standard config 41 |
| Workbench | ReactFlow 12.12.1; Dockview 8.9.0; resizable panels 4.21.0; virtualizer 3.14.26; ELK 0.12.1 |
| State and forms | Mutative 2.0.2; Zustand 5.1.0; react-hook-form 7.92.0 |
| Parsing and transport | fast-xml-parser 5.12.0; web-tree-sitter 0.27.2; pako 3.0.3; isomorphic-git 1.44.13; ws 8.22.2 |
| Cloudflare | Wrangler 4.161.0; worker types 5.20261112.1; scoped Undici 7.30.2 |
| Lint/format tooling | Oxlint 1.93.0; tsgolint 7.0.2006; oxfmt 0.78.0; React Doctor 0.9.22; Prettier 3.10.1 |
| Other | Lucide 1.72.0; Vue 3.5.45; shadcn 4.23.0; concurrently 10.0.7; fake-indexeddb 6.2.8; user-event 14.6.10; Node types 26.6.6 |

React/React DOM, Zod and z2f remain on their existing coordinated versions.
Workspace links, package manager, build-script permissions, SQL grammar pin,
package extension and existing security exception are preserved.

## Compatibility decisions

- **Resolver 5.9.2 stays:** the current z2f React/Vite releases declare the
  resolver 5 peer range. Resolver 7 is not a supported drop-in replacement.
- **Docs and compiler-API alias stay on TypeScript 6.0.3:** TypeDoc's current peer
  range ends at TypeScript 6, while codegen requires the classic compiler API.
  Normal compilation remains on TypeScript 7.0.2 and the existing ESNext target.
- **Latest Langium is installed with the old Core compatibility floor:** Core's
  `^4.4.0` declaration is also used to admit published serialized bundles. Raising
  it to `^4.4.2` rejected existing 4.4.0 cohorts and locks in the reference tests.
  Preserve that floor; the lockfile installs 4.4.2 throughout the workspace.
- **Keep the ReactFlow measurement patch:** the requested `pnpm update -r -L`
  first stopped atomically because its 12.12.0-specific patch would become unused.
  The published 12.12.1 ESM entries still perform synchronous ResizeObserver
  updates, so the existing coalescing/cancellation patch was rebased onto that
  exact release, with both ESM entries covered and UMD unchanged.
- **Regenerate from the new toolchain:** AST reflection and the Core/editor Zod
  outputs now agree on optional rationale text and required conditional branches.
  These are generated changes, not separate handwritten schema rules. The domain
  surface and form conformance output remain current.
- **Use semantic CSS assertions:** jsdom 31 normalizes `translate: 8px 0px` to
  `8px`. The Structure keyboard-move test now uses `toHaveStyle`, preserving the
  same displacement, reset and new-root checks across valid CSS serializations.

After the patch was rebased, the update used explicit exclusions for the two
incompatible package names and a separate docs pass. `pnpm dedupe` ran afterward;
CodeMirror resolves one state version (6.7.6) and one view version (6.43.15).

## Security result

The **production audit has zero advisories**. The full tree retains two
development-tool advisories, with no new suppressions:

| Advisory | Current boundary / reason it remains |
| --- | --- |
| [Minimatch glob preprocessing amplification](https://github.com/advisories/GHSA-g3hv-75wg-m249), moderate | TypeDoc, ts-morph and ESLint's development tree still use 10.2.6. A tested range-scoped 11.0.8 replacement failed TypeDoc's real entry-point discovery because `Minimatch.matchOne` was removed; that replacement was withdrawn. Require compatible upstream consumers before forcing this major. Legacy production v3/v5 copies are outside this advisory's affected range. |
| [Deepmerge prototype poisoning](https://github.com/advisories/GHSA-gcqx-w48m-w2h4), low | shadcn's development CLI still installs 4.3.1. npm reports 4.3.1 as latest, while the advisory requires 4.3.2 or later. No unpublished dependency or audit exemption was added. |

The existing braces structural backport remains necessary because npm still
reports 3.0.3. All 44 installed-package regression checks pass. Its existing
single advisory exemption is unchanged; this is a local mitigation, not an
upstream fixed-release claim.

## Verification

- Dependency install/dedupe, Langium generation and complete non-docs workspace
  build pass. TypeDoc entry-point discovery and the VitePress production build
  pass with the retained TypeScript 6 toolchain.
- Complete recursive package suite: **8,317 Vitest tests pass across 798 files**,
  with five existing skips and eight todo cases. The five documentation packaging
  tests also pass. Python execution uses 3.14.10.
- Root V8 coverage passes all existing thresholds with Vitest/coverage 5.1.0:
  lines 60.30%, branches 64.64%, functions 40.99% and statements 58.91%.
- Workspace type checks, Stylelint 18 CSS lint and authored-file formatting pass.
  The whole-checkout format command reports one pre-existing untracked user mock
  (`apps/studio/.impeccable/mocks/effect-feedback/effects.js`), which is preserved.
- Design preview TypeScript, two generated-contract checks and four rendered
  preview/interaction checks pass.
- Curated reconciliation/upload, security-patch and publication-contract script
  tests pass (87 cases). The pinned native implementation inventory and dispatch
  fixture verification pass.
- The complete optimized candidate browser suite passes **160 checks**, all on
  the first attempt. The aggregate validates **64 expected journey records** and
  sanitized evidence from all four shards against the frozen worktree snapshot.
  Receipts are under ignored `dist/dependency-refresh-20261113/`; local static
  assets use real hosted APIs and the existing Node-only GitHub authentication
  transport. The three faster shards took 3.3–4.7 minutes; the curated-heavy shard
  took 13.1 minutes. This is a completeness check, not an A/B performance claim.

Linux-only jobs and remote PR checks remain CI responsibilities;
local success is not a merge or deployment authorization. Changesets status still
fails the existing public visual-editor → private design-system graph (#594).
The patch changeset records affected public runtime packages without suppressing
that unresolved release boundary. See the [13-issue review](2026-11-13-open-issue-triage.md)
for fresh deployed evidence and remaining acceptance.
