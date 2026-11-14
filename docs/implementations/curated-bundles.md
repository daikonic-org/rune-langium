# Curated implementation delivery

Curated publication selects implementations against linked declarations and exact
signatures. Codegen has no CDM implementation catalog: it consumes the selected
payload already present on a curated declaration. A raw `[codeImplementation]`
declaration alone does not make a function executable.

Each function has one effective implementation kind:

```ts
type Implementation =
  | { kind: 'rune'; path: string }
  | { kind: 'language-specific'; targets: { typescript?: Location; python?: Location } }
  | { kind: 'unimplemented' };
```

A Rune entry has one implementation path and no language-specific alternatives.
Support declarations may live in additional Rune files. Upstream dispatch bodies
retain their source; selector/default completeness and regression evidence remain
separate from implementation kind. Handwritten Java implementations, tests and
empty data providers are reference evidence, never target implementations.

Reusable library ports retain their library namespace. The owned Strata frequency
and periodic schedule ports live in `com.opengamma.strata.basics.schedule`.
CDM's `PeriodsInYear`, `CalculationPeriod`, and `CalculationPeriods` reuse the
same CDM-to-Strata frequency conversion. Their Rune catalog paths include the
library sources and Apache license and notice as support files.

## Publication and loading

The publication catalog and canonical owned Rune files live in
`packages/project-runtime/src/curated-implementations/`. The generated source-text
module retains the exact Rune bytes; its build script shares the existing
formatter-stable runtime-source writer.

The CI publisher stamps `$implementation` onto the serialized function copy,
carrying its exact signature and selected target expression/dependencies or Rune
path. A target can also carry private module definitions that the emitter
includes once with its selected calls. It stamps `$implementationSources` onto the serialized model copy with
source bytes, SHA-256 hashes, model and upstream commit, plus the owned MIT license
and any named third-party license/notice files.
Original upstream archives, source text and Rune bodies remain unchanged. The
normal immutable serialized-artifact checksum covers these payloads in both the
complete and per-namespace artifacts; normal cohort publication stays atomic.

Reference loading verifies the existing manifest, artifact checksum and cohort.
Generation checks the supplied binding's identity, annotation and linked signature
before emission, and retains authored Rune and explicit project-binding precedence.
It never searches a model-specific implementation registry or fetches code.
Curated Rune entries can pin a SHA-256 of the same exact linked signature when an
enum has many members. Publication checks the hash and still carries the complete
signature in the selected payload.
Older bundles without implementation payloads remain readable. When a curated
implementation change lands on `master`, the publisher verifies the audited release
pins and builds a new immutable cohort. A fresh resolution can select the new
cohort while existing project locks continue to load their original checksummed
artifacts.

Native precision, increment and significant-figure rounding is self-contained in
those payloads: TypeScript shares bounded BigInt coefficient arithmetic and Python
uses its standard-library `decimal` and `fractions`. Exact increment division
preserves the handwritten Java failure policy. This adds no CDM-specific Codegen
runtime helper. Both targets
retain the existing finite `number`/`float` API, so decimal scale formatting and
arbitrary BigDecimal precision remain outside their contract. See the
[pinned rounding corpus](../../test/fixtures/third-party/cdm-rounding/README.md).

The three FpML key targets share a hash layout derived from the linked FpML
model at publication. The CDM 7.9.0, FpML 3.13.0 and Rune 10.15.3 cohort is
admitted after its layout matches the pinned Java fingerprint. Keep the concrete
type on a subtype input using a generated class or its qualified `@type`.
For scale-sensitive keys, load JSON text with `preserveNumberText: true` in
`parseProjectPayload` or the generated TypeScript `fromJSON` method. Python can
load numbers as `Decimal` or consume the same normalized number metadata.
Prototype's JSON and Rune JSON object imports preserve number text on browsers
with exact JSON number support. Function input validation selects the linked
concrete type and retains number text when converting inputs for execution.
Edits discard the changed value's original spelling and retain untouched
list items' text. Rune value equality compares the numeric values.
Ordinary target numbers use their canonical spelling.
Exact text requires a JSON object or array when the scalar's spelling differs
from its ordinary numeric representation.

The CDM publisher also reads `codelist/json` from the same pinned source archive.
It prepares a case-insensitive domain catalog before serializing the native
`LoadCodeList` targets. Each target returns a fresh `CodeList` from those bytes.
Scheme URIs are identifiers. No target dereferences them or needs access to the
source archive at execution time. Duplicate domains fail publication. Source
resource hashes and the original license and notice remain in the inventory and
archive. See the [pinned code-list fixture](../../test/fixtures/third-party/cdm-code-list-loader/README.md)
for the Java comparisons and the supported metadata-only case.

The same prepared catalog also produces Rune enums in `rune.resources.cdm`.
Each populated list is a read-only source document with its pinned JSON path,
scheme URI and list version. These documents travel in the normal serialized
workspace and namespace artifacts. Core links their wire-value synonyms to the
shared `rune.resources.CodeList` source. Projects can import those enum types
directly, and existing local resource mappings can use the same synonym source.

`ResolveReset` selects the single recorded reset matching the requested
`resetDate` from `TradeState.resetHistory`. It returns that record with its
observations and optional `rateRecordDate`.

`InterpolateForwardRate` calls the project's `impl.cdm.market.ReadForwardRateSnapshot`
binding. The provider supplies the resolved settlement maturity and dated forward
quotes from one snapshot in the payout's quote convention. The Rune body returns
an exact quote or applies Strata's linear interpolation to the closest dates on
each side. Duplicate quote dates and dates outside the supplied curve fail.

The installed `IndexValueObservation` and `GetMarketRates` Rune overrides call
`impl.cdm.market.ReadMarketObservations` with the full CDM interest-rate index
and requested dates. Bind this function to a project declaration with the same
signature using a declaration override. A Rune provider is portable across
TypeScript, Python and Studio. A provider should return one `DatedValue` per
requested date. The overrides preserve requested order and reject missing or
duplicate observations. Code-list enums can type provider inputs that are
backed by a list. Dated market observations still require a project data source.

The CLI's [explicit benchmark acquisition](benchmark-data.md) supplies SOFR,
SONIA and €STR fixings and compounded indices as verified saved snapshots plus
an ordinary provider override. Publication itself does not fetch or redistribute
these observations. Forward curves and other provider families remain separate.

The two FRO metadata overrides call `impl.cdm.fro.ReadFloatingRateIndexMatrix`.
Bind it to a project provider that supplies dated matrix versions for the
requested index, including versions that lack that index. Each interval starts
on its effective date and ends immediately before its optional end date.
`ExtractFloatingRateOptionData` uses the trade date and requires a match.
`FloatingRateIndexMetadata` uses the project's nominated metadata date and
returns an empty result if the selected version has no matching definition.
The pinned floating-rate codelist supplies an importable enum independently of
the versioned definition data.

The valuation time overrides use `impl.cdm.time.ReadBusinessCenterZones` and
`impl.cdm.time.ReadAssetValuationTimes`. Bind these declarations to project
data providers. The first selects the location by center code and optional
scheme and preserves the requested wall-clock time. The second matches the
complete asset identifier, time type and determination method, and returns the
provider's time with its optional location. Both require exactly one match.
Projects can import `rune.resources.cdm.BusinessCenter` for their inputs and
use `to-string` at the original CDM signature boundary.

The observation overrides use `impl.cdm.market.ReadObservationInputs` and
`impl.cdm.market.ReadRateIndexSnapshot`. Bind the first to a provider of
candidate readings, any requested weights and an aggregate identity when
multiple observations are combined. Rune selects a unique reading for each
requested identity, preserving duplicate requests, and applies the chosen
mean. Arithmetic reuses the original CDM helper for unweighted inputs.
Geometric averaging uses the bundled `rune.math.Log` and `Exp` declarations.
Bind the second provider to a nominated rate snapshot. Rune selects exactly
one quote for the requested index, including zero or negative rates.

The equity settlement overrides use `impl.cdm.settlement.ReadEquityFloatingTerms`
and `impl.cdm.settlement.ReadCashSettlementSchedule`. Bind the first to the
transaction's payer and receiver, price/quantity and rate terms, with any
applicable payment, calculation, reset and accrual fields. A master
confirmation supplies its own equity payment schedule. Bind the second to
the selected payout's calendar-resolved settlement schedule and current period
end. Rune requires a unique schedule entry for that period.

Bind `impl.cdm.collateral.ReadProductEligibilityInputs` to supply the
`EligibilityQuery` facts for the product. When more than one schedule is
offered, supply the applicable one from that list. The adapter reuses CDM's
`CheckEligibilityByDetails` evaluator.

Bind `impl.cdm.portfolio.ReadPortfolioAggregationInputs` to select and group
the event quantities using the portfolio's aggregation parameters and supply
their CDM lineage. Each series has a scalar opening balance and signed changes
in the same unit, including a zero opening for period-only totals. Rune
preserves the series' price context and unit, folds the changes into the
balance, and requires the resulting quantity to be nonnegative.

## Workspace installation

Studio's locked-project activation and reference prepare/accept flows copy Rune files **out of the verified
curated bundle** into `model/implementations/<model>/`. It includes any needed
positive source glob and saves source copies, provenance, configuration and the
reference lock in the same revisioned Save transaction for reviewed updates.
Project-controller source writes are adopted into the editable file inventory,
preserving unsaved editor text; initial installation therefore works before the
first Prototype execution without another reference selection.
The copies are ordinary editable, portable, version-controlled Rune namespace
overrides, handled by Core's existing linker.

`model/implementations/.curated-sources.json` records copied-source provenance and
ownership. Refresh updates/removes only unchanged owned copies. Local edits and explicit deletions are
preserved with a diagnostic; matching pre-existing user files never become owned
files that a later refresh can delete. Invalid hashes, unsafe paths or inconsistent
source origins fail preparation before writes.

Native builds perform the same installation transaction before constructing their
generation graph. Hosts can also call `prepareCuratedImplementationSources` to
include proposed edits in an existing transaction, or
`installCuratedImplementationSources` for the shared Save/readback implementation.
The post-install snapshot supplies the build receipt, so generated artifacts refer
to the actual copied sources. No hidden in-memory Rune override is injected by an
emitter.
