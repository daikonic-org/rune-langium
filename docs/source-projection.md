# Source-facing TypeScript projections

Studio's TypeScript body view is a syntax lens over Rune. The syntax is familiar,
but Rune supplies cardinality, absence, structural equality, calendar ordering,
metadata and collection semantics. Copying the display into a JavaScript engine
is not an execution path. Downloaded TypeScript retains its checked lowering.

The renderer consumes existing linked facts and is shared with expression editing.
It does not infer types in the UI. Public declaration selectors retain executable
output by default; body selectors return source-facing syntax and implementation status.

Readable projections and executable TypeScript target ESNext (ES2026-era syntax).
They are not constrained to older ECMAScript syntax. Rune operators and helpers
retain the agreed semantics; the modern target does not substitute native
JavaScript equality, collection or calendar behavior for Rune operations.

## Syntax

| Rune | TypeScript projection |
| --- | --- |
| `trades -> amount` | `trades.map(item => item.amount)` |
| `trades -> amounts` | `trades.flatMap(item => item.amounts)` |
| `trade ->> amount` | `trade._.amount` |
| `trade -> child -> amount` | `trade.child?.amount` when only child is optional |
| `trades extract [quantity * price]` | `trades.map(item => item.quantity * item.price)` |
| `trades extract [amounts]` | `trades.map(item => item.amounts)` (groups retained) |
| `(trades extract [amounts]) flatten` | `trades.map(item => item.amounts).flat()` |
| `trades filter [amount > 0]` | `trades.filter(item => item.amount > 0)` |
| `amount extract [item * 2]` | `amount * 2` when safe to inline |
| `maybeAmount extract [1]` | `extract(maybeAmount, item => 1)` |
| `amount filter [item > 0]` | `amount > 0 ? amount : null` for required amount |
| `values first` / `last` | `values.first()` / `values.last()` |
| `values count` / `sum` | `values.count()` / `values.sum()` |
| `values min` / `max` | `values.min()` / `values.max()` |
| `trades min [amount]` / `max [amount]` | `trades.min(item => item.amount)` / `.max(item => item.amount)` |
| `values sort` / `trades sort [amount]` | `values.sort()` / `trades.sort(item => item.amount)` |
| `values distinct` / `reverse` / `flatten` | `.distinct()` / `.reverse()` / `.flat()` |
| `values only-element` | `values.onlyElement()` |
| `values reduce a, b [a + b]` | `values.reduce((a, b) => a + b)` |
| `values join separator` | `values.join(separator)` |
| `[many, scalar]` | `[...many, scalar]` |
| `a = b` / `a <> b` | `a == b` / `a != b` |
| arithmetic and ordering | ordinary `+`, `-`, `*`, `/`, `<`, `<=`, `>`, `>=` |
| `a and b` / `a or b` | `a && b` / `a || b` |
| `amounts all > limit` / `any > limit` | `.every(item => item > limit)` / `.some(item => item > limit)` |
| `xs all > ys` | `xs.every(item1 => ys.every(item2 => item1 > item2))` |
| `xs all = ys` | `xs.every((item, index) => item == ys[index])` (positional) |
| `value exists` / `is absent` | `exists(value)` / `!exists(value)` |
| `value single exists` / `multiple exists` | `singleExists(value)` / `multipleExists(value)` |
| `(value -> a, value -> b) only exists` | `onlyExists(value, item => [item.a, item.b])` |
| `value one-of` | `oneOf(value)` |
| `value optional choice a, b` | `choice(value, item => [item.a, item.b], 'optional')` |
| `values contains value` / `contains otherValues` | `.has(value)` / `.isSupersetOf(otherValues)` |
| `values disjoint other` | `values.isDisjointFrom(other)` |
| `Point { x: x }` / `Point { x: x, ... }` | `Point({ x })` / `partial(Point, { x })` |
| `value -> date` / `value -> time` | `value.toPlainDate()` / `value.toPlainTime()` (`?.` when optional) |
| `value with-meta { reference: ref }` / `value as-key` | `withMeta(value, { reference: ref })` / `asKey(value)` |
| `value as Type` | `value as Type` |
| `value to-string` / `to-number` / `to-int` | `String(value)` / `Number(value)` / `int(value)` |
| calendar conversions | `date(value)`, `time(value)`, `dateTime(value)`, `zonedDateTime(value)` |
| `value to-enum Currency` / `Currency -> USD` | `Currency[value]` / `Currency.USD` |
| `value default fallback` | `value ?? fallback` |
| `if condition then yes else no` | `condition ? yes : no` |
| `value then item + 1` | `then(value, item => item + 1)` |
| `value then [item + 1]` | `then(value, item => [item + 1])` (list body preserved) |
| `empty` | `null` |
| `super` / `super(amount)` | `super()` / `super(amount)` |

Explicit Rune names are preserved; implicit parameters use `item`, with hygienic
suffixes only when necessary. Intrinsics are bare unless shadowed by an authored
binding, then use `rune.name(...)` (or `$rune.name(...)` if rune is shadowed too).
Authored namespace qualification and explicit argument spelling are preserved on ordinary calls. An authored bare implicit call stays bare; the linked Rune identity supplies its invocation semantics. Constructor type arguments, when present, use a second named options object, such as `Point({ x }, { T: 5 })`, and retain their Rune origin.

Aliases and immutable named outputs use `const`; root reassignment and deferred
initialization use `let`. Nested SET uses dotted assignment; ADD uses push with a
scalar or explicit spread, with initialization and ownership implicit in the lens.
Authored preconditions and postconditions use `assert(predicate, optionalName)` in
source order. A terminal switch may return directly only when no postcondition or
later work needs the output. Other switches assign locals in the original lazy
scope. Only authored defaults are shown. Type cases retain Rune selection semantics.

## Editing contract

`parseSourceTs` accepts an expression and optional serializable origin from
`renderSourceTypeScriptExpression`. The origin contains Rune source, baseline
projection text and source-region fragments, never live AST pointers. Token-tree
comparison tolerates formatting and quote changes. Supported edits replace unique
original subexpressions while retaining navigation/extraction and scalar-binding
identity. Repeated or overlapping origins refuse rather than guess.

Deep navigation uses `receiver._.field`; `.field("_")` selects an actual field
named `_` without entering the deep view. Older `.prop(item => item.field)`
drafts remain readable. A dangling deep view is not a Rune expression.

Without an origin, map canonically means extract, flatMap means extract followed
by flatten, and property access means Rune navigation. Collection membership and
quantifiers lower back to their Rune operations. The core parser remains the
syntax authority; no JavaScript is evaluated. Invalid or unsupported edits retain
the draft and do not write. Existing revision/workspace/dependency/read-only gates
remain in force. Full function bodies and lifted statement expressions are display
only; this change does not enable arbitrary JavaScript or whole-function editing.
The legacy subset lens exports remain for compatibility; Studio uses the source lens.

## Runtime and validation

One generated RuneList implementation composes owned arrays for inline modules,
sidecars and executable preview. `from(...items)` is variadic and does not flatten
array-valued items; map retains groups and flatMap/flat expose explicit flattening.
Operations preserve order and duplicates, use canonical Rune value keys for set
predicates, and keep sort/reverse nonmutating. Ordering accepts the linked
comparison callback for calendar types. External API and JSON values remain arrays.
SET copies arrays before ADD, including when inputs are frozen. Python shares the
same shape facts and preserves groups until declared array boundaries.
Element selectors (`first`, `last`, `only-element`, `min`, `max`) and reducers
retain selected groups too; their declared scalar or array boundaries normalize
the selected values without flattening the collection before selection.

Focused tests cover syntax, inverse refusal and origin retention, lazy switch
lifting, contract phases, scalar callback absence, group/flatten parity, ownership,
Temporal behavior and structural equality in actual compiled exports. Studio tests
cover formatting, implementation status, private drafts and guarded application.

`value as Cash exists` displays as `value instanceof Cash` for a scalar, or
`values.some(item => item instanceof Cash)` for a collection. The lens lowers
these guards to Rune type selection plus existence; it does not require exported
Data interfaces to be JavaScript constructors. Single/multiple-exists retain their
cardinality helpers. Standalone authored type selection retains `value as Cash`.

## Generated public value API

Generated TypeScript exposes `Trade.from(input)` alongside `new Trade(shape)`.
The factory returns a uniform fluent view for one value, an optional value or a
collection. It accepts typed model inputs, JSON text, unknown external payloads
and existing views; it normalizes scalar/list fields, checks declared bounds and
field types, and materializes nested models without mutating the input. Authored
business conditions remain explicit validation methods. `new Trade(shape)` keeps
single-instance construction; it does not perform the factory's normalization.

```typescript
const trade = Trade.from({ transfers: [{ asset: { amount: 3 } }] });
const total = trade._.asset.amount.sum();
const first = Trade.from([inputA, inputB]).first();
const payload = first.unwrap();
const items = trade.toArray();
```

Linked field descriptors supply both runtime traversal and TypeScript field types.
Direct and deep selection compose lower/upper cardinality bounds. Required single
values unwrap to `T`; optional singles to `T | undefined`; many-valued views to
scalar/nonempty-tuple/absence unions as their bounds permit. Literal tuples retain
their root size. Bounded field inputs and payloads use tuple unions up to 32;
larger bounds widen statically while retaining full runtime checks. Unknown/JSON
inputs are conservatively `0..*`. Cyclic deep paths also widen to `0..*`; runtime
path selection still uses the canonical linked traversal, with cycle protection.
Legacy plain Shapes and exported function array signatures stay interoperable and
do not encode every bound; call `.unwrap()` or `.toArray()` at those boundaries.

Operations share the existing RuneList implementation. Selection, filtering,
sorting and element selectors keep model descriptors, so chaining works after
`first()` or `min()`. `map` retains array-valued groups; `flatMap` and `flat` make
flattening explicit. Sorting uses Rune value/Temporal ordering and does not mutate
inputs. `unwrap()` returns the current plain model payload, `toArray()` returns an
owned array, and `toJSON()` serializes through the shared Rune data adapter.

An authored field that collides with a view operation is available through
`view.field('map')` or `view.field('_')`. Deep names that identify several distinct
linked fields are deliberately unavailable; use
`view.select('namespace.Owner#field')` to disambiguate. Traversal follows declared
model fields, not arbitrary JavaScript object keys. Metadata payload navigation
hides representation wrappers while retaining actual authored `value` fields.
