# Functions

## adapters

### `astToModel`
Convert RosettaModel AST roots into ReactFlow nodes and edges.

Each graph node's `data` IS the pure domain payload (AST fields only);
UI/editor metadata (namespace, errors, isReadOnly, …) lives on `node.meta`.
```ts
astToModel(models: unknown, options?: AstToModelOptions): AstToModelResult
```
**Parameters:**
- `models: unknown`
- `options: AstToModelOptions` (optional)
**Returns:** `AstToModelResult`

### `modelsToAst`
Convert graph nodes and edges to serializer-compatible model objects.
Groups nodes by namespace and produces one model per namespace.
```ts
modelsToAst(nodes: TypeGraphNode[], edges: TypeGraphEdge[]): ModelOutput[]
```
**Parameters:**
- `nodes: TypeGraphNode[]`
- `edges: TypeGraphEdge[]`
**Returns:** `ModelOutput[]`

### `formatCardinality`
Format a RosettaCardinality model as a display string, e.g. `(1..*)`.
```ts
formatCardinality(card: CardinalityShape | undefined): string
```
**Parameters:**
- `card: CardinalityShape | undefined`
**Returns:** `string`

### `parseCardinality`
Parse a cardinality display string back to structured form.
```ts
parseCardinality(card?: string): CardinalityShape
```
**Parameters:**
- `card: string` (optional)
**Returns:** `CardinalityShape`

### `getTypeRefText`
Get the display name of a type reference (e.g. from a TypeCall).
```ts
getTypeRefText(typeCall: TypeCallShape | undefined): string | undefined
```
**Parameters:**
- `typeCall: TypeCallShape | undefined`
**Returns:** `string | undefined`

### `getRefText`
Get display text from a Reference-like object.
```ts
getRefText(ref: ReferenceShape | undefined): string | undefined
```
**Parameters:**
- `ref: ReferenceShape | undefined`
**Returns:** `string | undefined`

### `annotationsToDisplay`
Convert Dehydrated&lt;AnnotationRef&gt;[] to display-friendly objects.
```ts
annotationsToDisplay(annotations: AnnotationRefShape[] | undefined): AnnotationDisplayInfo[]
```
**Parameters:**
- `annotations: AnnotationRefShape[] | undefined`
**Returns:** `AnnotationDisplayInfo[]`

### `conditionsToDisplay`
Convert condition models to display-friendly objects.
```ts
conditionsToDisplay(conditions: ConditionShape[] | undefined, postConditions?: ConditionShape[]): ConditionDisplayInfo[]
```
**Parameters:**
- `conditions: ConditionShape[] | undefined`
- `postConditions: ConditionShape[]` (optional)
**Returns:** `ConditionDisplayInfo[]`

### `resolveNodeKind`
Resolve the React-Flow node-kind (`'data' | 'choice' | 'enum' | ...`) for
a node or its data payload.

Accepts either a React-Flow node (`{ data }`) or the inner `data` payload
directly, and resolves via `data.$type` alone. `$type` is guaranteed on
every node since the typeKind→$type unification (Phase 2 curated-serializer
fix), so the former `node.type` fallback arm is retired. Unrecognised or
`$type`-less inputs degrade to the `'data'` last-resort default.

Use this helper instead of indexing `AST_TYPE_TO_NODE_TYPE` directly.
```ts
resolveNodeKind(nodeOrData: unknown): string
```
**Parameters:**
- `nodeOrData: unknown`
**Returns:** `string`

### `buildStructureGraph`
```ts
buildStructureGraph(doc: AdapterDocument, opts: BuildOptions): StructureGraphInput
```
**Parameters:**
- `doc: AdapterDocument`
- `opts: BuildOptions`
**Returns:** `StructureGraphInput`

### `expressionScopeFromEntries`
Presentation groups for canonical core scope descriptions.
```ts
expressionScopeFromEntries(entries: readonly ExpressionScopeEntry[]): FunctionScope
```
**Parameters:**
- `entries: readonly ExpressionScopeEntry[]`
**Returns:** `FunctionScope`
