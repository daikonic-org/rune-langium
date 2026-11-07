# CDM adapter and Strata frequency reference

`sources.json` pins five Rune declaration slices from CDM 7.9.0 and Rune 10.15.3,
using the same verified cohort as the native inventory. Bodies and source headers
are unchanged; only inter-declaration whitespace is normalized. The accompanying
CDM Community Specification 1.0 and Rune Apache-2.0 files retain their original
licenses. The handwritten CDM `CdmToStrataMapper.java` is an independent reference,
not generated Java. The pinned CDM root POM selects Strata 1.7.0; no direct
`PeriodsInYear` implementation was found in CDM's handwritten tree.

`strata.json` separately pins `com.opengamma.strata:strata-basics:1.7.0`, its source
JAR and binary dependency hashes. `java/Frequency.java`, `strata-LICENSE.txt` and
`strata-NOTICE.txt` are byte-for-byte extracts of the published source JAR.
The library retains OpenGamma's copyright and Apache-2.0 license.

The owned Rune port in `com.opengamma.strata.basics.schedule` covers `Frequency`
period state, `OfPeriod`, `Term` and `EventsPerYear`; it does not implement the full
Strata API or its string parser. The CDM adapter maps enum/multiplier fields into
that library. Only the library owns the annual-count algorithm. It uses exact
12/total-months or 364/days arithmetic, rejects mixed/non-dividing periods and
returns zero for the special Term frequency. Ordinary construction rejects zero,
negative or over-1000-year periods, including an ordinary 10000-year period;
Term is created separately.

`cases.json` has 57 CDM cases covering every positive divisor, invalid multipliers,
H/C, Term and integer boundaries. `strata-cases.json` adds 13 library construction
and compound-period cases. In Strata `0T` parses as Term, while CDM's additional
positive-multiplier rule rejects it; this is recorded as `referenceExpected`.
Huge week multipliers overflow the JVM period parser; the port rejects the same
input through its bounded period constructor, without promising Java exception
class/message parity.

Reproduce the independent reference check with an existing JDK and Python:

```sh
python3 scripts/verify-strata-frequency.py --cache-dir /tmp/rune-strata-frequency
```

This downloads only the checksum-pinned public Maven artifacts into the supplied
cache, verifies the committed source/license bytes, and runs the authored
`StrataFrequencyOracle.java` against the published binaries. It compares success
values and failure classes to the 70 pinned cases. Normal TypeScript/Python tests
use these expectations offline, exercise the actual Rune source, and verify its
selected caller closure. Project-runtime and Studio tests additionally publish,
verify, install and execute the source pack; removing the CDM adapter restores
unavailability. No Java or Strata binary is shipped to an executable target.
