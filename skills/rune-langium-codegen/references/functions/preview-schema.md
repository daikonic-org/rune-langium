# Functions

## preview-schema

### `normalizePreviewInputs`
Adapt plain form values to the generated function's metadata-bearing input contract.
```ts
normalizePreviewInputs(documents: LangiumDocument<AstNode>[], targetId: string, inputs: Record<string, unknown>, wrappers: Record<FieldMetadataKind, (value: unknown) => unknown>): Record<string, unknown>
```
**Parameters:**
- `documents: LangiumDocument<AstNode>[]`
- `targetId: string`
- `inputs: Record<string, unknown>`
- `wrappers: Record<FieldMetadataKind, (value: unknown) => unknown>`
**Returns:** `Record<string, unknown>`

### `adaptPreviewData`
Normalize canonical object values using the active linked declarations.
```ts
adaptPreviewData(documents: LangiumDocument<AstNode>[], targetId: string, value: unknown): { data: unknown; sourcePath: (path: string) => string }
```
**Parameters:**
- `documents: LangiumDocument<AstNode>[]`
- `targetId: string`
- `value: unknown`
**Returns:** `{ data: unknown; sourcePath: (path: string) => string }`

### `projectRuneJsonData`
Project canonical Choice slots and concrete Data types before Rune wire metadata encoding.
```ts
projectRuneJsonData(documents: LangiumDocument<AstNode>[], targetId: string, value: unknown): unknown
```
**Parameters:**
- `documents: LangiumDocument<AstNode>[]`
- `targetId: string`
- `value: unknown`
**Returns:** `unknown`
