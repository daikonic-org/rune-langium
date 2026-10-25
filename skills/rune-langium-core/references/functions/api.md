# Functions

## api

### `getSourceComments`
Hidden comment tokens, in UTF-16 source coordinates; string literals are not comments.
```ts
getSourceComments(source: string): readonly SourceComment[]
```
**Parameters:**
- `source: string`
**Returns:** `readonly SourceComment[]`

### `getAnnotationDefinitions`
Scope facts from the actual linked references, without rebuilding import/name resolution.
```ts
getAnnotationDefinitions(owner: AstNode): Readonly<Record<string, AnnotationDefinitionIdentity>>
```
**Parameters:**
- `owner: AstNode`
**Returns:** `Readonly<Record<string, AnnotationDefinitionIdentity>>`
