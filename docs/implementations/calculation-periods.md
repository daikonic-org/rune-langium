# Calculation-period execution evidence

This is a bounded continuation of #646, not a production calendar integration.
The [pinned closure](../../test/fixtures/third-party/cdm-calculation-period/README.md)
preserves CDM 7.9.0's three `ComputeCalculationPeriod` dispatch bodies and their
actual dependencies. The inventory retains its single upstream Rune implementation
path; no duplicate TypeScript/Python algorithm or curated calendar is added.

| Selector | Preserved behavior | Required data |
| --- | --- | --- |
| `Standard` | Return the supplied calculation period | Current period |
| `SetInAdvance` | Return the supplied prior period | Prior period; absence fails the required output contract |
| `FixingDate` | Offset the prior period when resets are relative to its start, otherwise the current period | Reset settings, adjusted dates and an explicit holiday provider for the supplied centers |

The first three cases reproduce the pinned handwritten
`ComputeCalculationPeriodTest.shouldDeterminePeriod` expectations. Its
`CalculatedRateTestHelper.period` and `FloatingRateTestHelper.initResetDates`
are copied unmodified alongside the test and provenance manifest. This release
has no handwritten production Java algorithm for the dispatch family. The suite
does not run the JVM or establish broader financial-standard parity.

The other cases cover positive/negative/zero business-day offsets, weekends,
combined and duplicate centers, a supplied reference value, leap day, missing
optional data, and unknown calendars. An absent selector retains the unavailable
upstream default. Inputs remain unchanged. TypeScript is strictly compiled in
single-file, per-namespace and barrel layouts; the same cases execute in standalone
Python and the real Studio worker. The worker also removes the calendar override:
the two independent selectors keep working, while `FixingDate` fails if it reaches
the missing provider. The preview marks the provider itself unavailable.

The owned [test calendar](../../test/fixtures/regressions/calculation-period/calendars.rosetta)
is an ordinary Rune namespace override, never a bundled implementation. `TEST_A`
and `TEST_B` are synthetic centers with explicitly listed dates. Its empty `GBLO`
branch is only for the finite dates in the upstream Java test; it is not a London
holiday calendar. Unknown centers fail a named condition. Prototype's regression
journey uses a verified, publication-produced multi-document bundle for the
upstream closure and native date helpers, with the calendar supplied as editable
workspace Rune source.

The managed Prototype journey also exposed a shared declaration-selection bug:
a caller reached only the abstract default of a transitive dispatch family.
Selection now retains every effective selector and its dependencies, respecting
Core's override resolution. Both selected standalone targets and the browser
journey execute the authored caller through this same closure.

The tests also exposed two shared TypeScript emission issues: built-in aliases such
as `int` must use the target profile's native type at function boundaries and avoid
imports for omitted built-ins; Temporal constructors can yield absence and must
use ordinary presence/cardinality shaping when placed in a list. Both fixes reuse
the existing profile and expression-presence machinery without casts.

## `PeriodsInYear` remains an assessed gap

Its frequency branching and arithmetic are expressible in Rune. The pinned
release supplies only an abstract signature and a caller in
`CalculateYearFraction`, with no handwritten Java algorithm/test or numeric
expectations for this function. The signature takes a `CalculationPeriodFrequency`
and returns an integer; it has no start/end dates or trade term.

Before selecting an implementation, establish the contracts for hourly/daily/weekly
frequencies, month multipliers that do not divide twelve, multi-year frequencies,
and `T`/`C`. A constant day/week count, rounded quotient, zero multi-year result or
term default would introduce business rules absent from this evidence. The
versioned Rune-feasibility assessment records this prerequisite, and the catalog
continues to report the function unimplemented.
