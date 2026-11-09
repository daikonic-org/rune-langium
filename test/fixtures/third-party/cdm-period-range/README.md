# CDM calculation period range

The fixture builder pins declaration slices from CDM 7.9.0 and Rune 10.15.3,
with original license and notice files. `sources.json` records upstream paths,
Git blobs and SHA-256 digests. The JVM verifier checks the handwritten
`CalculationPeriodRangeImpl.java` bytes against the published CDM source JAR
and calls the published default implementation.

The 22 cases cover equal dates, leap days, year and century boundaries, a long
range, missing and reversed dates, and supplied adjustment conventions. The Java
constructor counts the half-open interval, sets both period flags to false
and leaves `dateAdjustments` unused. Rune preserves the optional signature
and reports missing or reversed dates through named conditions. Java reports
`NullPointerException` or `IllegalArgumentException` for those cases.

The installed Rune override uses `DateDifference` and `LeapYearDateDifference`.
Tests execute the same cases in three strict TypeScript layouts and standalone
Python. They also call the upstream `Create_CalculationPeriodBase` adapter with
the range result. The export reports the unavailable `LoadCodeList` dependency
from the optional adjustment type. Range execution uses the supplied dates and
the curated date helpers.

Run the optional oracle with JDK 21 and the shared artifact cache.

```sh
python3 scripts/verify-period-range.py --cache-dir /tmp/rune-cdm-oracle
```
