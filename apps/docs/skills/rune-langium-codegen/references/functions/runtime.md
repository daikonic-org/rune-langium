# Functions

## runtime

### `createProjectBindingRegistry`
Prepared data and installed callbacks only; this module never reads configuration or loads code.
```ts
createProjectBindingRegistry(input: { codeLists?: readonly ProjectCodeListBinding[]; implementations?: readonly ProjectImplementationBinding[]; unavailableFunctions?: readonly { symbol: { model: string; namespace: string; kind: string; name: string; dispatch?: string }; reason: string }[] }): { implementationSymbols: { model: string; namespace: string; kind: string; name: string; dispatch?: string }[]; implementationStatus: any; codeList: any; codeListForType: any; validateCode: any; invokeByKey: (key: string, args: readonly unknown[]) => unknown; invoke: any }
```
**Parameters:**
- `input: { codeLists?: readonly ProjectCodeListBinding[]; implementations?: readonly ProjectImplementationBinding[]; unavailableFunctions?: readonly { symbol: { model: string; namespace: string; kind: string; name: string; dispatch?: string }; reason: string }[] }`
**Returns:** `{ implementationSymbols: { model: string; namespace: string; kind: string; name: string; dispatch?: string }[]; implementationStatus: any; codeList: any; codeListForType: any; validateCode: any; invokeByKey: (key: string, args: readonly unknown[]) => unknown; invoke: any }`

### `applyProjectPreviewBindings`
Transform every finite definition too, so deferred object expansion uses the same choices.
```ts
applyProjectPreviewBindings(schema: FormPreviewSchema, bindings: { implementationSymbols: { model: string; namespace: string; kind: string; name: string; dispatch?: string }[]; implementationStatus: any; codeList: any; codeListForType: any; validateCode: any; invokeByKey: (key: string, args: readonly unknown[]) => unknown; invoke: any }): FormPreviewSchema
```
**Parameters:**
- `schema: FormPreviewSchema`
- `bindings: { implementationSymbols: { model: string; namespace: string; kind: string; name: string; dispatch?: string }[]; implementationStatus: any; codeList: any; codeListForType: any; validateCode: any; invokeByKey: (key: string, args: readonly unknown[]) => unknown; invoke: any }`
**Returns:** `FormPreviewSchema`

### `validateProjectPreviewBindings`
Resource constraints supplement the generated Rune validator; missing data is an availability error.
```ts
validateProjectPreviewBindings(schema: FormPreviewSchema, data: unknown, bindings: { implementationSymbols: { model: string; namespace: string; kind: string; name: string; dispatch?: string }[]; implementationStatus: any; codeList: any; codeListForType: any; validateCode: any; invokeByKey: (key: string, args: readonly unknown[]) => unknown; invoke: any }): { path: string; message: string }[]
```
**Parameters:**
- `schema: FormPreviewSchema`
- `data: unknown`
- `bindings: { implementationSymbols: { model: string; namespace: string; kind: string; name: string; dispatch?: string }[]; implementationStatus: any; codeList: any; codeListForType: any; validateCode: any; invokeByKey: (key: string, args: readonly unknown[]) => unknown; invoke: any }`
**Returns:** `{ path: string; message: string }[]`

### `projectBindingNames`
Names cannot collide with authored Rune identifiers and remain unique in single-file bundles.
```ts
projectBindingNames(namespace: string): { invoke: string; bind: string }
```
**Parameters:**
- `namespace: string`
**Returns:** `{ invoke: string; bind: string }`

### `projectBindingHeader`
```ts
projectBindingHeader(namespace: string): string
```
**Parameters:**
- `namespace: string`
**Returns:** `string`

### `bindGeneratedProjectModule`
Attach a prepared registry to a newly loaded generated module; no global registry crosses projects.
```ts
bindGeneratedProjectModule(module: Readonly<Record<string, unknown>>, bindings: { implementationSymbols: { model: string; namespace: string; kind: string; name: string; dispatch?: string }[]; implementationStatus: any; codeList: any; codeListForType: any; validateCode: any; invokeByKey: (key: string, args: readonly unknown[]) => unknown; invoke: any }): void
```
**Parameters:**
- `module: Readonly<Record<string, unknown>>`
- `bindings: { implementationSymbols: { model: string; namespace: string; kind: string; name: string; dispatch?: string }[]; implementationStatus: any; codeList: any; codeListForType: any; validateCode: any; invokeByKey: (key: string, args: readonly unknown[]) => unknown; invoke: any }`

### `projectCodeListForAlias`
One adapter guard shared by the graph and all resource-aware generators.
```ts
projectCodeListForAlias(alias: RosettaTypeAlias, resources: Pick<{ implementationSymbols: { model: string; namespace: string; kind: string; name: string; dispatch?: string }[]; implementationStatus: any; codeList: any; codeListForType: any; validateCode: any; invokeByKey: (key: string, args: readonly unknown[]) => unknown; invoke: any }, "codeListForType"> | undefined): readonly { value: string; label: string }[] | undefined
```
**Parameters:**
- `alias: RosettaTypeAlias`
- `resources: Pick<{ implementationSymbols: { model: string; namespace: string; kind: string; name: string; dispatch?: string }[]; implementationStatus: any; codeList: any; codeListForType: any; validateCode: any; invokeByKey: (key: string, args: readonly unknown[]) => unknown; invoke: any }, "codeListForType"> | undefined`
**Returns:** `readonly { value: string; label: string }[] | undefined`
