# CDM market observations

[Sources and hashes](sources.json) pin the original CDM 7.9.0 declarations,
licenses and handwritten Java references. The upstream
[empty provider](java/IndexValueObservationEmptyDataProvider.java) requires
consumers to supply observations. The
[test provider](java/IndexValueObservationTestDataProvider.java) supplies
fixture values by floating index, tenor and date. The paired
[single](java/IndexValueObservationTest.java) and
[multiple](java/IndexValueObservationMultipleTest.java) tests provide numeric
expectations for the same three-month EURIBOR series.

The two curated Rune overrides preserve their original signatures.
`IndexValueObservation` forwards the complete `InterestRateIndex`.
`GetMarketRates` wraps the original `FloatingRateIndex` in that choice and
requests dates in a single provider call. The original
`IndexValueObservationMultiple` body is exercised through its dependency.

The [16 cases](cases.json) replay the six upstream numeric assertions using
explicit rows and exercise list ordering, repeated requests, distinct tenors,
inflation, unknown indices, missing dates and duplicate observations. The
fixture supplies a Rune provider through an explicit declaration override.
The same fixture executes through strict TypeScript, standalone Python and
Studio Prototype. Actual market rates come from a project-supplied provider.
