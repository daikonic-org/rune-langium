# Functions

## analysis

### `getElementNamespace`
Return the dot-separated namespace string for an element whose direct
`$container` is a `RosettaModel`. Returns undefined when the element
isn't a top-level model child — which is what every typeRef target is
(Data, Choice, RosettaTypeAlias, RosettaEnumeration, RosettaFunction
all live as direct children of RosettaModel via `model.elements`).

The model's namespace lives in `name: QualifiedName | string`. Behavior
mirrors the private helpers that were duplicated in `ts-emitter.ts:131`
and `zod-emitter.ts:148` — those will be deleted as a follow-up once
both emitters route through this module.
```ts
getElementNamespace(element: { $container?: unknown }): string | undefined
```
**Parameters:**
- `element: { $container?: unknown }`
**Returns:** `string | undefined`

### `collectNamespaceDependencies`
Walk every parsed document and return a per-namespace dependency map:
`Map&lt;sourceNamespace, Set&lt;targetNamespace&gt;&gt;`. A key `S` lists every
namespace `T ≠ S` that some type in `S` directly references.

The auto-select cascade in the Download modal computes the transitive
closure on top of this map — a fixed-point set-union that terminates
naturally when no new namespaces are added (cycles absorb cleanly).

Walks the spec §5.2 reference set in full:
  1. Data `superType` (extends)
  2. Data `attributes[].typeCall.type` (attribute type refs)
  3. RosettaTypeAlias `typeCall.type` (alias target refs)
  4. Choice `attributes[].typeCall.type` (choice arm refs)
  5. RosettaFunction `inputs[].typeCall.type` + `output.typeCall.type` +
     `superFunction` (function I/O refs)

NOT walked yet:
  - Function body operation type refs (the §5.2 "rule conditions" bullet).
    The Langium AST's `Operation` / `Condition` shapes have many possible
    type-bearing children, and the body refs are typically subset of the
    function's input/output anyway. If a real deselection test ever
    produces a broken emit because of a body-only reference, extend here.
```ts
collectNamespaceDependencies(documents: readonly LangiumDocument<AstNode>[]): Map<string, Set<string>>
```
**Parameters:**
- `documents: readonly LangiumDocument<AstNode>[]`
**Returns:** `Map<string, Set<string>>`

### `closeNamespaceDependencies`
Compute the transitive closure of a single source namespace through the
dep map produced by `collectNamespaceDependencies`. Returns the set of
namespaces that must be included if `source` is selected (includes
`source` itself).

Used by the modal's auto-select cascade on each toggle. O(N) per call
where N is the number of reachable namespaces — cheap enough to recompute
synchronously on every toggle.

Cycles between namespaces are absorbed naturally by the visited-set
check; no explicit cycle detection needed.
```ts
closeNamespaceDependencies(source: string, deps: ReadonlyMap<string, ReadonlySet<string>>): Set<string>
```
**Parameters:**
- `source: string`
- `deps: ReadonlyMap<string, ReadonlySet<string>>`
**Returns:** `Set<string>`
