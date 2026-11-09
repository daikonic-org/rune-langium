# CDM calendar helpers and adjustable dates

The fixture builder selects original declarations from CDM 7.9.0 and Rune
10.15.3. It preserves original licenses, notices, handwritten Java implementations
and tests, and the shared `AdjustableDateUtils` helper. The oracle checks seven
production sources against the published CDM source JAR and executes their
default bindings with the pinned CDM and Strata binaries.

The 76 cases cover signed offsets and date differences, century and 400-year
boundaries, all seven weekdays, year zero, and the shared Temporal date range.
Leap-year differences count all included days in leap years. The oracle renders
extended years with six digits to match the target date wire format.

`ResolveAdjustableDate` follows the CDM 7.9.0 Java helper's Saturday/Sunday
calendar and all eight convention values. Cases cover month-crossing modified
conventions, supplied adjusted dates, and unresolved relative dates.
`ResolveAdjustableDates` shares the convention helper. It preserves duplicates
and order, falls back from an empty adjusted list to explicit unadjusted dates,
and represents the Java adapter's absent relative or periodic result as an
empty Rune list. Business center calendars remain a separate integration.

Run the independent oracle with JDK 21 and the shared artifact cache.

```sh
python3 scripts/verify-calendar.py --cache-dir /tmp/rune-cdm-oracle
```
