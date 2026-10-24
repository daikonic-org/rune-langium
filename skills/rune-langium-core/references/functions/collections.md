# Functions

## collections

### `indexById`
Build an id→item Map, insertion order preserved. Defaults the key to `item.id`.
```ts
indexById<T>(items: readonly T[]): Map<string, T>
```
**Parameters:**
- `items: readonly T[]`
**Returns:** `Map<string, T>`
**Overloads:**
```ts
indexById<T>(items: readonly T[], key: (item: T) => string): Map<string, T>
```

### `fromIndex`
Derive the value array from an id→item Map (insertion order).
```ts
fromIndex<T>(map: ReadonlyMap<string, T>): T[]
```
**Parameters:**
- `map: ReadonlyMap<string, T>`
**Returns:** `T[]`
