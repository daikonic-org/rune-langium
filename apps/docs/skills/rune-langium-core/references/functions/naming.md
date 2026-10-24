# Functions

## naming

### `qualifiedExportPath`
The canonical Langium scope key for a top-level exported element:
`${namespace}.${name}`. Namespaces are dot-joined identifiers and element
names are dotless (grammar `ValidID`), so the result is injective and the
last dot separates namespace from name. An empty namespace yields the bare
name (no leading dot).

This is the single source of truth for the dot qualified name. (The
visual-editor's `::` node id is a SEPARATE convention, retired in a later
phase — do not couple to it here.)
```ts
qualifiedExportPath(namespace: string, name: string): string
```
**Parameters:**
- `namespace: string`
- `name: string`
**Returns:** `string`

### `namespaceFromSource`
Extract the namespace from raw `.rosetta` source text. Returns `''` when no
`namespace` declaration is present (matching the historical callers).
```ts
namespaceFromSource(text: string): string
```
**Parameters:**
- `text: string`
**Returns:** `string`

### `namespaceFromModelName`
Normalize a `RosettaModel.name` value (which may be a plain string, a quoted
STRING-named namespace, or a `{ segments: string[] }` qualified-name object)
to its dotted string form. Returns `undefined` for null/unknown shapes; the
caller supplies any `''`/`'unknown'` fallback it needs.
```ts
namespaceFromModelName(name: unknown): string | undefined
```
**Parameters:**
- `name: unknown`
**Returns:** `string | undefined`

### `expandNamespaceWildcard`
Expand an exact name or dotted-prefix wildcard against known namespaces.
```ts
expandNamespaceWildcard(raw: string, allNamespaces: ReadonlySet<string>): string[]
```
**Parameters:**
- `raw: string`
- `allNamespaces: ReadonlySet<string>`
**Returns:** `string[]`

### `buildImportAliasMap`
One alias may intentionally contribute several namespace prefixes.
```ts
buildImportAliasMap(imports: readonly NamespaceImport[]): Map<string, string[]>
```
**Parameters:**
- `imports: readonly NamespaceImport[]`
**Returns:** `Map<string, string[]>`

### `importAliasCandidates`
Shared by language scopes and views; a real qualified name keeps precedence.
```ts
importAliasCandidates(name: string, aliases: ReadonlyMap<string, readonly string[]>): string[]
```
**Parameters:**
- `name: string`
- `aliases: ReadonlyMap<string, readonly string[]>`
**Returns:** `string[]`

### `buildImportScope`
File-local scope facts shared by language lookup and projected references.
```ts
buildImportScope(namespace: string, imports: readonly NamespaceImport[]): ImportScope
```
**Parameters:**
- `namespace: string`
- `imports: readonly NamespaceImport[]`
**Returns:** `ImportScope`

### `importScopeCandidates`
Ordered names for a file scope; bare fallback is for the language's outer scope.
```ts
importScopeCandidates(name: string, scope: ImportScope): string[]
```
**Parameters:**
- `name: string`
- `scope: ImportScope`
**Returns:** `string[]`
