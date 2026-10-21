# Functions

## layout

### `computeLayout`
Compute layout positions for ReactFlow nodes using dagre.

Returns a new array of nodes with updated positions.
Does not mutate the input.
```ts
computeLayout(nodes: TypeGraphNode[], edges: TypeGraphEdge[], options?: LayoutOptions): TypeGraphNode[]
```
**Parameters:**
- `nodes: TypeGraphNode[]`
- `edges: TypeGraphEdge[]`
- `options: LayoutOptions` (optional)
**Returns:** `TypeGraphNode[]`

### `computeLayoutIncremental`
Compute layout with cache-first strategy.

For incremental visibility changes (toggling a single namespace),
nodes with cached positions reuse them. Only nodes without cached
positions trigger a full dagre run.

When the ratio of uncached nodes is small (&lt;30%), we place cached
nodes at their old positions and only run dagre for the new ones,
offsetting them near related cached nodes.

When the ratio is large (&gt;=30%), we run a full dagre layout and
update the cache.
```ts
computeLayoutIncremental(nodes: TypeGraphNode[], edges: TypeGraphEdge[], options?: LayoutOptions): TypeGraphNode[]
```
**Parameters:**
- `nodes: TypeGraphNode[]`
- `edges: TypeGraphEdge[]`
- `options: LayoutOptions` (optional)
**Returns:** `TypeGraphNode[]`

### `clearLayoutCache`
Clear the entire position cache (call on model reload).
```ts
clearLayoutCache(): void
```

### `computeLayoutAsync`
Compute layout asynchronously.

Prefers a Web Worker for true off-main-thread execution.
Falls back to requestIdleCallback-based yielding on the main thread.

Returns null if a newer layout request superseded this one.
```ts
computeLayoutAsync(nodes: TypeGraphNode[], edges: TypeGraphEdge[], options?: LayoutOptions): Promise<TypeGraphNode[] | null>
```
**Parameters:**
- `nodes: TypeGraphNode[]`
- `edges: TypeGraphEdge[]`
- `options: LayoutOptions` (optional)
**Returns:** `Promise<TypeGraphNode[] | null>`

### `cancelAsyncLayout`
Cancel any in-flight async layout.
```ts
cancelAsyncLayout(): void
```

### `computeGroupedLayout`
Layout each group independently with dagre, then arrange
groups in a grid pattern.
```ts
computeGroupedLayout(nodes: TypeGraphNode[], edges: TypeGraphEdge[], options?: LayoutOptions): TypeGraphNode[]
```
**Parameters:**
- `nodes: TypeGraphNode[]`
- `edges: TypeGraphEdge[]`
- `options: LayoutOptions` (optional)
**Returns:** `TypeGraphNode[]`

### `findInheritanceGroups`
Find inheritance-connected groups among the given nodes.
```ts
findInheritanceGroups(nodes: TypeGraphNode[], edges: TypeGraphEdge[]): GroupInfo[]
```
**Parameters:**
- `nodes: TypeGraphNode[]`
- `edges: TypeGraphEdge[]`
**Returns:** `GroupInfo[]`
