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
