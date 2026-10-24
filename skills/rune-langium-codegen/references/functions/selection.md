# Functions

## selection

### `collectDeclarationDependencies`
Direct declaration dependencies through the authoritative effective-reference port.
```ts
collectDeclarationDependencies(root: AstNode): readonly AstNode[]
```
**Parameters:**
- `root: AstNode`
**Returns:** `readonly AstNode[]`

### `declarationKey`
Stable, kind-aware identity for a selected top-level declaration.
```ts
declarationKey(declaration: ExportDeclarationSelection): string
```
**Parameters:**
- `declaration: ExportDeclarationSelection`
**Returns:** `string`

### `resolveExportSelection`
Resolve selected roots and return shallow document views without mutating the linked workspace.
```ts
resolveExportSelection(docs: LangiumDocument<AstNode>[], selection: ExportSelection): ResolvedExportSelection
```
**Parameters:**
- `docs: LangiumDocument<AstNode>[]`
- `selection: ExportSelection`
**Returns:** `ResolvedExportSelection`

### `unknownExportSelectionDiagnostics`
Shared diagnostic details for stale declaration or namespace export roots.
```ts
unknownExportSelectionDiagnostics(selection: Pick<ResolvedExportSelection, "unknown" | "unknownNamespaces">): { code: "unknown-export-selection"; message: string }[]
```
**Parameters:**
- `selection: Pick<ResolvedExportSelection, "unknown" | "unknownNamespaces">`
**Returns:** `{ code: "unknown-export-selection"; message: string }[]`

### `resolveEffectiveProjectTargetId`
Resolve a kind-qualified authored target through core's linked project identity.
```ts
resolveEffectiveProjectTargetId(docs: readonly LangiumDocument<AstNode>[], targetId: string, kind: string): string
```
**Parameters:**
- `docs: readonly LangiumDocument<AstNode>[]`
- `targetId: string`
- `kind: string`
**Returns:** `string`
