# Functions

## utils

### `getNodeSourceRegion`
Original UTF-16 range, shared by parsed and serialized model consumers.
```ts
getNodeSourceRegion(node: LocatedNode): SourceRegion
```
**Parameters:**
- `node: LocatedNode`
**Returns:** `SourceRegion`

### `getFunctionImplementationRegion`
Implementation range excludes the signature and retains preceding body comments.
```ts
getFunctionImplementationRegion(func: RosettaFunction | Dehydrated<RosettaFunction>, source: string): SourceRegion
```
**Parameters:**
- `func: RosettaFunction | Dehydrated<RosettaFunction>`
- `source: string`
**Returns:** `SourceRegion`

### `getExpressionRegions`
Root expressions in grammar order; indexes address their original owner arrays.
```ts
getExpressionRegions(owner: Data | Dehydrated<Data> | RosettaFunction | Dehydrated<RosettaFunction>): readonly Readonly<{ region: SourceRegion; kind: "alias" | "precondition" | "operation" | "postcondition"; index: number; expression: RosettaExpression | Dehydrated<RosettaExpression> }>[]
```
**Parameters:**
- `owner: Data | Dehydrated<Data> | RosettaFunction | Dehydrated<RosettaFunction>`
**Returns:** `readonly Readonly<{ region: SourceRegion; kind: "alias" | "precondition" | "operation" | "postcondition"; index: number; expression: RosettaExpression | Dehydrated<RosettaExpression> }>[]`

### `findExpressionOwner`
Resolve declaration identity, using the unique base for a function dispatch group.
```ts
findExpressionOwner(model: Pick<RosettaModel, "elements">, identity: { name: string; kind?: string }): Data | RosettaFunction | undefined
```
**Parameters:**
- `model: Pick<RosettaModel, "elements">`
- `identity: { name: string; kind?: string }`
**Returns:** `Data | RosettaFunction | undefined`

### `getExpressionOwners`
Unique owners across files, grouped by namespace, declaration name and kind.
```ts
getExpressionOwners(models: readonly Pick<RosettaModel, "name" | "elements">[]): (Data | RosettaFunction)[]
```
**Parameters:**
- `models: readonly Pick<RosettaModel, "name" | "elements">[]`
**Returns:** `(Data | RosettaFunction)[]`

### `isOptional`
Whether the cardinality allows zero occurrences (inf == 0).
```ts
isOptional(card: RosettaCardinality): boolean
```
**Parameters:**
- `card: RosettaCardinality`
**Returns:** `boolean`

### `isSingular`
Whether the cardinality forces exactly one (inf == 1 && sup == 1).
```ts
isSingular(card: RosettaCardinality): boolean
```
**Parameters:**
- `card: RosettaCardinality`
**Returns:** `boolean`

### `isPlural`
Whether the cardinality allows more than one instance (sup &gt; 1 or unbounded).
```ts
isPlural(card: RosettaCardinality): boolean
```
**Parameters:**
- `card: RosettaCardinality`
**Returns:** `boolean`

### `isRequired`
Whether the cardinality is required (inf &gt;= 1).
```ts
isRequired(card: RosettaCardinality): boolean
```
**Parameters:**
- `card: RosettaCardinality`
**Returns:** `boolean`

### `toConstraintString`
Produce a human-readable constraint string like "(1..1)", "(0..*)", etc.
```ts
toConstraintString(card: RosettaCardinality): string
```
**Parameters:**
- `card: RosettaCardinality`
**Returns:** `string`

### `getOptions`
Get the list of choice options from a Choice type.
```ts
getOptions(choice: Choice): ChoiceOption[]
```
**Parameters:**
- `choice: Choice`
**Returns:** `ChoiceOption[]`

### `getEffectiveConditions`
Get conditions that are defined on the Data types within a Choice's options.
Since Choice options reference type calls, we return the conditions
from the parent Choice's enclosing Data types (if any).
```ts
getEffectiveConditions(choice: Choice): Condition[]
```
**Parameters:**
- `choice: Choice`
**Returns:** `Condition[]`

### `getChoiceOptionPaths`
Declared option paths, including nested choices; data fields are not choice arms.
```ts
getChoiceOptionPaths(choice: Choice, seen: Set<Choice>): ChoiceOption[][]
```
**Parameters:**
- `choice: Choice`
- `seen: Set<Choice>` — default: `...`
**Returns:** `ChoiceOption[][]`

### `choiceOptionFieldName`
```ts
choiceOptionFieldName(optionTypeName: string): string
```
**Parameters:**
- `optionTypeName: string`
**Returns:** `string`

### `hasGeneratedInput`
Check if an expression node has a generated (synthetic) input marker.
This is used during code generation to track inputs that were
automatically inferred rather than explicitly declared.
```ts
hasGeneratedInput(node: RosettaExpression): boolean
```
**Parameters:**
- `node: RosettaExpression`
**Returns:** `boolean`

### `setGeneratedInputIfAbsent`
Set the generated input marker on an expression node if not already set.
Returns `true` if the marker was set, `false` if it was already present.
```ts
setGeneratedInputIfAbsent(node: RosettaExpression): boolean
```
**Parameters:**
- `node: RosettaExpression`
**Returns:** `boolean`

### `getFunctionSignature`
Resolve a dispatch overload to its namespace's base declaration.
```ts
getFunctionSignature(func: RosettaFunction, declarations?: Iterable<RosettaFunction, any, any>): RosettaFunction
```
**Parameters:**
- `func: RosettaFunction`
- `declarations: Iterable<RosettaFunction, any, any>` (optional)
**Returns:** `RosettaFunction`

### `getOperationArgument`
Resolve an explicit operation input or the input of its enclosing pipeline.
```ts
getOperationArgument(expr: RosettaExpression): RosettaExpression | undefined
```
**Parameters:**
- `expr: RosettaExpression`
**Returns:** `RosettaExpression | undefined`

### `resolveOperationType`
Shared operator result-type propagation; symbol lookup belongs to the caller.
```ts
resolveOperationType<T>(expr: RosettaExpression, resolve: (expression: RosettaExpression) => T | undefined, resolveType?: (type: RosettaType) => T | undefined, resolveIntrinsic?: (name: IntrinsicTypeName) => T | undefined): T | undefined
```
**Parameters:**
- `expr: RosettaExpression`
- `resolve: (expression: RosettaExpression) => T | undefined`
- `resolveType: (type: RosettaType) => T | undefined` (optional)
- `resolveIntrinsic: (name: IntrinsicTypeName) => T | undefined` (optional)
**Returns:** `T | undefined`

### `resolveTypeAliases`
Resolve a declared type without looping through recursive aliases.
```ts
resolveTypeAliases(type: RosettaType | undefined, seen: Set<RosettaType>): RosettaType | undefined
```
**Parameters:**
- `type: RosettaType | undefined`
- `seen: Set<RosettaType>` — default: `...`
**Returns:** `RosettaType | undefined`

### `getFunctionInputs`
Get effective input attributes, including inheritance and dispatch signatures.
```ts
getFunctionInputs(func: RosettaFunction, seen: Set<RosettaFunction>, declarations?: Iterable<RosettaFunction, any, any>): Attribute[]
```
**Parameters:**
- `func: RosettaFunction`
- `seen: Set<RosettaFunction>` — default: `...`
- `declarations: Iterable<RosettaFunction, any, any>` (optional)
**Returns:** `Attribute[]`

### `getFunctionOutput`
Get the effective output attribute, including dispatch signatures and inheritance.
```ts
getFunctionOutput(func: RosettaFunction, seen: Set<RosettaFunction>): Attribute | undefined
```
**Parameters:**
- `func: RosettaFunction`
- `seen: Set<RosettaFunction>` — default: `...`
**Returns:** `Attribute | undefined`

### `getEnumValues`
Effective enum members, with child declarations overriding inherited names.
```ts
getEnumValues(enumeration: RosettaEnumeration): RosettaEnumValue[]
```
**Parameters:**
- `enumeration: RosettaEnumeration`
**Returns:** `RosettaEnumValue[]`

### `getEnumValueLiteral`
The member identifier and the external code are distinct; displayName is presentation only.
```ts
getEnumValueLiteral(value: RosettaEnumValue): string
```
**Parameters:**
- `value: RosettaEnumValue`
**Returns:** `string`

### `getExpressionScope`
Describe the existing language-service scope at an expression, without a second resolver.
```ts
getExpressionScope(expression: RosettaExpression, services: RuneDslServices): ExpressionScopeEntry[]
```
**Parameters:**
- `expression: RosettaExpression`
- `services: RuneDslServices`
**Returns:** `ExpressionScopeEntry[]`
