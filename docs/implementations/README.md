# Native implementation coverage

This is a versioned coverage baseline, not completion of #646.
[`native-coverage.json`](native-coverage.json) records every `[codeImplementation]`
function in the linked cohort, its complete model/namespace/kind/name identity,
source Git blob, linked signature, exclusive effective implementation location and
pinned handwritten Java references. Schema version 3 selects one Rune path, a map
of language-specific targets, or an explicit unimplemented entry.

The audited cohort is CDM **7.9.0** (`0f1f99aef829c23910476981bb91256544cb8569`),
FpML **3.13.0** (`ffda7dffda7cec97f9648123a1ba3cb8aad4e568`) and Rune 10.15.3
(`c0251abb7ed07b1f2d2fe248f0b7f3aa9df7c5f6`). The dependency versions come from
that CDM commit's POM. This test inventory is not a workspace Nightly pin. It makes
no claim about a later moving upstream commit or every historical release.

There are **49 CDM native declarations**, no FpML native declarations, and **11
language-specific implementations per target**. Nine catalog entries use Rune,
including five owned overrides and four partially implemented upstream dispatch
families. Implementation kind does not imply complete selector coverage. The audit parses and links 189 original
source files whose Git object hashes are verified. It rejects parse failures,
unresolved signatures, foreign annotation identity and missing model ownership.

[`rune-feasibility.json`](rune-feasibility.json) separately records each function's
Rune route and prerequisites, tied to the exact cohort and linked signature hash.
The generated inventory includes that assessment, upstream dispatch selectors and
whether each selector has a Rune body. A body is not proof that all its dependencies
execute. Missing/obsolete assessments and changed signatures fail verification.

| Function | Contract covered by TypeScript / Python |
| --- | --- |
| Today | Existing UTC current date |
| Now | UTC current date/time, truncated to whole seconds |
| AddDays | Signed calendar-day addition, safe integer counts, Gregorian leap days |
| DateDifference | Signed second-minus-first calendar-day count |
| LeapYearDateDifference | Count all included days in leap years, with sign reversal; this is not a count of February 29 occurrences |
| DayOfWeek | MON–SUN using the Gregorian weekday |
| ToTime | Integer components, invalid clock values rejected |
| StringContains | Optional input returns false when absent; Java-compatible UTF-16 substring behavior, including empty needles and isolated surrogates |
| RoundToPrecision | Decimal UP/DOWN/HALF_UP of canonical finite target-number inputs; numeric output does not retain scale or trailing-zero formatting |
| RoundToNearest | Exact decimal division before UP/DOWN increment rounding; non-terminating quotients remain errors |
| RoundToSignificantFigures | Decimal significant-digit UP/DOWN/HALF_UP rounding with a positive figure count and explicit finite-result limits |

Implementation publication sources live under
`packages/project-runtime/src/curated-implementations/`. They are selected during
curation and delivered with the serialized bundle. Codegen reads that supplied
payload, rather than finding a CDM fallback at generation time. See
[curated delivery and workspace installation](curated-bundles.md).
Signature guards include type kind/qualified identity, parameter order/names,
cardinality, metadata/argument presence and enum wire values. A changed signature does
not quietly select an old implementation. Both emitters pass their allocated
parameter names to one native-expression call helper. Array returns populate the
existing output accumulator. Explicit installed bindings and authored Rune bodies
retain precedence; Python bindings receive the actual positional arguments.

The utility semantics were checked against the same CDM commit's handwritten
`*Impl.java` references under `rosetta-source/src/main/java/cdm/`. The inventory
records paths, class entrypoints, original Git blobs, SHA-256 hashes and tests;
empty data-provider stubs are separate from algorithms. Generated Java and test-only
implementations are excluded as production references. Implementations use the toolchain's existing
Temporal date and numeric contracts; this is not a claim to support every Java
LocalDate/BigDecimal value or external JVM behavior.

## Remaining integrations

The **40 functions without language-specific implementations remain tracked**. Two now
have explicit Rune source implementations: `EmptyExecutionDetails` and
`EmptyTransferHistory`. Their empty results implement their actual clearing
contracts; they are not generic fallbacks for missing business logic.
The [Rune source pack](../../examples/implementations/cdm/README.md) also includes
the single duplicate-preserving `PopOffDateList` implementation. Installing a
curated bundle copies those ordinary namespace overrides into the workspace,
across both executable targets. Native alternatives are not selected or shipped
for those functions. The inventory checks their source hashes,
full upstream signatures and effective declaration selection.

External data requirements do not make a function inexpressible in Rune. Rune
can select/transform supplied calendars, observations or reference data, or call
explicitly bound data-access helpers. Acquisition and small runtime primitives
remain separate requirements. Clock access, exact decimal arithmetic and current
string/collection primitive limits are recorded separately from business logic.

Existing Rune dispatch families such as `DayCountBasis`, `YearFraction`,
`ComputeCalculationPeriod` and `ProcessFloatingRateReset` must retain their upstream
bodies. Missing selectors and transitive dependencies still need execution evidence;
the latter family includes an empty `CompoundIndex` branch. The pinned
[day-count closure](../../test/fixtures/third-party/cdm-dispatch/README.md) now
executes all 9 and 11 existing selector bodies respectively, in strict TypeScript
under all three layouts and standalone Python. Missing defaults/selectors stay
unavailable. These source regressions preserve documented upstream quirks and do
not establish financial-standard or complete handwritten-Java parity.

The [calculation-period closure](calculation-periods.md) also exercises all three
`ComputeCalculationPeriod` bodies with explicit finite test calendars in strict
TypeScript, standalone Python and the real Studio worker. The pinned handwritten
Java test supplies its three baseline expectations. Production `FixingDate` still
needs an actual holiday provider.

[`PeriodsInYear`](../../packages/project-runtime/src/curated-implementations/rune/frequency.rosetta)
is a thin CDM adapter over the owned Rune port of OpenGamma Strata 1.7.0's
`Frequency` construction and `EventsPerYear`, in the original
`com.opengamma.strata.basics.schedule` namespace. The library owns exact annual
count rules; the adapter owns CDM multiplier/period constraints and conversion.
The [frequency evidence](../../test/fixtures/third-party/cdm-frequency/README.md)
checks 57 adapter and 13 library cases against the published JVM implementation,
strict TypeScript layouts and Python, plus curated installation and Prototype.
This is a bounded library port; no direct upstream CDM `PeriodsInYear` Java binding
was found. The catalog selects one Rune path with its library support file, with
no parallel target-specific implementation.

[`MapCommodityOptionStrikePriceSchedule`](../../packages/project-runtime/src/curated-implementations/rune/strike-schedule.rosetta)
is an ordinary Rune override of the handwritten CDM mapper. It pairs amounts and
dates by position, keeps duplicates and ordering, ignores extra dates and returns
explicit partial rows when dates run out. Normal result validation still reports
the missing required dates. The [16-case reference cohort](../../test/fixtures/third-party/cdm-strike-schedule/README.md)
matches the published CDM 7.9.0 JVM implementation, strict TypeScript layouts,
Python and the managed Studio worker. Prices are copied without arithmetic or
currency conversion. Shared Codegen analysis recognizes the counted reductions
and emits an indexed TypeScript pass when the whole lookup chain is pure and
unbound. It prepares each captured input once, giving O(P+D) time/allocation.
The source folds and fallback path remain quadratic; Python shares the local
reduction optimization but retains per-call lookup input preparation.

[The rounding family](../../test/fixtures/third-party/cdm-rounding/README.md) uses
shared TypeScript BigInt coefficient rounding and Python standard-library decimal
contexts/exact rational arithmetic. Its 309-case JVM oracle covers precision,
increments and significant figures, including 12 non-terminating-division errors.
Java decimal values/scales and target numeric results are recorded separately.
The finite-number API retains signed direction/ties and Rune preconditions;
overflow results fail explicitly. These catalog entries have no parallel Rune path.

| Integration family | Representative remaining functions / requirements |
| --- | --- |
| Code-list loading | `LoadCodeList`: emit prepared resource documents into standalone targets and use the same resolver as Prototype; the upstream Rune `ValidateFpMLCodingSchemeDomain` body must be preserved |
| Calendars and schedules | `BusinessCenterHolidays`, `ResolveAdjustableDate(s)`, `GetNonBusinessDates`, `CalculationPeriod(s)`, `CalculationPeriodRange`, `ComputeCalculationPeriod`; explicit holiday data, roll/stub rules, model-version semantics |
| Day counts and decimal mathematics | `YearFraction`, `DayCountBasis`, `VectorOperation`, `VectorGrowthOperation`; wider decimal representation and day-count parity |
| Market/reference data | `FloatingRateIndexMetadata`, `GetMarketRates`, `IndexValueObservation`, `ResolveRateIndex`, `ResolveReset`, `ResolveObservation`; explicit supplied data/providers and versioned identities |
| Timezone mappings | `TimeZoneFromBusinessCenterTime`, `ResolveTimeZoneFromTimeType`; business-center data plus named-zone/DST rules |
| Domain construction and execution | Portfolio, reset processing, payout, billing, key creation and commodity schedule functions; authoritative algorithms, explicit external dependencies and fixture workflows |

Several functions require integrations that cannot be inferred from their input
shapes. Before marking a family available, provide target implementations,
packaged data/dependencies, upstream/differential expectations and a Prototype
workflow. Do not infer data from a scheme URI, invent a holiday calendar or remove
a condition to make an example execute. [The resource matrix](../reference-examples/build-resources.md)
records the current explicit JSON-list boundary.

Prefer Rune where its semantics are sufficient. The example repository already
contains a positional, duplicate-preserving Rune implementation of
`PopOffDateList`, supplied through an explicit declaration override. Upstream's
coding-scheme validator also has a Rune body. The current Rune list `contains`
operator is not a substring operation; it must not replace `StringContains`
without a language-level semantic change and parity tests.

## Verification and updates

The [reviewed source pins](../../scripts/fixtures/native-implementation-sources.json) define the input format for `--sources`. After building Core, Codegen and project-runtime:

```bash
pnpm run verify:native-implementations
node scripts/audit-native-implementations.mjs --sources path/to/reviewed-cohort.json
node scripts/audit-native-implementations.mjs --issue-markdown /tmp/native-inventory.md
```

Use `--feasibility path/to/reviewed-assessments.json` with a different cohort;
assessments are never silently applied across model versions. `--issue-markdown`
writes the table for #646 from the same verified inventory; it does not publish it.

The default check compares source paths/blobs, ownership, signatures, Rune source
hashes/assessment, exclusive implementation locations and handwritten Java
references to the committed inventory. It also checks generated owned-source text
and pinned dispatch slices/legal notices. New declarations and changed/missing
implementations fail the check. Review changes before regenerating with
`node scripts/audit-native-implementations.mjs --write`. Existing unavailable
entries are an explicit baseline, not a zero-gap success report. CI runs the check
after the ordinary workspace build. Cached source bytes are verified on every
read; a corrupt cache fails, and no partial inventory is accepted.

Run Codegen's `test/implementations` and Python runtime suites, and Studio's real
worker suite. `test/e2e/native-implementations.spec.ts` executes AddDays and signed
DateDifference from a publication-produced curated artifact through the real
preview worker at desktop/390px with viewport and axe checks. The browser fixture
also checks the installed frequency adapter, positional strike mapper and native
rounding with enum inputs and the original Rune guard. These
are minimal declaration cohorts; standalone tests cover the other bundled
utilities and exact signatures.

CDM/Rune source references retain their upstream license and notice files. The inventory
commits factual signatures/hashes, not copied source trees. Generated TypeScript
continues to use the existing ISC-licensed `@js-temporal/polyfill`; Python uses
its standard runtime library. No OpenGamma or other new financial engine has been
silently added or represented as available.
