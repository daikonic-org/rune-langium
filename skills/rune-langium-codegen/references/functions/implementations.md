# Functions

## implementations

### `resolveNativeImplementation`
Authored Rune bodies win. Match identity, annotation and signature before selecting a target body.
```ts
resolveNativeImplementation(func: RosettaFunction, language: string): NativeImplementationResolution | undefined
```
**Parameters:**
- `func: RosettaFunction`
- `language: string`
**Returns:** `NativeImplementationResolution | undefined`

### `nativeFunctionShape`
Exact linked signature, shared by catalog guards and the upstream coverage inventory.
```ts
nativeFunctionShape(func: RosettaFunction): NativeFunctionShape
```
**Parameters:**
- `func: RosettaFunction`
**Returns:** `NativeFunctionShape`

### `describeNativeFunction`
```ts
describeNativeFunction(shape: NativeFunctionShape): string
```
**Parameters:**
- `shape: NativeFunctionShape`
**Returns:** `string`
