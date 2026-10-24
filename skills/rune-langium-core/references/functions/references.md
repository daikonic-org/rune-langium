# Functions

## references

### `declarationDispatch`
Selector text is stable before linking; resolving it here would recursively enter scope construction.
```ts
declarationDispatch(node: AstNode): string | undefined
```
**Parameters:**
- `node: AstNode`
**Returns:** `string | undefined`

### `setProjectDocumentModel`
Hosts explicitly assign document ownership; core does not infer model identity from names or namespaces.
```ts
setProjectDocumentModel(services: LangiumCoreServices, uri: URI, model: string): void
```
**Parameters:**
- `services: LangiumCoreServices`
- `uri: URI`
- `model: string`

### `setProjectRedirects`
```ts
setProjectRedirects(services: LangiumCoreServices, redirects: DeclarationRedirects | undefined): void
```
**Parameters:**
- `services: LangiumCoreServices`
- `redirects: DeclarationRedirects | undefined`

### `invalidateProjectResolution`
A host must invalidate identity indexes whenever it replaces document roots.
```ts
invalidateProjectResolution(services: LangiumCoreServices): void
```
**Parameters:**
- `services: LangiumCoreServices`

### `clearProjectResolution`
```ts
clearProjectResolution(services: LangiumCoreServices): void
```
**Parameters:**
- `services: LangiumCoreServices`

### `hasProjectRedirects`
```ts
hasProjectRedirects(services: LangiumCoreServices): boolean
```
**Parameters:**
- `services: LangiumCoreServices`
**Returns:** `boolean`

### `getEffectiveProjectDeclaration`
All consumers select through the same generation-local declaration targets as core linking.
```ts
getEffectiveProjectDeclaration(node: AstNode): AstNode | undefined
```
**Parameters:**
- `node: AstNode`
**Returns:** `AstNode | undefined`

### `projectDeclarationIdentity`
```ts
projectDeclarationIdentity(services: LangiumCoreServices, node: AstNode): { model: string; namespace: string; kind: string; name: string; dispatch?: string } | undefined
```
**Parameters:**
- `services: LangiumCoreServices`
- `node: AstNode`
**Returns:** `{ model: string; namespace: string; kind: string; name: string; dispatch?: string } | undefined`

### `redirectProjectNode`
A missing replacement stays unresolved; it must never fall back to the immutable original.
```ts
redirectProjectNode(services: LangiumCoreServices, node: AstNode): AstNode | undefined
```
**Parameters:**
- `services: LangiumCoreServices`
- `node: AstNode`
**Returns:** `AstNode | undefined`

### `redirectProjectScope`
Keep authored lookup names while navigation and linking descriptions point at the effective declaration.
```ts
redirectProjectScope(services: LangiumCoreServices, scope: Scope): Scope
```
**Parameters:**
- `services: LangiumCoreServices`
- `scope: Scope`
**Returns:** `Scope`

### `declarationKey`
Portable identity key; config and parser hosts share this exact representation.
```ts
declarationKey(identity: { model: string; namespace: string; kind: string; name: string; dispatch?: string }): string
```
**Parameters:**
- `identity: { model: string; namespace: string; kind: string; name: string; dispatch?: string }`
**Returns:** `string`
