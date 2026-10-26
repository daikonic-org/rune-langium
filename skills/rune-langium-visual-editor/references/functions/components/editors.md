# Functions

## components/editors

### `TypeSelector`
Searchable type selector with kind-colored badges.

When `renderTrigger` and `renderPopover` are provided, uses composition
to inject host app UI primitives (e.g., shadcn Popover + Command).
Otherwise falls back to a shadcn Select.
```ts
TypeSelector(__namedParameters: TypeSelectorProps): ReactNode
```
**Parameters:**
- `__namedParameters: TypeSelectorProps`
**Returns:** `ReactNode`

### `getKindBadgeClasses`
Returns badge CSS classes for a given type kind. Wraps the design-system
`badgeVariants` so callers (e.g. `ChoiceOptionRow`, `TypeLink`) get
token-backed colors automatically.
```ts
getKindBadgeClasses(kind: TypeKind | "builtin"): string
```
**Parameters:**
- `kind: TypeKind | "builtin"`
**Returns:** `string`

### `getKindDotClass`
```ts
getKindDotClass(kind: TypeKind | "builtin"): string
```
**Parameters:**
- `kind: TypeKind | "builtin"`
**Returns:** `string`

### `getKindLabel`
Returns a human-readable label for a type kind.
Delegates to the canonical KIND_LABEL map from KindBadge; handles the
'builtin' pseudo-kind (not a TypeKind) locally since KIND_LABEL only
covers TypeKind values.
```ts
getKindLabel(kind: TypeKind | "builtin"): string
```
**Parameters:**
- `kind: TypeKind | "builtin"`
**Returns:** `string`

### `CardinalityPicker`
```ts
CardinalityPicker(__namedParameters: CardinalityPickerProps): ReactNode
```
**Parameters:**
- `__namedParameters: CardinalityPickerProps`
**Returns:** `ReactNode`

### `MetadataSection`
Editable and inspection-only targets share the canonical construct capabilities.
```ts
MetadataSection(props: MetadataSectionProps): ReactNode
```
**Parameters:**
- `props: MetadataSectionProps`
**Returns:** `ReactNode`

### `AttributeRow`
```ts
AttributeRow(__namedParameters: AttributeRowProps): Element
```
**Parameters:**
- `__namedParameters: AttributeRowProps`
**Returns:** `Element`

### `DataTypeForm`
```ts
DataTypeForm(__namedParameters: DataTypeFormProps): Element
```
**Parameters:**
- `__namedParameters: DataTypeFormProps`
**Returns:** `Element`

### `EnumValueRow`
```ts
EnumValueRow(__namedParameters: EnumValueRowProps): Element
```
**Parameters:**
- `__namedParameters: EnumValueRowProps`
**Returns:** `Element`

### `EnumForm`
```ts
EnumForm(__namedParameters: EnumFormProps): Element
```
**Parameters:**
- `__namedParameters: EnumFormProps`
**Returns:** `Element`

### `ChoiceOptionRow`
```ts
ChoiceOptionRow(__namedParameters: ChoiceOptionRowProps): Element
```
**Parameters:**
- `__namedParameters: ChoiceOptionRowProps`
**Returns:** `Element`

### `ChoiceForm`
```ts
ChoiceForm(__namedParameters: ChoiceFormProps): Element
```
**Parameters:**
- `__namedParameters: ChoiceFormProps`
**Returns:** `Element`

### `FunctionForm`
```ts
FunctionForm(__namedParameters: FunctionFormProps): Element
```
**Parameters:**
- `__namedParameters: FunctionFormProps`
**Returns:** `Element`

### `ExpressionBuilder`
```ts
ExpressionBuilder(__namedParameters: ExpressionBuilderProps): Element
```
**Parameters:**
- `__namedParameters: ExpressionBuilderProps`
**Returns:** `Element`

### `NameCell`
```ts
NameCell(__namedParameters: NameCellProps): ReactElement
```
**Parameters:**
- `__namedParameters: NameCellProps`
**Returns:** `ReactElement`

### `CardinalityCell`
```ts
CardinalityCell(__namedParameters: CardinalityCellProps): ReactElement
```
**Parameters:**
- `__namedParameters: CardinalityCellProps`
**Returns:** `ReactElement`

### `typeChipKind`
```ts
typeChipKind(kind: TypeKind | "builtin" | undefined): TypeChipKind
```
**Parameters:**
- `kind: TypeKind | "builtin" | undefined`
**Returns:** `TypeChipKind`

### `TypePickerCell`
```ts
TypePickerCell(__namedParameters: TypePickerCellProps): ReactElement
```
**Parameters:**
- `__namedParameters: TypePickerCellProps`
**Returns:** `ReactElement`

### `InspectorFrame`
Layout only: providers and editor sessions stay owned by their declaration.
```ts
InspectorFrame(__namedParameters: InspectorFrameProps): Element
```
**Parameters:**
- `__namedParameters: InspectorFrameProps`
**Returns:** `Element`

### `InspectorDetailsPane`
A bounded local layout preference; no model, draft or persistence ownership.
```ts
InspectorDetailsPane(__namedParameters: InspectorDetailsPaneProps): Element
```
**Parameters:**
- `__namedParameters: InspectorDetailsPaneProps`
**Returns:** `Element`

### `InspectorInheritanceField`
```ts
InspectorInheritanceField(__namedParameters: TypeReferenceFieldProps & { label?: string }): Element
```
**Parameters:**
- `__namedParameters: TypeReferenceFieldProps & { label?: string }`
**Returns:** `Element`
