# CDM floating-rate metadata

[Sources and hashes](sources.json) pin the original CDM 7.9.0 contracts and
their dependency closure, including the upstream `ValidateFloatingRateIndexName`
body and the original floating-rate-index 3.10 codelist. The pinned CDM tree
provides neither handwritten Java bodies for these two declarations nor a
versioned FRO matrix. The test provider uses illustrative version dates and
definitions.

`FloatingRateIndexMetadata` looks up the index on the project's nominated
metadata date. `ExtractFloatingRateOptionData` selects the matrix version on
the trade date and requires a matching index. Selection checks half-open version
intervals, rejects overlapping versions and duplicate index definitions, and
respects removal from a later version. The installed Rune source declares
`ReadFloatingRateIndexMatrix` as an explicit project-provider dependency.

The [14 cases](cases.json) cover historical and current lookup, version
boundaries, missing indices, invalid and overlapping versions, duplicate rows,
the preserved validator and the original codelist wire code. The catalog fixture
publishes that codelist as a Rune enum. TypeScript, Python and Studio Prototype
exercise the same installed lookup.
