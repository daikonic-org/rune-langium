# Third-party test fixtures

This area contains pinned upstream corpora used as test inputs. These fixtures
retain their upstream licenses rather than the MIT/FSL licenses of authored
Rune-langium and Studio code. Keep upstream headers, license and notice files,
source versions and integrity manifests alongside each cohort.

- [CDM expression editor cohort](cdm-expression/README.md): the ten-operation
  function and linked declarations used by Studio's browser and scope tests.
- [CDM reference examples](cdm-examples/README.md): an unmodified Rune JSON payload
  with metadata/reference and repository-import provenance checks.
- [CDM day-count dispatch closure](cdm-dispatch/README.md): unmodified Rune bodies,
  pinned handwritten Java date-helper references and selector execution cases.
- [CDM calculation-period closure](cdm-calculation-period/README.md): all three
  original dispatch bodies, handwritten Java test/setup references and explicit
  calendar-provider boundary regressions.
- [CDM/Strata frequency contract](cdm-frequency/README.md): pinned CDM types and
  handwritten mapper, Strata 1.7.0 source/binary provenance and exact-count JVM
  oracle cases for the reusable Rune port and its CDM adapter.
- [CDM strike schedule](cdm-strike-schedule/README.md): pinned CDM/FpML declarations,
  handwritten Java mapper and published JVM oracle for positional mapping,
  duplicate preservation and missing-date partial rows.
- [CDM precision rounding](cdm-rounding/README.md): pinned handwritten Java
  implementation and JVM numeric/scale oracle for curated TypeScript/Python bodies.

- [CDM code lists](cdm-codelists/README.md): versioned option-type resource with upstream license, notice and integrity metadata.
- [Currency list](currency-list/README.md): pinned code-to-label currency JSON, upstream license and integrity metadata, exercised through in-memory Rune enum materialization.

- [Complete reference import corpus](reference-example-corpus/README.md): checksum-pinned repository archives and complete discovery/import CI inventory.

## CDM decimal vectors

[`cdm-vectors`](cdm-vectors/README.md) retains CDM 7.9.0 handwritten vector
implementations/tests, their shared arithmetic helper, original declaration slices
and upstream notices. Its 73-case optional JVM oracle covers exact vector operations,
half-even division, zero-divisor omission and cumulative growth.
