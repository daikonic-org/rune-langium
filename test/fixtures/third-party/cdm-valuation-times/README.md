# CDM valuation times

[Sources and hashes](sources.json) pin the CDM 7.9.0 signatures and their
dependency closure, including the upstream `ResolvePerformanceValuationTime`
body. No handwritten production Java bodies were found for the two abstract
functions at this pin. The fixture supplies illustrative zone mappings and
valuation times through the same two provider declarations used by the
curated overrides.

The project materializes the [pinned business-center list](../cdm-business-calendars/resources/business-center-9-3.json)
as the `rune.resources.cdm.BusinessCenter` enum. The London entry preserves the
original `GBLO` code and description. The Rune caller converts that enum to the
code when it constructs CDM's `BusinessCenterTime`.

The [19 cases](cases.json) cover exact matching, missing and duplicate entries,
the optional zone, scheme metadata and the original valuation caller. The
caller has two assignments. When only an explicit business-center time is
given, its second assignment clears the first result. CDM's generated Java
confirms that behavior. The fixture exercises the business-center function
directly and the asset branch through the upstream caller.
