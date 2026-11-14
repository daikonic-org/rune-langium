# CDM example reference-data service

This source-available service supplies the **CDM example** with public SOFR,
SONIA and €STR fixings and compounded indices, and retains private historical
SONIA OIS fitted curves. Its D1/R2 database is not a Studio
dependency. Real projects bring their own providers; Studio builds and executes
the ordinary installed Rune implementation without connecting to this service.

Drizzle owns the typed SQLite schema and routine queries. Its generated SQL
migrations are applied with Wrangler. The final publication batch and revision
window query remain explicit SQL. Both the D1 binding and CI HTTP transports use
the same query layer; native SQLite tests exercise the same schema and queries.
Format decoding, units, snapshot validation and Rune materialization are shared
with `@rune-langium/project-runtime/market-data`; no ORM or database driver is
added to the portable runtime.

## Local checks

```sh
pnpm --filter '@rune-langium/project-runtime...' run build
pnpm --filter @rune-langium/cdm-example-data-worker run build
pnpm --filter @rune-langium/cdm-example-data-worker test
pnpm --filter @rune-langium/cdm-example-data-worker run db:check
pnpm --filter @rune-langium/cdm-example-data-worker run type-check
```

The tests use Node's native SQLite and Miniflare D1/R2. They cover recurring
responses, unchanged confirmations, revision pins, staging visibility,
interrupted publication, stale-generation refusal, offline
imports, source failure isolation, the read API and sanitized CI reports. The
Miniflare dependency matches Wrangler's tested runtime version rather than the
older standalone alpha used elsewhere in this workspace.

Change `src/catalog/schema.ts`, then run `pnpm --filter
@rune-langium/cdm-example-data-worker run db:generate` and review the generated
SQL. Commit the schema, SQL and Drizzle metadata together. Never edit the
generated migration to change a deployed database's history.

## Setup and activation

The checked-in configuration has no public route and disables workers.dev.
Deployment is separate from implementation and CI ingestion. After reviewing
the candidate, create the example's D1 database and R2 bucket with Wrangler:

```sh
pnpm --filter @rune-langium/cdm-example-data-worker exec wrangler d1 create rune-cdm-example-data
pnpm --filter @rune-langium/cdm-example-data-worker exec wrangler r2 bucket create rune-cdm-example-data
```

Set the returned `database_id` in `wrangler.jsonc`. Bind a domain or route owned
by the CDM example service, then deploy that Worker. Neither resource nor route
belongs to Studio's general project environment. CI applies pending migrations
with Wrangler before publishing; the read-only Worker never runs migrations.

The daily workflow is in the **main rune-langium repository** at
[cdm-example-data.yml](../../.github/workflows/cdm-example-data.yml). Configure:

| Setting | Location | Purpose |
| --- | --- | --- |
| `CDM_EXAMPLE_DATA_ENABLED=true` | Repository variable | Enable this example-only scheduled job after setup |
| `CDM_EXAMPLE_DATA_DATABASE_ID` | Repository variable | The example's D1 UUID |
| `CDM_EXAMPLE_DATA_BUCKET` | Repository variable | Optional; defaults to `rune-cdm-example-data` |
| `CDM_EXAMPLE_DATA_API_TOKEN` | Repository secret | D1/R2 publication permissions for the configured account |
| `CLOUDFLARE_ACCOUNT_ID` | Existing repository secret | Account owning those resources |

The job runs at **20:17 UTC daily**, checks the last seven calendar days, and
attempts all six benchmark datasets and private SONIA OIS curves independently. Manual dispatch accepts a bounded
start/end window, series selection and dry-run mode; it defaults to dry-run.
Only the default branch can publish. Missing activation leaves the job disabled.
It creates no cloud resources, deploys no Worker and changes no user project.
Old corrections outside the lookback require a manual reconciliation/backfill.

A source failure leaves its accepted history intact while other complete
datasets publish. The aggregate job fails and uploads a sanitized per-dataset
report. Reports distinguish updated, unchanged, empty and failed acquisitions,
including the latest observed date; they do not equate a successful poll with a
new or timely publication. Calendar-aware freshness alerts and other curve adapters
are subsequent work; weekend/holiday filling is never implicit.

To validate public feeds without cloud credentials:

```sh
pnpm --filter @rune-langium/cdm-example-data-worker run refresh --dry-run --start 2026-11-02 --end 2026-11-06
```

With publication credentials configured, omit `--dry-run`. A request spans at
most 366 dates; use successive manual windows for a larger backfill. Import
previously acquired v1 captures offline with repeated `--import <snapshot.json>`
arguments. Their original URL, retrieval timestamp, raw response and hash are
preserved; catalog ingestion time is recorded separately.

## Read and project-import contract

All routes require `GET`; there is no public ingest, SQL or arbitrary R2 route.
Only the six admitted public benchmark identities are supported. Restricted
term feeds and curve datasets are not accepted through this API.

| Route | Result |
| --- | --- |
| `/market-data/datasets` | Dataset identities, provider units and required attribution |
| `/market-data/series/sofr/observations?start=2026-11-02&end=2026-11-06` | Latest retained observations within the window and the catalog generation |
| `/market-data/series/sofr/observations?...&generation=1&after=2026-11-03&limit=10` | Bounded pagination over that pinned candidate generation |
| `/market-data/series/sofr/snapshots?before=10&limit=20` | Accepted capture history, ordered by generation |
| `/market-data/selection?series=sofr,sonia&start=2026-11-02&end=2026-11-06` | Portable manifest pinning exact snapshot IDs and selected dates |
| `/market-data/snapshots/<sha256>` | An accepted immutable v1 snapshot; prepared artifacts remain inaccessible |
| `/market-data/runs?limit=20` | Recent sanitized acquisition outcomes |

For revisions, the newest retained capture or unchanged confirmation of a date
wins within the selected generation. Unchanged polls reuse a snapshot only when
it is the latest overlapping capture; a response returning to A after B creates
a new capture and generation, even when A's raw bytes were retained previously.
Confirmation times are separate from immutable capture provenance. They never
move backwards or change the values selected by an existing generation pin.
An old capture imported later cannot replace data confirmed more recently.
The manifest records every constituent capture; it is not a historical
publication-vintage guarantee. Capture and download time are not publication
time. Snapshot identity binds provenance as well as raw content.

Explicitly copy a selection into a **new** CDM example workspace directory:

```sh
rune-dsl market-data --catalog https://YOUR-CDM-EXAMPLE-DATA-HOST \
  --series sofr sonia estr --start 2026-11-02 --end 2026-11-06 \
  --output ./model/benchmark-data --json
```

The CLI saves `selection.json`, verified `snapshot-<id>.json` files and one
`market-observations.rosetta` override. Download bounds are 30 seconds per request,
16 MiB per snapshot envelope and 64 MiB per selection. It rejects wrong identities,
hashes, overlapping date assignments and partial downloads before creating the
output directory. Build/codegen/Prototype subsequently run offline. Keep one
active provider; refresh through normal project Save/Git rather than selecting
both old and new overrides.

Raw text is retained by content hash in R2; snapshots and query rows are staged
before one atomic publication batch. A crash can leave unreferenced objects or
rows, but readers cannot select them. No history is pruned automatically.
Source attribution travels with exports and generated source, including the
Bank of England's prescribed SONIA notice.

## Historical SONIA OIS curves (private catalog)

The `sonia-ois` dataset imports the Bank of England's **fitted** OIS curves from
its latest-month and historical ZIP/XLSX downloads. It stores all four published
grids: monthly and semiannual **spot** yields and **instantaneous forwards**.
Duplicate maturities on different sheets retain their grid identity. These are
annual, continuously compounded percentages with ACT/365 conventions, not par
swap quotes, realized fixings or published term SONIA. Original decimal text and
normalized decimal rates remain separate; the runtime's existing decimal-unit
normalizer supplies the conversion. No interpolation, extrapolation, nearest
curve date or missing-node filling occurs during ingestion or queries.

Use the pinned native reader in CI rather than adding another spreadsheet parser
to the Worker or browser. The system `curl` client acquires bounded HTTPS responses; Python's standard ZIP
reader and `openpyxl` decode the
actual workbook format; bounded archive entries, identity checks, grids, dates
and numeric cells are validated before writing a versioned intermediate.
`defusedxml` is installed alongside the pinned reader. Tests generate original
synthetic workbooks; downloaded BoE data is not committed to this repository.

```sh
python3 -m venv .venv-ois
.venv-ois/bin/pip install -r scripts/sonia-ois/requirements.txt
PYTHON_BINARY=.venv-ois/bin/python node scripts/refresh-curves.mjs \
  --start 2026-11-02 --end 2026-11-13 --dry-run
```

Omit `--dry-run` with the same D1/R2 credentials described above to publish.
The importer selects the current-month workbook or monthly archive from fixed
official URLs. A window crossing the current-month boundary is split so an older
archive cannot silently replace available current-month data. `--source latest`
or `--source archive` selects one explicitly. Empty captures publish no rows.
Both downloads may lag their observation dates; the report exposes the latest
actually observed date and the point count.

`read.py --archive <saved-zip> --retrieved-at <original-time>` replays saved bytes;
`refresh-curves.mjs --import <acquisition.json>` validates and imports its versioned
intermediate offline. Preserve the original acquisition timestamp. Each snapshot
binds the raw archive hash, selected workbook hashes, decoder version, requested
window, curve points and dataset conventions. R2 retains immutable source bytes
(base64 in a private JSON artifact) and the normalized snapshot. Additive Drizzle
migration `0002_sonia_ois_curves` creates distinct point/publication/run tables.
Staged rows remain hidden until a complete transactional generation is accepted.
Unchanged confirmations, explicit generation/snapshot pins and late backfills
retain their provenance; replaying an old accepted snapshot does not reactivate it.

`querySoniaOisCurve(db, { date, kind, grid, snapshotId?, generation? })` is the
internal exact-date query. Choose `kind: 'spot' | 'instantaneous-forward'` and
`grid: 'monthly' | 'semiannual'`. Points retain source percentages, decimal rates,
maturity years/months and the workbook identity. The separate curve tables and
R2 prefix are deliberately unreachable through public fixing/snapshot routes.

The BoE's [yield-curve guide](https://www.bankofengland.co.uk/statistics/yield-curves)
and [source terms](https://www.bankofengland.co.uk/legal) govern these archives.
The database-fixing Open Government Licence attribution does not automatically
apply to the separate curve resources. Their catalog access scope is
`internal-noncommercial`; the bucket remains private. Public redistribution and
project export of curve artifacts require a separate rights decision.

The daily workflow now attempts the six fixing series and SONIA OIS independently
through `scripts/refresh-all.mjs`; an individual failure cannot suppress the other
sources. Its sanitized report contains outcomes/counts, not curve values or raw
workbooks. PRs run the native reader's synthetic unit suite without cloud access.
The refresh job still requires explicit activation and default-branch execution.

Provisioning on 2026-11-14 created the private `rune-cdm-example-data` D1 database
and R2 bucket; the database ID is recorded in `wrangler.jsonc`. No Worker route or
public service was deployed. Scheduled publication still requires the repository
activation variable and scoped CI API secret.

The first verified curve import selected November 2–13, 2026. It accepted
**1,980 points over nine published dates, November 2–12**; November 13 was not
present in the downloaded workbook. All four grids were read back from D1.
Snapshot `121b24376d58e916833e45f47a9e1681c875e8062f43d4da420fde0ed4328d92`
is generation 1, with original archive and validated snapshot retained in R2.

The six previously saved fixing/index captures were also imported through the
unchanged v1 snapshot publisher: 36 observations in total, six per series, for
November 2–9. Their original retrieval times, source bytes and snapshot identities
are retained. This initial backfill does not enable the daily job. The repository
still needs `CDM_EXAMPLE_DATA_API_TOKEN` and its activation/database variables;
existing personal OAuth credentials were not copied into CI.
