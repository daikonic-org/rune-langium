# @rune-langium/codegen

> Generate code and form-preview schemas from parsed Rune DSL documents.

Code generation and preview-schema utilities for parsed Rune DSL / Rosetta models.

## Features

- Emit generated files with `generate`
- Build inspector/form schemas with `generatePreviewSchemas`
- Surface generator diagnostics through `GeneratorError`

## Selected exports

`generate()` accepts an optional `selection` for dependency-closed exports. Its
`namespaces` list makes every declaration in those namespaces an export root;
its `declarations` list selects individual roots by `{ namespace, kind, name }`.
The generator follows linked references from those roots and emits every needed
top-level declaration without mutating the parsed documents. Use this instead of
the legacy `GeneratorOptions.namespaces` allowlist when exporting individual
declarations; the two scopes are intentionally mutually exclusive in Studio's
download API.

Use `generateSelected()` when the caller also needs a receipt. It returns the
generated files and the exact explicit and dependency-included declarations
used for emission, plus a kind-aware `requiredBy` map from each dependency to
its explicit roots, without resolving the workspace a second time. Studio
stores that receipt in its downloadable artifact envelope.

## Python projections

The browser-safe `@rune-langium/codegen/export` surface exposes
`generatePythonModule(documents)` and `selectPythonProjection(module, subject, kind)`.
The module contains complete functions, typed input/Data records, enum literals,
runtime helpers and source-addressed function/condition fragments. Python 3.13
uses standard-library `TypedDict` and `Literal`; optional fields use `NotRequired`,
collection fields use lists, and Rune numeric values use binary64 floats. Functions
retain ordered aliases, preconditions, set/add operations and postconditions.
Native declarations require `rune.bind(qualifiedName, callable)` before execution;
missing bindings raise an explicit error. Studio displays projections read-only
and retains the narrower reverse-expression lens.

Python syntax/runtime checks require Python >=3.13. Set `PYTHON_BINARY` when the
shell's `python3` is older. The checked-in 117-case CDM execution battery and AST
grammar census run without downloads. An optional linked `.resources` scan compiles
staged CDM/FpML/Rune bodies and records versions, content hashes, expression counts,
syntax/linking exclusions and rendering failures in `dist/python-projection-coverage.json`.
Corpus syntax coverage is distinct from execution parity. Both targets share linked
type/cardinality/metadata resolution and `only exists` selection; Python switch
arms remain lazy without nested-ternary depth limits.

## TypeScript functions

Rune functions emit named exports with a single typed input object and an explicit
return type. Data values use `RuneFuncData<TypeShape>`, which preserves nested
fields while excluding class validation methods. Required inputs are required properties; optional inputs use `?`;
collection inputs and outputs use arrays. An optional scalar output returns
`T | undefined`. These types describe values and collection shape; TypeScript
arrays do not encode every Rune minimum or maximum cardinality. Exported functions
expect prevalidated, correctly typed inputs and preserve them without copying or coercion.
Validate external payloads before calling them; Studio does this once using
`emitStandaloneZodSchema(documents, targetId, { functionInputs: true })`, which
reuses the Data schema emitter and dependency closure. This input schema accepts the
adapted metadata contract, permits omitted zero-minimum arrays, and leaves Data
conditions to their separate validation flow. Generated
functions enforce declared output bounds at runtime, including absent-only `(0..0)` outputs.
Required metadata assignment fields reject absent values. Metadata helper discovery
follows linked declarations, including imported constructor and assignment fields.

Generated TypeScript imports `Temporal` from `@js-temporal/polyfill`; install that
package alongside the generated code. Function inputs, outputs, and model classes
use Temporal instances for dates and times. The function-input schema converts
ISO strings to Temporal once, including nested values and aliases. Class-to-function
calls preserve those instances. Studio serializes results back to ISO strings for
forms and JSON transport and supplies the same polyfill to executable previews.

Scalar/list adaptation is shared across functions, validators, and previews.
Assignments and calls use direct values when linked bounds and shapes already fit;
optional fields use `?.` and optional collections use `?? []`. Actual shape changes
and computed values with unproven bounds retain the shared runtime checks.
`extract` and list literals flatten one collection level; scalar assignments reject
multiple values. Arithmetic returns no value when an operand is absent or has more
than one value. Ordered comparisons involving absent operands are false. Sorting
places absent keys last; min/max choose populated keys when present.

Generated expression runtime calls use `rune.*`: for example, `rune.exists(value)`,
`rune.count(value)`, `rune.distinct(values)`, `rune.contains(left, right)` and
`rune.toDate(value)`. Validated scalar values use `===` / `!==`. Structured values
compare canonical `rune.valueKey` results; collection comparisons use `rune.equals`.
Computed numeric expressions can produce NaN and retain canonical value comparison;
metadata calls include `rune.withMeta`, `rune.toField` and `rune.toReference`.
Native operators and standard-library calls remain compact where equivalent.
Inline modules, shared runtime sidecars and executable previews use the same
runtime source builder; namespace methods preserve generic types and type guards.
Existing flat implementation exports remain available to runtime consumers.

Studio function previews resolve inherited and dispatch input signatures and
adapt plain form values and metadata envelopes, then validate their structure once before execution.
`normalizePreviewInputs` adapts plain form values to metadata wrappers using the
shared type resolver and runtime helpers, including nested and recursive values
beyond the form renderer's expansion depth.

Function bodies preserve calls, aliases, assignments, conditions, inheritance,
and dispatch, including overloads split across namespace files. Core and codegen
share the base-signature resolver. Qualified calls retain their resolved namespace through imports,
implicit calls, and `super`. Functions sharing a name with a type receive a `NameFunction` export (with a numeric suffix when needed); `GeneratedFunc.exportName` records it while `name` retains the Rune name. Otherwise per-namespace files keep their original exported
function names; conflicting callable names in barrel and single-file output use
`__rune$namespace$Name` exports (namespace dots become `$`). Internal aliases use
`$` so Rune inputs and aliases cannot shadow them.
Metadata-annotated parameters use `RuneFieldWithMeta<T>` or
`RuneReferenceWithMeta<T>`; ordinary value expressions unwrap field metadata,
while calls and assignments retain wrappers where their declarations require them.
Aliases retain metadata wrappers, including through chained bindings; value reads
unwrap them using the alias's metadata kind and cardinality.
Constructor fields use the same declared metadata and cardinality normalization
as function parameters. Nested assignments enter wrapper values and create missing
containers; collection intermediates select or create the first element, matching
the Java generator's builder semantics.
Implicit collection and pipeline calls retain the item's metadata. Conditional
and `default` branches normalize mixed raw, field, and reference values to a common
wrapper kind while evaluating only the selected branch. Switches use the same
branch normalization and preserve scalar, collection, and empty results.
Switch comparisons use selector payloads while whole-selector `item` branches
retain the original metadata wrapper. Choice branches bind the projected option. Arithmetic, aggregation,
conversions, predicates, and collection comparison keys read payloads even when
the enclosing output requires metadata. Filters, sorting, and min/max retain the
selected values' wrappers.

Deep navigation resolves types through `default` receivers and switch branch results.
Collection and pipeline result types use the same core operator propagation as language-service scopes.
Metadata navigation projects over collections and omits absent metadata values.
Functionless `extract` and `then` preserve item metadata for wrapped outputs and
read payloads for raw outputs.
Structural equality and collection keys compare Temporal values by their type and
canonical string value, including when nested in Data records.

Choice constructors, navigation, and assignment paths share emitted option names.
Nested assignments select the declared Choice arm when building its value, including
through collection and metadata boundaries.
Mixed list literals normalize each element separately. Reducers track accumulator
and item metadata independently, normalize the initial accumulator, and omit
unresolved references when reducing payloads. Empty reductions return no value.
Dispatch compares the selector's value without changing the wrapper used by its body.
Converting reference metadata to field metadata requires a payload value; an
unresolved reference throws instead of producing a field wrapper without a value.
Collection membership and distinct operations use structural value keys, so
separately allocated records with the same values compare equally.
`distinct` compares metadata payloads and retains the first matching wrapper.
Deep navigation preserves collections at intermediate path segments, including
collection-valued `default` receivers. Switch cases
and defaults bind `item` to the selected value. Two empty collections or two absent
optional scalars compare equal and do not compare unequal; an empty collection
and an absent scalar remain distinct.
Data switch guards compare linked declaration identity and explicit supertypes,
keeping same-named types in different namespaces distinct.
Data subtype switch cases require a populated distinguishing field when the
selector's declared type does not already establish that subtype. Inherited
fields alone do not distinguish a subtype from its parent.

Mapped TypeScript library functions use the bindings in `typescriptProfile`:
`Min` and `Max` use `Math.min` and `Math.max`, and `IsLeapYear` uses the shared
runtime implementation in every output layout. Unmapped library callables expose
a typed `.implementation` property for the host to supply. Abstract functions
still require implementations.
Invalid or unknown expression nodes emit diagnostics and throw when evaluated.

`test/emit/function-runtime.test.ts` parses Rune, generates complete modules,
checks them with TypeScript strict mode, and executes the result. Its call-site
checks also verify rejection of incompatible inputs and return assignments.
