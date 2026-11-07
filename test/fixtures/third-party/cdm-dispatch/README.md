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

The [regression cases](cases.json) cover all 9 `DayCountBasis` and 11 `YearFraction`
selector bodies, every enum value missing a default implementation, optional
period/termination inputs, signed and empty ranges, leap/century dates and month
ends. The suite compiles strict TypeScript in all three layouts and executes the
same cases in standalone Python. Native date leaves are supplied as publication
payloads before generation; a bare declaration cannot discover an implementation.

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
