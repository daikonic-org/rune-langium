# Curated artifacts and reference releases

The curated publisher has two identities. Development publications update
`/curated/<model>/manifest.json`; their date/content-hash artifact versions are
implementation details. Reference release catalogs at `/releases/<model>` map
explicit GitHub release tags to exact source commits and immutable cohort
manifests. A development ref is never inferred to be a release tag.

The shared `curated-schema` package owns both contracts. Catalog entries retain
repository/tag/commit, manifest URL, cohort, the SHA-256 of the exact manifest
bytes, compatible release dependencies and the compiler/toolchain identity.
The mirror serves catalogs with short caching, ETags, HEAD and its usual CORS
policy. Missing or invalid catalogs return unavailable responses; latest is not
used as a substitute. The Worker route configuration includes `/releases/*`.

## Preparing a release build

Build the required packages, then provide the actual CDM release tag:

```sh
pnpm --filter '@rune-langium/core...' --filter '@rune-langium/curated-schema' run build
node --max-old-space-size=4096 scripts/build-serialized-artifacts.mjs --release '<cdm-release-tag>'
bash scripts/upload-serialized-artifacts.sh --dry-run
```

The source adapter verifies GitHub release records and tag objects, including
annotated tags, and follows pinned upstream POM metadata for the known CDM/FpML
compatibility adapter. It downloads exact commits and records their mappings in
`dist/curated-artifacts/resolved-sources.json`. It does not run Maven or Java.
Catalog dependency edges describe the actual jointly linked compatible artifact
set, using the existing namespace graph. A tag that moved to another source
commit cannot replace an already advertised mapping. Rebuilding unchanged source
in a new compatible set appends another immutable cohort variant; previous
variants remain advertised so an older parent release can still resolve its
exact dependency cohort. Bytes at an existing cohort cannot be replaced.

The existing GitHub Actions publisher accepts an optional `cdm_release` manual
dispatch input and uses this same path. Scheduled runs and a blank input retain
the development publication path. The input is passed through an environment
variable and quoted command argument. Publication-policy tests run in normal CI.

The normal build without `--release` retains the development publication path.
The existing `--sources` option accepts explicitly prepared source pins; it is
separate from the verified release build option and must preserve release
provenance when used for release publication.

Dry run fetches current public metadata and checks local serialized-artifact
checksums. It writes proposed manifests/catalogs under a fresh
`dist/curated-publication-preview.*` directory, prints its path and uploads
nothing. It does not claim the proposed objects have been published.

## Publication order

The upload script prepares the entire set first. Publication uploads all
versioned bundles and namespace artifacts, then every immutable cohort manifest.
Only successful upload receipts permit catalog promotion. Dependency catalogs
are written before consumers; a dependency failure prevents consumer promotion.
Latest pointers are updated afterwards through the existing path. Each object
write is atomic; the group is not a multi-object transaction. Previously locked
cohort URLs remain usable independently of current catalogs or latest pointers.

No publication or Worker deployment is performed by tests. Ordering and
interruption checks use a mocked uploader:

```sh
node --test scripts/lib/curated-sources.test.mjs scripts/lib/curated-releases.test.mjs scripts/upload-serialized-artifacts.test.mjs
pnpm --filter @rune-langium/curated-schema test
pnpm --filter @rune-langium/curated-mirror-worker test
```
