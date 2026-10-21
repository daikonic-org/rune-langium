# Functions

## hooks

### `useAutoSave`
Returns a debounced callback that auto-saves the latest value after
`delay` milliseconds of inactivity. Flushes on unmount.
```ts
useAutoSave<T>(onCommit: (value: T) => boolean | void, delay: number): (value: T) => void & { flush: any }
```
**Parameters:**
- `onCommit: (value: T) => boolean | void` — Callback invoked with the latest value on commit.
- `delay: number` — default: `500` — Debounce delay in milliseconds (default 500).
**Returns:** `(value: T) => void & { flush: any }` — A debounced setter function.

### `useLatestRef`
```ts
useLatestRef<T>(value: T): RefObject<T>
```
**Parameters:**
- `value: T`
**Returns:** `RefObject<T>`

### `useNavigationArrival`
Brief destination emphasis, independent of selection and camera auto-fitting.
```ts
useNavigationArrival(consumedArrivalRef?: RefObject<NavigationArrival | undefined>): { arrivalNodeId: string | null; emphasizeArrival: (nodeId: string, revision?: number) => void; cancelArrival: () => void }
```
**Parameters:**
- `consumedArrivalRef: RefObject<NavigationArrival | undefined>` (optional)
**Returns:** `{ arrivalNodeId: string | null; emphasizeArrival: (nodeId: string, revision?: number) => void; cancelArrival: () => void }`

### `useStableKey`
```ts
useStableKey(): (item: object) => string
```
**Returns:** `(item: object) => string`

### `useExpressionAutocomplete`
```ts
useExpressionAutocomplete(availableTypes: TypeOption[], inputParams?: { name: string; typeName?: string }[]): UseExpressionAutocompleteResult
```
**Parameters:**
- `availableTypes: TypeOption[]`
- `inputParams: { name: string; typeName?: string }[]` (optional)
**Returns:** `UseExpressionAutocompleteResult`

### `useTypeRefDrop`
```ts
useTypeRefDrop(opts: UseTypeRefDropOptions): UseTypeRefDropResult
```
**Parameters:**
- `opts: UseTypeRefDropOptions`
**Returns:** `UseTypeRefDropResult`

### `useDiagnosticsForRange`
Returns the highest-severity `RangeDiagnostic` whose range overlaps the
given `astRange`, or `undefined` when no overlap exists.

Overlap semantics: two ranges `[a.start, a.end)` and `[b.start, b.end)`
overlap iff `a.start &lt; b.end && b.start &lt; a.end`. This matches the
standard half-open-interval definition used by CodeMirror and LSP.
Zero-length ranges (start === end) never overlap.

Severity ordering: 1 (error) &gt; 2 (warn) &gt; 3 (info) &gt; 4 (hint) — lower
numeric value wins.
```ts
useDiagnosticsForRange(astRange: { start: number; end: number } | undefined, diagnostics: readonly RangeDiagnostic[]): RangeDiagnostic | undefined
```
**Parameters:**
- `astRange: { start: number; end: number } | undefined` — Character-offset span of the row being tested. When
                 `undefined`, returns `undefined` without inspecting the
                 diagnostics array (nothing to match against).
- `diagnostics: readonly RangeDiagnostic[]` — Pre-converted diagnostics for the active file.
                    Pass a stable empty array (`[]`) when there are none.
**Returns:** `RangeDiagnostic | undefined`

### `useModelSourceSync`
```ts
useModelSourceSync(nodes: TypeGraphNode[], edges: TypeGraphEdge[], onModelChanged?: (serialized: Map<string, string>) => void | Promise<void>, parseEpoch: number, patches: Patches, originalSourceByNamespace: Map<string, string>, inversePatches: Patches): SourceSyncHandle
```
**Parameters:**
- `nodes: TypeGraphNode[]`
- `edges: TypeGraphEdge[]`
- `onModelChanged: (serialized: Map<string, string>) => void | Promise<void>` (optional)
- `parseEpoch: number` — default: `0` — The editor store's `parseEpoch` — bumped ONLY when the graph is (re)built
from a parse result. Used to gate serialization: a `nodes`/`edges` change
that arrives together with a `parseEpoch` bump came FROM the source (a
parse), so serializing it back is pointless and — for a degraded reparse
(worker unavailable) — actively corrupts the file. We serialize ONLY when
the change is USER-EDIT-origin (parseEpoch unchanged since the last run).
Optional/defaulted so non-studio callers (tests, standalone) keep the old
"serialize every content change" behavior.
- `patches: Patches` — default: `[]` — The store's accumulated Mutative patches since the last parse. Drives the
CST-reuse dirty set: only nodes/subtrees touched by a patch are
regenerated; everything else is sliced verbatim from originalSourceByNamespace.
- `originalSourceByNamespace: Map<string, string>` — default: `...` — Original source text keyed by namespace name — used as the CST baseline for
the reuse serializer. Built by the caller from the current workspace files.
Defaults to an empty map so legacy/test callers that don't supply it get an
empty output (no write-back).
- `inversePatches: Patches` — default: `[]` — The store's accumulated Mutative INVERSE patches since the last parse.
Used to derive the source byte ranges of genuinely-deleted elements so
those ranges are omitted from the assembled output. Defaults to [] so
legacy/test callers without deletion support keep the old behavior.
**Returns:** `SourceSyncHandle`

### `createEditorCommitRegistry`
```ts
createEditorCommitRegistry(): EditorCommitRegistry
```
**Returns:** `EditorCommitRegistry`
