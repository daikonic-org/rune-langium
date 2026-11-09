# CDM calculation schedules

This cohort preserves the linked CDM 7.9.0 declarations, their handwritten Java
implementations and tests, and one business-center code list with its original
source provenance. The fixture includes 74 cases covering regular periods,
endpoint admission, explicit and inferred stubs, invalid combinations, term
frequency, the supported special rolls, and weekend-adjusted plural schedules.
The 32 parameterized regular and stub cases are taken from
`CalculationPeriodImplTest`. The quarterly plural schedule starts from the
example in `CalculationPeriodsImplTest`.

The adapters call OpenGamma Strata 1.7.0. The source and runtime artifact hashes
are pinned in [the oracle manifest](java-oracle.json) and its shared dependency
manifest. The library references are `PeriodicSchedule.java`,
`StubConvention.java`, `RollConvention.java`, and `DayRollConventions.java` in
`com/opengamma/strata/basics/schedule`. The FpML mapping is in
`com/opengamma/strata/config/base/RollConvention.ini` in the
[published Strata sources](https://repo.maven.apache.org/maven2/com/opengamma/strata/strata-basics/1.7.0/strata-basics-1.7.0-sources.jar).

Run the optional JDK 21 oracle with
`python3 scripts/verify-calendar.py --suite cdm-strata-schedules --cache-dir /path/to/oracle-cache`.
It compares the complete outputs and rejection classes and checks the Sydney
roll against the actual Strata calendar for years 0000 through 9999.
