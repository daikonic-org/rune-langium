# CDM billing summary

The original declaration and its dependency closure are pinned to CDM 7.9.0,
FpML 3.13.0, and Rune 10.15.3 in [sources.json](sources.json). The fixture retains
each upstream license and notice. The repository's fixture builder verifies the
source paths, hashes and declaration ranges.

The upstream [Create_BillingSummary declaration](https://github.com/finos/common-domain-model/blob/0f1f99aef829c23910476981bb91256544cb8569/rosetta-source/src/main/rosetta/event-common-func.rosetta#L1383-L1391)
asks for a sum of all billing records and a ParentTotal. A ParentTotal carries
payer and receiver references at party level. One transfer carries the total,
so the port requires a shared asset, unit, settlement date and classification.
It uses the first record's compatible parent references and omits account
references and per-record payout lineage. Amounts are summed as canonical finite
decimals at the target number boundary. The record's applied minimum fee is
already part of the supplied amount.

The published [security-lending invoice example](https://github.com/finos/common-domain-model/blob/0f1f99aef829c23910476981bb91256544cb8569/rosetta-source/src/main/resources/functions/sec-lending/create-security-lending-invoice-func-output.json)
omits the summary and includes transfers without required settlement terms.
The pinned Java source tree supplies no handwritten implementation for the
summary. The [17 cases](cases.json) use complete records for all three transfer
arms, plus incompatible groups, incomplete terms, invalid amounts, and exact
parent-reference preservation. They exercise the same installed curated
implementation in strict TypeScript and standalone Python. Studio Prototype
also executes an authored Rune caller against the locked fixture.
