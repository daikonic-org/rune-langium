# Functions

## Visual Editor

### `createEditorStore`
Create an isolated zustand editor store instance.

Returns a new zustand `useStore` hook bound to a fresh store instance.
Use this when embedding multiple independent `RuneTypeGraph` components
in the same React tree — each graph must own a separate store.

The store is wrapped with `zundo` temporal middleware for undo/redo support.
Access undo/redo via `useEditorStore.temporal`.
```ts
createEditorStore(overrides?: Partial<EditorState>): UseBoundStore<Write<StoreApi<EditorStore>, { temporal: StoreApi }>>
```
**Parameters:**
- `overrides: Partial<EditorState>` (optional) — Optional partial initial state to override defaults.
**Returns:** `UseBoundStore<Write<StoreApi<EditorStore>, { temporal: StoreApi }>>` — A zustand `useStore` hook bound to the new isolated store.
