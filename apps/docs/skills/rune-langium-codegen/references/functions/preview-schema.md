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
