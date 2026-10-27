# Native implementation coverage

This is a versioned coverage baseline, not completion of #646.
[`native-coverage.json`](native-coverage.json) records every `[codeImplementation]`
function in the linked cohort, its complete model/namespace/kind/name identity,
source Git blob, linked signature and coverage for both executable targets.

The audited cohort is CDM `1704b23907b3dc4b87ba7a0133cb75aad9b43c77`, FpML 3.8.0
(`ab92e75df45e882e6775a5ce94dc6f520fe446f6`) and Rune 10.15.3
(`c0251abb7ed07b1f2d2fe248f0b7f3aa9df7c5f6`). The dependency versions come from
that CDM commit's POM. This test inventory is not a workspace Nightly pin. It makes
no claim about a later moving upstream commit or every historical release.

There are **49 CDM native declarations**, no FpML native declarations, and **9
bundled implementations per target**. The audit parses and links 192 original
source files whose Git object hashes are verified. It rejects parse failures,
unresolved signatures, foreign annotation identity and missing model ownership.

| Function | Contract covered by TypeScript / Python |
| --- | --- |
| Today | Existing UTC current date |
| Now | UTC current date/time, truncated to whole seconds |
| AddDays | Signed calendar-day addition, safe integer counts, Gregorian leap days |
| DateDifference | Signed second-minus-first calendar-day count |
| LeapYearDateDifference | Count all included days in leap years, with sign reversal; this is not a count of February 29 occurrences |
| DayOfWeek | MON–SUN using the Gregorian weekday |
| ToTime | Integer components, invalid clock values rejected |
| PopOffDateList | Remove the last position without mutating input or dropping earlier duplicates; empty/absent lists return empty lists |
| StringContains | Optional input returns false when absent; Java-compatible UTF-16 substring behavior, including empty needles and isolated surrogates |

Implementations live under `packages/codegen/src/implementations/<target>`.
Signature guards include type kind/qualified identity, parameter order/names,
cardinality, metadata/argument presence and enum wire values. A changed signature does
not quietly select an old implementation. Both emitters pass their allocated
parameter names to one native-expression call helper. Array returns populate the
existing output accumulator. Explicit installed bindings and authored Rune bodies
retain precedence; Python bindings receive the actual positional arguments.

The utility semantics were checked against the same CDM commit's `*Impl.java`
references under `rosetta-source/src/main/java/cdm/`. Source provenance in the
inventory links the declarations. Implementations use the toolchain's existing
Temporal date and numeric contracts; this is not a claim to support every Java
LocalDate/BigDecimal value or external JVM behavior.

## Remaining integrations

The **40 unavailable functions remain open**. Their exact names and reasons are
in the JSON inventory. They must not become empty/default successful values.

| Integration family | Representative remaining functions / requirements |
| --- | --- |
| Code-list loading | `LoadCodeList`: emit prepared resource documents into standalone targets and use the same resolver as Prototype; the upstream Rune `ValidateFpMLCodingSchemeDomain` body must be preserved |
| Calendars and schedules | `BusinessCenterHolidays`, `ResolveAdjustableDate(s)`, `GetNonBusinessDates`, `CalculationPeriod(s)`, `CalculationPeriodRange`, `ComputeCalculationPeriod`, `PeriodsInYear`; explicit holiday data, roll/stub rules, model-version semantics |
| Day counts and decimal mathematics | `YearFraction`, `DayCountBasis`, `RoundToNearest/Precision/SignificantFigures`, `VectorOperation`, `VectorGrowthOperation`; financial rounding/precision and day-count parity, not approximate floating-point replacements |
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
```

The default check compares source paths/blobs, ownership, signatures and target
availability to the committed inventory. New declarations and changed/missing
implementations fail the check. Review changes before regenerating with
`node scripts/audit-native-implementations.mjs --write`. Existing unavailable
entries are an explicit baseline, not a zero-gap success report. CI runs the check
after the ordinary workspace build. Cached source bytes are verified on every
read; a corrupt cache fails, and no partial inventory is accepted.

Run Codegen's `test/implementations` and Python runtime suites, and Studio's real
worker suite. `test/e2e/native-implementations.spec.ts` executes AddDays and signed
DateDifference through the real preview worker at desktop/390px with viewport and
axe checks. The browser fixture is a minimal declaration cohort; standalone tests
cover the other bundled utilities and exact signatures.

CDM/Rune source references retain their upstream Apache-2.0 terms. The inventory
commits factual signatures/hashes, not copied source trees. Generated TypeScript
continues to use the existing ISC-licensed `@js-temporal/polyfill`; Python uses
its standard runtime library. No OpenGamma or other new financial engine has been
silently added or represented as available.
