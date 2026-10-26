# Functions

## preview-references

### `expandPreviewField`
Resolve one deferred object body without expanding its nested references.
```ts
expandPreviewField(field: PreviewField, definitions: Record<string, Pick<FormPreviewSchema, "fields" | "choiceArmPaths" | "sourceMap">> | undefined): PreviewField
```
**Parameters:**
- `field: PreviewField`
- `definitions: Record<string, Pick<FormPreviewSchema, "fields" | "choiceArmPaths" | "sourceMap">> | undefined`
**Returns:** `PreviewField`

### `metadataPreviewField`
Edit a metadata payload's value path while retaining its adjacent keys, scheme and references.
```ts
metadataPreviewField(field: PreviewField, value: unknown): PreviewField
```
**Parameters:**
- `field: PreviewField`
- `value: unknown`
**Returns:** `PreviewField`

### `previewTypeSymbol`
Canonical presentation identity shared by schema generation, resource bindings and layout consumers.
```ts
previewTypeSymbol(kind: string, targetId: string): string | undefined
```
**Parameters:**
- `kind: string`
- `targetId: string`
**Returns:** `string | undefined`
