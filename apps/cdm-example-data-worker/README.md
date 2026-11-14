# CDM example reference-data service

This source-available service supplies the **CDM example** with public SOFR,
SONIA and €STR fixings and compounded indices. Its D1/R2 database is not a Studio
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

The tests use Node's native SQLite and Miniflare D1/R2. They cover revision pins,
staging visibility, interrupted publication, stale-generation refusal, offline
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
attempts all six datasets independently. Manual dispatch accepts a bounded
start/end window, series selection and dry-run mode; it defaults to dry-run.
Only the default branch can publish. Missing activation leaves the job disabled.
It creates no cloud resources, deploys no Worker and changes no user project.
Old corrections outside the lookback require a manual reconciliation/backfill.

A source failure leaves its accepted history intact while other complete
datasets publish. The aggregate job fails and uploads a sanitized per-dataset
report. Reports distinguish updated, unchanged, empty and failed acquisitions,
including the latest observed date; they do not equate a successful poll with a
new or timely publication. Calendar-aware freshness alerts and curve adapters
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

For revisions, the newest retained capture of a date wins within the selected
generation. An old capture imported later cannot replace a newer correction.
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
