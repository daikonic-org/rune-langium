# CDM observation resolution

[Sources and hashes](sources.json) pin the CDM 7.9.0 contracts and dependency
closure. The [handwritten arithmetic test](java/ResolveObservationAverageTest.java)
supplies the five prices and expected USD-per-share mean. The
[handwritten rate provider](java/ResolveRateIndexImpl.java) supplies the
`0.0875` fixture rate. The curated rate resolver selects from the project's
nominated snapshot.

The [29 cases](cases.json) cover exact identity including scheme metadata,
repeated requests, arithmetic, geometric and harmonic means with and
without weights, and missing or ambiguous readings and rates. Providers
supply one weight per observation identity and name the aggregate when
multiple readings are combined. The original unweighted arithmetic helper
preserves the price's unit, per-unit basis, expression and type.

The Prototype rate example imports the published
`rune.resources.cdm.FloatingRateIndex` enum from the same pinned list used in
the [FRO fixture](../cdm-floating-rate-metadata/README.md). Its fixture lookup
maps the selected external code to the member expected by CDM's original
signature. The combined observation closure fits barrel and per-namespace
TypeScript layouts. Its focused rate export fits single-file output.
