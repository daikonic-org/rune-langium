# Portable workspace implementation record

All 19 implementation tasks are complete on the local `codex/workspace-launcher-design` branch. No push, pull request, merge, deployment or remote starter publication has been performed.

## Delivered slices

| Slice | Tasks | Result |
| --- | --- | --- |
| Portable foundation | 6 | Compatible Rune configuration, companion build/Studio files, recoverable file-backed Save, independent named targets and shared CLI/Studio builds. |
| Reference resolution | 5 | Exact releases and immutable cohorts, verified locks/cache, effective declaration overrides, shared host receipts, installed-provider/resource capability boundaries. |
| GitHub initialization | 3 | Static Maven inspection inside GitHub-open, reviewed native initialization and explicit manual Git publication. |
| Studio projects | 5 | Portable examples/workflows/layouts, starter/workspace launcher, separate reference release review and a real Rune implementation fixture. |

The [approved design](../specs/2026-10-23-portable-workspaces-reference-models-design.md) and [plan index](../plans/2026-10-23-portable-workspaces.md) define the scope. The local starter is in [examples/workspaces/model-authoring](../../../examples/workspaces/model-authoring/README.md).

## Verification

- `PYTHON_BINARY=/opt/homebrew/bin/python3.14 pnpm -r --workspace-concurrency=1 run test`: **7,297 passed** (7,292 Vitest tests across 18 package runs, five Pages packaging tests), five existing skips and eight existing todos. Studio: 2,346 passed, two existing skips.
- `pnpm run type-check`: passed across the workspace.
- `pnpm --filter @rune-langium/studio run build`: passed.
- Scoped Oxlint, oxfmt, `git diff --check` and normal commit hooks: passed for every owned change.
- **21 affected browser journeys passed**: 16 launcher/reference/target/override/example/workflow journeys in the combined run, then all five initialization journeys after correcting its retired GitHub button selector. Coverage includes desktop/tablet/phone, keyboard/Axe, cancellation, conflict, cache, clones and file readback.
- Earlier final UI checks: all 30 wider form/Prototype journeys passed; the Rune implementation/clone journey passed three unretried repetitions and the task completion gate.
- The starter builds each named target and all targets through the actual CLI. Expected fixtures are retained; generated outputs and ordinary exports are ignored.

These are local deterministic checks. GitHub/auth transports are stubbed in the App regression; no live clone, publication, deployed acceptance, OS-wide atomicity or CDM business parity is inferred.

## Review disposition

One fresh whole-branch reviewer examined `eece3105b01b0c381e3ed578e4ff017502318224..cdfd2d743622238ee6de38dbe0e9244221fd2ece`. It reported six Important findings, no Critical findings and no separate Minor findings. All six were accepted and fixed in one test-driven pass. No duplicate review was requested. The reviewed head is distinct from the subsequent tested fix commit.

Fix commit: `d2772c03fd03ed980361b2128758db22905a00d4`.

| Finding | Regression and correction |
| --- | --- |
| Inactive clone rejected before initialization | Actual App/flow/ownership adapter/review/Save/activation test. Initialization access is scoped to newly cloned IDs, captured generation and ownership; ordinary activation guards remain. |
| Output overwrites expected fixtures | Shared native build refuses both `tests/expected` and descriptor-referenced golden files. Expected inputs join snapshot revisions. |
| Rename/Retry corrupts invalid payload | Load reports repair failure without substituting raw text or null as semantic data. Writes refuse until repair/restore and reload. Original bytes remain intact. |
| Upgrade lacks concrete compatibility review | Isolated canonical graphs/readers compare exact saved identities and preview contracts against the current lock. Review names affected files/identities. Global graph errors block acceptance; portable/schema changes are explicit warnings. Unsupported comparisons are reported. |
| Recovery failure leaves writers unbound | Repair-and-reload without reactivation attaches both repositories after readiness; regression writes and reads back example metadata and layout. |
| Invalid peer target invalidates graph | Scope errors stay target-qualified. Preview adoption and independent builds filter unrelated target errors; selecting the invalid target fails with its diagnostic. |

The first full test run exposed a readiness assumption in the new test assertion; it now waits for the visible enabled state. The initialization browser fixture used the launcher's retired GitHub label. Both test assumptions were corrected without product retries, budget changes or weakened Save/readback checks. The final workspace run and affected browser cases passed.

## Rulings I made

Every execution ruling follows in chronological plan order, including its consequence if wrong. Historical test narration is omitted; final verification is above.


### 2026-10-23-workspace-foundation

1. execute four dependent subsystem plans sequentially with no per-task agents; one fresh whole-branch reviewer at end - user selected native - cost: later tasks rely on ledger continuity rather than fresh implementers.

2. ProjectLock.toolchain is a record of package ID to exact version - represents generator versions without duplicating target settings - cost: lock adapters must retain these entries.

3. derive option TypeScript aliases from new target-options-schema, rather than duplicate existing interface unions - DRY/shared validation - cost: exported options remain structurally equivalent aliases instead of augmentable interfaces.

4. linked existing primary .resources into owned worktree for fixture-backed checks - two full-Studio failures were absent corpus, not regressions - cost: resource-backed tests depend on that existing corpus revision.

5. map portable .studio/project-save journal path into backing-private OPFS, outside repository working copy - avoids git sync staging an in-flight journal or exposing tokens - cost: hosts provide a separate private root.

6. source autosave now prunes only previously loaded/saved source paths for every backing, removing obsolete kind lookup - whole-tree browser saves erased new config/examples (observed RED) - cost: untracked source files remain until explicitly loaded/deleted.

7. portable raw-read/snapshot helpers live in project-config, shared by Studio and upcoming Node runtime - one validation/hash/readback seam - cost: small additional public host-neutral API.

8. unavailable/invalid target diagnostics remain target-scoped; only global errors block snapshot activation - partial-capability projects must retain independent usable targets - cost: every run must call shared projectDiagnosticsForTargets with selected names.

9. App acquires/releases project ownership without rewriting App-managed metadata; manager.open reuses claimProjectAccess - prevents stale metadata writeback - cost: explicit activation bookkeeping in App.

10. add optional ProjectFileAdapter.writeBinary and shared byte hashing - existing Excel generator returns binary; text encoding would corrupt it - cost: hosts without this capability must diagnose binary output as unavailable.

11. Node-only APIs live under project-runtime/node, keeping root browser-safe; journals use XDG/home cache outside working copy - Git must not stage journals/credentials - cost: native journal location is tied to resolved project path unless host supplies privateRoot.

12. Snapshot revision covers semantic project inputs while retaining all files in the snapshot; source glob selection moves to project-config - generated output must not invalidate its own build, and Studio/CLI must agree - risk: an omitted future input class must be added to the shared revision contract.

13. extract the build preflight/staging/writer into project-runtime/browser with an injected generator - Studio must remain network-only for language services while sharing CLI correctness rules - cost: native and server hosts must both supply captured target output.

14. the actual CLI subprocess parity integration receives a scoped15s timeout - it passes alone (~1s) but the full concurrent Studio suite exceeded the5s unit default - cost: a genuine subprocess hang fails later; no product retry/budget changed.


### 2026-10-23-reference-resolution

15. release publication is opt-in through verified GitHub release/tag/commit provenance; nightly master artifacts remain separate - date/hash artifact versions are not release tags - cost: no release is advertised until an explicit release artifact set is published.

16. add a read-only-metadata/local-file dry-run path to the existing uploader; successful immutable-upload receipts gate release promotion and catalogs are written dependencies-first - this makes publication reviewable without remote writes - cost: the R2 object group remains non-transactional, so earlier independent dependency catalogs can advance before a later consumer write fails.

17. include the new publication test in the existing CI policy step and expose the builder's release flag as an optional manual publisher input - otherwise the native release path would lack CI coverage/operator entry - cost: future explicitly dispatched release runs use the existing remote-upload workflow; no workflow is dispatched here.

18. allow an optional verified cache on explicit resolve so verification can warm the same cache used by ordinary open - complete closures must be verified before lock proposal without forcing duplicate downloads - cost: hosts must keep their cache bound to the common verified-byte contract.

19. retain same-tag/same-commit catalog entries for distinct immutable cohorts, forbidding moved source commits or changed bytes at an existing cohort - a later CDM publication can recompile the same Rune dependency tag and must not make older CDM releases impossible to resolve - cost: catalog history grows and resolution selects compatible artifact variants.

20. reserve model identity local for repository declarations, independent of workspace ID/name, and use canonical Rune AST kinds plus pre-link dispatch selector text - explicit URI ownership keeps core independent of config packages and mappings portable across clones - cost: hosts must register ownership before fresh graph linking.

21. generated active roots use the replacement's canonical namespace; originals remain linked for comparison/provenance, not exported active bodies - core's generation-local target registry is authoritative for selection/preview/Python and direct function requests - cost if wrong: consumers needing original-identity aliases must wait for explicit source materialization rather than receiving silently original behavior.

22. reuse a single Worker-port receipt bridge for all existing consumers, and retain editor didChange owners while gating LSP semantic requests - avoids parallel per-store receipt checks and competing live edit senders - cost if wrong: host readiness must be surfaced through this common boundary rather than direct raw Worker access.

23. validate managed Modify source bytes against acknowledged, verified reference documents before copying or stamping provenance - the legacy Inspector can retain a different cohort from the project lock - cost if wrong: a mismatched visible release requires reload instead of being silently relabeled.

24. preview discovery may transition loading→ordinary workspace and resume the existing preview path; exact saved-revision waits still reject missing managed captures - cold restore otherwise falsely displayed Managed project capture unavailable - cost if wrong: only the established ordinary path lacks a project receipt.

25. initial code-list adapter uses explicit resource source model plus kind-qualified alias ID, and JSON array value/label entries - no existing genericode adapter is installed, so guessing upstream formats would falsely claim support - cost if wrong: other resources remain unavailable until a registered adapter is supplied.

26. preserve external code lists as intersections with Rune constraints only for plain string/compatible enum aliases; refuse constrained/parameterized aliases and unsupported generators - silent constraint loss is incorrect - cost if wrong: those targets remain unavailable until their adapters are proven.

27. resource/config-only changes invalidate workflow caches by saved project revision, while the existing compatible-input restoration owns draft retention - source-only cache keys missed resource reloads in the browser - cost if wrong: repository saves can refresh schemas, but do not remount user workflows.


### 2026-10-23-github-project-initialization

28. add optional exact Maven-coordinate metadata to release catalog entries rather than deriving release tags from Maven versions - coordinates-to-tag mapping must be explicit - cost if wrong: old catalogs yield unresolved mappings until enriched; existing release resolution remains unchanged.

29. preserve compatibility evidence in a repository-managed build-config.import.json linked by optional build.importReport - imported unsupported steps must survive reopen without rereading a changed POM - cost if wrong: one additional explicit portable report file accompanies initialized settings.

30. known Rune Maven metadata yields unavailable Java targets, never silently substitutes TypeScript for Java - only plugin setup/version/path semantics are verified by pinned10.10.0/10.7.0 metadata - cost if wrong: users explicitly choose supported native targets after initialization.

31. pinned XML fixtures are authored metadata projections with exact upstream commit/source checksums; original downloaded bytes stay ignored for verification - retain coordinates/path facts and CDM license/NOTICE without vendoring unlicensed FpML implementation content - cost if wrong: projections do not establish full Maven build parity.

32. preserve pinned CDM license/NOTICE bytes and scope whitespace attributes to those two exact files - upstream trailing spaces are part of the verified fixture hashes - cost if wrong: these external documents retain upstream formatting rather than the repository source whitespace policy.

33. add optional read-only input/file-list preconditions to shared Save rather than writing POM no-ops - ordinary build revisions intentionally ignore post-initialization POM edits - cost if wrong: stricter initialization conflicts require a fresh review; no POM mutation.

34. create the inactive-clone initialization controller through WorkspaceProvider's existing adapter/controller boundary - the active workspace must remain untouched until review finishes - cost if wrong: one short-lived controller is disposed before normal activation.

35. disable automatic Git sync in the Studio host and provide an explicit Commit and push action using the existing engine - traced Save→notifyDirty→debounced stage/commit/push contradicted the approved local-Save contract - cost if wrong: previous automatic publication now requires a user action.

36. prove independent readiness using retained unsupported Maven Java targets plus explicitly authored native targets, rather than claiming a Java execution became native automatically - all observed pinned Rune Java setup metadata lacks a native adapter - cost if wrong: this proves composition/readiness, not Java generator parity.

37. keep persisted import evidence historical and evaluate current target/function readiness from authoritative diagnostics and effective-graph Capability[] - repairing native settings must not remain blocked by old unsupported Java notes - cost if wrong: historical notes remain visible after repair until deliberately replaced; they do not stand in for current runtime checks.


### 2026-10-23-studio-projects

38. move the unchanged canonical declarationKey into core/project-contract and reexport through existing project-resolution/root - config must reuse exact full identity without importing parser services - cost if wrong: purecontract gains one export; old root API remains identical.

39. extend shared Save with explicit CAS removals rather than deleting example files through a second filesystem path - rename/delete/move and partial recovery must retain one journal/readback/ownership contract - cost if wrong: additive mutation branch needs adapter/controller regression coverage.

40. expose a pure runtime/data codec gate preserving existing capabilities exports - browser persistence must share configured codec availability without loading native graph/host - cost if wrong: additive private entry requires browser build coverage.

41. add optional canonical typeIdentity to the legacy InstanceRecord adapter and one typed decoder - FQN alone cannot preserve owner/kind, and migration must reject scratch JSON - cost if wrong: additive public field/decoder require API refresh and existing bundle regressions.

42. bind production example IO in WorkspaceProvider to its existing ProjectController, leaving App only a typed legacy-storage factory - one workspace ownership/Save boundary must govern portable records, not simultaneous private autosave - cost if wrong: provider lifecycle and delayed workspace completions need regression coverage.

43. serialize example operations across records while retaining existing per-record store queues - concurrent descriptor Saves share one controller, so per-ID queues alone race - cost if wrong: large batches save sequentially.

44. derive existing public record/provenance/diagnostic types from their runtime schemas - avoid parallel envelope definitions - cost if wrong: structural public types remain same, consumer types/builds verify.

45. repository reload/retry invokes canonical controller recovery instead of a parallel rollback or bypass - interrupted writes must complete guarded readback before Saved/reopen - cost if wrong: reload reads a fresh snapshot, conflicts remain explicit.

46. share typed portable-root discovery/path guards across examples/workflows/layouts - no three approximations of private-root and decode policy - cost if wrong: existing example reader regressions must remain green.

47. portable literals must be JSON values, stable property paths exclude runtime array indices, empty path identifies the primitive control itself - keep semantic payloads independent of DOM/list identity - cost if wrong: unsupported literal/format remains explicit, no hidden coercion.

48. serialize Save/recovery mutations in the shared ProjectController, keeping load/build generation guards and each mutation's CAS intact - example and layout editors can save concurrently; separate feature queues cannot guarantee one controller mutation - cost if wrong: a waiting Save may encounter a legitimate newer-file conflict and must retain its draft.

49. shared primitive presentation uses empty source path, full-width span persists as numeric3 and projects back to full - approved DTO stores numbers, editor caps3columns - cost if wrong: future column expansion needs a schema migration rather than silently changing width semantics.

50. retain the mounted schema and current compatible inputs during same-function schema refresh, block Execute until fresh schema arrives, and share parameter/array-element compatibility between session and Prototype - do not invent a second execution revision or skip authoritative project receipts - cost if wrong: old fields remain visible briefly while marked running; incompatible fields reset once fresh schema arrives.

51. workspace reset clears preview data/request maps, provider cleanup alone disconnects the worker - transport lifetime exceeds workspace data lifetime - cost if wrong: provider cleanup remains responsible for null ref.

52. refresh obsolete browser selectors and density assertions for the shipped workflow surface rather than restoring retired chrome - current Add/type picker/node status controls are intentional - cost if wrong: old layout is not covered because it no longer renders.

53. starter provenance is workspace source metadata, never GitBacking - copying a public repository does not authorize a writable remote - cost if wrong: connecting a writable repository remains an explicit separate action.

54. absent lastSyncedSha is missing evidence, not Not pushed - recent status must not invent publication state - cost if wrong: status remains deliberately historical until real sync data exists.

55. publish a project-owned Explorer/parser view from the same captured verified documents, using canonical batch hydration and ScopeComputation exports - legacy metadata/latest must not determine a managed project's visible types - cost if wrong: managed view hydration adds work per semantic capture, and late workspace completions require guards.

56. retain existing captured/receipt contract and expose reference-view loading/errors separately - execution/LSP already gate their own applied receipts; UI parser readiness must not redefine semantic capture - cost if wrong: hosts must continue enforcing their own gates.

57. complete serialized files are already definitions, so shared curatedDeferredExports excludes them from hydration requests - keep one readiness path and worker receipt gate - cost if wrong: malformed serialized definitions must remain explicit worker errors, never trigger latest fallback.

58. keep existing bracketed editor paths plus canonical semantic URIs; managed copy takes exact URI+bytes from current verified reference documents after receipt checks - no invented legacy artifact key - cost if wrong: stale/mismatched source must be refused, old unmanaged loader stays isolated.

59. when the complete pinned view takes ownership, clear legacy corpus cache and reject late model documents outside its files - stale source must not override a current lock - cost if wrong: managed views rely on their verified complete closure; unmanaged progressive hydration remains unchanged.

60. keep the required bare numeric Double/Caller runtime fixture, and route the browser example journey through a local typed Quote wrapper calling that same reference Caller - existing example creation is intentionally object-oriented, and a wrapper exercises real stored-object binding/output without expanding primitive-root schema APIs - cost if wrong: standalone primitive examples remain outside this slice, not falsely advertised.

61. finishing a layout edit waits for its existing canonical Save to settle, without changing receipt invalidation or adding a second execution revision - users need a truthful finish boundary - cost if wrong: finishing remains disabled during slow storage and Retry retains the draft after failures.

62. scoped initialization IO is separate from active-project IO and is limited to freshly cloned IDs plus captured generation/ownership - retain ordinary late-activation guard - cost if wrong: leaving that activation invalidates the pending initializer instead of writing later.

63. malformed/missing/unsupported example payloads block whole-record writes including rename/Retry until repaired and reloaded - never serialize undecoded bytes as data - cost if wrong: metadata-only rename stays unsaved until repair, original payload stays intact.

64. expected fixtures use the conventional tests/expected root plus exact typed descriptor references as protected semantic inputs - avoid a new configuration approximation - cost if wrong: other unreferenced golden directories must be explicitly referenced.

65. proposed compatibility uses isolated canonical graphs/readers/preview contracts; portable/schema changes are warnings, global graph errors block acceptance, unsupported comparisons are explicit - intentional broken bindings can be retained with informed Save - cost if wrong: warnings require user review and do not prove full CDM business parity.

66. public starter availability, deployment/publication/writable Git integration remain separately authorized - local deterministic checks cannot verify unperformed remote operations - cost if wrong: remote delivery remains pending.

67. full CDM business/Java parity and standalone primitive-example UI remain excluded - the fixture proves wiring only - cost if wrong: payment schedules/calendar/observations need later implementations.

68. OS-wide atomicity and multi-object catalog promotion remain documented limitations with implemented revision/readback guards - no platform atomicity promise - cost if wrong: external races or partial independent promotions remain possible and require recovery.

69. upstream-compatible Rune materialization/new project ZIP remain unavailable rather than inferred from generator absence - no newly enabled source-export claim - cost if wrong: users need a later explicit portable archive/materialization feature.

70. Changesets packaging, unrelated dirty files and pre-baseline history remain separate - no opportunistic owner cleanup or review expansion - cost if wrong: their existing limitations are not repaired by this branch.

## Deferred minors

None were reported by the final reviewer.

## Capability and publication limits

- Remote starter proposals remain unavailable until real repositories are created and verified through a separately authorized step.
- The numeric Double/reference Caller fixture proves explicit Rune replacement wiring (10 to 20). The browser uses a typed Quote wrapper; standalone primitive-root example UI is outside this slice.
- Full CDM payment schedules, external observations/calendars, decimal business parity and Java implementation parity remain gaps unless explicitly implemented. Static Maven metadata is not Java execution.
- OS-wide atomicity, transactional multi-object catalog promotion, a new portable ZIP mode and upstream-compatible source materialization are not claimed.
- Existing public/private Changesets packaging and unrelated owner changes remain separate.
