# Pinned repository metadata fixtures

These authored XML metadata projections retain the pinned Maven coordinates,
properties, source/resource paths and generator/lifecycle configuration used by
the static initialization adapter. They are test data, not runnable Maven builds
or complete upstream POM distributions. Upstream comments and unrelated sections
are not reproduced.

The sources.json manifest records the exact repository commit, original source
path and SHA-256, plus the projection byte hash. CDM is pinned at
c817e5f78b86c2c61caa9291efc1322697bed5ca; Rune FpML at
675b4ca8faa27f71e345f127e890202b08456750. These match the existing codegen
corpus metadata, rather than a live branch or inferred release.

The CDM Common Domain Model working group is the source of the CDM metadata.
Its pinned Community Specification License 1.0 and NOTICE are retained under
cdm/. The pinned FpML tree declares no license/notice file; the FpML fixtures
contain an authored projection of configuration facts, not a relicensed copy of
upstream implementation code. Fixture provenance does not license external
schemas, code lists, generators or Java runtime implementations.

Both POMs name Java tooling and build-produced/filtered Rune inputs. These are
reported as unresolved or unsupported, never executed or silently converted to
working native targets. Original opened repository bytes are read-only inputs.

Pinned CDM license/notice bytes remain exact, including upstream trailing spaces;
path-specific Git whitespace attributes preserve their recorded checksums.
