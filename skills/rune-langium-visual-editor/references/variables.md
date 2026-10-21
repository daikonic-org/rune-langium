# Variables & Constants

## types

### `TYPE_REF_PAYLOAD_MIME`
MIME type used for drag-drop payloads.
```ts
const TYPE_REF_PAYLOAD_MIME: "application/x-rune-type-ref"
```

### `TYPE_REF_KINDS`
Every type kind a namespace-explorer row can carry. ALL kinds are draggable
(so no row falls back to text-selection on a drag attempt); drop targets gate
what they accept via their `accept` list. `Data`/`Choice`/`Enum`/`BasicType`/
`Record`/`TypeAlias` are valid attribute type-refs; `Func`/`Annotation` are
draggable but accepted by no target (they show the no-drop cursor).
```ts
const TYPE_REF_KINDS: readonly ["Data", "Choice", "Enum", "BasicType", "Record", "TypeAlias", "Func", "Annotation"]
```

### `BUILTIN_TYPES`
Built-in type names available in com.rosetta.model.
Covers all basic types, record types, and type aliases (spec §1.1):
  - Basic types:   boolean, number, string, time, pattern
  - Record types:  date, dateTime, zonedDateTime
  - Type aliases:  int, productType, eventType, calculation
```ts
const BUILTIN_TYPES: readonly ["boolean", "number", "string", "time", "pattern", "date", "dateTime", "zonedDateTime", "int", "productType", "eventType", "calculation"]
```

## components

### `RuneTypeGraph`
```ts
const RuneTypeGraph: ForwardRefExoticComponent<RuneTypeGraphProps & RefAttributes<RuneTypeGraphRef>>
```

### `KIND_LABEL`
Canonical kind → full label. The ONE source for kind labels.
```ts
const KIND_LABEL: Record<TypeKind, string>
```

### `KIND_LETTER`
Canonical kind → single-letter classifier for the compact glyph shape.
```ts
const KIND_LETTER: Record<TypeKind, string>
```

## components/panels

### `EditorFormPanel`
```ts
const EditorFormPanel: MemoExoticComponent<(__namedParameters: EditorFormPanelProps) => Element>
```

### `NamespaceExplorerPanel`
```ts
const NamespaceExplorerPanel: MemoExoticComponent<(__namedParameters: NamespaceExplorerPanelProps) => Element>
```

## components/editors

### `TypeCreator`
```ts
const TypeCreator: MemoExoticComponent<(__namedParameters: TypeCreatorProps) => Element>
```

### `AttributeEditor`
```ts
const AttributeEditor: MemoExoticComponent<(__namedParameters: AttributeEditorProps) => Element>
```

### `TypeChip`
```ts
const TypeChip: ForwardRefExoticComponent<Omit<TypeChipProps, "ref"> & RefAttributes<HTMLButtonElement>>
```

## adapters

### `AST_TYPE_TO_NODE_TYPE`
Kind-to-ReactFlow-type mapping. Used to set `Node.type` for
component selection, and for display badges.
```ts
const AST_TYPE_TO_NODE_TYPE: Record<string, string>
```

### `NODE_TYPE_TO_AST_TYPE`
```ts
const NODE_TYPE_TO_AST_TYPE: Record<string, string>
```

## store

### `useEditorStore`
Default store instance for use with RuneTypeGraph.
```ts
const useEditorStore: UseBoundStore<Write<StoreApi<EditorStore>, { temporal: StoreApi }>>
```
