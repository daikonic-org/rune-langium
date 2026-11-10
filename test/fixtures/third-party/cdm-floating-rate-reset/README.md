# CDM floating-rate reset dispatch

The pinned CDM 7.9.0 declarations retain their original Screen, OIS,
OvernightAvg and Modular bodies. The test links the selected dependencies,
installs the curated source pack and executes strict TypeScript and standalone
Python against explicit synthetic calendars and market observations.

The upstream CompoundIndex declaration is empty. Its installed selector uses
the adjusted calculation period endpoints, as in CDM's compounded index
observation instructions. It applies the same inclusive day count and
`ApplyCompoundedIndexFormula` used by `CalculateCompoundedIndexResetRate`.
The selector returns the raw rate and both observations. The event reset
workflow owns final rounding. Missing market values and the manual RefBanks
route retain explicit errors.

The standalone test also calls the original `GenerateDateList` with an empty
range and an unavailable calendar. Its guard returns an empty list without
evaluating the recursive alias or consulting the calendar.
