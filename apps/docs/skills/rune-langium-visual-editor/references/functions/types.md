# Functions

## types

### `typeRefMimeForKind`
Kind-scoped MIME variant so drop targets can filter by `accept` during
dragover, when the browser security model makes `getData` return empty.

**Recommended drag-source contract:** register BOTH the canonical
`TYPE_REF_PAYLOAD_MIME` (with the JSON payload) AND `typeRefMimeForKind(kind)`
(with empty value, just a marker). The dual-MIME pattern gives drop targets
accept-policy enforcement during the dragover phase.

**Single-MIME fallback:** drag sources that register only the canonical MIME
will still trigger drop, but accept-policy filtering moves to drop time —
the hook can't filter by kind during dragover, so hover may briefly show
"accepting" before the drop is rejected if the payload kind isn't in `accept`.
```ts
typeRefMimeForKind(kind: "Data" | "Choice" | "Annotation" | "Enum" | "BasicType" | "Record" | "TypeAlias" | "Func"): string
```
**Parameters:**
- `kind: "Data" | "Choice" | "Annotation" | "Enum" | "BasicType" | "Record" | "TypeAlias" | "Func"`
**Returns:** `string`

### `isTypeRefPayload`
Type guard for parsed drag payloads.
```ts
isTypeRefPayload(value: unknown): value is TypeRefPayload
```
**Parameters:**
- `value: unknown`
**Returns:** `value is TypeRefPayload`

### `expansionKey`
Serialise an expansion key for use as a Map / Record key.

**Format:**
- No `instancePath` (or empty): `${namespaceUri}::${typeId}::${attrName}`
- With `instancePath`: `${namespaceUri}::${typeId}::${attrName}::${path.join('&gt;')}`

This is the single deterministic per-instance key shape. Root-level rows
(empty `instancePath`) serialize without a suffix; nested rows append the
ancestor chain. `expansionKey` is the sole serializer — use it everywhere.
```ts
expansionKey(k: StructureExpansionKey): string
```
**Parameters:**
- `k: StructureExpansionKey`
**Returns:** `string`
