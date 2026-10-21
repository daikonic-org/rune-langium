# Functions

## utils

### `selectionState`
Returns the checkbox state for a collection of selection IDs.
```ts
selectionState(ids: readonly string[], selected: ReadonlySet<string>): boolean | "indeterminate"
```
**Parameters:**
- `ids: readonly string[]`
- `selected: ReadonlySet<string>`
**Returns:** `boolean | "indeterminate"`

### `toggleVisible`
Adds or removes only the supplied IDs, preserving every other selection.
```ts
toggleVisible(ids: readonly string[], selected: ReadonlySet<string>, checked: boolean): Set<string>
```
**Parameters:**
- `ids: readonly string[]`
- `selected: ReadonlySet<string>`
- `checked: boolean`
**Returns:** `Set<string>`

### `buildTypeOptions`
Projects the editor's canonical node repository into type-selector options.

Node ids stay qualified so same-named declarations from separate namespaces
remain independently selectable. Deferred repository entries are included
because they are valid workspace reference targets before hydration.
```ts
buildTypeOptions(repository: NodeRepository, includeBuiltins: boolean): TypeOption[]
```
**Parameters:**
- `repository: NodeRepository`
- `includeBuiltins: boolean` — default: `true`
**Returns:** `TypeOption[]`
