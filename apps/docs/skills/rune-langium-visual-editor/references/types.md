# Types & Enums

## types

### `TypeRefKind`
```ts
typeof TYPE_REF_KINDS[number]
```

### `TypeRefPayload`
Drag payload emitted by NamespaceExplorer items and consumed by drop targets.

**Field semantics:**
- `typeId`   — canonical node id in `ns.Name` format (e.g. `cdm.trade.Trade`).
              Used by `setInheritance` and other operations that reference nodes
              by their fully-qualified id.
- `typeName` — bare display/AST name (e.g. `Trade`) used in `$refText` writes,
              e.g. `updateAttributeType`. This is what the grammar stores as the
              unqualified cross-reference text.

Drag sources MUST set both fields.
**Properties:**
- `rune: "type-ref"`
- `namespaceUri: string`
- `typeId: string` — Canonical node id in `ns.Name` format. Used by setInheritance.
- `typeName: string` — Bare AST/display name used in $refText writes. Used by updateAttributeType.
- `kind: "Data" | "Choice" | "Annotation" | "Enum" | "BasicType" | "Record" | "TypeAlias" | "Func"`

### `StructureExpansionKey`
Key used in the expansion map; encodes namespace + type + attribute, plus
an optional per-instance discriminator.

**Per-instance semantics (Phase 14d, spec 020).** Each visible occurrence of
a type tracks its own expansion state — matching XmlSpy / Altova UModel /
Liquid Studio / Oxygen XML conventions. The `instancePath` carries the chain
of React Flow instance ids of the ancestors leading TO this row's owner (NOT
including the owner itself). Two placements of the same type at the same
depth produce different `instancePath`s because their parent instance ids
differ (e.g. `Trade::buyer::Party` vs `Trade::seller::Party`), so chevrons
inside them stay independent.

The separator inside the path uses `&gt;` (not `:`) because `:` is already the
field separator and we need to round-trip the path through a single string.
**Properties:**
- `namespaceUri: string`
- `typeId: string`
- `attrName: string`
- `instancePath: readonly string[]` (optional) — Chain of React Flow instance ids of ancestors leading to this row's owner,
NOT including the owner. Empty/undefined = root-level instance (no ancestors).

### `StructureConditionMeta`
Display-shaped condition meta surfaced on a Data / Choice / Function node's
header indicator (Phase A; Function added in Phase C — its `conditions` carry
both the function's `conditions` and `postConditions`). `name` is the
condition's source name (may be empty for unnamed conditions — the renderer
falls back to `preview` or an index label); `preview` is a short text
rendering of the condition expression produced by `conditionsToDisplay` (no
hand-rolled expression serialization).
**Properties:**
- `name: string`
- `preview: string`

### `StructureRow`
Single row inside a Data node, as the Structure View sees it.
**Properties:**
- `attrName: string`
- `typeName: string`
- `typeKind: "Data" | "Choice" | "Enum" | "BasicType" | "Record" | "TypeAlias" | "Unresolved"`
- `targetNodeId: string` (optional)
- `targetNamespaceUri: string` (optional)
- `cardinality: string`
- `isOptional: boolean`
- `isInherited: boolean`
- `astRange: { start: number; end: number }` (optional) — Range in the source document (for diagnostic binding + cursor sync).

### `StructureDataNode`
A Data node in the Structure View graph.
**Properties:**
- `id: string` — CANONICAL node id (e.g. `cdm.trade.Party`). Cells / editors look up the
shared type description by this id. Multiple visible instances of the same
type share the same `id` — they are distinguished by `instanceId`.
- `instanceId: string` (optional) — Per-instance discriminator id (Phase 14e). The adapter emits one
StructureDataNode per visible occurrence of a type; each carries its own
`expansions` map so chevrons on different instances don't bleed into each
other (e.g. `buyer.Party` vs `seller.Party`).

For root placements this equals the canonical `id`. For nested instances
it follows the layout's instance-id format
(`${parentInstanceId}::${attrName}::${canonicalId}`).

The `nodes` map in `StructureGraphInput` is keyed on `instanceId` when
the adapter populates it. Layout-only test fixtures may omit `instanceId`;
the layout falls back to `id` so existing fixtures continue to work.
- `kind: "data"`
- `name: string`
- `namespaceUri: string`
- `deferred: boolean` (optional) — True when this node is a deferred curated placeholder whose namespace
hasn't been on-demand hydrated yet (forwarded from `GraphNodeMeta.deferred`
via `AdapterNode`). Drives the same hydrating-spinner treatment as the
main graph canvas.
- `extendsName: string` (optional)
- `extendsNodeId: string` (optional)
- `definition: string` (optional) — Phase A — type-level documentation (the `definition` string on the AST
Data node). Surfaced via the header doc (ⓘ) indicator. Undefined / empty
when the type has no documentation.
- `annotations: readonly string[]` (optional) — Phase A — annotation display strings (e.g. `metadata`, `rootType`) derived
from the AST `annotations` via `annotationsToDisplay`. Surfaced via the
header annotations (@) indicator. Empty / undefined when none.
- `conditions: readonly StructureConditionMeta[]` (optional) — Phase A — condition display meta derived from the AST `conditions` via
`conditionsToDisplay`. Surfaced via the header conditions (✓) indicator.
Empty / undefined when none.
- `rows: readonly StructureRow[]`
- `expansions: ReadonlyMap<string, string>` — Direct expansions (attrName → child INSTANCE id). The child id keys into
`StructureGraphInput.nodes` (which is per-instance keyed).

### `StructureChoiceArm`
A Choice arm — represents one option in a Choice. Unlike Data attributes,
Choice arms have no `name` of their own (their identity IS their type) and
no cardinality (they are alternatives, not multi-valued).
**Properties:**
- `typeName: string` — The arm's type name as written in source (e.g., "CashPayment").
- `typeKind: "Data" | "Choice" | "Enum" | "Record" | "TypeAlias" | "Unresolved" | "Builtin"` — Classification of the referenced type, mirroring StructureRow.typeKind.
- `targetNodeId: string` (optional) — Canonical id of the referenced node, when resolvable.

### `StructureChoiceNode`
A Choice node in the Structure View graph.
**Properties:**
- `id: string` — Canonical node id; see `StructureDataNode.id` for the per-instance contract.
- `instanceId: string` (optional) — Per-instance discriminator (Phase 14e); see `StructureDataNode.instanceId`.
- `kind: "choice"`
- `name: string`
- `namespaceUri: string`
- `deferred: boolean` (optional) — See `StructureDataNode.deferred`.
- `definition: string` (optional) — Phase A — type-level documentation; see `StructureDataNode.definition`.
- `annotations: readonly string[]` (optional) — Phase A — annotation display strings; see `StructureDataNode.annotations`.
- `conditions: readonly StructureConditionMeta[]` (optional) — Phase A — condition display meta; see `StructureDataNode.conditions`.
Choice declarations may carry conditions in the grammar, so this is
accepted symmetrically with Data even though it is usually empty.
- `options: readonly StructureChoiceArm[]`
- `expansions: ReadonlyMap<string, string>` — Per-arm expansions (Phase 14e/B). Keyed by the arm's `typeName` (since
arms have no `attrName` — their identity IS the referenced type), value
is the child INSTANCE id in `StructureGraphInput.nodes`. Only arms whose
`typeKind` is `Data` or `Choice` are eligible to be expanded; terminal
arms (Enum / Builtin / Unresolved) never appear here.

Empty (default) for arms that have not been expanded by the user.

### `StructureEnumNode`
A read-only Enum node in the Structure View graph (Phase 14e/A). Materialized
when the user focuses an Enum from the namespace explorer; lists the enum's
values as plain rows. Enums are terminal — no per-value expansion, no
cellComponents wiring, no chevrons.
**Properties:**
- `id: string`
- `instanceId: string` (optional)
- `kind: "enum"`
- `name: string`
- `namespaceUri: string`
- `deferred: boolean` (optional) — See `StructureDataNode.deferred`.
- `values: readonly string[]` — Enum value names in source order.

### `StructureBaseContainer`
A base-type GroupContainer wrap.
**Properties:**
- `id: string` — Canonical wrapper id (e.g. `cdm.trade.Trade::__base::cdm.trade.TradeBase`).
Multiple instances of the same wrapper (one per visible occurrence of the
outer type) share the canonical id but differ in `instanceId`.
- `instanceId: string` (optional) — Per-instance discriminator (Phase 14e); see `StructureDataNode.instanceId`.
- `kind: "base"`
- `baseTypeId: string` (optional) — Canonical declaration ID, distinct from the synthetic wrapper ID.
- `baseTypeName: string`
- `baseTypeNamespaceUri: string`
- `deferred: boolean` (optional)
- `baseRows: readonly StructureRow[]`
- `childNodeId: string` — INSTANCE id of the child Data node inside this base container.
- `expansions: ReadonlyMap<string, string>` — Containment edges from this base level's inherited rows into expanded
target nodes (Data/Choice that the user clicked to expand). Values are
INSTANCE ids (mirroring StructureDataNode.expansions). Spec §3.2 — base
level rows can carry their own expansion edges, scoped per-instance.

### `StructureFunctionNode`
A read-only Function node in the Structure View graph (Phase C). Materialized
when the user focuses a `RosettaFunction` from the namespace explorer.

Functions are RENDERED as a card with the function's inputs presented as
stacked Data-style rows (name on top, `type · cardinality` beneath) and a
distinct output row (`→ ReturnType · card`). Functions are roots only in this
first cut — no nested expansion of input/output types into subtrees (deferred
to a later phase), so a function node has no expansion children and renders
like a simple Data node with no children column.
**Properties:**
- `id: string`
- `instanceId: string` (optional)
- `kind: "function"`
- `name: string`
- `namespaceUri: string`
- `deferred: boolean` (optional) — See `StructureDataNode.deferred`.
- `inputRows: readonly StructureRow[]` — Input parameters as stacked Data-style rows (reuses `StructureRow`).
- `outputRow: StructureRow` (optional) — Output as a single Data-style row; undefined when the function has no output.
- `definition: string` (optional) — Phase A — type-level documentation; see `StructureDataNode.definition`.
- `annotations: readonly string[]` (optional) — Phase A — annotation display strings; see `StructureDataNode.annotations`.
- `conditions: readonly StructureConditionMeta[]` (optional) — Phase A — condition display meta; see `StructureDataNode.conditions`.

### `StructureNode`
```ts
StructureDataNode | StructureChoiceNode | StructureBaseContainer | StructureEnumNode | StructureFunctionNode
```

### `StructureGraphInput`
Full graph input produced by the adapter.
**Properties:**
- `rootNodeId: string` — INSTANCE id of the root node. Keys into `nodes`. For the root placement
the instance id equals the canonical id of the outermost wrapper, so
existing callers that pass canonical ids through this field continue to
work for non-nested roots.

Phase 14e/A: roots may be `data`, `choice`, or `enum` kinds — the adapter
materializes whichever the focused type resolves to.
- `nodes: ReadonlyMap<string, StructureNode>` — Per-instance node map. Keys are `StructureNode.instanceId`; each visible
occurrence of a type is its own entry with its own `expansions` map.
Look up a node's shared canonical metadata via `.id`.

### `DomainNodeData`
Domain payload of an editor graph node — the discriminated union (on
`$type`) of `Dehydrated&lt;T&gt;` over every top-level element kind the editor
renders. This is the PURE domain object: lossless, strict `{ $refText }`
refs, `$type` required, and NO UI metadata (which lives on `node.meta`).

Sourced from the generated core `AnyDomain` union (single source of truth;
the editor no longer hand-maintains the arm list — the langium-zod
`repository.elementTypes` config drives it).
```ts
AnyDomain
```

### `AnyGraphNode`
Union of all node-data variants for top-level elements.
```ts
DomainNodeData
```

### `GraphNodeMeta`
**Properties:**
- `namespace: string`
- `imports: readonly NamespaceImport[]` (optional) — File-local import bindings for authored reference labels and navigation.
- `errors: ValidationError[]`
- `isReadOnly: boolean` (optional)
- `hasExternalRefs: boolean`
- `annotationDefinitions: Readonly<Record<string, { name: string; namespace: string }>>` (optional) — Derived linked scope facts; never part of the authored domain payload.
- `comments: string` (optional) — UI-only annotation (not from AST).
- `deferred: boolean` (optional) — True only on deferred-export placeholder nodes (list-only curated types
 not yet hydrated). Drives on-demand hydration gating in the explorer.

### `RootAstElement`
Union of all top-level AST element types that appear as graph nodes.
```ts
Data | Choice | RosettaEnumeration | RosettaFunction | RosettaRecordType | RosettaTypeAlias | RosettaBasicType | Annotation
```

### `TypeKind`
Short kind strings used for UI dispatch, badge rendering, and form actions.
```ts
"data" | "choice" | "enum" | "func" | "record" | "typeAlias" | "basicType" | "annotation"
```

### `EdgeKind`
```ts
"extends" | "attribute-ref" | "choice-option" | "enum-extends" | "type-alias-ref"
```

### `EdgeData`
Data payload for graph edges.

The index signature is required for compatibility with ReactFlow's
`Edge&lt;T extends Record&lt;string, unknown&gt;&gt;` constraint.
**Properties:**
- `kind: EdgeKind`
- `label: string` (optional)
- `cardinality: string` (optional)

### `ValidationError`
**Properties:**
- `nodeId: string`
- `severity: "error" | "warning" | "info"`
- `message: string`
- `ruleId: string` (optional)
- `line: number` (optional)
- `column: number` (optional)

### `ExpressionEditorSlotProps`
Props provided to the expression editor render-prop slot.

`packages/visual-editor` is editor-agnostic — the host app provides
the actual editor implementation (e.g. CodeMirror, Monaco) via a
`renderExpressionEditor` prop on `FunctionForm`.
**Properties:**
- `value: string` — Current expression text.
- `onChange: (value: string) => void` — Called on every keystroke / change.
- `onBlur: () => void` — Called when the editor loses focus — triggers validation & commit.
- `error: string | null` (optional) — Validation error message (null when valid).
- `placeholder: string` (optional) — Placeholder text shown when the editor is empty.
- `expressionAst: unknown` (optional) — Raw AST expression object — enables direct tree conversion without reparsing text.
- `readOnly: boolean` (optional)
- `target: { nodeId: string; kind: "precondition" | "postcondition"; index: number }` (optional)
- `draftCondition: { nodeId: string; kind: "precondition" | "postcondition" }` (optional) — Scope for a new condition draft; no expression source region exists yet.

### `FunctionBodyEditorSlotProps`
**Properties:**
- `nodeId: string`
- `readOnly: boolean`

### `TypeOption`
A type option for searchable type selectors.
**Properties:**
- `value: string` — Node ID, or special ID for built-in types.
- `label: string` — Display label (type name).
- `kind: TypeKind | "builtin"` — Type kind for badge coloring.
- `namespace: string` (optional) — Namespace for grouping in the dropdown.

### `SourceRefOption`
Option for the synonym-source reference picker.
**Properties:**
- `value: string` — Canonical id of the source declaration (e.g. `ns.FpML`).
- `label: string` — Display name (bare source name).
- `namespace: string` (optional) — Namespace for cross-namespace qualification.

### `CommonFormActions`
Actions shared by all type kinds.
**Properties:**
- `captureMetadataTarget: (nodeId: string, path: MetadataPath) => MetadataTarget | undefined` (optional)
- `applyMetadataCommand: (target: MetadataTarget, command: MetadataCommand) => MetadataEditResult` (optional)

### `DataFormActions`
Data type–specific editor actions.
**Properties:**

<!-- truncated -->
