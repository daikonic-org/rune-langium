# Functions

## store

### `isTypeNodeId`
Whether a graph-node id names a declaration valid in a Rune type reference.
```ts
isTypeNodeId(nodeId: string): boolean
```
**Parameters:**
- `nodeId: string`
**Returns:** `boolean`

### `makeNodeId`
Build a kind-aware graph-node id from a Rune qualified name and AST kind.
```ts
makeNodeId(namespace: string, name: string, kind?: string): string
```
**Parameters:**
- `namespace: string`
- `name: string`
- `kind: string` (optional)
**Returns:** `string`

### `nameFromNodeId`
The trailing simple name of a node id (everything after the last dot).
```ts
nameFromNodeId(nodeId: string): string
```
**Parameters:**
- `nodeId: string`
**Returns:** `string`

### `qualifiedNameFromNodeId`
Recover the Rune qualified name from a graph-node id.
```ts
qualifiedNameFromNodeId(nodeId: string): string
```
**Parameters:**
- `nodeId: string`
**Returns:** `string`

### `splitNodeId`
Split a node id into `{ namespace, name }` by the last dot; namespace is '' when absent.
```ts
splitNodeId(nodeId: string): { namespace: string; name: string }
```
**Parameters:**
- `nodeId: string`
**Returns:** `{ namespace: string; name: string }`

### `selectNodeRepository`
Returns a node repository derived from `nodesById`, memoized on the Map's
identity. The store swaps the Map reference on every `mutateGraph`, so a new
reference (post-reconciliation) yields a fresh repository; an unchanged
reference returns the cached instance.
```ts
selectNodeRepository(nodesById: ReadonlyMap<string, TypeGraphNode>): NodeRepository
```
**Parameters:**
- `nodesById: ReadonlyMap<string, TypeGraphNode>`
**Returns:** `NodeRepository`
