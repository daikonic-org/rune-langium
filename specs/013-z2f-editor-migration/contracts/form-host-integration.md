# Contract: Form Host Integration

**Branch**: `013-z2f-editor-migration` | **Phase**: 1 (design)
**Audience**: implementers of any of the five form slices (Phases B and D)

**October 12, 2026 implementation addendum:** The approved [shared Inspector plan](../../../docs/superpowers/plans/2026-10-12-inspector-shared-constructs.md) supersedes the numeric-index dirty retention and row rename descriptions below. Each declaration still owns one canonical form/schema. Optional host props `scopeKey`, `parseEpoch`, `saveStatus` and `registerCommitFlush` connect current workspace ownership and the existing persistence barrier; standalone consumers remain supported. `useInspectorExternalSync` delegates source triggering to upstream `useExternalSync`, then resets once and reapplies only uniquely matched dirty member leaves/errors. Same-epoch removal/name reuse and ambiguous reparse matches clear stale drafts with a visible identity error. Shared `useInspectorTargets` resolves canonical members before enum paging and supports name-only commits against current signature/display; the previous row callback API remains a fallback.

Child metadata paths use the parent form through `MetadataTargetContext`, generated schema capability checks and guarded graph actions. Accepted rich payloads detach from mutable RHF values, and uniquely unchanged item leases can renew across reparse. The existing per-field debounce reports a valid parse-blocked commit as pending; the shared flush registry rejects premature persistence and retains the edit for retry. No new timer, persisted child ID, storage format or private child form is added. Comments remain in Source and legacy notes/public callbacks remain supported. See the [qualitative assessment](../../../docs/investigations/2026-10-12-inspector-562-assessment.md) for implemented construct variants and tests. The rest of this document is retained as the original migration contract.

This document defines the integration contract between the editor pane (which
holds the selected graph node and per-kind action callbacks) and the form host
(`<ZodForm>` plus the upstream primitives from `010-editor-primitives`). It is
the contract every form-slice PR must satisfy.

---

## 1. Inputs the form host receives

Each form receives the same prop shape it does today (see e.g.
`DataTypeForm.tsx:88-105`). The migration does NOT change these prop names or
their semantics:

- `nodeId: string` — graph identity of the selected node.
- `data: AnyGraphNode` — the AST-shaped payload of the node. **Identity**
  (object reference) is the source of truth for "this is a different node".
- `availableTypes: TypeOption[]` — type-selector options.
- `actions: EditorFormActions<K>` — the kind-narrowed action surface
  (see `data-model.md` §5). Stable across re-renders unless the host
  intentionally swaps it.
- `allNodes?: TypeGraphNode[]` — for inherited-member resolution.
- `renderExpressionEditor?: (props) => ReactNode` — optional rich-editor slot.
- `onNavigateToNode?: NavigateToNodeCallback` — for type-link navigation.
- `allNodeIds?: string[]` — for resolving type names to node IDs.

The form host MUST NOT require additional props beyond this set; any new
configuration is encoded in `z2f.config.ts`, not in the form's prop shape.

---

## 2. Source-object binding (external sync)

The form is bound to `data` by **reference identity**:

- When `data !== prevData` (strict reference change), the form host calls
  `form.reset(toFormValues(data), { keepDirtyValues: true })`. This is the
  upstream `useExternalSync(form, data, toValues)` hook (R4 of
  `research.md`). The previous custom `<ExternalDataSync>` component is
  removed.
- When `data === prevData` but a _property_ of `data` changed by mutation,
  the form host MUST NOT reset. Pristine fields stay current via the natural
  React render cycle; dirty fields are protected by `keepDirtyValues`.
- When the user has an in-flight debounced commit at the moment `data`
  identity changes, the pending commit MUST flush against the _original_
  `nodeId` before the form repopulates with the new node's values. This
  preserves the existing behaviour described in spec Edge Cases.

**Failure mode**: if `toFormValues(data)` throws (e.g. malformed AST), the
form host MUST surface the error to the surrounding error boundary rather
than render a blank form. The spec's edge case ("source doesn't satisfy the
schema") is _not_ this case — that one is a Zod validation issue at field
level, not a projection error.

---

## 3. Reorder-event flow (graph round-trip)

For arrays configured `arrayConfig.reorder: true` in `z2f.config.ts`:

1. The user drags or keyboards a row from `fromIndex` to `toIndex`.
2. The upstream reorder primitive updates form state (the
   `useFieldArray.move()` equivalent) and emits a reorder event with `(from,
   to)`.
3. The form's reorder-handler (e.g. `handleReorderAttribute` in
   `DataTypeForm.tsx:204-210`) MUST forward the event verbatim:
   `actions.reorderAttribute(nodeId, fromIndex, toIndex)`. No re-mapping, no
   re-derivation from form state.
4. The graph store reconciles; the AST-shaped `data` reference changes; on
   the next render, `useExternalSync` is a no-op because the user-driven
   change already moved form state to the same end state.

**Add/Remove between reorders**: if the user adds or removes a row between
two reorders, the actions replay against the graph in the order they fired
(spec US2 Acceptance Scenario 3). The form host owes nothing extra here —
React's render order already provides the sequencing — but each PR's tests
MUST cover this case.

---

## 4. Auto-save debounce semantics (preserved)

Per-field commits remain on a per-field `useAutoSave(commitFn, 500)` debounce
(R8). The contract:

- The form host does NOT introduce a top-level debouncer in this migration.
- Each `commit*` callback in the form body wires through the action surface
  (`actions.renameType`, `actions.updateDefinition`, etc.).
- A row-level commit (e.g. attribute name) fires its row's `onUpdate(...)`
  callback, which closes over `nodeId` and the row index and forwards to
  `actions.updateAttribute(...)`.
- Switching nodes mid-debounce (see §2) flushes the pending timer first.

**Measurement**: SC-007 budgets ±50 ms of pre-migration timing. Each form
slice MUST include a regression test that measures debounce latency at the
action-fire point; the test asserts the total elapsed time between the input
event and the action call is within the budget for a representative leaf
field per form.

---

## 5. Failure modes and developer warnings

- **Section component referenced but not registered**: form host emits a
  developer-mode warning to the console and renders nothing for that
  section (matches spec Edge Case §5).
- **Row-renderer registered but the item-schema has no `[]` traversal in
  the typed config**: form host falls back to the default item rendering and
  emits a developer-mode warning.
- **`actions[<name>]` is `undefined` when the form fires it**: the form
  surfaces a developer-mode error and continues. This protects against
  accidentally narrowing the action surface (`EditorFormActions<K>`) wrongly
  in the host.

All warnings/errors above are dev-only (gated on `import.meta.env.DEV` or the
upstream equivalent). Production builds do NOT emit them.
