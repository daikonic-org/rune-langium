# Functions

## serializer

### `compactLspModelJson`
Keep semantic AST data and declaration ranges, without dependency token spans.
```ts
compactLspModelJson(json: string): string
```
**Parameters:**
- `json: string`
**Returns:** `string`

### `readLspModelMetadata`
Read canonical import and resolved-reference edges, including function bodies.
```ts
readLspModelMetadata(json: string): { namespace?: string; sourceUri?: string; imports: string[]; references: string[] }
```
**Parameters:**
- `json: string`
**Returns:** `{ namespace?: string; sourceUri?: string; imports: string[]; references: string[] }`

### `runeBigIntReplacer`
Canonical BigInt JSON replacer for Rune wire serialization: bigint → Number.
Chosen so EVERY serialization path agrees on one policy (closing the historical
Number-vs-String divergence). NOTE: Number(bigint) is lossy above 2^53; this
matches the pre-existing AST serialize path and Rosetta models large numerics as
BigDecimal/string, not bigint.
```ts
runeBigIntReplacer(_key: string, value: unknown): unknown
```
**Parameters:**
- `_key: string`
- `value: unknown`
**Returns:** `unknown`

### `serializeRuneModel`
Serialize a Rune AST model to its canonical wire JSON string.
```ts
serializeRuneModel(serializer: JsonSerializer, model: AstNode): string
```
**Parameters:**
- `serializer: JsonSerializer`
- `model: AstNode`
**Returns:** `string`

### `preserveCstText`
Copy `$cstNode.text -&gt; $cstText` for condition/expression-bearing AST parts
BEFORE `JsonSerializer.serialize`, because `$cstNode` is non-serializable
(circular) and the serializer drops it — yet the visual-editor's expression
cells need the original source text after the JSON round-trip.

Walks Function shortcuts/conditions/operations/postConditions and Data/Choice
conditions, copying both the part's and its `expression`'s CST text. Single
source of truth shared by the browser parse worker and the server parse
function (previously duplicated, byte-identical, in both — V7).

**Retained (Task 9 / CST-reuse eval):** Though `$cstRange` is now stamped on
all nodes during hydration, visual-editor expression consumers (FunctionForm,
model-helpers, etc.) cannot access originalSourceByNamespace to slice via offsets—
they are across a source-less boundary post-serialization. Keep `preserveCstText`.
```ts
preserveCstText(model: any): void
```
**Parameters:**
- `model: any`

### `deserializeRuneModel`
Deserialize a serialized Rune AST JSON string back to a `RosettaModel`.
```ts
deserializeRuneModel(services: HydrateServices, json: string): RosettaModel
```
**Parameters:**
- `services: HydrateServices`
- `json: string`
**Returns:** `RosettaModel`

### `hydrateModelDocument`
Deserialize a serialized Rune AST and build a `LangiumDocument`, optionally
registering it. `'none'` builds without registering (a later
`DocumentBuilder.build` will); `'always'` registers unconditionally;
`'idempotent'` returns an existing document for `uri` if present, else
registers the new one. Worker-local concerns (accumulators, deferred-json
eviction) stay at the call site. (V9 — single source of truth.)
```ts
hydrateModelDocument(services: HydrateServices, uri: string | URI, json: string, options: HydrateOptions): { model: RosettaModel; document: LangiumDocument }
```
**Parameters:**
- `services: HydrateServices`
- `uri: string | URI`
- `json: string`
- `options: HydrateOptions`
**Returns:** `{ model: RosettaModel; document: LangiumDocument }`

### `hydrateModelDocuments`
Hydrate and link one shared object graph, regardless of reference depth or input order.
```ts
hydrateModelDocuments(services: HydrateServices & { RuneDsl: { serializer: { JsonSerializer: Pick<RuneJsonSerializer, "deserializeModels"> } }; shared: { workspace: { LangiumDocuments: { deleteDocument: any } } } }, entries: readonly { uri: string | URI; json: string }[]): { model: RosettaModel; document: LangiumDocument }[]
```
**Parameters:**
- `services: HydrateServices & { RuneDsl: { serializer: { JsonSerializer: Pick<RuneJsonSerializer, "deserializeModels"> } }; shared: { workspace: { LangiumDocuments: { deleteDocument: any } } } }`
- `entries: readonly { uri: string | URI; json: string }[]`
**Returns:** `{ model: RosettaModel; document: LangiumDocument }[]`

### `assertValidDocuments`
Publication requires syntax-correct documents with every reference linked.
```ts
assertValidDocuments(documents: readonly LangiumDocument<AstNode>[]): void
```
**Parameters:**
- `documents: readonly LangiumDocument<AstNode>[]`

### `relinkReference`
Rebuild authored references through Langium's authoritative scope/link boundary.
```ts
relinkReference(services: LangiumCoreServices, container: AstNode, property: string, reference: Reference<AstNode> | MultiReference<AstNode>): Reference<AstNode> | MultiReference<AstNode>
```
**Parameters:**
- `services: LangiumCoreServices`
- `container: AstNode`
- `property: string`
- `reference: Reference<AstNode> | MultiReference<AstNode>`
**Returns:** `Reference<AstNode> | MultiReference<AstNode>`

### `relinkModelReferences`
Dependency snapshots must stay relinkable after live edits or a project-context transition.
```ts
relinkModelReferences(services: LangiumCoreServices, model: AstNode): void
```
**Parameters:**
- `services: LangiumCoreServices`
- `model: AstNode`
