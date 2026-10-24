# Functions

## projection

### `selectTypeScriptProjection`
Select recorded output; display availability is independent of inverse-lens coverage.
```ts
selectTypeScriptProjection(outputs: readonly GeneratorOutput[], subject: ProjectionSubject, kind: "function" | "condition", form: "body" | "declaration"): GeneratedProjection
```
**Parameters:**
- `outputs: readonly GeneratorOutput[]`
- `subject: ProjectionSubject`
- `kind: "function" | "condition"`
- `form: "body" | "declaration"` — default: `'declaration'`
**Returns:** `GeneratedProjection`

### `createPythonProjectionContext`
```ts
createPythonProjectionContext(documents: readonly LangiumDocument<AstNode>[], subject: ProjectionSubject): PythonProjectionContext
```
**Parameters:**
- `documents: readonly LangiumDocument<AstNode>[]`
- `subject: ProjectionSubject`
**Returns:** `PythonProjectionContext`

### `projectPythonFunction`
Complete implementation; the inverse Python lens retains its narrower expression contract.
```ts
projectPythonFunction(func: RosettaFunction, context: PythonProjectionContext): GeneratedProjection
```
**Parameters:**
- `func: RosettaFunction`
- `context: PythonProjectionContext`
**Returns:** `GeneratedProjection`

### `projectPythonCondition`
```ts
projectPythonCondition(condition: Condition, context: PythonProjectionContext): GeneratedProjection
```
**Parameters:**
- `condition: Condition`
- `context: PythonProjectionContext`
**Returns:** `GeneratedProjection`

### `generatePythonModule`
Standalone browser-safe Python source plus source-addressed display fragments.
```ts
generatePythonModule(documents: readonly LangiumDocument<AstNode>[]): PythonModule
```
**Parameters:**
- `documents: readonly LangiumDocument<AstNode>[]`
**Returns:** `PythonModule`

### `selectPythonProjection`
```ts
selectPythonProjection(module: PythonModule, subject: ProjectionSubject, kind: "function" | "condition", form: "body" | "declaration"): GeneratedProjection
```
**Parameters:**
- `module: PythonModule`
- `subject: ProjectionSubject`
- `kind: "function" | "condition"`
- `form: "body" | "declaration"` — default: `'declaration'`
**Returns:** `GeneratedProjection`

### `projectPythonExpression`
Forward generation is independent of the deliberately narrower inverse Python lens.
```ts
projectPythonExpression(expression: RosettaExpression, context: PythonProjectionContext): GeneratedProjection
```
**Parameters:**
- `expression: RosettaExpression`
- `context: PythonProjectionContext`
**Returns:** `GeneratedProjection`
