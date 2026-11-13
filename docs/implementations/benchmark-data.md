# Public benchmark snapshots

`rune-dsl market-data` explicitly downloads observations from the New York Fed,
Bank of England and ECB. It writes six versioned JSON snapshots and one ordinary
Rune override for `impl.cdm.market.ReadMarketObservations`. The original CDM
`GetMarketRates` and `IndexValueObservation` bodies consume that provider through
the existing curated implementations. Generated TypeScript, Python and Prototype
use the same saved Rune source without network access.

The [shared market-data catalog specification](../design/market-data-catalog/spec.md)
extends this delivery pattern to D1/R2 history, daily CI refresh and future curve
datasets. It preserves the provider contracts and explicit project pins; shared
storage and scheduled refresh are proposed, not part of the current CLI.

## Acquire and install

After installing the CLI and the matching curated CDM implementation sources:

```sh
rune-dsl market-data --start 2026-11-02 --end 2026-11-06 \
  --output ./model/benchmark-data --json
```

The output directory must be new. The command does not replace authored files,
update project configuration, or change any existing provider. The normal source
selection must include its `market-observations.rosetta`; default `model/**/*.rosetta`
selection already does. Keep only one `ReadMarketObservations` override in that
selection. An existing declaration binding to another provider must also be
removed or deliberately redirected before using this one.

For fewer series, append `--series sofr sonia estr`. To refresh, acquire into a
new directory outside the selected source tree, review the new responses/provider,
then replace the active copy through the project's normal Save/Git workflow.
Do not select both old and refreshed overrides. No refresh happens during Build
or Execute.

| Series ID | Official source series | CDM floating-rate index | Normalized value |
| --- | --- | --- | --- |
| `sofr` | NY Fed `SOFR` | `USD_SOFR` | Decimal rate |
| `sonia` | BoE `IUDSOIA` | `GBP_SONIA` | Decimal rate |
| `estr` | ECB `EST.B.EU000A2X2A25.WT` | `EUR_EuroSTR` | Decimal rate |
| `sofr-index` | NY Fed `SOFRAI.index` | `USD_SOFR_Compounded_Index` | Published index level |
| `sonia-index` | BoE `IUDZOS2` | `GBP_SONIA_Compounded_Index` | Published index level |
| `estr-index` | ECB `EST.B.EU000A2QQF08.CI` | `EUR_EuroSTR_Compounded_Index` | Published index level |

The source's observation/effective date is retained without shifting it to the
download or publication day. Rates expressed in percent become decimal rates:
`4.33` becomes `0.0433`. Index levels are not divided by 100. Each series retains
its own index base; levels from different benchmarks are not interchangeable.
The provider admits absent or one-day tenors and refuses term, vendor and other
index variants. It filters the saved observations to requested dates; existing
CDM callers preserve order/repeats and reject missing observations. Holidays and
weekends do not cause implicit filling, interpolation or invented rates.

## Replay and provenance

The host-neutral `@rune-langium/project-runtime/market-data` entry exports
`fetchBenchmarkSnapshot`, `readBenchmarkSnapshot`, `renderBenchmarkProvider`, the
snapshot schema and the supported series registry. Recreate a provider entirely
offline from the saved JSON snapshots:

```ts
import { renderBenchmarkProvider } from '@rune-langium/project-runtime/market-data';

// snapshots are the parsed JSON files; reading/rendering performs no fetch.
const source = await renderBenchmarkProvider(snapshots);
```

Each snapshot contains the exact UTF-8 response text, source URL, retrieval time,
SHA-256 checksum and any supplied ETag/Last-Modified headers. Reopening verifies
the checksum and the URL's series/date identity before parsing. Normalized values
are derived from those bytes rather than stored as a second editable inventory.
NY Fed revision indicators and ECB observation statuses are exposed where
provided; all other response metadata remains in the saved source text. Retrieval
time is not presented as an observation's publication time. Checksums detect local
corruption; they are not publisher signatures or historical-vintage guarantees.

Requests use official fixed endpoints, omit credentials, refuse redirects and
have a 30-second deadline and 2 MiB response limit. A request spans at most 366
dates. Duplicate dates, invalid/missing numeric values, unexpected series/units,
malformed CSV, and out-of-window dates fail rather than producing partial data.
A selected feed failure prevents output creation. Published empty windows remain
empty; requesting a missing date still fails through the canonical Rune guard.
CSV syntax is read by `csv-parse`'s browser ESM distribution; the shared adapter
validates feed identities, dates, units and nonempty, unique column headers.
One snapshot per series is accepted by a provider; choose the desired acquisition
explicitly when revisions or overlapping windows exist.

This supplies historical observations and compounded index levels. It does not
supply term SOFR/SONIA, forward curves, reference-bank determinations or broader
vendor entitlements. `ReadForwardRateSnapshot` remains a separate integration.
Public data retains each publisher's terms; it is acquired explicitly into the
project and is not automatically redistributed in curated model publication.

## Historical and term-rate sources

The six implemented adapters accept historical observation-date windows within
each publisher's available history. The 366-date request bound is an acquisition
limit, not a restriction to recent dates. Keep separate acquisitions as an
archive; the current provider materializer selects one snapshot per series.
Retrieving historical data today does not establish what a market participant
could have known before later revisions.

Published forward-looking term benchmarks require their own source, administrator
identity and tenor. They cannot be reconstructed by compounding the overnight
fixings above. Available historical-data paths include:

- [CME Term SOFR](https://www.cmegroup.com/articles/faqs/cme-term-sofr-reference-rates.html):
  licensed history via CME DataMine or an authorized distributor, with 1M/3M/6M/12M tenors.
- [FTSE Term SONIA](https://www.lseg.com/en/ftse-russell/benchmarks/term-sonia-reference-rates):
  historical data via LSEG data services; the public page supplies only a limited delayed window.
- [FTSE Term €STR](https://www.lseg.com/en/ftse-russell/benchmarks/term-estr) and
  [EMMI Efterm](https://www.emmi-benchmarks.eu/benchmarks/efterm/rate/): separate
  euro term benchmarks. EMMI offers registered, non-commercial delayed access
  for 25 publication days and a research-history request path; commercial/full
  history requires the appropriate subscription or authorized vendor.

The next integration should import an entitled CSV/JSON export first, preserving
administrator, exact benchmark/CDM identity, tenor, fixing date, units and source
publication/revision information. It can then use the same snapshot-to-Rune
delivery pattern. A provider API can follow once its schema and entitlements are
known. This is a proposed extension: the six-series implementation does not
claim term-rate acquisition or access to these licensed datasets.

## Sources and verification

- [New York Fed Markets API](https://markets.newyorkfed.org/static/docs/markets-api.html)
  and [SOFR averages/index methodology](https://www.newyorkfed.org/markets/reference-rates/sofr-averages-and-index).
- [BoE SONIA and historical database](https://www.bankofengland.co.uk/markets/sonia-benchmark),
  including the public `IUDSOIA` and `IUDZOS2` series.
- ECB [€STR rate series](https://data.ecb.europa.eu/data/datasets/EST/EST.B.EU000A2X2A25.WT)
  and [compounded index series](https://data.ecb.europa.eu/data/datasets/EST/EST.B.EU000A2QQF08.CI).

`project-runtime/test/benchmark-data.test.ts` uses synthetic official-format
responses to check acquisition, provenance, units, CSV details and failures.
`benchmark-provider.test.ts` publishes the pinned CDM dependency closure and
executes the installed override in all three strict TypeScript layouts and
standalone Python. CLI tests verify readback, failure receipts, no partial output
on acquisition failure and preservation of existing output/user edits. Network
access is not required by these tests. Studio's `test/workers/benchmark-provider.test.ts`
executes all six series through the real managed Prototype worker and project
receipt boundary, including the missing-observation error. A separate live check on 2026-11-13 acquired
five observations for each of the six series over 2026-11-02–06.
