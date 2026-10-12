# Open issue review — 2026-10-11

Reviewed all 17 open issues against master `b9e316cc` and the remediation branch.
The new application changes have local validation only; they are not deployed.
Issue closure is reserved for delivered behavior, rather than a passing recheck
of an intermittent incident or an architectural criterion that remains unmet.

| Issue | Disposition | Evidence / remaining acceptance |
| --- | --- | --- |
| [#588](https://github.com/pradeepmouli/rune-langium/issues/588) | Fixed in this change | Memory-only bounded telemetry queue retries explicit 429 rejections at most three times, honors Retry-After, limits fetch/body reads to ten seconds, drains schema-sized batches, flushes with keepalive on hidden/page-hide, and drops pending events on opt-out/disposal. Delivery remains best effort; ambiguous failures are never replayed. |
| [#589](https://github.com/pradeepmouli/rune-langium/issues/589) | Fixed in this change | Raw panel mirrors remain in evidence; timing rollups deduplicate by journey, navigation generation, operation and correlation ID. Reload journeys capture pre-navigation logs. Tests prove mirrors and ID reuse across navigation do not inflate or erase timings. |
| [#590](https://github.com/pradeepmouli/rune-langium/issues/590) | Fixed in this change | Canonical codegen metadata exposes date/time/dateTime/zonedDateTime, including aliases and function inputs. Shared Preview/Prototype controls preserve ISO values, explicit offsets and subsecond precision. Friendly temporal format messages replace regex dumps in the UI while Output retains the original diagnostic. Other validation errors retain their messages. No upstream zod-to-form change is required. |
| [#591](https://github.com/pradeepmouli/rune-langium/issues/591) | Fixed in this change | The real LSP server publishes the validated document version. Studio rejects stale versions and invalid/reversed ranges before CodeMirror mapping and graph delivery. Valid diagnostics and versioned clearing remain covered. |
| [#580](https://github.com/pradeepmouli/rune-langium/issues/580) | Fixed in this change | The server already resolves implicit Rune dependencies; Studio discarded unregistered dependency bundles. Routed results now carry authoritative resolved cohorts/versions and retain implicit bundles in workspace bindings. Store/router/API regression tests and real pinned CDM StringEquals execution followed by TypeScript/Python projection after serialized restore pass. |
| [#455](https://github.com/pradeepmouli/rune-langium/issues/455) | Implemented in this change | Output's Export debug info downloads local JSON with workspace summaries, exact bundle pins, diagnostics, bounded logs and whitelisted environment/settings. Source is opt-in and unloaded files are not fetched. No credentials, storage dumps, instance values or ASTs are collected, and nothing is submitted remotely. Unit and real download tests cover the default and opt-in paths. |
| [#592](https://github.com/pradeepmouli/rune-langium/issues/592) | Hardened; keep open | Preparation and projection display now have separate 30-second deadlines, late-response protection and direct Retry generation without remounting/editing CodeMirror. Never-settling preparation/request tests prove recovery. The original execution-then-projection stall is not reproduced by the real pinned worker fixture; repeat that exact order on cold/warm production contexts with correlated timings before claiming root-cause resolution. |
| [#526](https://github.com/pradeepmouli/rune-langium/issues/526) | Autosave requests fixed; keep incident open | Local J8 initially passed with 72 logical save requests; a new bound failed at 69 requests before type-created. Coalesced persistence reduced the same full journey to six requests and passed cardinality/reload checks. Saving is independent of parsing, has 500 ms trailing / two-second maximum waits, and flushes at workspace/lifecycle boundaries. Request counts are not physical OPFS-write counts. The historical detached-option incident remains unproven; verify repeated production interactions and form identity before closure. |
| [#525](https://github.com/pradeepmouli/rune-langium/issues/525) | Current behavior verified; keep incident open | J8 passes cardinality changes and reload on current code; new assertions require exactly two Inspector rows and one persisted notes attribute. Historical duplicate-row behavior has not been reproduced here. Keep the issue open for repeated production checks rather than assigning an unverified cause to the autosave improvement. |
| [#515](https://github.com/pradeepmouli/rune-langium/issues/515) | External credential blocker | Latest curated publication [38111257480](https://github.com/pradeepmouli/rune-langium/actions/runs/38111257480) builds artifacts but fails its first R2 upload with HTTP 403 / Cloudflare 10000 Authentication error. Safe uploader error reporting already exists. Cloudflare MCP token-management access also returns 9109 Unauthorized; a replacement authorized upload credential is required before rerunning publication. No partial manifest is published. |
| [#572](https://github.com/pradeepmouli/rune-langium/issues/572) | External release blocker | Live npm check still reports braces 3.0.3. Keep the tested local security backport/audit exception until an applicable patched release is published and validated; do not remove it merely because other dependencies upgraded. |
| [#562](https://github.com/pradeepmouli/rune-langium/issues/562) | Partly shipped; LOC criterion remains open | Configured sections, pinned round-trip parity and the no-reload HMR test already shipped. Current recursive editor .tsx count is 7,588 lines / 43 files versus 5,868 / 35 at d38d863 (+29.31%; scope has gained features). Its 25% reduction criterion has not been waived or met; deleting supported callback APIs solely to reduce lines is not an acceptable substitute. |
| [#574](https://github.com/pradeepmouli/rune-langium/issues/574) | Integration enhancement remains open | L2 still needs a shared policy/rule adapter for every custom Controller/register field plus SchemaLite container validation. A flag-only switch would remove resolver coverage. Preserve compileZod as an independent control and require all five AST schema parity/interaction checks and Rune-specific cold/warm benchmarks before enabling L2. Temporal-control fixes do not satisfy this criterion. |
| [#545](https://github.com/pradeepmouli/rune-langium/issues/545) | Architectural enhancement remains open | Immutable cache reuse and implicit-bundle retention do not implement progressive Inspector content. Compare incremental authoritative namespace hydration against publish-time Inspector projections, preserve inherited members and cross-bundle identity, and measure first-meaningful and fully-linked readiness separately. Do not show partial data as fully linked. |
| [#447](https://github.com/pradeepmouli/rune-langium/issues/447) | Architectural enhancement remains open | Browser artifact caching is not the proposed emitter-layer output cache or publish-time type-shape projection. Complete the description-seeded ScopeProvider resolution spike, then use one authoritative projection/emission implementation with exact content/target/options/version cache identities and an output-equivalence oracle. |
| [#540](https://github.com/pradeepmouli/rune-langium/issues/540) | Unreproduced performance incident; keep open | Existing later passing checks do not explain the historical >30-second cold tail. Capture repeated fresh/warm per-stage fetch/body/parse/hydration/render timing on the same deployment/cohort without increasing smoke timeouts. |
| [#582](https://github.com/pradeepmouli/rune-langium/issues/582) | Performance incident; keep open | A later faster BusinessCenters sample does not establish a stable latency distribution. Compare repeated same-cohort cold/warm form, hydration and closure timings with correlated Worker logs. Corrected logical timing rollups prevent mirrored samples from inflating the new distribution. |

## Validation and limits

- Full codegen: 164 files, 2,283 tests passed; one skipped, eight todo. Python
  projections use `PYTHON_BINARY=/opt/homebrew/bin/python3.14` (3.14.8); the
  bundled Python 3.12 cannot validate the required Python 3.13+ syntax.
- Full LSP: 74 tests passed, including real connection versioned diagnostics.
- Full Studio: 205 files and 1,911 tests passed; one file / three tests skipped.
- Full workspace type-check passed. Scoped source lint passes with pre-existing
  warnings, and changed-file formatting passes.
- Changesets status still fails the existing private-dependency tree check:
  public visual-editor depends on private design-system, and public codegen
  depends on private instrumentation-core. The config and those package
  manifests are unchanged from master; the new patch changeset is preserved,
  but this review does not claim that package publication is unblocked.
- Local J8 fails the save-count bound before the fix and passes after it with
  six requests, two Inspector rows, one notes declaration and persisted 0..*.
- Browser checks use an isolated Playwright context on local port 5174. User
  tabs and production are untouched. Twenty expression, temporal, debug-download
  and cache browser checks pass without retries. The network-LSP browser case
  requires a running LSP server and is explicitly skipped in this configuration.
- Debug report and telemetry tests cover different privacy boundaries: the
  former is an explicit local download; the latter still rejects raw model
  content and unrecognized wire fields. Page-exit delivery and browser-storage
  flushing are best effort, not crash-proof persistence guarantees.
