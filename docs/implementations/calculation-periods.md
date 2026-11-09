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
upstream closure and Rune date helpers, with the calendar supplied as editable
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

## Gregorian arithmetic and weekend adjustment

The curated bundle installs four calendar overrides under the original
`cdm.base.datetime` names. `DateDifference` uses Rune date subtraction.
`impl.cdm.calendar` provides the bounded 400-year era calculation for
`AddDays` and a signed leap-year day prefix. Same-month offsets that land
on days 1–28 construct the date directly. `DayOfWeek` checks seven possible
remainders from a known Monday. The original TypeScript/Python payloads remain
readable in previously published bundles.

`ResolveAdjustableDate` preserves an explicitly adjusted date and uses the
weekend adapter under `impl.cdm.calendar.adjustments` for an unadjusted date.
The pinned Java helper uses Saturday/Sunday holidays. Modified conventions
reverse direction when the first adjustment crosses a month. Relative
offsets without a supplied adjusted date return absence. The
[calendar fixture](../../test/fixtures/third-party/cdm-calendar/README.md)
compares both generated targets with the published handwritten Java bodies.

## Range construction from supplied dates

`CalculationPeriodRange` installs as an ordinary Rune override. It calls
`DateDifference` and `LeapYearDateDifference` for the half-open interval and
sets both period flags to false. The original signature permits optional dates.
The body checks that both dates are supplied and the end is at or after the
start. The adjustment argument remains in the signature and is unused by the
published Java constructor.

The [range fixture](../../test/fixtures/third-party/cdm-period-range/README.md)
compares 22 cases against the published CDM 7.9.0 handwritten implementation.
Strict TypeScript layouts and standalone Python also exercise the upstream
`Create_CalculationPeriodBase` adapter on the result. The export retains the
`LoadCodeList` warning from the optional adjustment type. The managed worker and
Prototype exercise the range with the curated date helpers.

## `PeriodsInYear` delegates to a Rune Strata port

The pinned release has no direct handwritten Java `PeriodsInYear` implementation.
Its scheduler's handwritten `CdmToStrataMapper`, however, converts frequencies
using `Frequency.parse`, and the CDM POM pins OpenGamma Strata 1.7.0. That library
provides a concrete exact-count algorithm in `Frequency.eventsPerYear`.

The reusable Rune implementation lives in
`com.opengamma.strata.basics.schedule`: `Period` retains year/month/day components,
`OfPeriod` implements positive bounded construction, `Term` creates the special
singleton's period, and `EventsPerYear` implements exact annual counts and failure
conditions. The CDM override only maps its frequency and retains CDM's positive
multiplier, supported period and Term-multiplier constraints.

Month/year periods use exact division of 12 by total months; day/week periods use
364 days/52 weeks. Term returns zero. Non-dividing, mixed and unsupported periods
fail; no fractional estimate is rounded to an integer. All positive divisors are
covered, including day counts accepted by Java beyond those listed in its Javadoc.
Strata's parser accepts `0T`, but CDM's multiplier condition rejects it. Large
week counts that overflow Java's period conversion are rejected by the port's
bounded day-component constructor.

The [pinned cohort](../../test/fixtures/third-party/cdm-frequency/README.md) includes
the unmodified handwritten Strata source, license/notice and CDM mapper. Seventy
cases run against published checksum-pinned Strata binaries on the JVM and the
generated TypeScript/Python port. This is an explicit adapter choice based on the
available reference; it does not assert a missing direct CDM binding existed or
port the full Strata scheduling API. It needs no production calendars or JVM
dependency at runtime.
