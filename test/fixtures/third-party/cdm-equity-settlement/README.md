# CDM equity settlement

[Sources and checksums](sources.json) pin the CDM 7.9.0 declarations and original
equity swap and cash-settlement callers. Identical dependency slices are read
from the billing fixture and verified against this manifest. The two implemented
declarations have no handwritten Java reference in the pinned release.

The [six cases](cases.json) cover the master confirmation's payment schedule,
standalone transaction terms, exact period selection and missing or duplicate
periods. The fixture providers supply negotiated funding terms and the resolved
schedule. Strict TypeScript and standalone Python also exercise the original
`NewEquitySwapProduct` and `EquityCashSettlementAmount` callers. The cash transfer
case uses the pinned date helpers and verifies the amount and settlement date.
