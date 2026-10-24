# Functions

## options

### `resolveExcelSheets`
Resolve the effective sheet toggles from a partial/absent options block,
applying the schema defaults. Used by the emitter so a missing `excel`
option or a partial `sheets` object still produces a complete workbook.
```ts
resolveExcelSheets(options: { sheets?: Partial<{ types: boolean; enums: boolean; typeAliases: boolean; conditions: boolean }> } | undefined): { types: boolean; enums: boolean; typeAliases: boolean; conditions: boolean }
```
**Parameters:**
- `options: { sheets?: Partial<{ types: boolean; enums: boolean; typeAliases: boolean; conditions: boolean }> } | undefined`
**Returns:** `{ types: boolean; enums: boolean; typeAliases: boolean; conditions: boolean }`

### `validateTargetOptions`
```ts
validateTargetOptions(target: string, options: unknown): { value?: Record<string, unknown>; errors: string[] }
```
**Parameters:**
- `target: string`
- `options: unknown`
**Returns:** `{ value?: Record<string, unknown>; errors: string[] }`

### `getGeneratorCapabilities`
```ts
getGeneratorCapabilities(): readonly { id: string; available: boolean }[]
```
**Returns:** `readonly { id: string; available: boolean }[]`

### `getTargetLayouts`
```ts
getTargetLayouts(target: string): readonly string[]
```
**Parameters:**
- `target: string`
**Returns:** `readonly string[]`
