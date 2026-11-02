# Classes

## generated

### `DuplicateKeyError`
*extends `Error`*
```ts
constructor(key: string): DuplicateKeyError
```
**Properties:**
- `key: string`
- `name: string`
- `message: string`
- `stack: string` (optional)
- `cause: unknown` (optional)
**Methods:**
- `isError(error: unknown): error is Error` — Indicates whether the argument provided is a built-in Error instance or not.
