# Functions

## validation

### `detectCircularInheritance`
Detect whether setting `childId extends parentId` would create a cycle.

Walks the inheritance chain from parentId upward; if it reaches childId,
a cycle exists.
```ts
detectCircularInheritance(childId: string, parentId: string, edges: TypeGraphEdge[]): boolean
```
**Parameters:**
- `childId: string`
- `parentId: string`
- `edges: TypeGraphEdge[]`
**Returns:** `boolean`

### `detectDuplicateName`
Check if a name already exists in the given namespace.

When `nodeId` is provided, checks for duplicate attribute names within
that node instead of type names.
```ts
detectDuplicateName(name: string, namespace: string, nodes: TypeGraphNode[], nodeId?: string): boolean
```
**Parameters:**
- `name: string`
- `namespace: string`
- `nodes: TypeGraphNode[]`
- `nodeId: string` (optional)
**Returns:** `boolean`

### `validateCardinality`
Validate a cardinality string.

Returns null if valid, or an error message string if invalid.
Accepts formats: "inf..sup", "(inf..sup)", "inf..*", "(inf..*)"
```ts
validateCardinality(input: string): string | null
```
**Parameters:**
- `input: string`
**Returns:** `string | null`

### `detectDuplicateEnumValue`
Check if an enum value name already exists within the specified enum node.
```ts
detectDuplicateEnumValue(valueName: string, nodeId: string, nodes: TypeGraphNode[]): boolean
```
**Parameters:**
- `valueName: string`
- `nodeId: string`
- `nodes: TypeGraphNode[]`
**Returns:** `boolean`

### `validateNotEmpty`
Validate that a name is non-empty after trimming whitespace.

Returns null if valid, or an error message string if invalid.
```ts
validateNotEmpty(name: string, context: string): string | null
```
**Parameters:**
- `name: string`
- `context: string` — default: `'Name'`
**Returns:** `string | null`

### `validateIdentifier`
Validate that a name conforms to Rune DSL identifier rules.

Returns null if valid, or an error message string if invalid.
```ts
validateIdentifier(name: string): string | null
```
**Parameters:**
- `name: string`
**Returns:** `string | null`

### `validateExpression`
Validate expression syntax with the canonical Rune parser, without linking workspace symbols.
```ts
validateExpression(expression: string): ExpressionValidationResult
```
**Parameters:**
- `expression: string` — The expression text to validate.
**Returns:** `ExpressionValidationResult` — Validation result with error message if invalid.

### `validateGraph`
Run all validations on the current graph state and return errors.
```ts
validateGraph(nodes: TypeGraphNode[], edges: TypeGraphEdge[]): ValidationError[]
```
**Parameters:**
- `nodes: TypeGraphNode[]`
- `edges: TypeGraphEdge[]`
**Returns:** `ValidationError[]`
