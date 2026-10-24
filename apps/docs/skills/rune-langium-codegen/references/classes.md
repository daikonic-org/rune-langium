# Classes

## runtime

### `ProjectBindingUnavailable`
*extends `Error`*
```ts
constructor(message?: string): ProjectBindingUnavailable
```
**Properties:**
- `name: string`
- `message: string`
- `stack: string` (optional)
- `cause: unknown` (optional)

## types

### `GeneratorError`
Thrown when strict mode is enabled and any error diagnostic is produced.
FR-022.
*extends `Error`*
```ts
constructor(message: string, diagnostics: GeneratorDiagnostic[]): GeneratorError
```
**Properties:**
- `diagnostics: GeneratorDiagnostic[]` — The diagnostics that caused this error.
- `name: string`
- `message: string`
- `stack: string` (optional)
- `cause: unknown` (optional)

## emit

### `GenericModelEmitter`
Parameterized `WholeModelEmitter` that wraps any `NamespaceEmitter`
plus a `LanguageProfile` (019 spec §3.2). Collapses the
"per-namespace then aggregate" pattern into one place so individual
targets only need to ship a NamespaceEmitter + a Profile.

Dispatch flow:
  1. Call the inner `NamespaceEmitter` for each namespace with
     `suppressBoilerplate: true` so shared runtime helpers are
     emitted once via the Profile's sidecar, not duplicated
     across per-namespace files.
  2. Resolve the layout (defaults to `'barrel'` here — the
     library default of `'per-namespace'` is handled one layer up
     in `resolveEmitter` before reaching this class).
  3. For `'single-file'`: check the Profile's `singleFileLimits`,
     then call `concatenate()`. Emit a fatal diagnostic if exceeded.
  4. For `'barrel'`: emit per-namespace outputs + the Profile's
     barrel + the Profile's sidecars.
*implements `WholeModelEmitter`*
```ts
constructor<T>(innerCtor: NamespaceEmitterConstructor, profile: LanguageProfile<T>): GenericModelEmitter<T>
```
**Methods:**
- `emit(walks: ReadonlyMap<string, NamespaceWalkResult>, registry: NamespaceRegistry, options: GeneratorOptions): Promise<GeneratorOutput[]>`
