# @rune-langium/codegen

> Generate code and form-preview schemas from parsed Rune DSL documents.

Code generation and preview-schema utilities for parsed Rune DSL / Rosetta models.

## Features

- Emit generated files with `generate`
- Build inspector/form schemas with `generatePreviewSchemas`
- Surface generator diagnostics through `GeneratorError`

## Selected exports

`validateTargetOptions(target, options)` validates a named project's generator
settings using the same schemas that own the public option types.
`getTargetLayouts(target)` supplies those supported layouts to UI controls, and
`getGeneratorCapabilities()` distinguishes registered targets from unavailable
ones. These APIs do not select a default generator or download implementations.

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
take positional parameters in Rune order, retain their ordinary names and types,
and retain ordered aliases, preconditions, set/add operations and postconditions.
Optional Python parameters accept `None`; only trailing optional parameters have
defaults. Native function bindings receive the same positional arguments.
Native declarations without a bundled body require `rune.bind(qualifiedName, callable)` before execution;
missing bindings raise an explicit error. Explicit bindings override bundled defaults.
`PythonModule.diagnostics` reports missing or incompatible bundled implementations.
Studio displays projections read-only
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

Rune functions emit named exports with positional parameters in Rune declaration
order and an explicit return type, such as `AddTwo(left, right)`. Ordinary parameter
names match Rune inputs; target keywords and implementation binding collisions
are escaped. Data values use `Type.Shape`, which preserves nested
fields while excluding class validation methods. Required inputs are required parameters. Trailing optional inputs use `?`; optional
inputs before required ones accept `undefined` without changing argument order;
collection inputs and outputs use arrays. An optional scalar output returns
`T | undefined`. These types describe values and collection shape; TypeScript
arrays do not encode every Rune minimum or maximum cardinality. Exported functions
expect prevalidated, correctly typed inputs and preserve them without copying or coercion.
Validate external payloads before calling them; Studio does this once using
`emitStandaloneZodSchema(documents, targetId, { functionInputs: true })`, which
reuses the Data schema emitter and dependency closure. This input schema accepts the
adapted metadata contract, permits omitted zero-minimum arrays, and leaves Data
conditions to their separate validation flow. Generated
functions expose ordered `parameterNames` metadata, including single-file bundles.
Studio maps validated fields through this order and then invokes the positional API.

TypeScript `single-file` bundles contain `model.ts` and `helpers.ts`; distribute
both files. The model starts with imports and declarations, while shared runtime
implementations live only in the companion. Barrel bundles use the same companion
instead of the former `runtime.ts`. Helper filenames gain a numeric suffix when
a namespace already owns that path. Model files precede companion files in
generator output, so previews open the model by default. Parameters and shortcuts
escape runtime globals such as `Number`, `undefined` and `Math`; original Rune
input names remain in `parameterNames`. Python similarly protects names imported
by its runtime, including `math`, while retaining ordinary builtin parameter names.

Functions enforce declared output bounds at runtime, including absent-only `(0..0)` outputs.
Required metadata assignment fields reject absent values. Metadata helper discovery
follows linked declarations, including imported constructor and assignment fields.

Generated TypeScript imports `Temporal` from `@js-temporal/polyfill`; install that
package alongside the generated code. Function inputs, outputs, and model classes
use Temporal instances for dates and times. The function-input schema converts
ISO strings to Temporal once, including nested values and aliases. Class-to-function
calls preserve those instances. Studio serializes results back to ISO strings for
forms and JSON transport and supplies the same polyfill to executable previews.

The built-in namespace also exports `time = Temporal.PlainTime`,
`date = Temporal.PlainDate`, `dateTime = Temporal.PlainDateTime`,
`zonedDateTime = Temporal.ZonedDateTime` and `pattern = RegExp` type aliases, so
the generated preview exposes these implementation mappings. Pattern-typed fields
and functions use native regular expressions. Fixed string literals in authored
pattern destinations become regex literals; ordinary string fields retain strings.
Factories, function-input schemas and Studio preserve native pattern values, while
JSON uses their regex source strings. RegExp flags have no Rune wire field and
serialization rejects them instead of discarding them. Pattern syntax follows the
JavaScript RegExp implementation; unsupported expressions fail explicitly.

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

Generated model factories and property checks narrow unknown inputs before use.
They do not cast through `unknown` or to `any`. Selector/comparator argument tuples
and checked descriptor guards retain collection/cardinality relationships. The
private proxy runtime still needs assertions for conditional cardinality types
that TypeScript cannot derive from validated runtime counts.

TypeScript modules import a shared `helpers.ts` companion by default, including
per-namespace output. Set `typescript.inlineHelpers: true` with per-namespace
layout for a self-contained module. Studio's TypeScript and Zod previews use
shared companions, keeping support code out of the selected model by default.

Data declarations expose one public class, such as `Quote`, with `Quote.from`
and a merged `Quote.Shape` type for plain function inputs/outputs. `new Quote`
constructs one proxied instance; `Quote.from` projects its result by cardinality.
`Quote.is` recognizes instances and qualified Rune JSON type tags, validating
both tagged and untagged input shapes. Shape validation and cardinality checks
remain part of factory normalization. `Quote.fromJSON(input, { format: 'RUNE_JSON' })`
decodes Rune wire metadata using Core's codec; instance/list
`toJSON({ format: 'RUNE_JSON' })` encodes linked fields. Base-typed factories and
fields retain known tagged descendants and generated subclass instances, validating
the concrete fields before creating their instances. Nested Choices round-trip
through the same cycle-safe acceptance rules as the preview adapter. Descendants register as their modules load; importing
the bundle barrel registers the complete generated set. Unknown, unloaded or
unrelated concrete types are rejected. Plain JSON remains the
default, including `JSON.stringify(instance)`. Unknown fields are retained by
factory normalization; unsupported ambiguous Choice representations fail explicitly.

The shared `RuneObject` base owns factory, guard and JSON behavior. Classes keep
their fields, constructor, authored condition methods and `@RuneObject.model`
identity. Each `@RuneObject.field` supplies its cardinality, type check and optional
linked type/metadata once. The base derives and caches runtime selections lazily,
including cyclic graphs; importing a model does not traverse its linked types.
There is no runtime `Quote.Type` property. `Quote.Shape`, `Quote.Input`
and traversal types remain in the type-only merged namespace. Natural class
inheritance preserves `instanceof` and factory cardinality inference.

Field decorators take positional arguments: `@RuneObject.field(Cardinality.One, check)`.
The common count bounds are `One` (`1..1`), `Optional` (`0..1`), `ZeroOrMore`
(`0..*`) and `OneOrMore` (`1..*`). Other ranges use
`Cardinality.range(2, 5)` or `Cardinality.atLeast(2)`. These immutable values retain
literal bounds in their types and normalize once to the existing runtime count
checks; they do not constrain numeric field values. Optional arguments after the
check are a lazy linked-type getter, metadata-envelope cardinality and a native
field reader, in that order. Trailing unused arguments are omitted. `Cardinality` is exported by
generated modules and their helper companion in every layout.

Standard decorators are enabled by default (`typescript.decorators: true`).
Consumers must lower decorators when their JavaScript engine cannot execute them.
Set `typescript.decorators: false` for equivalent `RuneObject.decorate(...)`
registration calls, as used by Studio's type-erasing execution compiler. This
changes registration syntax only; both modes use the same definitions and runtime.
Generated source and strict type checks retain the ESNext target.

The shared `is` namespace exposes `is.Quote(value)`. A statically known `RuneObject`
input narrows to the concrete class; unknown/plain data narrows to `Quote.Shape`.
Generated instances use class identity, while plain shapes use the same linked
field/cardinality validation as factory construction. `Quote.is` is inherited as
an equivalent convenience. Duplicate model names receive qualified guard names.
Choice unions use the shared Choice factory with `is`/`from`/`fromJSON` methods.

Set `typescript.serialization: 'zod'` to import `${Model}Codec` from companion
modules generated by the Zod emitter. The download includes those companions;
consumers need Zod 4. Codec serialization validates authored constraints and
converts native Temporal/RegExp fields in both directions. Rune JSON envelopes,
references and concrete type selection continue through the shared Core codec.
Every nested concrete model uses its own codec, including subclasses inside
base-typed scalar/list fields, Choice arms and metadata references. Wire and native
checks use the companion schema's public parse/encode operations; runtime hydration
retains concrete fields and codecs do not replace them with base-schema clones.
The default `'runtime'` mode has no Zod dependency. For standalone schemas,
`zod.codecs: true` adds the same bidirectional codecs and native output types;
ordinary Zod emission retains its wire-value schemas.

Preview fields expose optional `typeSymbol` presentation metadata, using a
kind-qualified identity such as `data:example.Trade`, `typeAlias:example.Amount`
or `builtin:number`. The shared type resolver preserves the declared alias;
collections and deferred object expansion retain this metadata. Consumers can
associate reusable layouts and control formats with symbols without inferring
types from field labels or changing validation semantics.

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
Unique cross-namespace calls keep the exported function name. Only colliding or
lexically shadowed calls use protected aliases; private aliases include the caller
namespace when needed for single-file output and defer native binding reads until
invocation.
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
without a bundled body still require implementations.
Invalid or unknown expression nodes emit diagnostics and throw when evaluated.

### Bundled code implementations

`src/implementations/` owns the shared catalog and handwritten bodies per language.
`resolveNativeImplementation(function, language)` validates the qualified function
identity, resolved standard `codeImplementation` annotation and exact signature,
then reports an available body or an explicit unsupported reason. It does not
fetch code or evaluate workspace files. Authored Rune bodies and project-installed
TypeScript implementations take precedence. Declaration overrides use the ordinary
effective-project graph, so a workspace can replace a reference function in Rune.

The initial entry is CDM `cdm.base.datetime.Today`, with no inputs and output
`today date (1..1)`. Both TypeScript export and standalone Python module generation
embed a UTC calendar-date implementation; no Java/OpenGamma or host callback is
required. TypeScript returns `Temporal.PlainDate` through its existing
`@js-temporal/polyfill` dependency. Python uses its standard-library `datetime`
dependency and the backend's canonical ISO date string. Conditions and output
cardinality checks still surround the native body. Preview availability consults
the same catalog as TypeScript generation.

Unregistered or incompatible declarations retain an explicit unavailable
diagnostic and throwing stub. Other targets do not gain executable native bodies
merely because a TypeScript or Python body exists. Python module generation
remains the existing projection API, not a new named export target. Add identities,
signature checks, target bodies/dependencies and standalone execution tests together
when extending the catalog. Never infer an implementation from an unqualified name.

`test/emit/function-runtime.test.ts` parses Rune, generates complete modules,
checks them with TypeScript strict mode, and executes the result. Its call-site
checks also verify rejection of incompatible inputs and return assignments.

Generated display bodies use purpose-built Rune objects' `.equals()` for scalar
structural comparisons, delegating to the canonical recursive equality contract.
Executable TypeScript exports still compare plain JSON using shared runtime helpers.
Studio formats generated TypeScript and Python with lazy formatter engines in its
worker; authored Rune source and executable exports are unchanged by formatting.

`@rune-langium/codegen/instances` retains the internal InstanceRecord API.
`typeIdentity` optionally carries the portable model/namespace/kind/name identity;
`parseInstanceRecord` validates the legacy record envelope before migration. Its
payload remains semantic data, independent of display formatting.


## Cardinality-aware TypeScript values

Generated `Trade.from(input)` returns `undefined` for no values, a `Trade` for one,
and an array-backed `RuneList` for multiple values. The same projection applies to
linked fields and deep selections such as `trade._.asset`. `One<T>`, `Optional<T>`,
`OneOrMore<T>` and `ZeroOrMore<T>` expose those shapes; bounded outputs retain tuple
bounds. Public values pass directly to ordinary functions without unwrapping.

`RuneObject` proxies cache private `RuneValue` field slots. Setters and list edits
reuse the factory normalizer, and serialization reads canonical storage rather
than projected getters. Plain `Trade.Shape` collection fields accept a scalar or
array; factory inputs and projected outputs retain stricter linked bounds.
`new Trade(shape)` still constructs one model instance. Authored business-condition
validation remains explicit. See [source projections and the public value API](../../docs/source-projection.md#generated-public-value-api)
for bounds, collision escapes and serialization behavior.
