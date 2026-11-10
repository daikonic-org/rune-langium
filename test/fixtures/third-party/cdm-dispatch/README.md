# Pinned CDM day-count dispatch closure

CDM 7.9.0 and Rune 10.15.3 source pins, original Git blob hashes and copied-file
SHA-256 hashes are in [sources.json](sources.json). These inputs retain their
upstream licenses/notices beside the fixtures: CDM's root Community Specification
License 1.0 and Rune's Apache-2.0 license. Java files are unmodified
handwritten implementations/tests from the same CDM commit, not generated Java.

The six Rune files are dependency-closed slices selected by Codegen's canonical
declaration selection: 13 declaration identities, including both dispatch families,
their enum and date-helper dependencies. The shared fixture extractor retains
original header and declaration CST bytes; only inter-declaration whitespace is
normalized. Normal tests use these local bytes without downloads.

The [regression cases](cases.json) cover all 9 upstream `DayCountBasis` and
11 upstream `YearFraction` bodies, plus the curated additions. They also cover
unavailable selectors, optional period/termination inputs, signed and empty
ranges, leap/century dates and month ends. The suite compiles strict TypeScript
in all three layouts and runs the same cases in standalone Python. The date
helpers and additions are installed Rune sources.

The curated basis selectors are ACT/364 (364), 1/1 (1), 30E/360.ISDA (360) and
ACT/ACT.ISMA (365, the nominal basis used by CDM for ICMA). The nominal basis
does not supply an accrual calculation for a coupon stub.

The AFB selector uses [Strata 1.7.0's implementation of Actual/Actual AFB](https://repo.maven.apache.org/maven2/com/opengamma/strata/strata-basics/1.7.0/strata-basics-1.7.0-sources.jar)
under `com.opengamma.strata.basics.date`. It counts whole years from the end,
then divides the remaining days by 366 when the half-open remainder includes a
leap day and by 365 otherwise. Strata uses ordinary anniversary clamping. For
example, 2024-02-29 to 2025-02-28 is 365/366. The signed implementation matches
`DayCounts.ACT_ACT_AFB.relativeYearFraction` across 15 JVM cases using the
[checksum-pinned Strata 1.7.0 jars](../cdm-frequency/strata.json).

ISMA year fractions require the reference coupon periods described by
[ICMA's day-count rules](https://www.icmagroup.org/assets/Appendix-A5-Jan-2022-update.pdf).
RBA Bond Basis requires the regular payment frequency and first/final stub
context under section 4.6.1(xi) of the
[2021 ISDA definitions](https://www.sc.com/en/uploads/sites/66/content/docs/2021-ISDA-Interest-Rate-Derivatives-Definitions-as-of-30-September-2021.pdf).
Those inputs are absent from the CDM callable signature. The corresponding
selectors remain unavailable.

There is no handwritten Java implementation/test for either dispatch family in
this pinned release. The adjacent Java date-helper tests supply independent numeric
expectations for the native-utilities suite. We do not run the Java project or claim
complete Java/financial-standard parity. Null Java arguments also fall outside the
required Rune date signatures.

Two pinned Rune behaviors are preserved explicitly: `30E/360.ISDA` reads
`endDate.day` in the `startDay` else branch, and its termination test affects end-day
adjustment; `CAL/252` divides calendar-day difference by 252. These are source
regressions, not claims that the formulas implement all published financial rules.

After the normal verified native inventory audit has populated its source cache:

```sh
node scripts/build-cdm-dispatch-fixtures.mjs           # verify
node scripts/build-cdm-dispatch-fixtures.mjs --write   # deliberate regeneration
```

Use `--cache-dir` with an existing verified audit cache. Review source pins,
declaration closure, licenses, notices, Java references and fixture hashes together.
