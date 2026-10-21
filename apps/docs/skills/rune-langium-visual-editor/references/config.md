# Configuration

## GraphFilters

Visibility filter state for the type graph.

### Properties

#### namespaces

**Type:** `string[]`

#### kinds

**Type:** `TypeKind[]`

#### namePattern

**Type:** `string`

#### hideOrphans

**Type:** `boolean`

## LayoutOptions

### Properties

#### engine

**Type:** `LayoutEngine`

#### direction

**Type:** `LayoutDirection`

#### nodeSeparation

**Type:** `number`

#### rankSeparation

**Type:** `number`

#### groupByInheritance

Group nodes into inheritance trees and lay out each tree independently.

**Type:** `boolean`

## NodeStyleConfig

### Properties

#### data

**Type:** `{ headerColor?: string; borderColor?: string }`

#### choice

**Type:** `{ headerColor?: string; borderColor?: string }`

#### enum

**Type:** `{ headerColor?: string; borderColor?: string }`

## EdgeStyleConfig

### Properties

#### extends

**Type:** `{ color?: string; strokeWidth?: number }`

#### attribute-ref

**Type:** `{ color?: string; strokeWidth?: number; dashed?: boolean }`

#### choice-option

**Type:** `{ color?: string; strokeWidth?: number }`

#### enum-extends

**Type:** `{ color?: string; strokeWidth?: number }`

## RuneTypeGraphConfig

Configuration props for the `RuneTypeGraph` component.

### Properties

#### layout

**Type:** `LayoutOptions`

#### nodeStyles

**Type:** `NodeStyleConfig`

#### edgeStyles

**Type:** `EdgeStyleConfig`

#### initialFilters

**Type:** `GraphFilters`

#### showMinimap

**Type:** `boolean`

#### showControls

**Type:** `boolean`

#### showLegend

Show the always-on kind/edge legend overlay (default true).

**Type:** `boolean`

#### readOnly

**Type:** `boolean`

## EditorState

Snapshot of visual editor state tracked by the zustand store.

### Properties

#### nodes

**Type:** `TypeGraphNode[]`

**Required:** yes

#### edges

**Type:** `TypeGraphEdge[]`

**Required:** yes

#### nodesById

Canonical id→node index — the edit SUBSTRATE (Phase 3B). `nodes` above is a
derived render cache (invariant I1: `nodes === [...nodesById.values()]`).
Every source-affecting action writes this Map through a chokepoint
(`mutateGraph`/`updateGraphView`/`loadModels`); the post-undo `store.subscribe`
re-derives the arrays from the Maps after history restore.
Do NOT write the Maps ad-hoc from a new action — go through a chokepoint.

**Type:** `Map<string, TypeGraphNode>`

**Required:** yes

#### edgesById

Canonical id→edge index — the edit substrate (invariant I1:
`edges === [...edgesById.values()]`). See `nodesById` for the write contract.

**Type:** `Map<string, TypeGraphEdge>`

**Required:** yes

#### deferredExports

Curated-bundle deferred-export entries, stored on the store so
`loadModels` can re-merge their placeholder graph nodes after
replacing `nodes` with new RosettaModel-derived nodes. Without this
state, every `loadModels` call (e.g. from EditorPage's linkDocument
callback) would silently lose the curated namespaces that
`loadDeferredExports` previously created.

**Type:** `DeferredExportEntry[]`

**Required:** yes

#### selectedNodeId

**Type:** `string | null`

**Required:** yes

#### selectionRekey

Rename-only identity change from the last explicit selection, preserved across model refreshes.

**Type:** `{ from: string; to: string; intermediateIds?: string[] }`

#### searchQuery

**Type:** `string`

**Required:** yes

#### searchResults

**Type:** `string[]`

**Required:** yes

#### activeFilters

**Type:** `GraphFilters`

**Required:** yes

#### detailPanelOpen

**Type:** `boolean`

**Required:** yes

#### validationErrors

**Type:** `ValidationError[]`

**Required:** yes

#### layoutOptions

**Type:** `LayoutOptions`

**Required:** yes

#### focusMode

When true, selecting a node auto-isolates its focused cluster.

**Type:** `boolean`

**Required:** yes

#### focusRelatedExcludedKinds

Node kinds excluded from focus-mode related clusters (selected node is always retained).

**Type:** `Set<TypeKind>`

**Required:** yes

#### visibility

**Type:** `VisibilityState`

**Required:** yes

#### pendingHydrationNamespaces

Namespaces queued for server-side hydration. An App.tsx effect watches
this list and re-parses with `hydrateNamespaces` set to the cumulative
union of these + `hydratedNamespaces` so the worker receives the full
closure. Cleared by `markNamespacesHydrated` once the parse completes.

**Type:** `string[]`

**Required:** yes

#### hydratedNamespaces

Namespaces that have already been hydrated in the current session.
Used by `requestNamespaceHydration` to deduplicate requests and by the
App.tsx re-parse effect to build the cumulative `hydrateNamespaces` set
(replacement-semantics worker hydration requires sending the full set).

**Type:** `string[]`

**Required:** yes

#### hydrationNonce

Monotonically-incrementing counter, bumped by `markNamespacesHydrated`
each time new AST content reaches the worker. Consumers (e.g.
ExplorePerspective) can react to this to re-link a selected node whose
initial link ran before the hydration round-trip completed.

**Type:** `number`

**Required:** yes

#### parseEpoch

Monotonically-incrementing counter bumped ONLY when the graph is (re)built
from a parse result — i.e. inside `loadModels`. (`loadDeferredExports` is a
state-only stash that does NOT rebuild nodes, so it does not bump it.)
User-edit actions deliberately do NOT bump it.

`useModelSourceSync` reads this to tell PARSE-origin `nodes`/`edges` changes
apart from USER-EDIT-origin ones: it only serializes the graph back to
source text when `parseEpoch` did NOT advance since the last emission.
Without this, a degraded reparse (worker unavailable → attributes stripped,
empty `errors`) would re-serialize the truncated graph over the real source
and corrupt the file. See `loadModels`' degraded-parse guard for the
complementary protection (rejecting a parse that shrinks the live graph).

**Type:** `number`

**Required:** yes

#### pendingEditPatches

Id-rooted Mutative patches for user edits that have NOT yet round-tripped
through a reparse. Captured by `mutateGraph` (semantic edit actions), replayed
by `loadModels` on top of each healthy parse so an edit made just before its
own reparse lands is not momentarily reverted, then pruned as the parse
catches up. See `edit-reconcile.ts` for the pure replay logic.

Deliberately excluded from the zundo `partialize` set (`{nodes, edges}`), so
it is not part of undo history — patches track in-flight intent, not state.

**Type:** `Patches`

**Required:** yes

#### pendingInversePatches

**Type:** `Patches`

**Required:** yes

## UseTypeRefDropOptions

### Properties

#### accept

Kinds this drop target will accept. Drops whose `payload.kind` is not in
this list are silently ignored (no `onDrop` call).

`isOver` semantics during dragover depend on what the drag source
registered on `dataTransfer`:
- **Kind-specific MIME** (e.g. `application/x-rune-type-ref+data`): `isOver`
  is set only when at least one registered kind matches this list — strict
  accept gating during hover.
- **Canonical MIME only** (`application/x-rune-type-ref`, no kind suffix):
  `isOver` is set as a backward-compatibility fallback; kind filtering
  moves to drop time via the parsed payload + `accept` check. Hover may
  briefly show "accepting" before the drop is rejected.

Drag sources following the recommended dual-MIME contract get the strict
behavior; single-MIME sources still work but lose dragover-time filtering.

**Type:** `readonly ("Data" | "Choice" | "Enum" | "BasicType" | "Record" | "TypeAlias" | "Func" | "Annotation")[]`

**Required:** yes

#### onDrop

Called with the parsed payload when an accepted drop completes.

**Type:** `(payload: TypeRefPayload) => void`

**Required:** yes

## BuildOptions

### Properties

#### focusedTypeId

**Type:** `string`

**Required:** yes

#### expansionMap

**Type:** `ReadonlyMap<string, boolean>`

**Required:** yes