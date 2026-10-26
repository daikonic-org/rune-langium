# Functions

## components

### `KindBadge`
```ts
KindBadge(__namedParameters: KindBadgeProps): ReactElement
```
**Parameters:**
- `__namedParameters: KindBadgeProps`
**Returns:** `ReactElement`

### `useTypeNavigationMenu`
Targets must already be resolved by the owning link, tree or Structure adapter.
```ts
useTypeNavigationMenu(actions: TypeNavigationActions): { open: (event: MouseEvent, nodeId: string | undefined) => void; onKeyDown: (event: KeyboardEvent, nodeId: string | undefined) => void; menu: Element | null; targetProps: (nodeId: string | undefined, label?: string) => { onContextMenu: (event: MouseEvent) => void; onKeyDown: (event: KeyboardEvent) => void; role?: string; tabIndex?: number; aria-label?: string; aria-haspopup?: "menu" }; hasActions: boolean }
```
**Parameters:**
- `actions: TypeNavigationActions`
**Returns:** `{ open: (event: MouseEvent, nodeId: string | undefined) => void; onKeyDown: (event: KeyboardEvent, nodeId: string | undefined) => void; menu: Element | null; targetProps: (nodeId: string | undefined, label?: string) => { onContextMenu: (event: MouseEvent) => void; onKeyDown: (event: KeyboardEvent) => void; role?: string; tabIndex?: number; aria-label?: string; aria-haspopup?: "menu" }; hasActions: boolean }`

### `TypeHeader`
```ts
TypeHeader(__namedParameters: TypeHeaderProps): ReactElement
```
**Parameters:**
- `__namedParameters: TypeHeaderProps`
**Returns:** `ReactElement`

### `StructureView`
A focused DOM hierarchy with a single movable root.
```ts
StructureView(props: StructureViewProps): ReactElement
```
**Parameters:**
- `props: StructureViewProps`
**Returns:** `ReactElement`
