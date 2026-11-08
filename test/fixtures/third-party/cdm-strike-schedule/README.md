# CDM commodity strike-schedule reference

`sources.json` pins five Rune declaration slices (15 linked identities) from CDM
7.9.0, FpML 3.13.0 and Rune 10.15.3, matching the native inventory's verified
cohort. Declaration bodies and source headers are unchanged; only whitespace
between declarations is normalized. Original CDM Community Specification 1.0
and Rune Apache-2.0 license/notice files accompany their sources. The pinned FpML
tree supplies no license/notice file; its source bytes and repository provenance
are retained without assigning it the authored code's license.

`java/MapCommodityOptionStrikePriceScheduleImpl.java` is the unmodified
handwritten production implementation. Its Git blob and SHA-256 are recorded in
`sources.json`; `java-oracle.json` independently verifies the identical bytes in
the published CDM 7.9.0 source JAR. Generated Java is not the algorithm reference.

The mapper pairs each price's amount with the date at the same position. It
preserves input order and duplicate amounts/dates, ignores extra dates and omits
the date when the price list is longer. It does not propagate currencies, IDs or
schemes, perform currency conversion, or calculate new prices. CDM's default
runtime validator allows those partial results even though `DatedValue.date` is
required. The Rune port uses an explicit partial constructor; normal standalone
and Studio result validation still reports the missing date.

`cases.json` covers 16 cases, including empty/single lists, missing and extra
dates, unsorted and duplicate values, zero/decimal amounts, leap day, metadata
discard and a 64-step schedule. `missingDateRows` identifies expected validation
failures. Decimal examples stay within the executable targets' existing numeric
profile: this does not promise arbitrary Java BigDecimal precision.

The ordinary Rune port uses reductions for positional lookup and prefix
accumulation, costing O(P*D + P^2) for P prices and D dates. The handwritten Java
implementation uses a linear indexed loop. This performance limitation remains
until Rune has a shared indexed collection primitive; there is no target-specific
alternative algorithm or recursion depth limit.

Reproduce the independent reference check with Python and JDK 21+:

```sh
python3 scripts/verify-strike-schedule.py --cache-dir /tmp/rune-strike-schedule
```

The shared oracle helper downloads checksum-pinned public Maven artifacts,
verifies committed source bytes and launches the authored
`scripts/fixtures/StrikeScheduleOracle.java`. It invokes the actual handwritten
mapper through CDM's published `CdmRuntimeModule`, including its default validator,
and compares all 16 outputs. Normal tests use these expectations offline in strict
TypeScript under all three layouts, standalone Python, curated installation and
the managed Studio worker. Browser tests cover desktop/390px import and execution.
No JVM or CDM Java binary is shipped with generated targets.
