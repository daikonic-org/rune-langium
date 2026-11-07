# Pinned CDM calculation-period closure

[sources.json](sources.json) records CDM 7.9.0/Rune 10.15.3 source pins, original
Git blob hashes and copied-file SHA-256 hashes. The twelve Rune files are canonical
dependency-closed declaration slices (53 identities), preserving original headers
and declaration CST bytes. Only inter-declaration whitespace is normalized.
CDM's Community Specification License 1.0 and Rune's Apache-2.0 notices/licenses
are included; these third-party inputs retain their upstream licenses.

The three copied Java files are the unmodified handwritten calculation-period
test and its two setup helpers. Their provenance and integrity are checked with
the sources. They are reference evidence, not generated Java or a JVM execution
claim. The first three [cases](cases.json) reproduce that test's expected periods;
the remaining cases are authored boundary regressions. Production holiday-calendar
availability is not claimed.

The [owned synthetic calendar](../../regressions/calculation-period/calendars.rosetta)
is supplied explicitly as a normal Rune override. It is outside the upstream
fixture and outside the publication catalog. See the
[execution assessment](../../../../docs/implementations/calculation-periods.md)
for tested boundaries, preserved selector behavior, missing-data behavior and the
separate [CDM/Strata frequency implementation](../cdm-frequency/README.md).

After the native audit has populated its verified cache, regenerate or check both
dispatch cohorts with `scripts/build-cdm-dispatch-fixtures.mjs` (`--write` for an
intentional refresh, `--cache-dir` for an existing audit cache). Review source
pins, closure, original bytes, notices and reference hashes together.
