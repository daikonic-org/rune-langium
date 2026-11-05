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
remain in force. Studio edits TypeScript expression values directly in the body
view, with Apply/Discard for a private draft. `parseSourceTsBody` locates authored
initializer, assignment, assertion and add-value slots, checks the surrounding
statement structure, and delegates each value to the same origin-aware inverse.
All changed Rune regions commit in one document transaction and one undo step.
Changing declaration names, targets, returns or control flow requires Rune source.
Lifted statement expressions without a matching origin are refused; no JavaScript
is evaluated and unsupported drafts remain available for correction or discard.
The legacy subset lens exports remain for compatibility; Studio uses the source lens.

Callback parameters follow lexical shadowing, including constructor shorthand:
`then(amount, x => Point({ x }))` retains field `x` with the pipeline value. Rune
pipelines expose only implicit `item`; edits that capture that binding inside
another callback are refused when they cannot preserve its meaning. Named Rune
closure captures remain supported. Quantified comparisons also refuse callbacks
whose shadowed parameters cannot be represented by the corresponding Rune operator.

Origin fragments carry serializable callback aliases, so an edit to a hygienic
`item1` inside a nested callback restores Rune's implicit `item` in that callback.
Legacy callback origins without binding information require reopening the draft.
Substituted scalar callbacks permit literal edits but refuse larger fragment edits
when their original binding cannot be recovered without guessing.

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
The public constructor is the `Trade` class itself, with a merged `Trade.Shape`
type for function inputs and outputs. Shared helpers are separate by default.
Generated model classes use `@RuneObject.model` and `@RuneObject.field` to declare
runtime facts once; the shared base derives inherited and deep metadata lazily.
Field decorators use positional `field(Cardinality.One, check)` arguments, with
`Optional`, `ZeroOrMore`, `OneOrMore`, `range(lower, upper)` and `atLeast(lower)`
for other count bounds. Linked-type getters and envelope cardinality follow the check.
The shared runtime converts these immutable declarations to its existing count
checks; numeric value constraints remain independent.
The type-only namespace retains static traversal/cardinality information.
`typescript.decorators: false` produces equivalent registration calls for hosts
that erase types without lowering decorators, including Studio execution. Code
previews and downloads use standard decorators by default.
`Trade.fromJSON(input, { format: 'RUNE_JSON' })` and
`trade.toJSON({ format: 'RUNE_JSON' })` opt into Rune wire metadata; ordinary
`toJSON()` and `JSON.stringify()` retain plain JSON output.
The factory accepts typed model inputs, JSON text and unknown external payloads.
It normalizes scalar/list fields, checks declared bounds and field types, and
materializes nested models without mutating the input. The public result follows
its count: no values become `undefined`, one becomes a model instance, and two or
more become an array-backed `RuneList`. Object fields and deep selections use the
same rule. There is no public `unwrap()` step. Authored business conditions remain
explicit validation methods. `new Trade(shape)` constructs one proxied instance.

```typescript
const trade = Trade.from({ transfers: [{ asset: { amount: 3 } }] });
const asset = trade._.asset;
const first = Trade.from([inputA, inputB]).first();
const result = CalculateTrade(trade); // accepts Trade.Shape directly
```

Linked descriptors supply runtime traversal and TypeScript field types. Direct
and deep selections compose lower/upper cardinality bounds. `One<T>` is `T`;
`Optional<T>` is `T | undefined`; `OneOrMore<T>` is `T` or a RuneList containing at
least two items; `ZeroOrMore<T>` also permits `undefined`. Literal tuples retain
their root size. Bounded factory inputs and projected fields use tuple unions up
to 32; larger bounds widen statically while retaining full runtime checks.
Unknown/JSON-text inputs are conservatively `0..*`. Cyclic deep paths also widen
to `0..*`; runtime traversal remains cycle protected. Plain Shapes accept scalar
or array collection fields for structural interoperability. Factory Input types
and projected result fields retain precise cardinality constraints.

`RuneObject` proxies cache a private RuneValue for each field. Getters expose
projected values; setters and mutable list operations normalize and check bounds
before committing. Replacing a field detaches its old list handle. JSON encoding
reads canonical storage, so a declared collection still serializes as an array
even when its current getter projects to a scalar. Metadata envelopes are retained.

Explicit list transformations share RuneList's implementation and stay collection
containers for chaining: `map` retains array-valued groups, while `flatMap` and
`flat` flatten explicitly. Sorting uses Rune value/Temporal ordering and does not
mutate the source. Element selectors return the selected scalar/model directly.
`list.project()` applies the count-based projection, and `toArray()` returns an
owned native array. Lists satisfy `Array.isArray` without changing Array.prototype.

Authored fields retain their ordinary property names, including `_` and `map`.
Use `value.deep()` to traverse when an authored `_` field shadows deep access, or
`value.field('map')` for an explicit linked selection. Deep names identifying
several distinct linked fields are deliberately unavailable; use
`value.select('namespace.Owner#field')` to disambiguate. Traversal follows declared
model fields, not arbitrary JavaScript object keys. Metadata payload navigation
hides representation wrappers while retaining actual authored `value` fields.
