# Publish-Time Codegen Artifacts for Curated Bundles — Design Spec

**Feature Branch**: `curated-publish-time-codegen`
**Status**: Draft — design review
**Created**: 2026-07-30
**Author**: Pradeep Mouli (with brainstorming via Claude Code)
**Context**: issue #432 (Cloudflare resource-limit crash on large codegen downloads) and its stopgaps — PR #445 (isolate-scoped document cache) and the `cpu_ms = 300000` Pages limit raise. Builds on spec 018 (`2026-05-12-codegen-additional-targets-design.md`, server-side Download), spec 019 (`2026-05-12-studio-workers-pages-functions-design.md`), and the curated manifest work (`2026-05-23-curated-manifest-per-namespace-design.md`).

## 1. Goal

Make `/api/codegen` cheap for its primary product case — **user models that extend CDM** — by moving all curated-content processing to publish time, so a mixed user+curated download request touches no serialized curated AST at all: no fetch of `modelJson`, no `JsonSerializer.deserialize`, no multi-round re-link, no walking a CDM-sized closure inside a 128 MiB Worker isolate.

Organizing principle: **codegen output is a pure function of (source content, target, options)**. No input whose content has not changed should ever be re-parsed, re-linked, re-walked, or re-emitted. Applied at three scales:

1. **Curated content** — fixed at publish. All parsing, linking, shape extraction, and emission for curated namespaces happens once, in the publisher (which already builds and links every document with no CPU ceiling), never per-request.
2. **User content** — fixed per workspace state. A request-side cache keyed by *content hash* (not just selection identity) makes target-format switching on an unchanged workspace a cache hit, closing the gap PR #445 deliberately left (user-file requests are currently never cached because content was not part of the key).
3. **Per-namespace incrementality** (future) — a namespace's output is a function of its own sources plus the *shapes* of what it references; the projection artifact (§4.1) makes that dependency explicit and hashable.

## 2. Background — why request-time hydration is the bottleneck

The crash mechanics behind #432, in order of cost:

- **Hydration CPU.** `hydrateModelDocuments` (packages/core) must rebuild live cross-document object references from serialized `$ref` URIs. Because Langium's `JsonSerializer.deserialize` resolves references via a one-shot lookup against already-registered documents, correctness requires up to `MAX_RELINK_ROUNDS = 8` full re-deserialization passes over the batch (a Bellman-Ford-style relaxation; see that function's doc comment). Cost is proportional to closure size, paid on every cold request.
- **Walk + emit CPU.** `runGenerate` walks every namespace in the closure and runs the target emitter.
- **Memory.** A hydrated CDM closure alone approaches the flat 128 MiB isolate cap (the `/api/parse` incident measured ~238 MB for deserialize+link of the full closure). PR #445's ten review rounds were all about preventing *two* closures from ever being resident at once.

What is already done, and what it does not do:

| Mitigation | Status | Limit |
|---|---|---|
| Closure-scoped fetching (manifest `deps`, PR #342 lineage) | Shipped | Bounds *which* namespaces load, not the per-namespace cost |
| Isolate document cache + full hydration serialization (PR #445) | Shipped | Only helps *repeat* requests on a warm isolate; cold/first requests pay full price; user-file requests never cached |
| `limits.cpu_ms = 300000` on the Pages project | Applied 2026-07-30 | Raises the ceiling; does nothing about the memory cap or the wasted work |

The remaining problem is structural: the request path re-derives, per request, information that was fully known at publish time.

## 3. Primary use case — user models extending CDM

A user authors a handful of `.rosetta` files that `import cdm.*` namespaces and `extends` CDM types, then downloads Zod/TypeScript/JSON Schema output. This is simultaneously:

- the product's core workflow (authoring against the curated corpus, not browsing it), and
- the worst platform case: one small user file seeds the dependency cascade, and CDM's internal connectivity pulls a large closure — all of today's hydration cost, triggered by kilobytes of user input.

Curated-*only* downloads (browse CDM, download as-is) are the degenerate easy case and fall out for free (§4.2).

## 4. Architecture — two publish-time products, one pipeline

The publisher (`apps/curated-mirror-worker/src/serialized-artifact.ts`) already parses and **fully links** every document in the bundle (`builder.build(documents)`) before serializing. Both new products are additional outputs of that same pass — no new parsing pipeline, no second model of the language.

### 4.1 Product 1 — type-shape projections (the enabler)

A compact, per-namespace index of every exported type's *emitter-relevant structure*:

```ts
// packages/codegen (or core) — the single schema, versioned
interface NamespaceShapes {
  schemaVersion: 1;
  namespace: string;
  types: Record<string, TypeShape>;
}

type TypeShape = DataShape | ChoiceShape | EnumShape | AliasShape;

interface TypeRefShape {
  namespace: string;   // resolution baked in at projection time
  name: string;
  kind: TypeShape['kind'] | 'primitive';
}

interface DataShape {
  kind: 'data';
  name: string;
  extends?: TypeRefShape;            // the edge only — flattening is derived (§5)
  attributes: AttributeShape[];      // OWN attributes only
}

interface AttributeShape {
  name: string;
  type: TypeRefShape;
  cardinality: { min: number; max?: number };  // absent max = unbounded
}

interface ChoiceShape { kind: 'choice'; name: string; options: TypeRefShape[]; }
interface EnumShape   { kind: 'enum';   name: string; parent?: TypeRefShape; values: string[]; }
interface AliasShape  { kind: 'alias';  name: string; target: TypeRefShape; }
```

Kilobytes per namespace (vs. megabytes of `modelJson`), loadable with a plain `JSON.parse` — no Langium services, no deserialize, no re-link rounds. This extends the artifact family that already exists: the manifest's `exports` entries already carry the *kind* half (`{type: $type, name, path}`); shapes add the *structure* half. Precedent: PR #342 replaced "hydrate the closure to derive the namespace dep-graph" with "read it precomputed from the manifest" — this is the same move, one level deeper.

### 4.2 Product 2 — pregenerated per-namespace outputs (the import target)

For each namespace × implemented per-namespace target (`zod`, `typescript`, `json-schema`, `sql`, `markdown`): the **real** `generate()` output, produced by calling the existing pipeline inside the publisher, stored alongside the existing artifacts.

Why this is still needed when shapes exist: the emitters mostly *reference* cross-namespace parents rather than re-emit them — zod emits `runeExtendChoice(CuratedChoice, shape)` / `ParentSchema.extend(...)` behind an **import**; JSON Schema uses `$ref`. A mixed download's zip must therefore *contain* `cdm/base/math.zod.ts` for the user file's imports to resolve — and that file is exactly this product. It also carries everything deliberately excluded from shapes (§8): conditions (`.refine()` predicates), funcs, annotations.

DRY cost: zero. The publisher imports `generate()` and runs it; there is no second emitter.

Mechanically, this product is not a separate system: it is the §7 L1 output cache **warmed at publish time**. The publisher runs `generate()` with the same injected store and the same keying scheme (curated docs key by `bundleId@version`, so the entries are valid for every future request against that bundle version); the request path performs the identical lookup it would for any other cached output.

### 4.3 Request flow — before vs. after

| Step | Today | After |
|---|---|---|
| Curated content | Fetch `modelJson` per closure namespace → deserialize → up to 8 re-link rounds → hold full AST closure | Fetch shape indexes for the closure (kilobytes) → `JSON.parse` |
| User files | Parse via Langium (cheap — small) | Unchanged |
| Cross-boundary refs | Langium linker over the hydrated closure | Scope-over-descriptions (§6) |
| Emit user namespaces | `generate()` over the full document set | `generate()` over user docs + curated *shapes* |
| Emit curated namespaces | `generate()` re-derives them every request | Copy pregenerated outputs into the zip |
| Curated-only request | Same full pipeline | Pure artifact lookup; no Langium engine invoked |
| Unchanged-user repeat request (e.g. target switch) | Full re-parse + re-emit (never cached) | Cache hit via content-hashed key (§7) |

## 5. The projection function — one source of truth, one consumer path

`projectTypeShape(node): TypeShape` lives in shared code and is the **only** producer of shapes:

- **Publish time**: runs over the curated ASTs the publisher just linked → stored artifact.
- **Request time**: runs over the just-parsed user ASTs → in-memory shapes for this request.

The emitters are refactored to consume **shapes only** for type structure — kind classification, attribute lists, `extends` edges, choice options, alias targets — through one accessor layer, replacing today's direct `.ref` walks (`data.superType?.ref`, `attr.typeCall?.type?.ref`; census: ts-emitter 25 uses, zod 17, json-schema 7, base-namespace-emitter 5). Transitive derivations (inherited-attribute flattening for SQL's `single-table`/`table-per-type` modes, choice-ancestry detection for `runeExtendChoice`) are implemented **once**, over the shape graph, and serve both live and projected inputs.

Two recorded lessons make this the only acceptable design:

- **Never a parallel implementation** (`preview-validator.ts` incident): a shape *schema* maintained separately from what the emitters read would drift review-round by review-round. One function produces; one layer consumes.
- **No synthesized AST data** (PR #182 rule): do **not** rehydrate projections into fake AST nodes so unmodified emitters can keep calling `.ref` — rework the consumers to the projection interface instead.

Note the request-time direction also fixes a latent correctness gap: user docs are parsed *without* the curated closure registered, so their cross-boundary `.ref`s are unresolved anyway — the current pipeline only works because the closure is hydrated first. Shapes make the boundary explicit instead of incidental.

## 6. Cross-boundary reference resolution — RESOLVED (Phase 0 spike: GO)

When a user attribute names `Quantity`, deciding *which* `Quantity` (local shadows import — the probe result from the #366 work) is scoping. Reimplementing scoping over shape indexes would be a forbidden parallel implementation of `RuneDslScopeProvider`.

The DRY-clean direction: **run the real scope machinery over descriptions, not documents.** Langium's global scope operates on `AstNodeDescription`s (name, type, document URI, path) — which is precisely what the publish-time `exports` index contains. Seed the request's index with descriptions synthesized from the manifest exports (no ASTs), and for each cross-boundary reference consume the **real** `ScopeProvider`'s winning candidate description directly — never dereference it into a live node — then map that description to its shape-index entry.

### 6.1 Spike result (2026-07-30): confirmed, and better than assumed

The premise isn't just theoretically sound — it's already shipped in production for a related purpose:

- **`RuneDslIndexManager.registerExports`** (`packages/core/src/services/rune-dsl-index-manager.ts`, ADR 007 Phase 4) already registers `AstNodeDescription[]` for a URI with **no backing document** — the parser worker uses this today for curated on-demand hydration.
- **`RuneDslLinker.loadAstNode`** (`packages/core/src/services/rune-dsl-linker.ts`) already treats `description.node === undefined` as the normal case, lazily materializing a real node via `DeferredModelProvider` only when `.ref` is actually dereferenced — otherwise leaving it unmaterialized.
- **Mechanically**, Langium's `DefaultLinker.doLink` (`node_modules/langium/lib/references/linker.js:90-104`) runs scope resolution and sets `ref._nodeDescription = description` **before** calling `loadAstNode(description)` — scope resolution and node materialization are genuinely separate steps. Consuming `reference.$nodeDescription` instead of `reference.ref` is what lets Phase B skip materialization (and therefore hydration) entirely.

Empirically proven (scratch test, 3/3 cases, deleted after — will be rewritten as a real fixture-backed test when Phase B lands):

1. A bare stub description (`{type: 'Data', name: 'Quantity', path, documentUri}`, no node, no `DeferredModelProvider`) registered via `registerExports`, referenced from a parsed user document: `.ref` correctly fails to materialize (nothing to load), but `ref.$nodeDescription` resolves correctly — name, type, path, documentUri all present.
2. Same via a qualified `import` — resolves identically.
3. **Local-shadow case**: the user document defines its own `Quantity` (`Data`) while a curated stub of the same bare name is also registered, deliberately typed `Choice` so a wrong hit is detectable — resolution correctly picks the **local** node (`$nodeDescription.type === 'Data'`), and being local, `.ref` also resolves directly.

**APIs for Phase B**: `RuneDslIndexManager.registerExports(uri, descriptions)` seeded from the manifest's exports at request time (no parse of curated content needed to register); user documents built normally (no special `eagerLinking` handling needed — real linking runs, it just never needs to materialize the curated side); consume `reference.$nodeDescription` (never `.ref`) to key the `NamespaceShapes` lookup.

**Not yet spiked** (low-risk, confirm when Phase B lands): alias imports (`import x.* as y`) resolve through `RuneDslScopeProvider.getGlobalScope`'s `AliasResolvingScope`, which is purely description/string-based — nothing in it appears to depend on live nodes, but no test has exercised it yet.

The fallback documented in the original draft (hydrate only directly-referenced curated documents) is no longer needed as a hedge — it remains a reasonable *degradation* path for a bundle whose artifacts predate the shape schema (§8's version-skew case), not a risk mitigation for this design.

### 6.2 One services instance per request — required, not optional

The curated descriptions and the user documents must be registered against the **same** `RuneDsl.shared.workspace.IndexManager` instance within a request — Langium resolves a cross-reference by querying one shared index/scope; there is no mechanism to merge candidates across two separate `IndexManager` instances. This is a hard constraint of how the linker works, not a design preference.

It is also already how `loadAllDocuments` (`apps/studio/functions/api/codegen.ts`) is structured today: one `createRuneDslServices()` call per request, reused for both `factory.fromString(...)` on user files and (currently) curated hydration. Phase B does not restructure this — it changes only what gets registered on the curated side of that same instance (bare export descriptions instead of fully hydrated documents), not the one-instance-per-request shape.

Across process boundaries, instances are necessarily separate — the publisher (curated-mirror-worker, its own process) and the browser's on-demand hydration each have their own `createRuneDslServices()` call — but all three consume the identical `RuneDslIndexManager`/`registerExports` code path. No parallel implementation, three independent instances.

## 7. Content-addressed caching (independent quick wins)

Two cache levels, both derivable from the purity principle, both independent of shapes/pregeneration and shippable first:

- **L1 — output cache, baked into the emitter layer**: content-addressed memoization of `GeneratorOutput` lives **inside `@rune-langium/codegen`**, at the per-namespace emit boundary (`runGenerate`'s namespace loop / the base namespace emitter), not in any one consumer. Key: `sha256(` contributing-doc identities — user docs by `(path, content hash)`, curated docs by `(bundleId@version, path)` — `+ namespace + target + canonical(options) + codegen package version)`. The package-version component is what makes the key safe for *persistent* backends: an emitter upgrade changes the key, so stale outputs can never survive a deploy. The store is injected via `GeneratorOptions` (the repo's capability-injection pattern — same as `curatedFetcher`), defaulting to none, so the library stays isomorphic and behavior-unchanged for callers that don't opt in. Every consumer then inherits the win: the browser preview worker (which re-runs generation on unchanged files constantly) injects an in-memory Map; the Pages Function injects a Cache-API-backed store keyed on the hash — persisting across isolates, so even a cold isolate hits; the CLI can inject a disk store. Options are canonicalized **after** server defaults are applied (sorted keys, defaults injected) so equivalent requests normalize to one key. This also unifies with §4.2: the publisher's pregenerated outputs are *the same cache, warmed at publish time* — one keying scheme, one lookup path, primed from two directions. Whole-model targets can adopt the same memoization later with a whole-input-set key.
- **L2 — document cache**: extend PR #445's `documentCacheKey` with a hash of the user file set (`sha256` over sorted `(path, content)` pairs) and lift the `files.length === 0` gate. The original reason user-file requests were excluded — the key didn't capture content, so caching risked serving stale documents — disappears once content *is* the key. Same 1-entry cap, TTL, and busy-tracking. This is what makes the studio's target-switch flow (TS → Zod on the same unchanged workspace) skip re-hydration: L1 misses (different target), L2 hits.

## 8. v1 boundaries / non-goals

- **Expressions stay out of shapes.** Conditions, funcs, and reporting rules are *not* projected; they live only in the pregenerated outputs of their own namespace, which mixed requests import rather than regenerate. Keeps the shape schema small and stable. Documented consequence: an emitter feature that needs a *parent's* condition text inline in a *child's* output cannot be built on shapes alone (none exists today).
- **Whole-model targets (`excel`, `graphql`) are out of scope** for pregeneration — they bundle user+curated into one artifact by definition, so they keep the live path (with shapes still replacing hydration for structure).
- **No change to the CLI or browser Preview worker** — both keep operating on live ASTs they already have; `projectTypeShape` is additive.
- **The #445 document cache is retained**, demoted to safety net (cold-path fallback: bundles published before the projection schema, `schemaVersion` mismatches).

## 9. Phasing

- **Phase 0 — spike**: scope-over-descriptions (§6). Go/no-go for the design; fallback documented above. Also ship §7's two content-addressed cache levels (independent, small, immediately useful).
- **Phase A — emitter refactor (behavior-preserving)**: introduce `TypeShape` + `projectTypeShape` + the shared flattening/ancestry helpers; refactor emitters to consume shapes computed *live from the hydrated documents they already receive*. No artifact, no request-path change — the entire existing emitter test suite plus the corpus gate is the oracle that shapes lose nothing.
- **Phase B — projection artifact**: publisher emits `NamespaceShapes` per namespace (manifest v3 field alongside `deps`/`exports`/`artifact`); `/api/codegen` loads shapes instead of hydrating curated documents for mixed requests, wiring the Phase 0 resolution in.
- **Phase C — pregenerated outputs**: publisher runs `generate()` per namespace × target; `/api/codegen` assembles mixed zips from pregenerated curated files + live user emission; curated-only requests become pure lookups.
- **Phase D — per-namespace incremental emission** (deferred until measured need): hash (own sources + referenced shapes) per user namespace; re-emit only dirty namespaces.

Each phase ships independently and reduces load on the request path; a stall after any phase still leaves the system strictly better than today.

## 10. Testing strategy

- **Phase A is self-verifying**: byte-identical emitter output before/after the shape refactor, across the existing suites and the corpus invariant gate (the schema-validity-trigger harness).
- **Round-trip parity**: for every curated namespace, `generate()` at publish time (Phase C artifact) must equal `generate()` over the same hydrated documents at request time — asserted in the publisher's own tests while both paths exist.
- **Resolution parity (Phase 0/B)**: for a fixture matrix (bare vs. qualified refs, local-shadows-import, cross-bundle collisions), description-seeded resolution must pick the same target as full-closure hydration.
- **Mixed-download E2E**: user file extending a curated Data and a curated Choice → zip contains pregenerated curated files + live-emitted user file whose imports resolve against them; compare against today's full-hydration output.
- **Version skew**: request against a bundle whose artifacts predate `NamespaceShapes` → clean fallback to the hydration path (the retained #445 cache), not an error.

## 11. Risks

- **Scoping spike fails** (§6) → documented fallback; the rest of the design survives.
- **Shape schema under-captures an emitter need** discovered late (e.g., an annotation-driven emission detail) → caught in Phase A while inputs are still live ASTs; extend the schema *before* any artifact exists, so no published-artifact migration.
- **Publish-time cost growth** — running `generate()` × targets per publish is bounded and infrequent (publisher runs off-request with no CPU ceiling); artifact storage grows by roughly the size of one generated output set per target.
- **Emitter refactor breadth** — 50+ `.ref` sites across emitters; mitigated by Phase A's byte-identical-output oracle and landing it per-emitter (zod → ts → json-schema → sql → markdown), each independently verifiable.

## 12. Alternatives considered

- **Client-side generation** — rejected; contradicts specs 018/019's deliberate placement (memory headroom, whole-closure processing, `jszip`/`exceljs` out of the browser bundle), and relocates the cost to unpredictable user devices plus a closure-sized download.
- **Relink-free serialized closure** (normalize `$ref`s to positional indices for single-pass rehydration) — kills the 8-round cost but still fetches, parses, and holds megabytes of AST per request; shapes make the whole question moot for the codegen path.
- **`cpu_ms` raise alone** — shipped as stopgap; raises the ceiling without touching memory or wasted work.
- **Container-based codegen backend** (spec 011 infrastructure) — higher limits, but adds cold-start latency and a second deploy surface for what is ultimately precomputable work; kept in reserve if whole-model targets ever outgrow the Worker.
