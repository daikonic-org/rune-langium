# Calculation-period execution evidence

This is a bounded continuation of #646.
The [pinned closure](../../test/fixtures/third-party/cdm-calculation-period/README.md)
preserves CDM 7.9.0's three `ComputeCalculationPeriod` dispatch bodies and their
actual dependencies. The inventory retains its single upstream Rune implementation
path. The FixingDate selector uses the calendar supplied by the project.

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
branch covers only the dates in the upstream Java test. Unknown centers fail a
named condition. Prototype's regression journey instead installs the
[published Strata business calendar](business-calendars.md) and executes the
upstream closure over the London Christmas, Boxing Day and New Year's Day
holidays.

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
`AddDays` and a signed leap-year day prefix. Integer division doubles the
divisor only as far as the quotient requires. Same-month offsets that land
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

## `CalculationPeriod` and `CalculationPeriods`

The handwritten CDM adapters call Strata 1.7.0's `PeriodicSchedule` with
`BusinessDayAdjustment.NONE`. The Rune port implements the shared unadjusted
interval calculation in `com.opengamma.strata.basics.schedule`. Its CDM adapters
live under `impl.cdm.calendar.schedule` and install as two declarations in one
ordinary override file.

`CalculationPeriod` admits exactly one supplied date for each endpoint. It selects
the interval containing the target and marks the schedule's first and last
periods. A target outside the half-open schedule returns an empty period object,
matching the Java builder result. `CalculationPeriods` resolves endpoint
adjustments with the existing Saturday/Sunday adapter, builds the no-stub
schedule, and leaves both flags false. Missing endpoints return an empty list.
Both reuse `CalculationPeriodRange` for day counts.

The shared engine preserves explicit and inferred stub boundaries, the
direction of the roll, and the merge of long stubs. For Strata's FpML adapter,
`NONE` and advisory `EOM` derive a roll from the schedule when appropriate.
`FRN`, `IMMCAD`, and `TBILL` are outside that version's FpML name mapping and
fail explicitly. The Sydney rule is equivalent to the Thursday preceding the
second Friday over the pinned calendar's accepted range. The JVM verifier
checks all 120,000 months against Strata's published calendar.

The [schedule fixture](../../test/fixtures/third-party/cdm-strata-schedules/README.md)
checks the pinned Java cases through standalone TypeScript and Python. The
optimized Prototype journey loads the same Rune sources from a verified bundle
and exercises both functions.
