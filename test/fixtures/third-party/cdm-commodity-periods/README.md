# CDM commodity calculation periods

This cohort pins CDM 7.9.0, FpML 3.13.0 and Rune 10.15.3. The original
handwritten `CalculateCommodityCalculationPeriodsImpl` and the upstream
declarations retain their original licenses and provenance. The oracle checks
the handwritten source against the published CDM source JAR and runs the
compiled default through CDM's normal Guice bindings.

Nineteen JVM cases cover absent frequency inputs, missing dates, equal and reversed
dates, signed dates, day and week intervals, and month and year clamping.
Each step starts at the previous boundary. The result includes the first
boundary on or after termination, even if that step overshoots. For a balanced
monthly schedule the port moves each advanced boundary to the first of its month.
The target implementations use the shared Temporal date range. The fixture
records Java's wider-range overshoot and checks that both targets reject it.

The pinned FpML type defines a term schedule by its effective and termination
dates and requires multiplier 1. The port returns those endpoints and emits
one when they are equal. The Java loop stalls on a forward term schedule.
The generated-target tests cover the FpML term cases and five invalid-multiplier
guards separately from the JVM cases.

```sh
python3 scripts/verify-calendar.py --cache-dir /tmp/rune-cdm-oracle --suite cdm-commodity-periods
```

Codegen executes the same cases in strict TypeScript under all three layouts and
standalone Python. The Prototype test consumes the actual publication payload
through a locked CDM/FpML reference closure.
