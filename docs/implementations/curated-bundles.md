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
path. It stamps `$implementationSources` onto the serialized model copy with
source bytes, SHA-256 hashes, model and upstream commit, plus the owned MIT license
and any named third-party license/notice files.
Original upstream archives, source text and Rune bodies remain unchanged. The
normal immutable serialized-artifact checksum covers these payloads in both the
complete and per-namespace artifacts; normal cohort publication stays atomic.

Reference loading verifies the existing manifest, artifact checksum and cohort.
Generation checks the supplied binding's identity, annotation and linked signature
before emission, and retains authored Rune and explicit project-binding precedence.
It never searches a model-specific implementation registry or fetches code.
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

The installed `IndexValueObservation` and `GetMarketRates` Rune overrides call
`impl.cdm.market.ReadMarketObservations` with the full CDM interest-rate index
and requested dates. Bind this function to a project declaration with the same
signature using a declaration override. A Rune provider is portable across
TypeScript, Python and Studio. A provider should return one `DatedValue` per
requested date. The overrides preserve requested order and reject missing or
duplicate observations. Code-list enums can type provider inputs that are
backed by a list. Dated market observations still require a project data source.

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
