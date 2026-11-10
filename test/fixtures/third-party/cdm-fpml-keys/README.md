# CDM FpML keys

These slices pin the original CDM 7.9.0 key declarations and handwritten Java
implementations, FpML 3.13.0 data and enum declarations, and Rune 10.15.3
basic types and annotations. See [sources.json](sources.json) for Git blobs,
SHA-256 digests and license and notice paths.

The Java oracle used the immutable objects from
`com.regnosys.rune-fpml:rosetta-source:3.13.0` and the pinned CDM
`CreateAssetKeyImpl`, `CreateKeyImpl` and `CreateKeyForQuotedCurrencyPairImpl`.
The layout fingerprint derives from each reachable immutable model's generated
`hashCode` field order, Java types and parent. Its source JAR SHA-256 is
`1d97cf826d18736a66b4d3badf8e5f1b5d3f3d6313ec841f554a51ef3a6916ec`.
The complete comparison covered empty and populated objects across 662 data
types and 275 handwritten key results. Of those keys, 272 have the required
Rune prefix. The generated targets matched those 272 results.

[cases.json](cases.json) keeps representative inputs and the Java results.
The `json` string preserves decimal spelling, including the distinct 1.0
and 1.00 cases. The suite serializes the selected bindings, reloads them through
the project graph and runs the same fixtures in strict TypeScript and Python.
It exercises absent operands, a concrete subtype with an inherited field,
list order, enum contributions, UTF-16 strings and a zoned timestamp. The
complete linked layout is checked by `pnpm run verify:native-implementations`.
