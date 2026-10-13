# Architecture and Invariants

Current source and package manifests take precedence over historical specs.

## Package Map

| Area                                                    | Responsibility and entry points                                                                                                                                                                                                                     |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core`                                         | Rune grammar, generated AST/domain/Zod surfaces, parsing, linking, validation, and serialization. `src/services/rune-dsl-module.ts` exposes `createRuneDslServices`, which composes generated and custom Langium services and registers validation. |
| `packages/lsp-server`                                   | Language-server integration over the core language services.                                                                                                                                                                                        |
| `packages/codegen`                                      | Native generation, imports, Rosetta rendering, and instance utilities. `src/generator.ts` orchestrates namespace generation; `src/emit/namespace-walker.ts` supplies shared normalization.                                                          |
| `packages/visual-editor`                                | React Flow graphs, forms, adapters, and editor state; consumes core and codegen.                                                                                                                                                                    |
| `packages/design-system`                                | Shared theme, tokens, and UI primitives.                                                                                                                                                                                                            |
| `apps/studio`                                           | React IDE, workspace persistence, browser workers, provider composition, and Pages Functions.                                                                                                                                                       |
| `packages/git-sync-engine`, `packages/curated-schema`   | Shared Git synchronization and curated-model contracts.                                                                                                                                                                                             |
| `packages/instrumentation-core`, `packages/worker-core` | Shared instrumentation and Worker infrastructure; Worker logging lives in `worker-core/log`.                                                                                                                                                        |
| `apps/lsp-worker`                                       | Hosted LSP sessions in `RuneLspSession` Durable Objects.                                                                                                                                                                                            |
| Other worker apps                                       | Curated-model mirror, GitHub authentication, codegen gateway, and telemetry.                                                                                                                                                                        |
| `packages/codegen-legacy`, `apps/codegen-container`     | Legacy JVM/Rosetta bridge and container path; Java 21 and `rosetta-code-generators` still apply here.                                                                                                                                               |
| `apps/docs`, `site`                                     | Documentation and landing page, combined with Studio into the Pages artifact.                                                                                                                                                                       |

The main dependencies are Studio → visual-editor/codegen/LSP/core,
and CLI/codegen/LSP → core.

## Studio Runtime

- Studio uses React 19, React Flow 12, Dockview, zustand 5/zundo 2, Tailwind CSS 4, Base UI, and CodeMirror 6. Manifests currently use TypeScript 7 and Langium 4.4; check manifests before changing versions.
- OPFS stores workspace files; IndexedDB stores metadata, caches, settings, and layouts.
- Workspace activation reconciles the shared model store with the destination bindings before parsing or persisting them. New/close clear files, deferred declarations, hydration, selection, previews, and undo history in memory only after pending saves succeed, preserving the previous workspace on disk. Storage failures retain the current workspace and its retryable latest snapshot; edits arriving during a flush must also finish saving before activation. A newer transition request supersedes older requests still waiting for storage. Pending parse/load results are invalidated across that boundary. Superseded restores leave the newer workspace's screen alone; the winning import owns the loading screen and exits restoring mode. Superseded imports discard only their newly created empty record.
- `apps/studio/src/shell/providers/StudioProviders.tsx` composes provider responsibilities; `LspProvider.tsx` owns the LSP client and transport lifecycle.
- `WorkbenchHost` owns Dockview mounting, stable panel bridges, native-layout restore, serialization subscriptions, and disposal. Each perspective supplies a `WorkbenchDefinition` with its panels, titles, and default builder. `DockShell` remains Explore's adapter: it owns migration of `PanelLayoutRecord`, the Explore factory layout, toolbar/shortcuts, center-pane policy, and utility-tray collapse behavior. Per-workspace perspective preferences use versioned workbench settings; they must contain UI state only, never model payloads or generated artifacts.
- **Studio LSP is network-only.** `apps/studio/src/services/transport-provider.ts` defaults to session-token minting followed by a token-gated WebSocket to the hosted LSP. Only an explicit `wsUri` opts into direct WebSocket, with token-gated fallback after failure. Configured endpoints can differ between local, preview, and production environments.
- Parser and codegen browser workers handle local model operations; they do not provide an LSP fallback.
- LSP diagnostics carry the version of the validated Langium document. Studio uses one per-URI protocol version counter for live editor changes, headless file changes and dependency refreshes; mounting or replacing a view preserves that version. Studio rejects stale versions and invalid ranges before forwarding them to graph diagnostics or CodeMirror; it never clamps old ranges onto new source.
- Parser workspace replacement uses one reset for parse and hydration, including empty snapshots. Langium's builder removes parsed documents and their index/build state; indexed deferred stubs are removed separately before registering the replacement. Scope snapshots must never retain symbols from removed files.
- Expression owners retain graph declaration kind through Studio's scope request. Core's `findExpressionOwner` resolves both the editor and worker owner, including the unique base declaration of a function dispatch group. Duplicate bases and ambiguous legacy names fail closed, so same-named Data and function declarations keep distinct bodies and conditions. This lookup works for parsed and serialized models without container pointers. Core's `getExpressionOwners` groups declarations across all namespace files; the graph adapter and Studio's source-file lookup use that same selection, so variant-first file order cannot bind Inspector to a dispatch variant. A lone variant remains visible in the graph but cannot acquire a base expression binding or Builder scope. Builder and foreign-expression drafts capture the workspace dependency snapshot, validate it after asynchronous scope loading and again on Apply, and retain their private text when that snapshot is stale.
- `LspProvider` keeps full source/CST only for the active file (including curated source once loaded). It incrementally synchronizes compact canonical models for that namespace's import and resolved-reference closure, including function-body references. Browser namespace caches remain intact across navigation; the hosted LSP prunes unrelated or replaced snapshots before upload to avoid retaining two corpus generations. All dependencies use Langium's authoritative scope/link services. Editor plugins attach only after their canonical source URI has been opened; already-open owners stay attached during dependency synchronization. Closing detaches the plugin before sending didClose. Live editor buffers override snapshots; closing a source view restores its semantic model. Serialized declaration ranges support cross-file definition navigation without fetching every source file. The Durable Object persists models in bounded chunks and restores them before rebuilding the active source on wake.
- Curated/reference-only models have distinct hydration and editing capabilities. Check deferred hydration, diagnostics, inheritance, and bare/qualified references when changing them; do not equate visibility with editability.
- Source synchronization serializes and updates writable workspace files only. Namespace routing prefers a writable target regardless of reference-file order; serialization baselines, writeback and import matching reuse that routing. Read-only and reference-only files remain byte-identical even when they share a namespace. Routed user models already published to the graph must not be published again by deferred document linking; curated models still enter the graph when first materialized.
- Curated namespace artifacts carry original file `content` alongside the serialized AST. Both artifact builders preserve upstream comments and formatting. The parse response sends serialized models only for immutable artifact keys the browser has not received; the browser retains prior documents across workspace switches in the same tab and reconstructs the full closure for the parser worker's replacement-style hydration. `services/curated-artifact-cache.ts` persists published content-digest artifact identities in a separate, disposable IndexedDB database across reloads and tabs. The small receipt index supplies known keys; only the current server-required closure's payloads are restored. Source text is fetched separately through `/api/curated-source` only for the selected namespace and cached independently by artifact key for read-only browsing. Deferred Source navigation waits for namespace hydration to supply the authoritative artifact identity before reading the source cache; a hydrated legacy namespace may still load without a key. An absent source is a loading state, not an empty file. List-only namespaces remain deferred. Legacy artifacts without content still hydrate, but displaying their original source requires rebuilding and publishing the artifacts.
- Center panes stack vertically when their container becomes too narrow for the selected pane count; the wide layout retains draggable horizontal splits.
- Center controls use one pill panel with a larger gap between the exclusive Graph/Structure view and Source/Inspector companion panes. Accessible groups retain that distinction. Structure refits its existing camera after a settled pane resize; avoid fixed content minimums that overflow split panes.
- Global Search uses the editor node repository, workspace files, and perspective registry. Type results and explorer name/arrow actions use Explore's hydration-aware navigation bridge; file search requests Source through the file-navigation store. Explicit type navigation reveals the target kind, and an empty Graph offers recovery instead of enabled camera actions. Selection-to-source navigation retains declaration identity while AST/source loads and resolves coordinates against the matching source before revealing; only a matching live editor acknowledges success. New selection, workspace, or explicit file navigation supersedes queued reveals. Indirect navigation uses request-scoped, text-free destination emphasis across Source, generated code, Graph, Structure, Inspector, and prototype fields, including repeated loaded destinations. Indirect is relative to the destination pane: a graph, explorer, or Structure selection that reveals Source or generated code cues that destination even when the origin was clicked directly or the file was already loaded. Direct selection within the destination and background model/codegen refreshes alone do not create arrival requests. Explicit repeat navigation and reopening a pane that restores and scrolls to its destination may cue again. Delayed Source waits pulse only the visible Source control after 250ms; unavailable destinations and completed or superseded requests stop the cue. Arrival cues never shift content or change existing focus behavior, and reduced motion uses static emphasis.
- Export's workbench definition reconciles dock constraints after default construction and native-layout restore. Empty generated output starts compact; the first artifact expands only the untouched default group, preserving restored or manually arranged output panes.
- The opt-in development-only `?design-preview` controls use a page-session store. `WorkbenchHost` owns the shared auxiliary edge policy for Explore (Types, Form/Code, utilities), Prototype (Instances/payload graph), and Export (Settings/output). New auxiliary edges start pinned; existing expanded/collapsed arrangements retain their state. Explore side tabs select views and chevrons own visibility; other auxiliary tabs retain native toggling. Group focus must not pre-expand an edge on pointer-down. Opening or unpinning one edge preserves opposite open edges; unpinned panels collapse on return to the main grid. API navigation uses Dockview's activation origin and keyboard tabs expand after native selection. New side edges retain horizontal panel headers while expanded and rotate to vertical strips only when collapsed. Preview layout changes must not persist; toggling off restores the original Dockview snapshot with panel reuse. `DockLayout` applies Rune's shared theme to the outer shell as well as the grid so edge panels inherit the same rounded chrome. The optional Explore location path derives from editor selection and canonical namespace and declaration name. Native collapse/expand is available in the installed free package; overlay peek auto-hide requires the separate enterprise module.
- Close transports during reconnect/disposal so server-side sessions and documents can be released.
- The LSP connection adapter converts returned or thrown vscode `ResponseError` values into thrown lspeasy protocol errors for ordinary request handlers. Cancellation must travel in JSON-RPC's error field, never as a successful completion payload.

## Curated Artifact Cache

The curated artifact cache has a combined budget of 128 MiB of serialized UTF-16 payloads and 512 records, with least-recently-used eviction across model and source records. Payload and receipt writes are atomic. Storage denial, quota errors, incompatible formats and unusable entries fall back to normal loading. The parser keeps models deferred; if deserialization fails when a cached document is linked, it reports the immutable artifact identity. The workspace service discards the restored closure, coalesces concurrent failures into one server refetch and retries linking once. App subscribes to the recovery result through the same parse-result publication path used by ordinary parsing, keeping preview files consistent without importing UI stores into the service. App invalidates service recovery at the same boundary as its workspace parses, including switches to an empty workspace that start no new parse. Parse revisions prevent old recovery hydration and publication while immutable artifact and source caches remain reusable. Freshly downloaded model failures are reported without cache retries. The server still selects the current manifest and dependency closure, so a cached old generation cannot satisfy a new artifact identity. Mutable and legacy date-only artifact paths retain session caching only. Cache entries contain public curated data, never writable workspace files or UI state. Bump the cache format version when changing the serialized hydration contract. Trace operations `curatedCacheIndex`, `curatedCacheRead`, and `curatedCacheWrite` expose storage timings through the existing instrumentation configuration without capturing payloads. This cache reduces repeat downloads; worker hydration and rendering still run, and it does not provide an offline manifest path.

## Form Configuration

Studio's `apps/studio/z2f.config.ts` is the authoritative canonical `@zod-to-form/core` config, imported by its Vite plugin. `components.source: './z2f-components'` resolves relative to each schema module in `src/codegen-forms/`. Generation settings live under `defaults`; `defaults.optimization.compileZod` is independent of optimization level and defaults to false here. Presets expand through the shared resolver, preserving controlled shadcn event props.

Visual-editor's typed `z2f.config.ts` preserves AST hidden fields, sections, schema overrides and array reorder. Its component adapters use `value`/`onChange`; its `FieldTemplate` composes shared design-system primitives. These adapters must override raw shadcn event contracts explicitly. Do not restore removed `fieldTypes`/`formPrimitives` config keys.

The five hand-authored EditorForms use the shared `editorOptimization` policy with L1 enabled and Zod compilation disabled. `EditorFormProvider` supplies cached per-field validators to `EditorController`, resolving canonical AST schemas through object/array paths. This includes identifier unions skipped by the upstream L1 walker. All bespoke RHF Controllers must use that bridge; enabling the hook flag alone drops validation. Unknown loose-object fields (such as `expressionText`) retain their existing dedicated validation. Graph-level diagnostics remain in `ErrorsSection`. The generated-form configuration remains independently unoptimized; it does not install the runtime editor bridge.

## Shared Semantics

- Core normalizes bare functional expressions only at the parser lexer boundary. The bracket scanner is shared with `insertImplicitBrackets`; token offsets and columns map back to original UTF-16 source positions before CST construction. Synthetic brackets have empty images and zero-width CST ranges. CST text, diagnostics, reference locations and serialized text regions all address the original document.

- Core `BASE_TYPE_FILES` owns the standard Rune types and annotations. Studio re-exports it; the shared `RuneWorkspaceManager` loads it during LSP initialization, including reconnects. Core and LSP factories install `RuneDslSharedModule`.
- `hydrateModelDocuments` registers every parsed root before `RuneJsonSerializer` invokes Langium's reference revival. Keep one object graph: repeated deserialize rounds retain stale generations and cannot resolve arbitrary cycles. Batch tests must verify target identity across long chains and cycles.
- Curated downloads use a disposable browser worker; user-file-only downloads use `/api/codegen`. Both call `src/services/codegen-download-handler.ts` for validation, namespace closure, generation, and packaging. Hydration closes the documents that may be resolved; `ExportSelection` then chooses dependency-closed declaration roots for emission; `generateSelected` returns that exact receipt with the outputs, including a kind-aware `requiredBy` provenance map. Artifact envelopes record the receipt, immutable curated manifest cohorts when available, and generated files, so Studio previews and downloads use the same captured ZIP. Preserve fatal diagnostics and terminate the browser worker on completion, error, or timeout.
- Curated mirror CORS uses the shared worker origin matcher and the explicit `ALLOWED_ORIGIN` list in its Wrangler config, including this project’s Pages previews and local Studio ports.
- Curated manifests record bundle dependencies as well as namespace dependencies. Parsing and downloads use `loadCuratedWorkspace` to close the namespace graph across those bundles before hydration. Parsing keeps unrelated namespaces as deferred explorer entries; downloads hydrate all selected documents together before generation. `packages/curated-schema` owns production-source selection and the publisher's namespace graph; CI parses CDM, FpML, and Rune runtime sources in one workspace so serialized cross-bundle references retain their targets. Before serialization, `assertValidDocuments` requires completed linking and rejects syntax or reference errors even when semantic validation is disabled. Worker artifact builds use isolated services with the shared standard library so a previous build cannot supply missing declarations. The uploader hashes the prepared manifest set into a cohort, pins dependency manifests to that cohort, and uploads all versioned blobs and immutable cohort manifests before advancing latest pointers. Consumers resolve floating bundle selections through one cohort, so a partial pointer update cannot mix generations. Legacy date versions still select the current manifest; `cohort-<sha256>` versions select immutable manifests and must match the returned cohort. The mirror cron preserves cohort and dependency metadata alongside the serialized namespace graph. Cohort manifests and content-hashed artifacts remain outside daily archive pruning; any future garbage collector must retain the full dependency closure of live cohorts.
- Routed parsing returns each dependency bundle's resolved manifest cohort/version. Studio registers implicit curated dependencies with that identity before merging reference-only files, so preview snapshots and restored workspace bindings retain the exact serialized reference targets. It does not replace an implicit pin with a guessed latest version.
- Derive UI previews and validation from authoritative codegen output. A sample awaiting a worker validation result must remain visibly pending; editing alone never establishes validity.
- Preview scalar formats follow the resolved Rune primitive, including aliases, arrays and Choice arms. Shared Preview/Prototype controls use native date, time and local datetime pickers over ISO strings. An ISO editor preserves nanosecond fractions and explicit zoned offsets/IDs; changing the companion picker retains precision beyond its millisecond display. Workers remain authoritative validators; friendly temporal format guidance changes only presentation, leaving original diagnostics in Output/Activity.
- Preview preparation coalesces hydration and worker-file acknowledgement independently of individual panel cancellation. A shared 30-second deadline aborts stalled preparation and allows a fresh retry. Projection display requests also have a 30-second deadline and a direct Retry generation action; execution keeps its separate 120-second deadline. Late replies cannot replace a newer retry result.
- Routed parse results carry every resolved curated bundle's immutable cohort/version, including implicit cross-bundle dependencies. Studio retains those bundles in its workspace model bindings instead of discarding dependencies that the user did not select explicitly.
- Workspace edits update memory immediately. Browser persistence coalesces rapid edits for 500 ms, with a two-second maximum wait while typing; pending snapshots keep their original workspace IDs and flush on workspace transitions, hidden visibility, page hide, and unmount. Parsing remains a separate debounce and does not gate saving syntactically invalid drafts.
- Output offers an explicit local debug JSON download using the existing bounded diagnostic/operation stores. Source contents are opt-in and never lazily fetched; credentials, storage dumps, instance payloads, and serialized ASTs are not collected. Remote telemetry retains its existing closed privacy schema.
- Recursive and deep preview objects use finite, namespace-qualified `FormPreviewSchema.definitions` generated by the same Data/Choice builders. `expandPreviewField` relocates one definition body at a time; the shared Preview/Prototype controls expand deferred objects only when a value exists or the user adds one. The eager depth cap limits schema size, not authoring or generated Zod validation depth. Invalid recursive aliases remain language errors.
- Explorer navigation uses the graph node ID; row dragging retains the shared type-reference payload for association editing. In controlled inclusion mode, the row/name toggles the caller-provided canonical selection ID without a navigation highlight; the arrow opens the declaration. Filtering, virtualized rows, and collapsed namespace descendants must not discard explicit selections. The explorer count reports available declarations, independently of graph visibility.
- Parsing and downloads share raw-source collection, including read-only system definitions. Editability must not determine which declarations codegen can resolve; curated bundle metadata and serialized documents use their separate transport.
- Reference models explicitly selected on the launcher seed newly created workspaces, including pre-created Git-backed targets. Creating a workspace from an active one does not inherit its bindings. Saved curated-only workspaces restore their bindings even with zero source files. Failed or unresolved declared bindings remain persisted for retry; after a successful load, explicit unload removes the binding.
- Explorer compacts namespace chains before filtering, retaining common-prefix branches and namespaces with direct declarations. Expanding a parent automatically opens only single-child namespace chains and stops at branching points; collapse clears the whole subtree. Shared namespace-tree helpers preserve canonical paths for expansion and subtree inclusion; the explorer omits per-namespace kind summaries while retaining declaration badges and top-level kind filters.
- `walkNamespace` gathers declarations and computes the type-reference graph, cycles, and emission order once per namespace. Emitters consume the readonly `NamespaceWalkResult` and own their diagnostics/source maps.
- `getTargetRelativePath` centralizes output paths. TypeScript and Python function emitters consume the shared extraction facts in `types/func.ts`; target syntax and runtime remain separate.
- Studio function forms use resolved inherited/dispatch signatures. Codegen `normalizePreviewInputs` adapts plain form values using the shared type resolver and metadata runtime helpers, traversing actual input values independently of form expansion depth. Python input normalization and this adapter share declaration-derived metadata payload shapes from `expr/metadata-input.ts`, including aliases, inherited Data/Choice fields and own/inherited key or template metadata. JSON envelopes retain their metadata and normalize only their payload; records matching declared payload fields take precedence where the two shapes are ambiguous. Python marks runtime-created wrappers with an internal dictionary subclass so repeated function-input normalization preserves their representation without adding JSON keys. Metadata conversion preserves absence before wrapping, including call and constructor boundaries; required cardinality checks still reject missing values.
- Studio function preview and standalone schema compilation share the Sucrase TypeScript compiler. Function preview transpiles complete generated modules and resolves imports among generated outputs plus the explicit `@js-temporal/polyfill` runtime dependency. Keep private evaluator binding names outside the Rune identifier alphabet (use `$`). Keep the worker execution restrictions and test real parsed/emitted functions when changing this path.
- Builder scope requests include the current workspace sources and serialized dependencies, with canonical file URIs. The parser worker serializes each complete parse/link/scope request so router fallback and concurrent updates cannot query missing or stale documents.
- Core `getFunctionInputs` resolves inherited inputs and dispatch signatures for both codegen and expression scope; external callable scope entries count their declared parameters, and reporting/eligibility rules expose zero or one argument from their declared input. Scope inspection materializes deferred callable descriptions through the shared Rune linker before reading signatures; unrelated model stubs stay deferred.
- Core `getFunctionSignature` resolves dispatch bases from namespace declarations and linked selectors. Language-service scopes and codegen share it, including overloads split across files. Output enum-member scope derives from that effective signature, retaining the correct declaration identity for inherited and dispatch functions when global enum names collide.
- Visual-editor operation drafts use core `parseExpression` for syntax validation before committing any operation. Unknown workspace symbols do not require linking at this boundary; invalid drafts retain their private text.
- Function expression helpers live in `packages/codegen/src/expr/`; preserve cardinality and metadata across call and assignment boundaries. Validate changed semantics with parsed Rune, strict compilation of generated modules, and runtime assertions. TypeScript exported entry points expect prevalidated, correctly typed inputs. Studio validates plain form inputs once with `emitStandaloneZodSchema` in function-input mode, reusing Data attribute schemas and their full dependency closure. Calls and root assignments skip adaptation when linked bounds and representation already fit; computed arguments, nested set/add targets, and function outputs retain runtime cardinality checks; appends check the combined collection before mutating it. Function-input schemas convert ISO strings to Temporal once throughout the dependency closure. The shared `RuneFuncData` structural mapping and class-to-function calls preserve Temporal instances; Studio serializes execution results back to JSON wire values. See the codegen README.
- Core scopes and codegen share `resolveOperationType` and `getOperationArgument` for operator result types and headless pipeline inputs. Keep symbol lookup in its owning context; add operator propagation rules to the shared core utility. Conversion operators expose intrinsic result names: scopes resolve the corresponding workspace record declarations, while codegen retains the semantic type for comparisons without inventing AST declarations. Calendar field reads, including implicit pipeline fields, use the shared `renderCalendarField` emitter because TypeScript values use Temporal and Zod JSON predicates use ISO strings.
- Switch guards retain Rune's target restrictions: basic, record, enumeration and alias types can select declared Choice arms, but are not standalone type guards. The broad AST target union accommodates those Choice arm declarations; scope resolution enforces the distinction. `getChoiceTypeScope` shares qualified-name and import-alias handling between `as` and Choice switches.
- Core `getEnumValues` supplies inherited enum members to scopes and emitters. Constructor fields precede metadata keywords; Choice switch guards prefer declared option types over same-named imports.
- Core also owns alias resolution, declared choice-option paths, and choice field names. `as` selects an exact declared choice arm (including nested arms and distinct aliases) or narrows data to a subtype; collection narrowing filters unmatched values. TypeScript retains selected metadata wrappers. When several Choice paths reach the same target, retain each path’s declared wrapper kind and normalize present terminal selections before combining them; never infer wrappers from a payload’s `value` property. Data narrowing uses structural guards because plain JSON inputs have no nominal runtime type tag.
- TypeScript declaration names, annotation decorator factories and their Args types, and callable bindings use `packages/codegen/src/emit/callable-names.ts` across imports, type signatures, expressions, and bundled exports. Resolve calls from declaration identity; preserve original Rune names in function metadata used by Studio and carry the actual export in `GeneratedFunc.exportName` when a function collides with a type.
- Reuse `@rune-langium/worker-core/log` (`createWorkerLogger`, `REDACT_PATHS_BASELINE`) in Cloudflare Workers. Send raw structured objects to `console.log` for field indexing. The shared logger implements redaction explicitly because `pino/browser` does not apply its `redact` option. Pages Functions and the Node container are distinct runtime surfaces.

- Studio adapts plain form values and metadata envelopes once, then validates their structure with the standalone function-input schema before execution. Input schemas preserve omitted zero-minimum arrays and reference-only envelopes; Data conditions stay in their separate validation flow. Data/Choice envelopes use declared field shapes, preserving ordinary payload fields named `value` or `externalReference`. The pinned CDM battery covers this shared execution seam.

- Inspector section placement is owned by `visual-editor/src/components/forms/sections/config.ts`. Generated form config derives its field assignments from that layout; custom Inspector tabs resolve the same sections with the upstream `SectionRenderer`. Placement includes inherited AST metadata and UI-only comments, which are not all enumerated by the generated schema walker. Standalone section callback props remain a public API.
- Inspector forms own one 12px outer inset through `INSPECTOR_FORM_CLASS`; the center pane adds none, and headers/sections do not repeat horizontal padding. Fields and embedded editors retain their own text inset. Inspector member rows share name-field geometry through `INSPECTOR_ROW_NAME_CLASS`, keeping attributes/function inputs and enum members at the same text size and padding. Member-details headings derive from the canonical root kind (Attribute, Member, Option, or Input), and icon-only controls retain accessible names. Center panes have no outer padding; graph/structure drawing wrappers own a 6px inset so React Flow's interaction layer remains untouched. `DockShell` measures the center stack for location-path alignment and updates it on native layout changes and resize.
- Explore side panels use the shared `PanelCollapseButton` chrome from the utility tray. Dedicated grid groups resize to a constrained rail, rotate headers vertically while hidden, and retain mounted drafts and the session's expanded width in workbench-owned state across header remounts. Single-tab side groups retain header actions, with the chevron above titles when collapsed. Explore restores dedicated split Form/Code columns into one preview group without replacing panels; mixed groups containing the main task are preserved. The dock title supplies Studio's sole Type explorer heading; groups sharing the main task on narrow layouts are never hidden wholesale. Preview edge groups use their native collapse API, with explicit show/hide choices kept open across focus changes.
- Non-React consumers use `@rune-langium/visual-editor/model` for graph state and `/identifiers` for identifier helpers. Workers must not import the full UI barrel. The render gate accepts regenerated schemas into its existing registry during development, preserving workspace consumers while React refreshes the Inspector.

## Deployment and Verification

`pnpm run build:cloudflare` combines the landing page, docs, and Studio under
`apps/docs/.vitepress/dist/`. Source Pages Functions live in
`apps/studio/functions/`; root `functions/` and `wrangler.toml` are generated
build artifacts. Consult [the testing guide](../TESTING.md) for endpoint,
production smoke, and full UX verification commands. Keep evidence from those
checks separate from local unit-test results.

## Expression editing

Studio's Inspector reuses SourceEditor and `documentExtensions` for continuous function implementation and active Data condition editing. Core's implementation range retains same-line, comment-only and trailing body trivia for parsed and serialized models; a body without comments or statements remains a zero-length insertion. Trailing comments on later lines must be indented beyond the declaration; following top-level documentation stays protected. Region views keep the complete owning file in CodeMirror, conceal and protect other regions, and retain full-file UTF-16 offsets (including CRLF bytes). Shared editing transactions preserve CRLF for Enter and paste while retaining one undo entry and leaving externally synchronized bytes intact. The shared editor theme owns typography and content padding. Embedded function/condition and generated editors use minimal CodeMirror chrome without gutters or active-line decoration; Source retains compact gutters. Embedded views resize vertically and expand without recreating their editing session.

`ExpressionDocument` captures file identity, workspace generation, revision and expected range text for guarded edits. It retains mapped regions by file/declaration/target so invalid drafts remain editable after Inspector disposal; edits outside a retained region require fresh parsed coordinates. Parsed workspace entries retain their exact input source while structural form edits wait for reconciliation. Curated source loads on demand for either Source or Inspector and remains read-only. `LspClientService.claimDocumentView` assigns one plugin owner per URI, transfers it on focus, and flushes final pending edits before detachment; closing an inactive view cannot untrack its active peer. A current parse that removes or renames the selected declaration invalidates its editor binding.

The Inspector Builder opens a private expression draft dialog from the current
function caret or selected Data condition. Apply validates the captured workspace,
file revision and original expression bytes, then commits one CodeMirror undo
transaction; Cancel and Escape never write. Unfilled Builder slots render a preview-only invalid Rune marker, so Apply cannot commit them, including after switching to Text. The strict shared serializer rejects placeholders. Reordering/deleting a condition or
editing Source makes an open draft stale. The parser worker exposes core's
canonical expression scope, including dispatch signatures, inherited fields,
earlier aliases, Choice symbols and callable argument counts. Visual-editor reuses the core scope-kind type and omits callables without authoritative arity from its picker. Confirmed zero-input calls remain available. The dialog's Text surface reuses
SourceEditor with a private buffer and no live LSP owner.

Before requesting builder scope, Studio normalizes the owning workspace path to
its URI and sends the current source/dependency snapshot through the parser
worker's existing parse/link pipeline. This also seeds that worker after a router
request falls back to main-thread parsing; it does not create a second resolver.
The worker serializes complete requests over its mutable document/index services,
including scope's parse/link/read sequence. Failed snapshot builds and syntax
errors in the owning document fail the scope request. Unrelated files' syntax
errors do not block a valid owner; no request continues against another
request's documents.

Generated expression views use codegen's recorded projection metadata and the
existing preview worker/session client. Embedded function views display body-only
fragments; condition views display the predicate without declaration or diagnostic
wrappers. Emitters record these fragments during the same traversal that generates
the full exported declarations; public projection selectors default to declarations. Display coverage is independent of inverse-lens coverage. Reverse
editing opens a private dialog, schema-validates and reparses the converted Rune
AST, and applies only the captured region with revision guards. Generated function bodies remain read-only. Function provenance includes trailing implementation
comments through core's source-region helper. The projection worker resolves the
canonical owner and validates the current body binding against source before
selecting its declaration range, including hydrated models without document text;
responses retain the original editor binding. Native scalar operators share the export emitter's
linked type/cardinality proof; collections, metadata, missing values and structured
equality retain their required runtime behavior. Preview file receipts acknowledge
delivery; identical content preserves the linked/generation caches.

Projection lookup compares canonical Langium URIs while replies retain the original
editor binding. Both languages use codegen's `resolveExportSelection` to generate
the selected declaration and its dependency closure, including dispatch siblings.
An unrelated broken declaration must not block a valid projection; a rendering
failure in the selected closure remains visible. Projection cache keys include
language and declaration identity alongside the existing workspace version guard.

Equality projections and exports use compact native scalar comparisons when the
linked type proof permits them, including optional scalars over prevalidated JSON.
Enum constants use the same scalar proof in both feature-call and symbol-reference
forms, including hydrated models. Boolean comparisons against literals reduce to
the value or its negation when the field is required. Branch and short-circuit
facts fold proven scalar contradictions instead of widening inputs with casts.
Typed scalar presence uses null checks; collections use their length. Metadata
field collections have required payloads, while reference collections check for
an actual payload because reference-only entries are valid. Unknown cardinality
uses a native, single-evaluation presence predicate. Constructor context and literal-preserving
cardinality generics retain enum types without literal casts; matched scalar and
collection shapes skip redundant normalization.
Displayed TypeScript condition predicates use `false` for a missing `else`.
Executable validators retain implication semantics: a condition passes when its
antecedent does not apply. A missing branch in a function value expression remains
`undefined`; nested value expressions within predicates retain that behavior.
Executable structured values compare canonical `rune.valueKey` results. Scalar
structural comparisons in displayed TypeScript bodies assume purpose-built Rune
objects with `.equals()` implementing that same recursive contract; optional objects
retain null/undefined equivalence. This representation does not execute in the preview. Primitive collection
comparisons inline the same quantified equality source used by the runtime;
structured collections retain `rune.equals(left, right, quantifier?, unequal?)`. Computed scalars use native
target-language comparisons as well. Built-ins whose source is not loaded and
linked aliases resolve through the same declared-type resolver as signatures.
`collection-shape` distinguishes uniformly scalar/array expressions from mixed branches,
using the linked navigation facts. Native list materialization, count, filtering,
mapping, edges, ordering and primitive set operations serve projections and exports.
Mixed branches use native flattening without widening or casting input values.
Singleton arithmetic and Cartesian comparison share source builders with the runtime;
each operand/key is evaluated once. Completed primitive function returns reuse their
enforced output bounds; pending output accumulators and composite/metadata boundaries
retain their checks. Explicit `...` composite constructors retain a builder assertion
for their incomplete fields; complete constructors use `satisfies` and preserve enum literals.
Cross-namespace calls reuse the shared export-name ownership table: unique names
stay short, while collisions and lexical shadowing retain protected aliases.
Private captures are scoped to the caller module and defer binding reads, so
single-file output cannot duplicate aliases or read later native bindings early.
Constructor emitters and cardinality/list adaptation share presence facts: an empty
Choice is absent, while an empty Data builder is an object. Required boundaries
must still reject empty Choices.
Primitive and enum function inputs need no input normalization. Dates and times
use Temporal in both functions and Data classes. Required calendar arithmetic,
field access, equality, and ordering use native Temporal operations. Input schemas
convert ISO wire strings once using the shared Rune formats and Temporal parsing,
including aliases, recursive fields, choices, and metadata payloads. JSON schemas
and forms retain strings; Worker results convert Temporal values to ISO strings
before crossing the message boundary, preserving ordinary numeric and optional
values through structured cloning. Function-condition body projections use the
same Temporal expression mode as exported functions. Python retains precision-preserving
calendar operations for nanoseconds and years outside datetime's supported range.
The shared runtime owns
pairing, broadcasting, missing values and `all`/`any` behavior. TypeScript, Zod
and executable previews use the same generated runtime source; Python exposes
the same namespace and argument order. Name allocation keeps legal declarations,
aliases and inline parameters named `rune` separate from the runtime namespace.

Other expression runtime calls use the same namespace: `rune.exists`,
`rune.count`, `rune.list`/`single`, conversions, calendar operations and metadata
operations. `contains`, `disjoint` and `distinct` share runtime implementations
instead of emitting per-expression closures. Native operators and standard-library
calls remain inline where their behavior matches. A single runtime composition
function builds TypeScript, JavaScript and sidecar sources, creating the namespace
after its implementations; metadata members follow the existing metadata-use
selection. Namespace aliases retain generic signatures and presence type guards.
Python uses static aliases to its authoritative implementations; dependency
discovery follows both namespace methods and helpers passed as callbacks.

Python expression rendering lives in codegen's `projection/` backend and consumes
the same linked declaration, cardinality, metadata and Choice-path facts. Shared
scalar proofs, Data-selection facts and temporal wire formats serve both targets.
The browser-safe Python runtime string is generated from one authoritative `.py`
file. Grammar reflection drives the expression-kind census; linked execution
fixtures compare Python with the TypeScript emitter, including lexical closure
scope, metadata retention, nanoseconds and daylight-saving transitions.

`generatePythonModule` emits typed Data records, enum literals and complete
function bodies with positional parameters. Both generated APIs use declared Rune
input order and names, escaping target keywords or internal binding collisions.
Trailing optional arguments have defaults; preceding optional arguments retain
explicit absence types. TypeScript exposes ordered `parameterNames` metadata even
in single-file output; Studio uses it to adapt schema-validated named form fields.
Python protects builtins and global callables from input-name shadowing. Native declarations require an explicit callable binding;
missing bindings fail visibly. Dispatch normalizes inputs before selecting a
variant, retaining wrappers for its body. Function condition fragments are
captured from that same body traversal. Python records the authored body statements
without export input normalization or the final export boundary check. Expressions,
conditions and assignments still use the canonical backend, with native dictionary
access, comprehensions, presence/default/coalescing, collection edges and primitive
deduplication. Specialized metadata, structural equality and precision-preserving
calendar operations retain their authoritative implementation. See the
[utility scrub audit](../investigations/2026-10-13-projection-utility-scrub.md).
Python and TypeScript share projection
provenance and Studio's file-version/async cache guards. Studio lazily loads
Prettier and Ruff WASM in the codegen worker for generated display formatting,
strips temporary formatter wrappers and rechecks source freshness afterward.
Authored Rune text is not formatted through this path. Generated views remain
read-only and do not widen the inverse lens.

Rule predicates resolve their declared input through the authoritative type/scope helpers. Python shares implicit field-context initialization with Data conditions; TypeScript rules reuse its Data-condition context, including inherited fields and metadata presence. Named rule fields link through the same typed scope used for navigation.

## Inspector shared constructs

The Inspector uses one declaration form and generated canonical schema. `InspectorFrame` composes the common header, inheritance picker, appropriate tabs and `InspectorFooter`; `InspectorDetailsPane` shows metadata for the selected child below the member rows. Attributes/function inputs share `AttributeRow` and the same complete Attribute draft factory. Enum identifiers remain inline; enum `display` belongs in selected-value details. `MetadataSection`, `AnnotationSection` and `SynonymEditor` bind root or child paths through `MetadataTargetContext`; readonly rich items use the authoritative Rune renderer.

Inspector sections mount on first activation and remain mounted while hidden afterward. This avoids creating inactive expression editors on selection while preserving visited drafts, CodeMirror views/undo and registered commit flushes. Section IDs retain their sessions across tab reordering; removing a section unmounts its content. Browser checks for the complete file editor use `fullSourceEditor` in Studio's shared test helpers, scoped to the center stack's Source pane; embedded expression editors also use the shared SourceEditor component.

`useInspectorTargets` maps form keys to canonical member range/name/type-reference identity before paging, including the source-reset frame. `useInspectorSelection` maintains form-local RHF/pointer/range identity and requires a unique match after reparse. `useInspectorExternalSync` uses upstream source triggering and RHF public form-state subscription to rebase dirty leaves/errors through that same authored member identity; removed/ambiguous drafts cannot migrate to a replacement child. Guarded name-only callbacks preserve current Source signatures/display. Nothing persists these child keys. `metadata-target` guards owner, epoch and expected item; `metadata-ops` validates the edited canonical field and uses the existing graph recipe/history/patch path. Valid pending metadata commits blocked by parsing retain their draft and reject the existing save barrier until retry. Rich form payloads detach on acceptance, and unchanged item leases can renew across reparse. Inherited/curated metadata stays readonly; explicit existing override actions retain their meaning.

`EditorCommitRegistry` flushes existing debounced fields and focused rich item edits before a root rename or Studio workspace/source/storage barrier. Source sync's explicit flush awaits the same ordered publication receipt and immutable parsed baseline as its observer. CodeMirror keeps its view during temporary readonly/signature-coordinate transitions and reconfigures editability in place; stale source coordinates cannot authorize edits or projections. Studio does not manufacture a Saved label.

Authored comments are Source-only. Core's existing lexer yields UTF-16 comment ranges; per-render trivia ownership comes from original child CST ranges, including outside-root inline tails. Clean declarations need no trivia scan. Dirty render recursion preserves owned comments once, drops removed-child trivia and reuses untouched bodies. Legacy notes and standalone callback APIs remain covered. See the [qualitative #562 assessment](../investigations/2026-10-12-inspector-562-assessment.md).

Curated navigation resolves the selected declaration's actual document within the active bundle/version/namespace/artifact. Pending reveal is scoped to current navigation/workspace/revision and is cancelled when superseded. Multi-document namespaces must never use the first matching namespace file as a declaration owner; namespace/source laziness and immutable cache keys are unchanged.

Source selection uses CodeMirror lexical context plus an anchored declaration and
its name range. Comments, strings, neighboring lines and ordinary expression
keywords cannot manufacture a missing-type navigation request. Explicit LSP
reference navigation still resolves through the language service.
