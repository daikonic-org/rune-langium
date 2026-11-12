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
| `packages/project-config`                               | Host-neutral portable project configuration, comment-preserving YAML edits and dependency lock contracts. Target validation is injected; only core's pure project contract is imported, without parser, Studio or codegen dependencies. |
| `packages/instrumentation-core`, `packages/worker-core` | Shared instrumentation and Worker infrastructure; Worker logging lives in `worker-core/log`.                                                                                                                                                        |
| `apps/lsp-worker`                                       | Hosted LSP sessions in `RuneLspSession` Durable Objects.                                                                                                                                                                                            |
| Other worker apps                                       | Curated-model mirror, GitHub authentication, codegen gateway, and telemetry.                                                                                                                                                                        |
| `packages/codegen-legacy`, `apps/codegen-container`     | Legacy JVM/Rosetta bridge and container path; Java 21 and `rosetta-code-generators` still apply here.                                                                                                                                               |
| `apps/docs`, `site`                                     | Documentation and landing page, combined with Studio into the Pages artifact.                                                                                                                                                                       |

| `packages/project-runtime` | Composes project-config, core and codegen for explicit named builds. The `/browser` entry owns the host-neutral build transaction with an injected generator; native parser composition is at the root and filesystem/local-project entry points live under `/node`. The `/references` entry owns host-neutral locked closure resolution and byte verification. |

The main dependencies are Studio → visual-editor/codegen/LSP/core,
and CLI/codegen/LSP → core. CLI project builds use project-runtime; core/codegen expose their package metadata for authoritative toolchain version checks.

## Portable project state

Studio change feedback is presentation-only. `ChangeFeedbackBoundary` compares
canonical rendered item snapshots after accepted authored input/model revisions;
source positions and background reference hydration do not create edit events.
Inspector rows expose stable presentation keys through the shared row helper.
Structure instances share their canonical navigation key, so an edit cues every
visible expansion of the same type. Graph cues compare authored node data, excluding
position and selection; panning, moving blocks and layout changes stay quiet.
Position-only Graph layout results preserve React Flow's current measurements,
including dimensions accepted by a ResizeObserver update in the same frame.
Source and generated code use the same effect vocabulary through CodeMirror
decorations on explicitly annotated external document updates. Initial display,
navigation and active editing controls stay quiet, including commits after blur.
Removed controls leave only a bounded inert, aria-hidden visual snapshot; feedback
never delays a model mutation or adds another persistence/validation path. Sample
JSON retains its exact text while a CSS-only deletion ghost shows removed text.
Its cues require a ready preview and an accepted authored or sample-value revision,
so schema hydration and validation-only updates stay quiet.
Timing is shared by animation and cleanup, and reduced motion removes spatial
transitions while retaining the color cue. Feedback is canceled on focus, scope
changes and unmount; it never moves the caret or scrolls another pane.
Feedback fingerprints filter parser-only metadata and use Core's canonical
BigInt replacer, so hydrated integer literals remain comparable to wire values.

`project-config` owns file capture, revision identity, normalization and snapshot
validation. Both Studio and the headless runtime consume these host-neutral
contracts. Positive source glob selection and semantic input revision are shared:
configuration, lock, selected Rune sources, resources and shared Studio files
invalidate inputs; generated output and unrelated prose do not. Raw byte revisions
preserve binary resource identity. Snapshots retain known raw file revisions;
`createProjectDraftSnapshot` rehashes edited text while retaining untouched binary
identities. Input paths use code-point ordering so host locale cannot alter a
revision. Structural errors prevent snapshot activation; target-scoped errors
are selected through `projectDiagnosticsForTargets` for each explicit build.

Studio's `WorkspaceProvider` publishes project state separately from model data
and personal workbench preferences. Its controller validates proposed files,
performs revisioned Save/readback, retains the last valid snapshot on errors and
discards late activation results. Working-copy adapters bind the workspace root
and live ownership; journals map to private backing storage outside Git.
Migration returns proposed writes for confirmation and never deletes browser
preferences as a side effect of reading repository configuration.

WorkspaceProvider extends the shared workspace save barrier to drain portable
example and presentation saves after editor/source flushing. Both streams drain
until their saved state stabilizes, including edits queued during the wait. Settled save failures remain
blocking until explicitly retried; Git stages only after the complete barrier
succeeds. Example payload/descriptor writes and removals retain their normal transaction/readback and workspace ownership checks.

The Source bar reports the actual source autosave state and its Save action drains
that same shared barrier. A file's Git modification flag is independent of local
persistence; saving never marks uncommitted work as committed.
Successful autosave clears retained manual-save errors in the Source bar; pending
or failed persistence never clears them by itself.

Named-target settings are repository state; the selected target and ad hoc root
selection remain personal run preferences. Explicit Save preserves YAML comments
and checks the captured file revision. Before a named build, Export flushes editor
and source autosave, reloads the active project controller, and waits for the
ordinary provider's matching runtime capture. Preparation is cancelable and
rejects workspace/source changes or Save failures; it never creates a parallel
receipt. Only then does Generate target/all stage every chosen artifact before
writes through `project-runtime/browser`; the native host parses an isolated graph, while Studio supplies the existing server generator. Both use
strict library defaults and shared concrete namespace-scope expansion. A build
finishing after project disposal cannot write through the guarded adapter.
Binary generator output is persisted as bytes. Preview/download retain the exact
captured ZIP and become stale on semantic input or configuration errors.

Export settings and generated output share one expandable Dockview panel with
mounted tabs, preserving target drafts when switching views. Generation diagnostics
open from a counted disclosure instead of displacing source. Artifact files carry
small namespace ownership lists derived from emitter source maps and canonical
target paths; explorer navigation selects the matching captured file within Export.
These lists survive output-prefix composition without retaining full source maps.
The first preview prefers a text file owned by an explicitly selected root's
namespace, using that captured metadata rather than archive order. A still-valid
explicit file choice remains selected across regeneration.
Reference detail cards fetch public repository descriptions and publication
inventory independently of activation. Installed references use their locked
cohort; proposed releases reuse the resolver's cohort selection and manifest
verification, including dependency constraints and backtracking. Informational
inventory neither loads model bundles, promotes fetched bytes nor returns an
activation lock. Add/Update reference retains complete bundle verification,
proposal review and revisioned Save before runtime refresh.
Reference details normalize the registry's Git clone suffix before matching
catalog/lock repository identity, so release inventory uses the same cohort as
activation. LSP metadata extraction uses native JSON parsing followed by an
iterative object/reference walk; it retains body-only edges without invoking a
reviver for every source/token-position scalar.

Code-tab downloads list namespaces from the provider's current managed semantic
view, including deferred reference inventory before namespace materialization.
They reuse `generateExport` with the captured
project, canonical declaration dependency resolution and artifact receipt checks.
Changing source, project capture or workspace closes stale choices and cancels
in-flight downloads. The legacy parse dependency graph is used only for legacy workspaces.

Reference release catalogs extend the existing curated artifact contract rather
than replacing it. GitHub release/tag/commit provenance maps to a checksummed
immutable cohort manifest; artifact versions never imply release tags. The
publisher prepares a complete set before writes, verifies serialized bytes,
records successful immutable uploads and promotes catalogs dependencies-first.
Catalogs retain distinct immutable cohorts for an unchanged source tag/commit;
parent manifests constrain the selected dependency cohorts. The shared resolver
backtracks cohort variants without selecting another source release. Locked open
verifies full manifest/bundle closure before returning documents or promoting
bytes, without catalog/latest lookup. Studio reuses its bounded IndexedDB cache
and guards explicit config+lock Save by workspace/revision and cancellation.
Reference-only configuration hashing keeps unrelated source/target edits from
forcing a network resolution. Installed core/codegen identities and core's
Langium support range determine artifact compatibility.
Development/latest manifests remain separate. The mirror serves `/releases/*`
with its existing CORS/ETag/error conventions. See
[curated publication](../curated-publishing.md) for the dry-run and upload order.
The scheduled publisher reconciles missing stable GitHub releases through that
same immutable release path before its independent moving Nightly build. A release
build failure cannot advertise its catalog entry, advance Nightly pointers, or
prevent attempts for other independently valid releases.

Core's pure `project-contract` entry owns declaration identity, receipt,
canonical JSON and resolution-context schemas; project-config aliases these contracts rather
than maintaining another shape. This entry imports only Zod. Core remains
independent of project configuration/runtime packages.

Core's injected project-resolution port is independent of project configuration.
Hosts explicitly register document ownership; declaration keys include model,
namespace, AST kind, name and dispatch selector. The reserved `local` model names
repository declarations, so mappings survive cloning and workspace renaming.
`buildEffectiveProject` creates fresh services and registers all roots before
hydration/linking. Scope descriptions and source links redirect through the same
port; serialized references rebuild through that linker rather than retaining
pointers into a cached generation. Originals remain available for provenance.
Mapping cycles, ambiguous/missing endpoints, kind/signature/cardinality changes
and incomplete dispatch families are diagnosed. Structural changes are checked
against actual reference callers. Its receipt captures project revision, lock
and override digests; host adoption is a separate readiness boundary. Native builds load verified
locked documents and generate from that graph; source-only materialization is
explicitly unavailable with overrides. Shared context validation compares actual
lock/override data with the receipt digests before a host acknowledges them.
LSP semantic synchronization applies context only with the final retained URI
set. It revives fresh dependency roots, reparses open buffers, validates mappings
and echoes the applied receipt. Core owns reference rebuilding for both serialized
revival and LSP snapshots, including transitions back to ordinary workspaces.
Hosted storage persists context using the same chunk/pointer writer as models;
cold replay supplies it at the final model barrier, never before its dependencies.
Studio captures draft text over the saved snapshot while preserving untouched
binary identities. Locked reference loading is keyed separately from source
edits. Captured metadata is not semantic readiness: the preview worker builds a
fresh effective graph and acknowledges its exact receipt. One shared Worker-port
bridge tags operations for preview, Prototype, validation and code preview,
rejects mismatched replies and preserves legacy message shapes. Worker replies
capture their originating generation before yielding; they cannot borrow a
newer receipt. Identical receipts reuse the same immutable graph.
Parser-worker dependency snapshots link all already-materialized documents before
reading or serializing their references; deferred corpus entries remain lazy.
Function-output navigation prefers the worker's canonical schema and only reads
AST references when the owning document has computed scopes.
Managed namespace demand uses the verified per-document declaration index to
publish a uniquely selected owner's linked closure before unrelated namespace
files finish. Namespace hydration still awaits every requested file; ambiguous
owners use the complete namespace path, and failures retain the last valid view.

Codegen's selection view uses core's resolved declaration targets, including
explicitly selected original roots. It emits the replacement's canonical
namespace, excludes overridden original bodies and retains linked originals for
inspection. Preview schemas and Python module bindings share this selection
boundary. Kind-qualified direct function requests resolve through that same port.
Native TypeScript builds and managed Studio generation use the same linked
standard library in their dependency closure. Named targets still select their
roots from the project namespaces.

Studio's source-sync fingerprint covers only namespaces with a writable source
baseline, including their outgoing inheritance edges. Read-only reference ASTs
remain available for inspection and canonical validation, but are never duplicated
into the source publication fingerprint. The LSP model cache retains dependency
metadata across the cohort and compact payloads only for the active closure;
an idle editor with no override roots releases the cache without serializing it.
Managed preview messages carry reference AST bytes only in the captured project;
their parallel file inventory retains source/URI and a reference marker for
projection checks, without cloning the serialized cohort a second time. Legacy
preview messages retain their existing serialized-file hydration path.

The LSP client separately tracks model bytes and resolution context, so
configuration-only edits and reconnects require a fresh applied receipt. Existing
editor plugins retain didChange ownership while semantic requests wait. Studio
accepts local parser snapshots only when their recorded source equals captured
editor text. Explicit override endpoint namespaces and their import dependencies
join the active semantic closure; unavailable captures cannot fall back to an
ordinary graph. Managed diagnostics are buffered during context synchronization and
replayed through the existing editor and observer handlers only after the exact
acknowledgement; superseded generations are discarded.

## Studio Runtime

Studio's [product context](../../apps/studio/PRODUCT.md) records established users,
workflows and product principles for interface work. Impeccable's local live-mode
configuration names the Vite SPA entry; it does not inject a helper by default or
change production CSP. Product context complements the runtime invariants below.

Center-stack controls retain rounded pill tracks, separating the primary View
from panes shown alongside it. Groups wrap together with the same selected-state
styling. Open-file buttons expose their selection with `aria-pressed`; their
strip scrolls instead of compressing every filename. File tabs use a quieter
surface and active underline while the workspace picker retains its appearance.

The Type explorer and Inspector type picker share namespace presentation: relative
compressed labels, 8 px ancestor guides, bounded indentation, explicit namespace
focus and ancestor breadcrumbs. Compression never crosses a declaration or branch.
Name collisions receive the shortest distinguishing namespace suffix, then kind
and actual declaration ID when needed; display labels never replace identity.
Qualified rows reserve a second line in the virtualizer, whose keys include the
row identity and height-affecting qualifier. Namespace focus changes only the
local navigation scope, preserving graph visibility and canonical export inclusion.
Both surfaces share the inset active-row highlight and retain their existing
buttons, kind glyphs and native drag behavior.

Graph selection and focus camera movement belong to `RuneTypeGraph`. Studio
owns explicit Fit View/re-layout actions and responsive container changes, and
must not re-fit the entire graph on every selection. The graph permits zoom down
to 5% so Fit View can include tall/wide namespaces while retaining viewport
culling; selecting a type restores a readable detail view.
Responsive container fits retain the selected node as their target, including
when a direction change requires asynchronous layout. Explicit Fit View still
fits the complete visible graph.
Semantic zoom hides detail without changing node dimensions: summaries overlay
the retained body space, and hidden cardinalities keep their layout width.
Graph member grids bound both name and type columns independently of the shared
navigation-button reset. Long labels retain full titles rather than forcing
letter-wide name wrapping and oversized cards.
The pinned XYFlow ESM patch batches its internal node measurements per animation
frame, drops detached elements and cancels queued work on unmount; applying a
second delay only in `onNodesChange` leaves its internal observer updates exposed.

The header truncates long workspace labels while retaining their full accessible
name and tooltip. At compact desktop widths the brand text and search hint yield
space before workspace identity; the switcher keeps its 28 px height.

Declaration context menus share pointer placement and navigation actions across
the Type explorer, Graph, Structure and Inspector type references. Each owner
supplies an already-resolved canonical ID and its existing navigation callbacks;
Structure instance paths are never used as declaration targets. Editable source
and text fields retain the native browser menu. Shared DropdownMenu positioners
own the same explicit overlay layer as Select and Popover so dock resize handles
cannot intercept menu actions.
Pointer anchors portal to the document body to avoid React Flow's transformed
coordinate space, and menu events do not bubble into their owning node. Empty
toast viewport space passes pointer events through; visible toast cards remain
interactive.
The graph's informational legend also passes pointer events to the canvas.

Inspector title actions are a host-owned slot in the shared `TypeHeader`, so
workspace creation does not leak into individual declaration forms. Its declaration
title is a level-two heading beneath the perspective heading, including transient
read-only states; heading order cannot depend on neighboring Dockview panels. Extend uses
the canonical Rune renderer. Reference-only Modify copies exact declaration ranges
from the verified active curated source into editable override files; split dispatch
files retain their own imports. The host checks workspace identity and collisions,
then uses the normal file persistence/parse path. Modify emits `override namespace`
with the original namespace and declaration names. Core's namespace override view
owns selection for linking, serialized references, code generation and editor models;
unmodified siblings remain available. Competing replacements and incomplete dispatch
families fail validation. Existing explicit project mappings remain supported, and
Modify retains its verified provenance mapping; a competing mapping cannot silently
win over native source syntax. The Rune renderer preserves the namespace marker.
Native and configured callable replacements share Core's signature comparison:
ordered input/output names, resolved type identities, type arguments and cardinalities.
Native pairs come from the linking inventory and are checked after scopes exist;
bare Rune sources and captured projects both diagnose incompatible replacements.
Deferred root registration invalidates that inventory before its first reference
lookup, including provider-registered batches. Split dispatch signature candidates
resolve and deduplicate through the same effective targets as ordinary linking.
Managed actions flush the existing
source/autosave owners, await the saved revision in the preview worker, and Save
the copy plus explicit override map in one project transaction. Copy bytes must
match the verified active reference documents before their source URI, commit and
cohort become provenance. Tagged copies retain locked publication metadata;
Nightly copies use the verified document's publication metadata, including dependencies,
without adding a reference lock or changing its moving request. All copied dispatch
documents must belong to one publication. Repeated Modify follows the existing mapping. Extend
adds no redirect. Curated sources remain immutable.
Studio resolves read-only state and source ownership per declaration/file. Source
synchronization captures each writable file's own baseline and declaration set,
including renames and removals; sharing a namespace never copies immutable siblings
or writes one override declaration into another override file. Graph exports retain
the owning namespace marker, while metadata stays outside declaration payloads.
Parsed roots map document URIs to authoritative workspace paths; parsed namespaces
take precedence over initial file metadata. Save derives current declaration IDs
from the supplied store snapshot as well as baseline IDs, so a form rename flushed
before React rerenders cannot publish a deletion. New local declaration filenames
include their AST kind, keeping same-name functions and types distinct without
changing their Rune identities.
Preview-worker hydration restores references within curated snapshots; their exports
must also be registered through Langium's index before parsing authored source that
imports them. Index each hydrated batch once and remove exports when it is replaced.

Studio's body-level visual profile applies to every perspective and portaled
overlay: Inter UI text uses normal tracking and a 13 px default at the standard
root size, with a shared compact label scale, readable line height and rem-based
text scaling. Source and generated code retain the monospace family. Borders use
one-pixel theme-colored hairlines, including Dockview panel edges and headers;
controls use the stronger input tier. Brand accents and existing glyphs remain.

Shared single-line Button, Input and Select primitives own compact (24px) and
standard (28px) heights. Existing button size names retain width/icon intent;
Studio must not add competing global height overrides. Multi-line editors, list
rows and touch/resize hit areas remain separate. Dockview uses one unlayered sash
geometry rule set: a theme hairline inside the existing 16px drag target.
Input has one field treatment for inline and ordinary form editing. Input,
Textarea, NativeSelect and SelectTrigger reuse a private field-chrome definition
in design-system. NativeSelect in the existing `/ui/select` module owns ordinary
option lists; rich Select and searchable domain pickers preserve their focus,
selection and z2f binding contracts. Repeated utility actions use Button rather
than app-local button chrome. Field groups use 8px gaps and nested sets use 12px.
The desktop launcher fills its frame with Recents beside Starters, each owning
its overflow; Reference Models uses the same full-frame body. Narrow launchers
retain a stacked layout. Navigation and workspace actions stay outside Recents'
scroll region.

Panel and section density is configured centrally in design-system `tokens.css`:
`--panel-padding-inline` defaults to 12 px and `--panel-padding-block` to 8 px.
The Tailwind bridge exposes `px-panel-x`, `py-panel-y` and their single-edge
variants. Shared Inspector frames, metadata/details, Preview and Prototype
sections use these semantic insets; change the two tokens rather than patching
individual section padding. Nested sections inherit the owning horizontal gutter
and use only the block inset, avoiding doubled indentation. Compact Inspector
forms use `--inspector-padding-inline` (8 px); their header owns no second gutter.
Function inputs and the named output share `AttributeRow`, including type-drop,
cardinality and metadata targeting. Inputs are added from the section legend;
there is no permanent empty creation row. Output signature edits keep the reserved
`output` dependency-edge label and update lexical output references and assignment
roots in the same Undo transaction. The adapter captures exact linked output-reference
identities in a weak side table before dehydration; no live parser nodes or extra
reference fields enter the domain payload. Implicit fields and same-named calls
retain their original bindings. Pending edits wait for a linked parse; unresolved
or unproven implicit captures fail closed. Reconciliation ignores derived namespace
metadata and compares arbitrary integer literals exactly, so acknowledged expressions
do not replay as unlinked text. The legacy type-only action delegates to this edit.
`--field-label-gap` (4 px) is shared by design-system Field and Preview controls.
Preview and Prototype share validated field state: invalid controls use a semantic
red-tinted background and border, `aria-invalid`, and an associated inline error.
Temporal controls forward the same state; corrected fields clear both cues.
Worker diagnostics remain the sole source of validation results. Untouched empty
numeric fields show neutral required guidance; edit/blur reveals the canonical
error with plain-language number-type copy. Domain diagnostics and precise decimal
strings retain their original meaning; presentation never changes Execute gates.

Preview and Prototype share symbol-associated presentation preferences in
`form-presentation-store.ts`. Active workspace preferences are read from typed
repository presentation files through ProjectController; browser settings remain
a separate migration candidate until explicitly reviewed and accepted. Object
layouts store member order, column count and spans; numeric formats store currency,
grouping and decimal places. Full owner/namespace/kind/name keys bind shared files;
source-relative property paths exclude runtime list indices. Codegen
attaches kind-qualified `typeSymbol` metadata through its authoritative resolver,
preserving declared aliases and identities through deferred expansion. Root
selection IDs are normalized before lookup so nested uses share the same layout.
Preferences never rewrite Rune, validation, or sample values. A formatted numeric
control shows the raw value while focused and only writes actual edits.
Reordering changes DOM order, supports pointer/touch and keyboard handles, and
stays inside the owning object. Container queries collapse saved multi-column
layouts in narrow panels. Unknown members are ignored and newly generated fields
retain their source order after saved members. Preference loads and save results
are scoped to each workspace and revision; failures expose a retry action.
The shared readiness gate blocks editing and store writes until preferences have
loaded successfully; failed restores retry the read before accepting edits.
Documentation and synonyms appear alongside annotations without a generic
Metadata disclosure. Choice options compose the same `TypeChip` and kind mapping
as other references while `TypeLink` retains import-aware navigation.
Scalar metadata autosaves retain valid edits when the host defers them during a
source reparse. Metadata draft controls stay editable during this structural lock;
explicit synonym Add commands use the same retained-save lifecycle as scalar edits.
Studio supplies its live edit store to the shared source-sync hook. Semantic user
edits synchronously capture the ordered publication before a preceding parse can
consume their one-shot patches; pure parse changes only adopt the source baseline.
User patches arriving after a parse but before React adopts its epoch still publish.
Save uses the same publication path. Explicit publication invalidates older rendered
observer snapshots so they cannot overwrite a newer edit.
Permanent source permissions and inherited rows remain read-only. A fresh canonical
target retries that same guarded pending edit, including enum display names; changing workspace or member identity never bypasses
the existing target checks. Synonym fieldsets can shrink within their Inspector
pane so enlarged text wraps controls inside the shared gutter.
A remounted row resumes a valid dirty name after a temporary parse lock. Accepted
member names bridge the form-reset frame and update selection aliases only after
canonical target readback, preserving the selected member through acknowledgement.
An unavailable scoped target never authorizes an old rename callback.

Namespace alias expansion is shared with Core's scopes. One alias may name
several imported namespaces in source order. Graph metadata retains imports per
source declaration, including files sharing a namespace; Structure, Inspector,
graph navigation and inherited member rows resolve against the originating
file's imports. Labels keep authored reference text while navigation uses the
canonical target ID. An inherited override resolves its parent's alias to a
qualified type name before copying into the child's source scope.

Annotation names accept the same qualified/import-aliased spelling. Annotation
arguments retain the existing `AnnotationRef.attribute` field and legacy attribute
identity. Core's built-in ingest/enrich/projection declarations also accept a
`SchemaOrFormat` target through the shared global scope; unrelated/custom annotation
arguments remain limited to that annotation's attributes. `AnnotationArgument` is
the generated Attribute/Schema/enum-value union, preserved during workspace hydration.

Studio restores the complete user-document snapshot in Core's batch deserializer,
registering all roots before reviving cross-file references. Inspector annotation
scope facts therefore retain the server's selected target even when another
namespace declares the same annotation name. Curated documents remain deferred.

Enum summary disclosure sends a node-scoped Inspector section request with a
fresh revision. Returning from Details to Values preserves the mounted editor
and its paging state. Preview hydration completion marks a selected unsupported
target as waiting until a generated result or concrete failure arrives; namespace
hydration alone is not generation readiness. The provider publishes committed
hydration only for namespaces whose serialized definitions are in that React
file snapshot. A nonce-only render cannot release another namespace/instance
request before those files commit; an already-committed dependency can be
acknowledged without a new file update.

- Studio uses React 19, React Flow 12, Dockview, zustand 5/zundo 2, Tailwind CSS 4, Base UI, and CodeMirror 6. Manifests currently use TypeScript 7 and Langium 4.4; check manifests before changing versions.
- OPFS stores workspace files; IndexedDB stores metadata, caches, settings, and layouts.
- Workspace activation reconciles the shared model store with the destination bindings before parsing or persisting them. New/close clear files, deferred declarations, hydration, selection, previews, and undo history in memory only after pending saves succeed, preserving the previous workspace on disk. Storage failures retain the current workspace and its retryable latest snapshot; edits arriving during a flush must also finish saving before activation. A newer transition request supersedes older requests still waiting for storage. Pending parse/load results are invalidated across that boundary. Superseded restores leave the newer workspace's screen alone; the winning import owns the loading screen and exits restoring mode. Superseded imports discard only their newly created empty record.
- `apps/studio/src/shell/providers/StudioProviders.tsx` composes provider responsibilities; `LspProvider.tsx` owns the LSP client and transport lifecycle.
- `WorkbenchHost` owns Dockview mounting, stable panel bridges, native-layout restore, serialization subscriptions, and disposal. Each perspective supplies a `WorkbenchDefinition` with its panels, titles, and default builder. Its optional idempotent reconciler runs after restore and definition updates, preserving existing panel instances when conditional panels appear or disappear. `DockShell` remains Explore's adapter: it owns migration of `PanelLayoutRecord`, the Explore factory layout, toolbar/shortcuts, center-pane policy, and utility-tray collapse behavior. Per-workspace perspective preferences use versioned workbench settings; they must contain UI state only, never model payloads or generated artifacts.
- **Studio LSP is network-only.** `apps/studio/src/services/transport-provider.ts` defaults to session-token minting followed by a token-gated WebSocket to the hosted LSP. Only an explicit `wsUri` opts into direct WebSocket, with token-gated fallback after failure. Configured endpoints can differ between local, preview, and production environments.
- Hosted dependency snapshots compute exports and local scopes without eagerly
  linking every function body. Live source still links and validates through
  Langium. Because lazy snapshot references do not enter the reverse-reference
  index, source updates clear cached snapshot targets and rebuild the actual
  open source set, preserving transitive diagnostic invalidation. Snapshot
  replacement and close/restore retain the same authoritative model lifecycle.
- Parser and codegen browser workers handle local model operations; they do not provide an LSP fallback.
- LSP diagnostics carry the version of the validated Langium document. Studio uses one per-URI protocol version counter for live editor changes, headless file changes and dependency refreshes; mounting or replacing a view preserves that version. Studio rejects stale versions and invalid ranges before forwarding them to graph diagnostics or CodeMirror; it never clamps old ranges onto new source.
- Parser workspace replacement uses one reset for parse and hydration, including empty snapshots. Langium's builder removes parsed documents and their index/build state; indexed deferred stubs are removed separately before registering the replacement. Scope snapshots must never retain symbols from removed files.
- Expression owners retain graph declaration kind through Studio's scope request. Core's `findExpressionOwner` resolves both the editor and worker owner, including the unique base declaration of a function dispatch group. Duplicate bases and ambiguous legacy names fail closed, so same-named Data and function declarations keep distinct bodies and conditions. This lookup works for parsed and serialized models without container pointers. Core's `getExpressionOwners` groups declarations across all namespace files; the graph adapter and Studio's source-file lookup use that same selection, so variant-first file order cannot bind Inspector to a dispatch variant. A lone variant remains visible in the graph but cannot acquire a base expression binding or Builder scope. Builder and foreign-expression drafts capture the workspace dependency snapshot, validate it after asynchronous scope loading and again on Apply, and retain their private text when that snapshot is stale.
- `LspProvider` keeps full source/CST only for the active file (including curated source once loaded). It incrementally synchronizes compact canonical models for that namespace's import and resolved-reference closure, including function-body references. Browser namespace caches remain intact across navigation; the hosted LSP prunes unrelated or replaced snapshots before upload to avoid retaining two corpus generations. All dependencies use Langium's authoritative scope/link services. Editor plugins attach only after their canonical source URI has been opened; already-open owners stay attached during dependency synchronization. Closing detaches the plugin before sending didClose. Live editor buffers override snapshots; closing a source view restores its semantic model. Serialized declaration ranges support cross-file definition navigation without fetching every source file. The Durable Object persists models in bounded chunks and restores them before rebuilding the active source on wake.
- Curated/reference-only models have distinct hydration and editing capabilities. Check deferred hydration, diagnostics, inheritance, and bare/qualified references when changing them; do not equate visibility with editability.
- Source synchronization serializes and updates writable workspace files only. Namespace routing prefers a writable target regardless of reference-file order; serialization baselines, writeback and import matching reuse that routing. Read-only and reference-only files remain byte-identical even when they share a namespace. Routed user models already published to the graph must not be published again by deferred document linking; curated models still enter the graph when first materialized.
- Curated namespace artifacts carry original file `content` alongside the serialized AST. Both artifact builders preserve upstream comments and formatting. The parse response sends serialized models only for immutable artifact keys the browser has not received; the browser retains prior documents across workspace switches in the same tab and reconstructs the full closure for the parser worker's replacement-style hydration. `services/curated-artifact-cache.ts` persists published content-digest artifact identities in a separate, disposable IndexedDB database across reloads and tabs. The small receipt index supplies known keys; only the current server-required closure's payloads are restored. Source text is fetched separately through `/api/curated-source` only for the selected namespace and cached independently by artifact key for read-only browsing. Deferred Source navigation waits for namespace hydration to supply the authoritative artifact identity before reading the source cache; a hydrated legacy namespace may still load without a key. An absent source is a loading state, not an empty file. List-only namespaces remain deferred. Legacy artifacts without content still hydrate, but displaying their original source requires rebuilding and publishing the artifacts.
- Center panes stack vertically when their container becomes too narrow for the selected pane count; the wide layout retains draggable horizontal splits.
- Center controls use one pill panel with a larger gap between the exclusive Graph/Structure view and Source/Inspector companion panes. Accessible groups retain that distinction. Structure uses intrinsic DOM sizing and content-aware wrapping after pane resize; avoid fixed content minimums that overflow split panes.
- Global Search uses the editor node repository, workspace files, and perspective registry. Type results and explorer name/arrow actions use Explore's hydration-aware navigation bridge; file search requests Source through the file-navigation store. Explicit type navigation reveals the target kind, and an empty Graph offers recovery instead of enabled camera actions. Selection-to-source navigation retains declaration identity while AST/source loads and resolves coordinates against the matching source before revealing; only a matching live editor acknowledges success. New selection, workspace, or explicit file navigation supersedes queued reveals. Indirect navigation uses request-scoped, text-free destination emphasis across Source, generated code, Graph, Structure, Inspector, and prototype fields, including repeated loaded destinations. Indirect is relative to the destination pane: a graph, explorer, or Structure selection that reveals Source or generated code cues that destination even when the origin was clicked directly or the file was already loaded. Direct selection within the destination and background model/codegen refreshes alone do not create arrival requests. Explicit repeat navigation and reopening a pane that restores and scrolls to its destination may cue again. Delayed Source waits pulse only the visible Source control after 250ms; unavailable destinations and completed or superseded requests stop the cue. Arrival cues never shift content or change existing focus behavior, and reduced motion uses static emphasis.
- Export's workbench definition reconciles dock constraints after default construction and native-layout restore. Empty generated output starts compact; the first artifact expands only the untouched default group, preserving restored or manually arranged output panes.
- The opt-in development-only `?design-preview` controls use a page-session store. `WorkbenchHost` owns the shared auxiliary edge policy for Explore (Types, Form/Code, utilities), Prototype (Instances/payload graph), and Export (Settings/output). New auxiliary edges start pinned; existing expanded/collapsed arrangements retain their state. Explore side tabs select views and chevrons own visibility; other auxiliary tabs retain native toggling. Group focus must not pre-expand an edge on pointer-down. Opening or unpinning one edge preserves opposite open edges; unpinned panels collapse on return to the main grid. API navigation uses Dockview's activation origin and keyboard tabs expand after native selection. New side edges retain horizontal panel headers while expanded and rotate to vertical strips only when collapsed. Preview layout changes must not persist; toggling off restores the original Dockview snapshot with panel reuse. `DockLayout` applies Rune's shared theme to the outer shell as well as the grid so edge panels inherit the same rounded chrome. The Explore location path is always available in production, derives from editor selection and canonical namespace/declaration name, and owns its styles in the normal app stylesheet rather than the development preview bundle. Native collapse/expand is available in the installed free package; overlay peek auto-hide requires the separate enterprise module.
- Close transports during reconnect/disposal so server-side sessions and documents can be released.
- The LSP connection adapter converts returned or thrown vscode `ResponseError` values into thrown lspeasy protocol errors for ordinary request handlers. Cancellation must travel in JSON-RPC's error field, never as a successful completion payload.

Prototype's `PrototypeWorkflow` owns equal, detached input drafts and one optional
`FunctionSession`. Object builder owns a separate draft and renders only a typed
object editor and payload; switching surfaces preserves the live workflow session.
New workflow clears only executable draft state, while named recipes remain
repository-managed. Clear-input undo restores only that input, preserving peer
parameter edits. `WorkflowNode` composes the existing controlled FormPreview
renderer; object parameters render separately and primitive inputs remain inline.
Standalone input nodes are keyed by surface and transient draft identity. Their
data stays in the owner; value edits retain identity, while recipe opening,
rebinding and object-type selection create a fresh identity. Function-input Undo
is scoped to its active session and function. Saved recipes never persist these
transient identities. Node-local Undo/layout state cannot cross draft boundaries.
Example-selection requests retain their originating surface; visiting the other
surface never replays a replacement into its retained draft.
Node-local layout editing uses the shared symbol-associated presentation store.
The instance grid exposes failed-save retries through the existing instance-store
persistence action. Draft schema failures can retry their request without losing
the input object; each retry aborts and invalidates its preceding request.
The instance grid stores reusable objects; selecting one requests an explicit
compatible parameter binding. Drafts never mutate stored objects. Batch JSON
import belongs to the grid, and single-input import belongs to each node.

`useWorkflowValidation` requests canonical worker validation on a separate session
channel. Input identity, request cancellation, factory identity and model snapshots
fence obsolete replies. Per-input type diagnostics and whole-function checks gate
Execute together. Validation status popovers can retry failed requests without
editing inputs; the function status retries all unavailable checks together.
`typescript.inputChecks` emits opt-in precondition-only exports
through the same aliases/precondition emitter and dispatch selector used by actual
execution. These exports never run assignments or postconditions. Ordinary exports
are unchanged. Function schemas expose the declared result field, including scalar
outputs and return-variable names; result values never infer their own type.

Function switching retains values and source bindings only for compatible field
and array-item identities. Input edits and function selection invalidate execution results. Clearing a
function fences outstanding schema and execution requests. Pending, failed or
unavailable transformations cannot fall back to the input payload as though it
were a result. A valid no-function input is an explicit passthrough state. Only
singular declared object results can seed a stored instance. Source-specific payload
arrival remains scoped to an input bound from the selected grid object. Its
explicit binding path normalizes both exact field and nearest-ancestor navigation,
including the first item when a stored object is bound to a list parameter.

Cold curated function preparation retains its declaration kind across schema refreshes.
Hydration commits are acknowledged even when the namespace already arrived in a
dependency closure and no new files were added. Publishing an equivalent curated
model set does not reset input drafts; editable source and bundle-version changes
still refresh the signature. Preview metadata reports missing executable bodies
using the emitter's shared normalized function and dispatch facts. Both Preview
and Prototype explain that limitation and disable execution while retaining inputs.
Optional temporal controls default and clear to an absent value. Generated temporal
format issues abort before semantic refinements can invoke Temporal on invalid
strings, preserving structural issue paths for field highlighting.

Prototype node headers reuse Structure's kind palettes and shared `TypeChip` references;
its compact chooser uses the same chip with canonical repository identity. Function
references use the function palette, while unknown references retain unresolved styling.
Node insets and controls follow the shared compact Inspector spacing scale.
Graph and Prototype share the `--canvas-background` vignette token; Prototype
nodes use the existing `studio-card` depth treatment and subtle kind-tinted edges.

Workflow and Object builder share one session and renderer. Their view selector,
Add and Payload graph actions occupy a single Prototype toolbar. Smooth SVG connectors are layout
presentation over nested DOM; no independent graph semantics or canvas engine is
introduced. Bounded pointer/keyboard dividers persist widths per workspace; narrow
containers stack nodes. `PerspectiveHost` lazily retains Prototype after a visit
in the current workspace so perspective changes do not destroy drafts. The
owning Inspector panel keys the workflow by workspace ID and activation epoch;
that boundary disposes the session and clears drafts, bindings and results even
when the source/cohort and preview factory are identical. Same-workspace
hydration and view changes retain the workflow. Workflow data/results are not serialized as presentation
preferences. Validators and schema clients own and dispose their worker listeners.

The shared worker listener/session factory follows worker lifetime; preview selection is read at error-delivery time and never recreates Prototype sessions. Unresolved preview results use the live deferred-export manifest, so initial publication and workspace switches cannot retain stale hydration targets.

Workflow input/output type chips, function headers and signature references carry canonical declaration kind through Explore's hydration-aware bridge. Header context menus reuse the shared type-navigation menu; Inspector exposes both a navigation button and the same pointer/keyboard actions. A workspace-ID/activation-epoch return scope offers Back to Prototype after an inspection visit without creating an instance, rebinding inputs or resetting the retained workflow. Editable text controls retain native menus.

## Curated Artifact Cache

The shared closure loader retains up to 24 immutable cohort manifests per runtime,
deduplicating pending reads and evicting failures and least-recently-used entries.
Floating/latest and legacy date requests always refresh their manifest pointer.
Missing namespace artifacts use eight download slots that refill individually;
results publish only after the complete closure succeeds, in original order.
Neither optimization changes cohort selection, artifact receipts or preview
readiness. The [latency investigation](../investigations/2026-10-19-curated-hydration-latency.md)
records the fixed-corpus replay and its production verification limits.

The workspace provider also carries the current parse result's pinned namespace
seed metadata. A selected deferred type can read its namespace independently of
the full closure and render a read-only declaration-first Inspector. The parser
worker uses isolated services, canonical `hydrateModelDocuments` and a lazy
Langium build for this view. Its snapshots never enter semantic/graph/preview
stores. Selection, activation scope and artifact identity guard late results;
the Inspector retains one projection for its active pinned namespace. Changing
declarations in that namespace selects from the same pending or completed read
instead of queuing another worker build. A different scope, cohort or namespace
invalidates that read; full linking replaces the temporary view. A visible
loading notice and separate readiness markers prevent treating declared fields
as resolved dependencies.
Older servers without metadata retain normal loading. See the
[progressive hydration investigation](../investigations/2026-10-18-curated-progressive-hydration.md).

The parse response also advertises immutable `curatedCacheSeeds` from the same
resolved manifests used for its dependency closure. Studio queues those public
identities in `curated-cache-client`; a lazy module SharedWorker downloads one
namespace at a time and writes through the canonical artifact cache without
materializing Langium documents or publishing workspace models. Tabs share the
queue and deduplicate by immutable artifact key. A dedicated worker provides a
best-effort per-tab fallback when sharing is unavailable or fails. Data-saving
and slow-2G connections do not start speculative loading.

Foreground parse/source operations hold a renewable, expiring pause across tabs
and abort active speculative fetches. Navigation releases the tab's ownership;
immutable completed writes remain reusable. Prefetch uses the ordinary artifact
fetcher and validation but disables its separate in-memory namespace retention.
Its atomic cache writes never evict foreground entries and stop on capacity or
storage failure. Mutable workspace files and per-tab parser state never cross
this worker boundary. This is background cache seeding, not progressive Inspector
hydration: current-cohort server validation and per-tab reconstruction still run
when a type is opened.

The curated artifact cache has a combined budget of 128 MiB of serialized UTF-16 payloads and 512 records, with least-recently-used eviction across model and source records. Payload and receipt writes are atomic. Storage denial, quota errors, incompatible formats and unusable entries fall back to normal loading. The parser keeps models deferred; if deserialization fails when a cached document is linked, it reports the immutable artifact identity. The workspace service discards the restored closure, coalesces concurrent failures into one server refetch and retries linking once. App subscribes to the recovery result through the same parse-result publication path used by ordinary parsing, keeping preview files consistent without importing UI stores into the service. App invalidates service recovery at the same boundary as its workspace parses, including switches to an empty workspace that start no new parse. Parse revisions prevent old recovery hydration and publication while immutable artifact and source caches remain reusable. Freshly downloaded model failures are reported without cache retries. The server still selects the current manifest and dependency closure, so a cached old generation cannot satisfy a new artifact identity. Mutable and legacy date-only artifact paths retain session caching only. Cache entries contain public curated data, never writable workspace files or UI state. Bump the cache format version when changing the serialized hydration contract. Trace operations `curatedCacheIndex`, `curatedCacheRead`, and `curatedCacheWrite` expose storage timings through the existing instrumentation configuration without capturing payloads. This cache reduces repeat downloads; worker hydration and rendering still run, and it does not provide an offline manifest path.

## Form Configuration

Studio's `apps/studio/z2f.config.ts` is the authoritative canonical `@zod-to-form/core` config, imported by its Vite plugin. `components.source: './z2f-components'` resolves relative to each schema module in `src/codegen-forms/`. Generation settings live under `defaults`; `defaults.optimization.compileZod` is independent of optimization level and defaults to false here. Presets expand through the shared resolver, preserving controlled shadcn event props.

The explicit `Input: {}` component override routes uncontrolled generated text
fields through the shared design-system Input instead of the HTML fallback.
Workspace settings derive their directories form from `StudioConfigSchema`,
then use `updateStudioConfig` and the existing controller Save/readback. Companion
configuration preconditions exclude the transaction's own destination, whose
write already carries its captured revision; all other companion guards remain.
Export tabs retain separate named-target drafts and a one-off draft. Target
removal edits configuration only and keeps generated output. Reference selections
come from saved requests/locks immediately, plus verified Nightly provenance only
when the active reference key matches the workspace and its configuration;
catalog fetches do not block the saved selection. Loading dependencies remain
distinct from absent models.

Visual-editor's typed `z2f.config.ts` preserves AST hidden fields, sections, schema overrides and array reorder. Its component adapters use `value`/`onChange`; its `FieldTemplate` composes shared design-system primitives. These adapters must override raw shadcn event contracts explicitly. Do not restore removed `fieldTypes`/`formPrimitives` config keys.

The five hand-authored EditorForms use the shared `editorOptimization` policy with L1 enabled and Zod compilation disabled. `EditorFormProvider` supplies cached per-field validators to `EditorController`, resolving canonical AST schemas through object/array paths. This includes identifier unions skipped by the upstream L1 walker. All bespoke RHF Controllers must use that bridge; enabling the hook flag alone drops validation. Unknown loose-object fields (such as `expressionText`) retain their existing dedicated validation. Graph-level diagnostics remain in `ErrorsSection`. The generated-form configuration remains independently unoptimized; it does not install the runtime editor bridge.

## Shared Semantics

- Scope construction and expression type inference share one active-expression
  guard. A missing dependency must leave ordinary unresolved references rather
  than re-enter a feature link through a same-named extraction alias. The guard
  is scoped to the synchronous request and cleared in `finally`; it is not a
  cached inference result that could survive later dependency loading.

- Core normalizes bare functional expressions only at the parser lexer boundary. The bracket scanner is shared with `insertImplicitBrackets`; token offsets and columns map back to original UTF-16 source positions before CST construction. Synthetic brackets have empty images and zero-width CST ranges. CST text, diagnostics, reference locations and serialized text regions all address the original document.

- Core preserves the original digit groups in Rune numeric literals until the full
  decimal or integer is parsed. Cardinalities keep their ordinary integer token
  conversion. TypeScript execution and read-only projections normalize padded
  integral parts for ECMAScript while preserving fractional zeroes. The editable
  TypeScript lens rejects a literal when normalizing it would lose source spelling.

- JSON data that needs the original number spelling can opt into `preserveNumberText`
  on the project codec or generated `fromJSON`/`toJSON` methods. Exact tokens travel
  as `@numberText` on canonical model data, leaving the fields numeric. The output
  codec writes those tokens in their original JSON number positions. A generated
  object assignment clears the affected field's source token.

- Core `BASE_TYPE_FILES` owns the standard Rune types and annotations. Studio re-exports it; the shared `RuneWorkspaceManager` loads it during LSP initialization, including reconnects. Core and LSP factories install `RuneDslSharedModule`.
- `hydrateModelDocuments` registers every parsed root before `RuneJsonSerializer` invokes Langium's reference revival. Keep one object graph: repeated deserialize rounds retain stale generations and cannot resolve arbitrary cycles. Batch tests must verify target identity across long chains and cycles.
- Managed project downloads and curated downloads use a disposable browser worker; legacy user-file-only downloads use `/api/codegen`. Managed captures travel by structured clone, preserving snapshot Maps. The HTTP boundary rejects project captures rather than silently treating them as legacy requests. Both transports call `src/services/codegen-download-handler.ts` for validation, namespace closure, generation, and packaging. Hydration closes the documents that may be resolved; `ExportSelection` then chooses dependency-closed declaration roots for emission; `generateSelected` returns that exact receipt with the outputs, including a kind-aware `requiredBy` provenance map. Artifact envelopes record the receipt, immutable curated manifest cohorts when available, and generated files, so Studio previews and downloads use the same captured ZIP. Managed exports apply the same effective graph and named-target scope as native builds, require the captured project receipt in the ZIP envelope, and retain it when combining target artifacts. Missing or mismatched receipts cannot be staged or downloaded. Preserve fatal diagnostics and terminate the browser worker on completion, error, or timeout.
- Curated mirror CORS uses the shared worker origin matcher and the explicit `ALLOWED_ORIGIN` list in its Wrangler config, including this project’s Pages previews and local Studio ports.
- Curated manifests record bundle dependencies as well as namespace dependencies. Parsing and downloads use `loadCuratedWorkspace` to close the namespace graph across those bundles before hydration. Parsing keeps unrelated namespaces as deferred explorer entries; downloads hydrate all selected documents together before generation. `packages/curated-schema` owns production-source selection and the publisher's namespace graph; CI parses CDM, FpML, and Rune runtime sources in one workspace so serialized cross-bundle references retain their targets. Before serialization, `assertValidDocuments` requires completed linking and rejects syntax or reference errors even when semantic validation is disabled. Worker artifact builds use isolated services with the shared standard library so a previous build cannot supply missing declarations. The uploader hashes the prepared manifest set into a cohort, pins dependency manifests to that cohort, and uploads all versioned blobs and immutable cohort manifests before advancing latest pointers. Consumers resolve floating bundle selections through one cohort, so a partial pointer update cannot mix generations. Legacy date versions still select the current manifest; `cohort-<sha256>` versions select immutable manifests and must match the returned cohort. The mirror cron preserves cohort and dependency metadata alongside the serialized namespace graph. Cohort manifests and content-hashed artifacts remain outside daily archive pruning; any future garbage collector must retain the full dependency closure of live cohorts.
- Routed parsing returns each dependency bundle's resolved manifest cohort/version. Studio registers implicit curated dependencies with that identity before merging reference-only files, so preview snapshots and restored workspace bindings retain the exact serialized reference targets. It does not replace an implicit pin with a guessed latest version.
- Derive UI previews and validation from authoritative codegen output. A sample awaiting a worker validation result must remain visibly pending; editing alone never establishes validity.
- `CodegenProvider` owns the shared browser worker connection. Resetting workspace/model preview data clears pending results without detaching that worker; only its provider lifecycle attaches or detaches preview dispatch.
- Preview and Prototype share the same schema-driven field renderer and live value handlers. Choice dropdowns retain atomic arm replacement; collection grids derive summaries from schema fields and open the same renderer in a detail dialog. Detail navigation preserves array indices and returns focus to its opening control. Ordinary schema labels stay stable; item ordinals apply only to actual list-item paths ending in `[]`. Presentation components do not own validation or alternate schema semantics.
- Preview scalar formats follow the resolved Rune primitive, including aliases, arrays and Choice arms. Shared Preview/Prototype controls compose the design-system Calendar and themed time segments alongside ISO inputs. The Calendar wraps react-day-picker's date-grid and keyboard semantics with shared theme tokens. An ISO editor preserves nanosecond fractions and explicit zoned offsets/IDs; companion picker edits retain that precision and authored suffix. Workers remain authoritative validators; friendly temporal format guidance changes only presentation, leaving original diagnostics in Output/Activity.
- Preview preparation coalesces hydration and worker-file acknowledgement independently of individual panel cancellation. A shared 30-second deadline aborts stalled preparation and allows a fresh retry. Projection display requests also have a 30-second deadline and a direct Retry generation action; execution keeps its separate 120-second deadline. Late replies cannot replace a newer retry result.
- Routed parse results carry every resolved curated bundle's immutable cohort/version, including implicit cross-bundle dependencies. Studio retains those bundles in its workspace model bindings instead of discarding dependencies that the user did not select explicitly.
- Workspace edits update memory immediately. Browser persistence coalesces rapid edits for 500 ms, with a two-second maximum wait while typing; pending snapshots keep their original workspace IDs and flush on workspace transitions, hidden visibility, page hide, and unmount. Parsing remains a separate debounce and does not gate saving syntactically invalid drafts.
- Output offers an explicit local debug JSON download using the existing bounded diagnostic/operation stores. Source contents are opt-in and never lazily fetched; credentials, storage dumps, instance payloads, and serialized ASTs are not collected. Remote telemetry retains its existing closed privacy schema.
- Recursive and deep preview objects use finite, namespace-qualified `FormPreviewSchema.definitions` generated by the same Data/Choice builders. `expandPreviewField` relocates one definition body at a time; the shared Preview/Prototype controls expand deferred objects only when a value exists or the user adds one. The eager depth cap limits schema size, not authoring or generated Zod validation depth. Invalid recursive aliases remain language errors.
- Explorer navigation uses the graph node ID; row dragging retains the shared type-reference payload for association editing. In controlled inclusion mode, the row/name toggles the caller-provided canonical selection ID without a navigation highlight; the arrow opens the declaration. Filtering, virtualized rows, and collapsed namespace descendants must not discard explicit selections. The explorer count reports available declarations, independently of graph visibility, in a fixed footer below the scrolling tree. Global graph visibility actions belong in the Graph filter menu, leaving Explorer search and namespace navigation uncluttered.
- Parsing and downloads share raw-source collection, including read-only system definitions. Editability must not determine which declarations codegen can resolve; curated bundle metadata and serialized documents use their separate transport.
- Reference models explicitly selected on the launcher seed newly created workspaces, including pre-created Git-backed targets. Creating a workspace from an active one does not inherit its bindings. Saved curated-only workspaces restore their bindings even with zero source files. Failed or unresolved declared bindings remain persisted for retry; after a successful load, explicit unload removes the binding.
- Explorer compacts namespace chains before filtering, retaining common-prefix branches and namespaces with direct declarations. Expanding a parent automatically opens only single-child namespace chains and stops at branching points; collapse clears the whole subtree. Shared namespace-tree helpers preserve canonical paths for expansion and subtree inclusion; the explorer omits per-namespace kind summaries while retaining declaration badges and top-level kind filters.
- `walkNamespace` gathers declarations and computes the type-reference graph, cycles, and emission order once per namespace. Emitters consume the readonly `NamespaceWalkResult` and own their diagnostics/source maps.
- `getTargetRelativePath` centralizes output paths. TypeScript and Python function emitters consume the shared extraction facts in `types/func.ts`; target syntax and runtime remain separate.
- Studio function forms use resolved inherited/dispatch signatures. Codegen `normalizePreviewInputs` adapts plain form values using the shared type resolver and metadata runtime helpers, traversing actual input values independently of form expansion depth. Python input normalization and this adapter share declaration-derived metadata payload shapes from `expr/metadata-input.ts`, including aliases, inherited Data/Choice fields and own/inherited key or template metadata. JSON envelopes retain their metadata and normalize only their payload; records matching declared payload fields take precedence where the two shapes are ambiguous. Python marks runtime-created wrappers with an internal dictionary subclass so repeated function-input normalization preserves their representation without adding JSON keys. Metadata conversion preserves absence before wrapping, including call and constructor boundaries; required cardinality checks still reject missing values.
- UI adapters use Core's `getLinkedReferenceTarget` to read restored reference
  targets directly and defer lazy getters until document scopes exist. Annotation
  identity and function-output bindings use this same rule for parsed and
  serialized models.
- Studio function preview and standalone schema compilation share the Sucrase TypeScript compiler. Function preview transpiles complete generated modules and resolves imports among generated outputs plus the explicit `@js-temporal/polyfill` runtime dependency. Keep private evaluator binding names outside the Rune identifier alphabet (use `$`). Keep the worker execution restrictions and test real parsed/emitted functions when changing this path.
- Zod schema references follow the actual declaration order, including acyclic
  targets copied into children of cyclic parents. Defer forward references with
  the emitter's shared lazy-reference helper; exported validators and Prototype
  selection must validate inherited arrays without capturing undefined item schemas.
- A Rune override that narrows a list to a scalar rebuilds the Zod child shape.
  Inherited conditions receive the declaring type's list representation.
  Metadata-aware schemas validate the same envelopes for attributes and Choice
  options. The linked input adapter accepts unambiguous upstream enum display
  names and retains canonical values and materialized code-list codes.
- A required choice accepts a populated reference field before its target is
  resolved. Conditions that delegate to optional functions accept an empty
  result and still reject an explicit false.
- Standalone schemas expose linked condition-function dependencies. The shared
  generated preview runtime loads their selected TypeScript module closure and
  reuses canonical argument adaptation and function-input validators, including
  Temporal conversion. Named imports resolve lazily within the cached module graph
  so cyclic field dependencies cannot initialize foreign child classes too early.
  Prototype and the pinned corpus CI gate use this same compiler and loader.
- Builder scope requests include the current workspace sources and serialized dependencies, with canonical file URIs. The parser worker serializes each complete parse/link/scope request so router fallback and concurrent updates cannot query missing or stale documents.
- Core `getFunctionInputs` resolves inherited inputs and dispatch signatures for both codegen and expression scope; external callable scope entries count their declared parameters, and reporting/eligibility rules expose zero or one argument from their declared input. Scope inspection materializes deferred callable descriptions through the shared Rune linker before reading signatures; unrelated model stubs stay deferred.
- Core `getFunctionSignature` resolves dispatch bases from namespace declarations and linked selectors. Language-service scopes and codegen share it, including overloads split across files. Output enum-member scope derives from that effective signature, retaining the correct declaration identity for inherited and dispatch functions when global enum names collide.
- Visual-editor operation drafts use core `parseExpression` for syntax validation before committing any operation. Unknown workspace symbols do not require linking at this boundary; invalid drafts retain their private text.
- Function expression helpers live in `packages/codegen/src/expr/`; preserve cardinality and metadata across call and assignment boundaries. Validate changed semantics with parsed Rune, strict compilation of generated modules, and runtime assertions. TypeScript exported entry points expect prevalidated, correctly typed inputs. Studio validates plain form inputs once with `emitStandaloneZodSchema` in function-input mode, reusing Data attribute schemas and their full dependency closure. Calls and root assignments skip adaptation when linked bounds and representation already fit; computed arguments, nested set/add targets, and function outputs retain runtime cardinality checks; appends check the combined collection before mutating it. Function-input schemas convert ISO strings to Temporal once throughout the dependency closure. The shared `RuneFuncData` structural mapping and class-to-function calls preserve Temporal instances; Studio serializes execution results back to JSON wire values. See the codegen README.
- Core scopes and codegen share `resolveOperationType` and `getOperationArgument` for operator result types and headless pipeline inputs. Keep symbol lookup in its owning context; add operator propagation rules to the shared core utility. Conversion operators expose intrinsic result names: scopes resolve the corresponding workspace record declarations, while codegen retains the semantic type for comparisons without inventing AST declarations. Calendar field reads, including implicit pipeline fields, use the shared `renderCalendarField` emitter because TypeScript values use Temporal and Zod JSON predicates use ISO strings.
- Reporting-rule references infer their result from the rule expression through the existing expression cycle guard, as aliases do. Rule-root `item` derives its type from the declared input through cycle-safe alias resolution; nested collection and switch bindings take precedence. Switch default and literal branches retain the selector type rather than falling back to the rule input. Codegen's shared navigation and collection analysis follows those same rule results, so both generated languages retain their type and cardinality.
- Switch guards retain Rune's target restrictions: basic, record, enumeration and alias types can select declared Choice arms, but are not standalone type guards. The broad AST target union accommodates those Choice arm declarations; scope resolution enforces the distinction. `getChoiceTypeScope` shares qualified-name and import-alias handling between `as` and Choice switches.
- Core `getEnumValues` supplies inherited enum members to scopes and emitters. Constructor fields precede metadata keywords; Choice switch guards prefer declared option types over same-named imports.
- Core also owns alias resolution, declared choice-option paths, and choice field names. `as` selects an exact declared choice arm (including nested arms and distinct aliases) or narrows data to a subtype; collection narrowing filters unmatched values. TypeScript retains selected metadata wrappers. When several Choice paths reach the same target, retain each path’s declared wrapper kind and normalize present terminal selections before combining them; never infer wrappers from a payload’s `value` property. Data narrowing uses structural guards because plain JSON inputs have no nominal runtime type tag.
- TypeScript declaration names, annotation decorator factories and their Args types, and callable bindings use `packages/codegen/src/emit/callable-names.ts` across imports, type signatures, expressions, and bundled exports. Resolve calls from declaration identity; preserve original Rune names in function metadata used by Studio and carry the actual export in `GeneratedFunc.exportName` when a function collides with a type.
- Reuse `@rune-langium/worker-core/log` (`createWorkerLogger`, `REDACT_PATHS_BASELINE`) in Cloudflare Workers. Send raw structured objects to `console.log` for field indexing. The shared logger implements redaction explicitly because `pino/browser` does not apply its `redact` option. Pages Functions and the Node container are distinct runtime surfaces.

- Studio adapts plain form values and metadata envelopes once, then validates their structure with the standalone function-input schema before execution. Input schemas preserve omitted zero-minimum arrays and reference-only envelopes; Data conditions stay in their separate validation flow. Data/Choice envelopes use declared field shapes, preserving ordinary payload fields named `value` or `externalReference`. The pinned CDM battery covers this shared execution seam.

- Inspector section placement is owned by `visual-editor/src/components/forms/sections/config.ts`. Generated form config derives its field assignments from that layout; custom Inspector tabs resolve the same sections with the upstream `SectionRenderer`. Placement includes inherited AST metadata and UI-only comments, which are not all enumerated by the generated schema walker. Standalone section callback props remain a public API.
- Inspector forms own one 6px outer inset through `INSPECTOR_FORM_CLASS`; the center pane adds none, and headers/sections use 6px vertical spacing without repeating horizontal padding. Fields and embedded editors retain their own text inset; metadata textarea focus rings draw inside their borders so scroll edges cannot clip the side highlight. Inspector member rows share name-field geometry through `INSPECTOR_ROW_NAME_CLASS`, keeping attributes/function inputs and enum members at the same text size and padding. Inherited rows use the same typography with muted names, and consume the same type options as local rows so reference chips retain canonical kind colors. Member-details headings derive from the canonical root kind (Attribute, Member, Option, or Input), and icon-only controls retain accessible names. Inspector navigation uses the same one-second outline fade as graph/structure, inset to avoid clipping; reduced motion retains a static cue until cleanup. Dockview leaf views own symmetric gaps; shell/grid wrappers add no padding or one-sided margins. Center panes have no outer padding. Graph's drawing wrapper retains its 6px inset around React Flow; Structure owns a normal scrollable document inset and does not mount React Flow. `DockShell` measures the center stack for location-path alignment and updates it on native layout changes and resize.
- Inspector type-label rows use `InspectorTypeField` for Wrapped type and Extends, preserving a shared vertical alignment and accessible group name. Dock headers and the center pane selector share `--studio-panel-header-height`; the center selector can grow when its controls wrap.
- Structure sizes cards through native DOM layout, capped by the owning canvas. Shared type and cardinality wrappers align controls without fixed row measurements.
- Structure requests the existing namespace hydration action for visible deferred roots, expanded children and inherited bases. Hydrated namespaces publish their documents into the shared graph independently of selection. Successfully linked documents are recorded after their models are merged, once per workspace; in-flight documents are tracked separately. Selected-document linking shares both sets, so navigation after later parser hydration resets cannot republish cached models. Both paths replace corpus snapshots by their canonical serialized document URI, including dependencies returned transitively; files sharing a namespace remain distinct. Regionless legacy snapshots use exact content identity. Later rounds skip successful documents, while Structure’s Load details action can retry failed publication without repeating namespace downloads or successful peer documents. In-flight link results belong to the workspace generation; selection changes must not discard their once-delivered models. Deferred cards show loading/retry content, while a hydrated derived type without own fields says _No additional attributes_.
- Structure header names are drag surfaces. Explicit navigation arrows move from the property row to the child header while expanded; context menus retain canonical declaration targets. Type-reference lookup excludes functions even when their Rune names match a type. Inspector reference fields own option resolution so member rows do not preselect by label.
- Explore side panels use the shared `PanelCollapseButton` chrome from the utility tray. Dedicated grid groups resize to a constrained rail, rotate headers vertically while hidden, and retain mounted drafts and the session's expanded width in workbench-owned state across header remounts. Single-tab side groups retain header actions, with the chevron above titles when collapsed. Explore restores dedicated split Form/Code columns into one preview group without replacing panels, caps its initial width at the shared 320px default after dimensions are available, and leaves later manual resizing alone; mixed groups containing the main task are preserved. The dock title supplies Studio's sole Type explorer heading; groups sharing the main task on narrow layouts are never hidden wholesale. Preview edge groups use their native collapse API, with explicit show/hide choices kept open across focus changes.
- Non-React consumers use `@rune-langium/visual-editor/model` for graph state and `/identifiers` for identifier helpers. Workers must not import the full UI barrel. The render gate accepts regenerated schemas into its existing registry during development, preserving workspace consumers while React refreshes the Inspector.

## Deployment and Verification

`pnpm run build:cloudflare` combines the landing page, docs, and Studio under
`apps/docs/.vitepress/dist/`. Source Pages Functions live in
`apps/studio/functions/`; root `functions/` and `wrangler.toml` are generated
build artifacts. Consult [the testing guide](../TESTING.md) for endpoint,
production smoke, and full UX verification commands. Keep evidence from those
checks separate from local unit-test results.

## Expression editing

Studio's Inspector reuses SourceEditor and `documentExtensions` for continuous function implementation and active Data condition editing. Core's implementation range retains same-line, comment-only and trailing body trivia for parsed and serialized models; a body without comments or statements remains a zero-length insertion. Trailing comments on later lines must be indented beyond the declaration; following top-level documentation stays protected. Region views keep the complete owning file in CodeMirror, conceal and protect other regions, and retain full-file UTF-16 offsets (including CRLF bytes). Shared editing transactions preserve CRLF for Enter and paste while retaining one undo entry and leaving externally synchronized bytes intact. The shared editor theme owns typography and content padding. Embedded function/condition and generated editors use minimal CodeMirror chrome without gutters or active-line decoration; Source retains compact gutters. Embedded views grow with visible and wrapped content, with a four-line minimum and a maximum of `min(50dvh, 24rem)`; expansion raises the maximum to `min(70dvh, 48rem)`. CodeMirror scrolls beyond that bound without recreating the editing session.

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
existing preview worker/session client. TypeScript body/predicate fragments use
one source-facing syntax renderer over canonical linked facts; executable exports
use the checked lowering backend. The display is a Rune syntax lens, so familiar
JS operators retain Rune equality, ordering, absence and collection semantics.
Authored contracts remain named `assert(...)` calls in their original phases.
Switch lifting preserves lazy scopes and evaluation order; terminal returns never
skip postconditions. Native/project/bodyless functions carry implementation status
outside the editor, with actual bundled source when available.
Inspector Rune regions hide their common leading indentation through CodeMirror
replacement decorations and atomic cursor ranges. Full-file source bytes and
coordinates remain unchanged; nested relative indentation stays visible.
Shared Inspector member-name geometry matches the compact add-name inputs across
attribute, function, enum and inherited/static rows; each payload form reuses it.
See [source projection syntax](../source-projection.md) for the spelling and inverse contracts.

Public projection selectors still default to executable declarations. Readable
display coverage does not imply inverse coverage. Expression reverse edits reuse
the source renderer, parse the familiar syntax into canonical Rune, validate and
reparse the AST, then apply only the captured region through existing workspace,
revision, dependency and read-only guards. Serializable origins preserve existing
operation identity across whitespace/quote changes and supported subtree edits;
ambiguous edits retain their draft and require Rune source. Full generated bodies,
statement-lifted expressions and real external implementations remain read-only.
Function provenance includes trailing implementation comments through core's
source-region helper. The worker resolves the canonical owner, validates the
current binding and retains the original editor identity in replies.

Linked fragment spellings also retain expression-relative Langium paths, including
on CST-free worker ASTs. The shared Codegen rebase helper verifies Rune equivalence
and restores coordinates from captured source without re-rendering type-dependent
syntax or callback aliases. Legacy coordinate fragments require unique AST matches.

Detached source-projection expressions are validated through Core's canonical
`parsedAdapter.dehydrate` representation before applying edits. Validation must not
read lazy Langium reference getters on document-free source-lens ASTs; rendering
and provenance checks continue using the original expression.

Projection lookup compares canonical Langium URIs while replies retain the original
editor binding. Both languages use codegen's `resolveExportSelection` to generate
the selected declaration and its dependency closure, including dispatch siblings.
An unrelated broken declaration must not block a valid projection; a rendering
failure in the selected closure remains visible. Projection cache keys include
language and declaration identity alongside the existing workspace version guard.
Selected code exports resolve against the complete cached document set and reject
syntax or reference errors in their closure; other preview consumers retain the
cached valid-document view. Worker and main-thread parse results collect lexer
and parser errors through the same helper, including original-source coordinates.

Executable TypeScript equality uses compact native scalar comparisons when the
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
collection shapes skip redundant normalization. Checked argument boundaries share
the same depth-aware collection materialization as assignments, including mixed
scalar/group branches and switch branch depths. Scalar boundaries materialize
groups before single-value checks. Inline bindings share one lexical lookup:
pipelines bind the complete argument, while extraction callbacks bind an element
and reduce its grouping depth by one. Python
normalizes mixed scalar/group values before boundary flattening, preserving zero
and empty values. Extraction wraps arrays directly rather than spreading them
into function arguments, avoiding the host's argument-count limit.
TypeScript source projections preserve authored equality as `==`/`!=` and authored
casts as `value as Type`, without requiring object equality methods. These are Rune
operations in familiar syntax; executing the text directly as JavaScript would not
preserve their semantics. Executable validators retain conditional implication,
Temporal comparisons, structural equality and absence handling. Both-empty and
quantified collection rules stay in canonical lowering, not in UI rendering.
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
`only exists` retains the common parent's linked field metadata and cardinality
for both targets. Its existing presence renderer and field readers treat
reference-only scalar/list wrappers as absent, including inherited fields,
nested predicates and postconditions; the parent expression is evaluated once.
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
Bundled TypeScript models import the shared `helpers.ts` companion instead of
inlining it. The namespace emitter and profile share its collision-safe filename
allocation. Generic model emitters tag shared artifacts as support files;
generator ordering places model outputs first and sorts paths within each group,
so preview and download ordering agree. Function parameters and shortcuts protect
TypeScript runtime globals; Python parameter allocation derives imported bindings
from its canonical runtime source. Ordered metadata retains original Rune names.
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
Python protects builtins and global callables from input-name shadowing. Rune's
standard-library `Min`/`Max` callables use Python's scalar builtins as native
fallbacks only for the qualified numeric signatures; explicit bindings still win.
Export-selection callers supply all linked workspace documents, including the
implicit standard library, to retain those callable dependencies.
Curated publication selects model-specific implementations; Codegen reads the supplied
declaration payload and checks its identity, annotation, signature and target
before emission. Preview availability uses the same payload reader. Authored Rune
replacements and explicit host bindings take precedence. Native declarations without a supplied body require
an explicit callable binding; missing bindings fail visibly. Dispatch normalizes inputs before selecting a
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

Enum cards in Graph and Structure show at most eight values plus a disclosure
row. `utils/enum-preview.ts` owns the limit, disclosure label and displayed row
count shared by both renderers and layout estimates. Full model values remain
intact. Hosts may supply `onInspectType` to reveal complete details; Studio opens
the existing Inspector without toggling an already open pane closed. Inspector
pagination remains the complete-list owner.
Explicit Inspector section requests carry increasing revisions. A mounted frame
consumes each revision once, so temporarily clearing the node-scoped context and
returning to that node cannot replay an old disclosure over a manual tab choice.

Inherited overrides retain the declaring ancestor's namespace and file imports.
Core's `buildImportScope` and `importScopeCandidates` supply the same ordered
lookup facts to the language scope and projected type resolution. Copying an
inherited reference excludes the global bare-name fallback; unresolved text and
builtins remain authored text instead of picking an unrelated loaded declaration.

The Inspector uses one declaration form and generated canonical schema. `InspectorFrame` composes the common header, inheritance picker, appropriate tabs and `InspectorFooter`; `InspectorDetailsPane` shows metadata for the selected child below the member rows. Fill sections retain their minimum content height: a short Inspector scrolls the form rather than compressing signature fields or clipping the embedded editor. Attributes/function inputs share `AttributeRow` and the same complete Attribute draft factory. Enum identifiers remain inline; enum `display` belongs in selected-value details. `MetadataSection`, `AnnotationSection` and `SynonymEditor` bind root or child paths through `MetadataTargetContext`; readonly rich items use the authoritative Rune renderer.

Inspector sections mount on first activation and remain mounted while hidden afterward. This avoids creating inactive expression editors on selection while preserving visited drafts, CodeMirror views/undo and registered commit flushes. Section IDs retain their sessions across tab reordering; removing a section unmounts its content. Browser checks for the complete file editor use `fullSourceEditor` in Studio's shared test helpers, scoped to the center stack's Source pane; embedded expression editors also use the shared SourceEditor component.

`useInspectorTargets` maps form keys to canonical member range/name/type-reference identity before paging, including the source-reset frame. `useInspectorSelection` maintains form-local RHF/pointer/range identity and requires a unique match after reparse. `useInspectorExternalSync` uses upstream source triggering and RHF public form-state subscription to rebase dirty leaves/errors through that same authored member identity; removed/ambiguous drafts cannot migrate to a replacement child. Guarded name-only callbacks preserve current Source signatures/display. Nothing persists these child keys. `metadata-target` guards owner, epoch and expected item; `metadata-ops` validates the edited canonical field and uses the existing graph recipe/history/patch path. Valid pending metadata commits blocked by parsing retain their draft and reject the existing save barrier until retry. Rich form payloads detach on acceptance, and unchanged item leases can renew across reparse. Inherited/curated metadata stays readonly; explicit existing override actions retain their meaning.

A uniquely matching complete authored member in an incoming snapshot acknowledges
an already committed addition or rename before dirty-field rebasing. Other pending
member drafts still require the existing unique identity match; removed or
ambiguous drafts retain their warning and cannot migrate to another member.

`EditorCommitRegistry` flushes existing debounced fields and focused rich item edits before a root rename or Studio workspace/source/storage barrier. Source sync's explicit flush awaits the same ordered publication receipt and immutable parsed baseline as its observer. CodeMirror keeps its view during temporary readonly/signature-coordinate transitions and reconfigures editability in place; stale source coordinates cannot authorize edits or projections. Studio does not manufacture a Saved label.

Authored comments are Source-only. Core's existing lexer yields UTF-16 comment ranges; per-render trivia ownership comes from original child CST ranges, including outside-root inline tails. Clean declarations need no trivia scan. Dirty render recursion preserves owned comments once, drops removed-child trivia and reuses untouched bodies. Legacy notes and standalone callback APIs remain covered. See the [qualitative #562 assessment](../investigations/2026-10-12-inspector-562-assessment.md).

Curated navigation resolves the selected declaration's actual document within the active bundle/version/namespace/artifact. Pending reveal is scoped to current navigation/workspace/revision and is cancelled when superseded. Multi-document namespaces must never use the first matching namespace file as a declaration owner; namespace/source laziness and immutable cache keys are unchanged.

Source selection uses CodeMirror lexical context plus an anchored declaration and
its name range. Comments, strings, neighboring lines and ordinary expression
keywords cannot manufacture a missing-type navigation request. Explicit LSP
reference navigation still resolves through the language service.

### Selected-object inspector and code previews

Original curated source is parsed through Studio's shared parser before binding
Inspector expression ranges. Published serialized offsets are not assumed to
match the source artifact. Projection requests verify that actual source range,
then resolve the corresponding linked declaration/condition for emission; range
and file-version guards still reject stale or cross-declaration requests.

Refreshed readonly source clears prior coordinate parses/bindings before parsing;
Rune bodies and generated views require a source-matching binding. Parse errors
and rejected parses show the source error instead of old code. Editable drafts
retain their existing last-valid recovery behavior.

Code preview uses the selected declaration and the canonical export dependency
closure for authored and curated objects. It awaits namespace readiness and the
worker file receipt. The active View action bypasses its cached generation without hiding the pane;
request identity and source versions reject late results. Download retains its
explicit namespace/layout configuration.
For TypeScript Data and Choice arrivals, the public type is the navigation
destination when a same-name factory is also exported. Namespace checks and
source-map disambiguation still reject unrelated or repeated declarations.

Inspector documentation and annotations share Details. Readonly child metadata
comes from its canonical selected node, not an unrelated parent form field.
Function body editors size to content within their shared minimum and maximum
heights. Documentation can scroll or resize without authorizing changes to
readonly declarations.

Expression language buttons reuse the shared pressed-state styling and form a
named group separate from editing actions. The workspace footer renders one
connection state: connected transport details, or the user-facing language-service
badge with Retry. It wraps recovery controls on narrow screens and truncates the
selected declaration ID while retaining the complete ID in its title. Transport
error details remain in operation logs rather than a second footer indicator.

TypeScript source bodies omit generated annotations, metadata payload access,
input assertions and representation guards. Constructors preserve explicitly
authored types (`Point({ x })`); optional navigation follows linked cardinality.
Exports retain runtime metadata/cardinality checks. The generated RuneList wrapper
uses composition over an owned array, without changing native prototypes or
external plain-array values. Collection extraction preserves intermediate groups;
explicit flattening and declared array boundaries materialize them. SET owns an
array before a later ADD can extend it. Inline, sidecar and preview helpers share
one authoritative runtime source.
Projected switch statement returns reuse ordinary assignment value shaping,
including scalar-to-collection conversion, empty branches and omitted defaults.
Expression and statement switches share `renderTranspiledSwitch`, retaining the
original metadata selector and implicit branch context while comparing its
payload. Statement selectors bind once rather than wrapping statements as an
expression.

TypeScript enums export a string-union type and a const value object under the
same canonical name. The legacy Values array reads from that object. Inherited
members and empty enums use core's canonical enum member collection, so displayed
enum-member references resolve to actual generated values without changing JSON.
TypeScript passes its existing reserved runtime names to the shared allocator;
enum names colliding with those names and their companion exports are allocated
together. Namespace emission, parameter bindings and the barrel allocator use
the same `TYPESCRIPT_RESERVED_NAMES` policy. Other language emitters retain
their own naming policy.

Notification presentation does not own logging. Operation owners record their
Activity/Output events, optionally displaying a toast; dismissing a toast creates
no operation or history entry. `recordOperation` supplies the shared correlation ID.
Workspace failure owners use that helper once, including storage error details;
the workspace error notification effect does not add history records.
Hydration rejections pass their original curated operation ID and duration to
the workspace-error owner, rather than recording a second terminal failure.

Code preview requests retain the previous same-target, same-selection contents separately from
the waiting snapshot's renderable output. Stale results recover those files and
the selected path; successful results preserve a still-present selected path.
Changing output language, workspace identity, declaration namespace/name/kind,
or switching between a declaration and a workspace export clears recovery data.
The editor clears the previous selection's document even when an earlier request
was already waiting; repeated refreshes for the same selection retain the view.
Waiting recovery contents are not eligible for navigation arrival cues.
Worker `codegen:setFiles` messages only install source files and invalidate the
codegen version. Only `codegen:generate` runs export generation. Selected preview
readiness therefore publishes its snapshot without starting a discarded
whole-workspace export before the selected-closure request.
Explore execution replies must match both the function name and the request ID
of its latest dispatch before consuming a span or publishing output/activity.
Workspace resets discard spans while preserving the provider-owned worker;
late success/error replies cannot settle a newer same-name run.

The Langium connection adapter routes typed, generic and logging notifications
through one send boundary. It checks listening state and handles the pinned
lspeasy server/WebSocket terminal-disconnect rejection if the socket closes during
the send. Async diagnostic publication can finish after a client disconnects;
other send failures and request failures continue to propagate.

### New condition drafts

ConditionSection uses the same expression-editor slot during creation and editing.
A new condition passes `draftCondition` rather than a source target: its Builder/Text
state stays local until Add, and Cancel publishes nothing. Studio's
DraftConditionEditor requests a detached condition probe through the parser worker;
`getExpressionScope` and the linked ScopeProvider remain authoritative for inherited
attributes, function inputs/output and imported references. The probe never changes
the loaded owner or writes a placeholder condition to source. Late scope replies
are ignored after a draft target changes. Reconciliation normalizes pending
`RawDsl` expressions through core parsing/dehydration before acknowledging their
typed AST form, so a caught-up condition is not appended a second time.

### Structure document

Structure consumes `buildStructureGraph` directly as a semantic, nested DOM
hierarchy. That adapter remains authoritative for resolved identities, aliases,
inheritance, independent instance paths, expansion and recursion limits.
`StructureView` uses the same `expansionKey` serializer, editor cell slots,
metadata indicators, diagnostics and type-navigation menus as the surrounding
workbench. Inherited cells and function signatures remain readonly; resolved
references expose real navigation buttons and context actions, including the
canonical inherited `baseTypeId` rather than a synthetic wrapper identity.
Function cards label Inputs and Output explicitly and expose navigation, without
expansion chevrons for signature rows the adapter does not materialize. Choice
options and enum values share compact section labels and member insets. Enums
limit their preview only when an Inspector callback makes the complete list
reachable; embedded views without that callback display every value.

Each wide parent card owns a local DOM canvas. Properties stay compact; expanded
child cards move independently by their headers, with an aria-hidden cubic Bézier connector
to the owning property. Parent available width determines whether properties and children fit side by side; stacked children use that available width rather than the narrow property column. This keeps intrinsic sizing and compact mode from feeding back into each other. Native
scrolling replaces viewport culling and auto-fit transforms; expansion never changes
text scale or moves the camera. Arrival and keyboard focus emphasize the interior
card. Graph kind colors and header backgrounds are retained; members are unboxed.
The shared `TypeChip` centers its contents with a compact unit line height.
Structure type/cardinality rows use that same line height, keeping text aligned
across bordered pills, plain cardinality text and navigation controls.
The local `--structure-inset` in visual-editor styles controls shared card padding;
minimum row height and the peer collision gap remain independent of this density setting.
Canvas height ends at the last row or expanded child plus the computed bottom
inset; it does not add a second fixed padding reserve.

Cards default to intrinsic content width capped by their container; inline-size containment is deliberately avoided. An edge separator sets an explicit pixel width, leaving height to native content; Reset restores automatic sizing. Placement
uses instance-scoped state, survives collapse and resets without changing source.
The shared `placeStructureBlock` geometry helper keeps a 16px gap from sibling
cards during pointer/keyboard moves and resizes, without considering descendants
in another parent canvas. A ResizeObserver measures native child extents for bounded content sizing,
local canvas height and connectors; it does not fit, scale or recursively size cards.
User placement is separate from canonical adapter identities and field order.
Root instance keys prevent an inline
draft from migrating to another selected type. Graph still uses XYFlow with Graph-only renderers. Retired Structure renderer
variants and placement APIs are removed; Graph inheritance-group header geometry
lives in `layout/graph-node-geometry.ts`. Structure owns no XYFlow renderer or
legacy width-measurement pipeline.

Editor row reordering and cardinality parsing share one implementation each.
Serialization and edit validation share the same inheritance-edge parent lookup;
reference edges do not enter that map. Test-only graph lookup and patch fixtures
live under tests rather than the public runtime API.

Dagre graph construction and coordinate conversion are shared by synchronous,
worker and main-thread fallback adapters; scheduling, cancellation and cache
ownership stay with those adapters. Studio workspace creation, migration and
LSP session routing share the same 26-character Crockford ULID generator.

CLI parse, validate and generate commands share recursive `.rosetta` discovery
in `packages/cli/src/discover-files.ts`. It preserves input order, repeated
paths and missing-path errors rather than applying command-specific filtering.

Codegen import readers share identifier sanitization and collision reservation
in `import/identifiers.ts`; fallback names remain explicit at each call site.
JSON Schema and XSD share deletion-based namespace sanitization; OpenAPI retains
its distinct replacement-based policy. All six namespace emitters build their
fallback URI entries with `emit/type-ref-resolver.ts::toTypeIndexLookup`.
TypeScript and Zod bundle profiles share preamble removal in `emit/bundle-imports.ts`.
Python and TypeScript lenses share grammar-neutral tree/refusal helpers and a
source-reference grammar cache factory; each grammar owns a separate cache.
SQL retains its default-source-only cache policy and pinned grammar.

Workers share JSON response construction through `@rune-langium/worker-core/http`.
`jsonResponse` preserves caller headers and status; `corsJsonResponse` adds the
already-checked origin and `Vary: Origin`. Route handlers remain responsible for
origin authorization before constructing a CORS response.

Project capability preparation uses installed host providers and explicitly rooted
resource mappings. The effective graph carries one codegen binding registry for
form choices, input/output validation and TypeScript/Zod/JSON Schema constraints.
The shared declaration dependency walker determines affected callers and export
scopes. Unsupported resource generators fail before publication; provider callbacks
never enter serialized captures or generated source. Workflow caches include the
saved project revision so resource/config-only changes cannot retain valid status.

Static project initialization stays in project-config/import and consumes only
opened repository text. The runtime adds explicit catalog artifact-to-release
mappings; it never interprets Maven versions as tags or loads Java code. The
optional build.importReport references portable compatibility evidence, included
in snapshot identity/output protection. Existing build configuration suppresses
POM initialization; subsequent POM edits do not change native builds.
ProjectImportReportSchema owns the persisted evidence format for both review and
reopen. The private runtime's pure `/status` entry combines that historical report
with current snapshot diagnostics and explicitly supplied effective-graph
capabilities. It does not reparse POMs, infer provider availability or replace the
normal build/Execute gates. Export settings renders unavailable target diagnostics
separately; Prototype's existing canonical schema/validation availability still
gates Execute. Shared report findings use the design-system disclosure chrome.


GitHub-open performs optional native project initialization only after a successful
clone. WorkspaceProvider binds an inactive clone's ordinary ProjectController to
the same owned file adapter used for active projects. Existing build-config.yml
or .yaml skips Maven detection; ambiguous spellings are diagnosed. The inline
review inspects local POM metadata, allows explicit profiles, and saves only its
reviewed settings/report through the shared transaction. Read-only input
revisions and a repository file-list precondition survive journal recovery.
Cancel/Keep browsing and initialization failure preserve the cloned repository,
POM bytes, remote and branch. Re-review reloads current files after a conflict.

Studio opts out of the Git engine's automatic synchronization: working-copy Save
only marks actual changed files dirty. Git / Sync's explicit Commit and push
flushes the existing editor Save barriers before invoking the existing engine.
Uncommitted changes are distinct from ahead/behind commit counts; no token or
private journal is included in repository-managed files. The generic engine's
automatic mode remains available to other hosts.

### Portable Prototype examples

Project-config owns ExampleDescriptor/path/codec metadata and `readExamples`.
Studio's `example-repository` adapts these records to the existing instance store;
WorkspaceProvider binds it to the active ProjectController, while App supplies only
limited typed legacy storage. Before publishing reopened Rune JSON records, the repository
uses the existing linked preview-worker decoder to restore form Choice slots. Worker
registration uses the existing preparation bound. A changed project revision
retries decoding once against the latest snapshot. Decode failures retain the
original files and block semantic writes until a successful reload, which
replaces the empty placeholder without overwriting active edits. Example saves
serialize across records and use shared
project Save/readback, including explicit CAS removals for deletion. Late completion
from another workspace cannot publish a Saved/failed state into the active store.
The pure runtime `/data` entry is the single codec availability/serialization gate.
Full type identity accompanies the internal display FQN; unknown/ambiguous legacy
bindings retain data. Portable descriptors restore their explicit identity without
consulting the UI's still-loading declaration inventory. Instance preparation and
the canonical preview worker establish readiness and report genuinely missing
types; the repository does not maintain a second semantic availability check.
Only typed legacy record files are inspected, and readback
precedes private migration markers. No private directory-tree copy is permitted.

Named Prototype workflows are explicit portable recipes under `studio.workflows`.
Their optional function identity, input example/literal bindings and output names
are separate from execution results and personal view state. Opening stages a
function session before replacing the visible workflow; workspace changes cancel
pending opens. Shared Save/recovery is queued at ProjectController while preserving
each operation's CAS and generation checks. A same-function schema refresh retains
mounted fields/current compatible drafts, disables Execute until fresh schema and
validation are available, and offers a schema retry after failure. Parameter/array
element compatibility is shared by session retention and Prototype source bindings.
`WorkflowLibrary` compares canonical captured recipes for unsaved state and retains
per-recipe drafts while switching in the mounted session. Workspace changes clear
those private drafts; reload recovery is not promised. Save compares against the
exact recipe written, so edits during a pending Save remain unsaved. Recipe Save
may retain a clearly labeled previous result for matching workspace/function/inputs,
but that history never re-enters session state, the current payload graph or the
Save-as-example path.

Workflow function composition uses ordinary Rune source as its only executable
definition. Codegen's browser-safe `/rosetta` entry exposes
`renderWorkflowFunction`: its authoring draft has typed/cardinality-aware inputs
and output, named steps and a result expression. Core parses each expression;
the existing Rune renderer emits steps as aliases and the result as an assignment.
Calls, collection `extract`/`filter` and nested composition therefore share normal
Core validation and all existing execution/export paths. There is no workflow
interpreter or second serialized step graph.
Studio's **Compose** perspective is portaled from the retained Explore editor
owner into its own activity-rail surface. It shares the selected declaration,
canonical inspector, `ExpressionDocument`, save barrier and source update path;
only the active perspective mounts the canonical inspector form. Its controlled
React Flow instance has separate positions, selection and viewport state from the
type graph. Palette/camera changes do not write Rune. Per-function leaf drafts
survive nested navigation while the workspace remains mounted.
Core's `describeFunctionComposition` matches the directly resolved
`rune.studio.composition` annotation and projects acyclic aliases, calls, scoped
`extract` calls and one whole-output set. It returns original UTF-16 regions and
located reasons for unsupported/unresolved bodies. Conditions and metadata stay
in Source/Inspector. The parser worker supplies these facts through its existing
serialized parse/link context transaction, without a UI resolver or evaluator. Callable discovery is lazy: search or a port
context requests signatures through the same ScopeProvider enumeration as the
expression builder. Exact resolved type identity and cardinality containment
prioritize suggestions; this never blocks other calls or replaces validation.
Node arguments use the existing function-preview schemas for their skeleton;
ordinary bindings live on the node and a bottom variable tag tray supplies inputs,
locals and outputs. Designer variables remain Rune aliases. Reference-only aliases
share one producer node, and output rebinding replaces a definition without renaming
its consumers. Core supplies exact dependencies and source blocks. Private candidate
analysis through the same serialized parser queue restores the captured workspace
in a finally block, including on failure; canonical validation runs before commit.
Stable topological source-block ordering retains comments and condition placement.
The canvas remains mounted but inert while source reparses, preserving camera state.
Core retains the outer AST `expressionType` in composition facts. Studio's shared
primitive presentation registry uses it for palette/canvas icons and labels without
classifying source strings. Visual-editor's `createExpressionStarter` reuses the
existing operator catalog factories, parser and canonical Rune renderer; starters
are complete editable expressions and use the same guarded candidate transaction.
Nested branches/closures remain opaque focused expressions rather than new graph
execution semantics.
Its stateless Dagre layout reuses the visual editor's measured-dimension graph helper
without sharing the type graph's cache. Named argument edits retain authored call spelling and trivia. Expression/alias
edits use captured source/dependency snapshots and revision/read-only guards;
comment-dropping edits are refused. Unsupported functions remain callable but
show Source instead of a partial graph rewrite.
The inline creation form uses the canonical workspace picker and preview schemas
for deferred callable signatures. Prototype resets workspace-owned state before
consuming a matching Compose navigation request, including on its lazy first mount;
the request remains pending locally until the function can be resolved.
Creation atomically saves source, the ordinary
annotation model (when absent) and a standard Prototype recipe through
ProjectController. Source/config/file-list preconditions, duplicate identity and
path checks preserve existing local files. Canonical identity readback gates
opening the new function; **Try in Prototype** reuses the saved recipe and normal
function session. Workspace-qualified navigation prevents cross-project recipe
activation. There is no CDM-specific eligibility, workflow interpreter or second
serialized executable graph. Syntax-ready edits still use normal semantic
validation before execution.

### Editable starter copies and bound folders

The starter catalog describes projects. Checked source adapters verify the commit,
read the Git tree, and verify the raw file contents against their blob IDs.
Only the commit and tree use the GitHub REST quota. `createStarterOpener` validates
the copy boundary, then `createStarterWorkingCopy` uses the existing ProjectController before host
activation. Starter provenance lives on WorkspaceRecord without GitBacking,
credentials or reference-only flags. Unpublished catalog proposals stay disabled.
Workspace opening and reference dependencies occupy separate launcher sections.
The published `daikonic-org/rune-starter` is a GitHub template; `rune-cdm-example`
was generated from it and retains the same workflow checker and CI. The launcher
catalog pins verified public commits rather than floating branches. Both are
ordinary editable starter copies, without an inherited writable remote. The CDM
workspace pins 7.9.0 and demonstrates structural trade validation and product
qualification, accrual schedule generation, and fixed-leg coupons on the same
published vanilla-swap data. Quote uses a materialized Rune currency enum.
Template-generated repositories do not automatically pull future template changes.
View example opens that verified local copy. Fork example uses GitHub sign-in,
verifies or creates the user's own fork, and enters the shared GitHub clone and
project-initialization review flow. A clone retry reuses the verified fork; it
does not repeat repository creation. Public example repositories are never opened
as the user's writable upstream remote.
Recent-workspace Rename updates only display metadata and recents in one IndexedDB
transaction, preserving current backing/UI state and updating the active header.
It never renames `rune-config.yml` model identity or repository-managed files.

Bound folder source IO uses WorkspaceManager's canonical project adapter. Source
loads recover the private Save journal before reading; source writes use shared
ProjectController Save/CAS and preserve unrelated files. Retry adopts only exact
readback of this source writer's interrupted attempt, preserving external edits
as conflicts. The journal and personal metadata stay in browser-private storage;
portable configuration/examples remain in the selected working-copy folder.
Browser and native project adapters share project-config's `isIgnoredProjectEntry`
policy. Both prune `.git`, `.studio` and `node_modules` before descending at any
depth, so installed dependencies never enter project snapshots or Save checks.

### Locked reference view publication

`prepareProjectReferenceChange` separates resolver verification from acceptance.
The UI flushes pending source Save; preparation reloads the controller and derives
release changes from that fresh configuration. Draft snapshots preserve untouched
binary revisions. Review captures config/lock writes, the original project revision,
the exact repository file list and non-destination byte revisions. Acceptance
checks cancellation/current identity and passes that evidence into the canonical
Save preconditions, rejecting silent source/resource edits, additions and removals.
The existing resolve-and-save API delegates to this same transaction.
`reviewProjectCompatibility` builds the proposed graph in isolation with the
shared runtime, validates explicit overrides and portable record identities,
and compares canonical preview schemas for saved type/function bindings against
the locked current graph. Review identifies affected files. Broken portable
bindings and schema changes remain explicit warnings; global graph errors block
acceptance. Unavailable baseline or standalone preview contracts are reported,
not treated as a compatibility success.
When there are no saved bindings, review still validates the complete proposed
graph and portable records, but does not build an unused comparison baseline.
`ReferenceModelPicker` deduplicates artifact cohorts by release tag, never
selects a latest tag implicitly, and does not invoke the legacy model store.
The same picker offers Nightly as `release: nightly`. Shared runtime
`loadProjectReferences` follows the current mirrors on open/refresh without a
persisted commit, cohort or lock entry. Accepting a reference review explicitly
refreshes the active runtime loader even when configuration bytes are unchanged,
so Explorer, validation and generation receive the newly verified documents.
Compatibility review captures the active in-memory reference documents as its
baseline, guarded by the same workspace/reference/lock identity as the runtime.
When that baseline is unavailable, a previous tagged lock can be reconstructed;
previous Nightly contents cannot, so review reports the unavailable comparison
explicitly instead of comparing the new mirror with itself.
Cancelled or failed reviews do not request activation. Tagged requests alone
determine lock freshness; an all-Nightly selection creates no lockfile, and switching the last
tagged reference to Nightly removes its lock through guarded Save. Nightly
dependency cohorts, format, paths and bytes are checked together through the
same bundle validator as tagged references. Partial publications fail visibly;
Nightly never silently replaces a required tagged dependency. Nightly follows
upstream CDM `master` and its required dependency versions without stability or
reproducibility guarantees. The legacy loader panel is removed. Tagged
publication updates release catalogs only, leaving Nightly pointers unchanged.
Both paths publish checksum-addressed source archives with matching manifest
metadata; release publication verifies their bytes and successful upload receipts.
Moving `latest` archive URLs use short cache lifetimes; checksum-addressed source
archives retain immutable caching.

Unconverted/unreadable restored examples remain visible with their original
data. Their retained-load errors do not block unrelated reference Save. Editing
or retrying one clears that marker; actual failed writes remain Save barriers.

`WorkspaceProvider` projects captured references into the Explorer through
`prepareProjectReferenceView`. Canonical batch AST hydration and Rune scope
computation register a complete document set in the existing parser worker;
read-only ownership and original source remain attached to each reference file.
The UI's reconstructed materialized closure also prepares its own scopes through
the canonical DocumentBuilder before publication. Namespace overrides revive
references lazily, so worker linking alone cannot make that separate graph ready.
Scope preparation retains lazy linking and skips validation; unrelated reference
documents stay deferred. Publications are queued per capture so concurrent
namespace requests retain each other's models. Abort checks discard late builds,
and failed requests retain the last valid view without poisoning subsequent retries.
Only configured local source paths participate in semantic hydration. The complete
current editable file inventory remains available to source editors and autosave,
including files outside those globs. Retained views contribute semantic models
and locked read-only files; their captured writable text never replaces current
editor files. Readiness tracks writable-file identity as well as parsed/input
identity, so an edit immediately marks the retained semantic view pending.
View readiness is separate from
semantic capture and each host's applied-receipt barrier. Complete serialized
definitions are excluded from legacy namespace-hydration requests. Workspace
identity and abort guards discard late view completion; failed loads expose
retry without editing configuration or falling back to latest artifacts.

The local model-authoring starter is self-contained. Its separate test cohort
uses an empty numeric reference `Double`, an explicit local Rune replacement and
an original reference caller. Runtime tests pair emitted TypeScript execution
with the canonical standalone function-input validator; TypeScript's compile-time
parameter types are not treated as runtime validation. The browser workflow uses
a typed Quote wrapper, preserving existing object-example semantics while proving
the same override call chain. Display formatting and field order survive a fresh
clone without changing semantic values. No starter repository or fixture release
is published by these tests.

### Portable project recovery and input protection

Expected fixtures under `tests/expected` and explicit example `expected` paths
are protected build inputs and participate in snapshot revisions. Builds cannot
replace them through a generated output directory. Target scope errors remain
qualified by target; preview adoption and independent targets exclude unrelated
target errors using the common diagnostic filter.

Undecoded example payloads never become semantic strings or synthesized null
values. Load reports a repair failure; semantic writes and generic Retry refuse
to reinterpret those bytes until the payload is repaired/restored and reloaded.
Repository writers attach after the controller's first successful readiness
publication, including recovery after an initially malformed project.

The App grants initialization IO only for a freshly created inactive GitHub
clone. Its adapter also checks the captured workspace generation and ownership
at write time; ordinary active-project access retains its activation guard.
Activation, workspace departure and controller disposal revoke pending access.


## Rune source highlighting

Studio's shared Rune stream highlighter recognizes documentation references,
synonyms, rule references and labels as annotation heads only inside bracket
contexts. Standard annotation names come from core's annotation source, custom
names are learned from local declarations, and fixed heads/argument labels are
checked against core's generated keyword contract. Incremental parser copies
retain independent bracket/declaration state. Strings and comments do not alter
that context; lists and inline-function brackets retain expression styling.
Shared editor syntax rules read design-system CSS tokens with canonical JS
fallbacks; comments use neutral muted text and italic emphasis. Display styling
never hides or modifies source. Rune uses standard Lezer definition/function,
type and property tags for declaration names, typed members, constructors,
calls and navigation. Enum declarations and references to enums learned in the
current file use constant tags, which share the constant palette with other
editors. Classification follows syntax rather than capitalization; the stream
parser does not guess imported symbol kinds. Incremental copies isolate enum,
member and declaration state. Light-theme palette work is tracked in #643.

## Reference example imports

Core's parser-free `/serialization` entry owns JSON/RUNE_JSON wire metadata
conversion. Project-config's portable example reader and native project-data APIs
use it directly; codegen's declared-type adapter is shared by imported-object
normalization, function inputs and worker validation. Preview fields carry their
declared metadata shape so controls edit envelope value paths while retaining
adjacent schemes, keys and references. Ordinary Data fields named `value` are not
inferred to be metadata. Finite preview path relocation has one shared walker.

Verified reference documents carry ephemeral upstream source provenance. Example
browsing reads immutable Git objects from that source commit, reusing the starter
reader's bounds and blob verification. Nightly has no new lock or persisted pin.
Imports preserve exact declaration identity and provenance in portable example
files, use normal Save/readback, and leave workflow binding explicit. Capture
refreshes after example saves retain browser state only while the reference key
matches; workspace/reference changes invalidate pending imports. The dedicated
object-adaptation request uses the same preview receipt/cancellation boundary as
execution. Rune JSON example persistence uses the correlated `instance:serialize`
worker operation and the shared project-data serializer against linked documents.
It checks the saved revision against the applied project receipt and rejects a
changed workspace epoch. Cloned canonical values do not need to retain decoder
WeakMap annotations. Optional model/version overrides preserve existing headers
when omitted. See [format support and the XML milestone](../reference-examples/README.md).

Reference code-list resources use the project runtime's `decodeProjectCodeList`;
`build-config.yml` resource mappings can specify `codeList.format`, scheme/version
expectations and original repository file provenance. Scheme URIs are never
fetched. One prepared registry supplies generated constraints and preview choices.
Resource validation unwraps only declared metadata envelopes. Large form code lists
use the shared searchable command primitives; historical/deprecated values remain
visible. [The audited artifact matrix](../reference-examples/build-resources.md)
records remaining parameterized-domain, XML and publication integrations.

Curated publication owns model-specific implementation selection. Its catalog and
owned Rune sources live in project-runtime, not Codegen. Serialized declarations
carry an exclusive `$implementation` payload (one Rune source or concrete target
bodies); `$implementationSources` carries exact source bytes, hashes, origin and
license. Normal immutable artifact/cohort checks cover these payloads. Codegen's
`resolveNativeImplementation` reads only the supplied binding and uses `nativeFunctionShape` for linked signature
checks and `nativeImplementationExpression` for allocated parameter bindings.
The TypeScript output accumulator and Python native-provider arguments remain
part of the ordinary function contract. CI audits pinned upstream sources with
the shared Git reader, registers model ownership before linking and compares the
[native coverage inventory](../implementations/README.md); known unavailable
entries remain explicit and must never be described as complete coverage.

Reference prepare/accept copies bundled Rune files into ordinary workspace sources
in the same Save transaction as configuration and lock changes. Native builds use
the shared installation/readback transaction before graph construction, with the
resulting snapshot/receipt. Provenance tracks ownership; refresh preserves local
edits and only updates/removes unchanged owned copies. No emitter inserts hidden
Rune overrides. [Curated implementation delivery](../implementations/curated-bundles.md)
documents this boundary.

The native inventory also binds Rune-feasibility assessments to the exact cohort
and linked signatures. Explicit Rune implementation sources use ordinary
`override namespace` linking; the audit verifies their source hashes and full
reference signatures. Effective entries have exactly one implementation kind;
Rune entries never contain language-specific target alternatives. Pinned handwritten
Java algorithms, tests and empty providers are separate reference evidence.
An override may replace existing selectors while keeping the original dispatch
base and other selectors. An override that replaces the base must retain the
complete family. Bundled selector overrides are selected only for empty upstream
branches. Same-namespace Rune sources can add absent selectors. Publication checks
the whole upstream model for collisions before attaching such a source, and the
catalog distinguishes those additions from upstream bodies.
Executable TypeScript and Python defer read-only aliases in functions with a
self-recursive alias. Each invocation computes a deferred alias on its first
read, so recursive calls stay behind the authored guard and repeated reads
share the result. Python pipeline operators use the bound value of the preceding
stage, with the original expression retained for type and cardinality analysis.
Handwritten dependency algorithms retain their own artifact identity and source
hash in `referenceJava.dependencies`, separately from direct CDM implementations.
The bounded Strata frequency port is a reusable Rune library under
`com.opengamma.strata.basics.schedule`. Its `OfPeriod`, `Term` and `EventsPerYear`
functions own Strata semantics; the CDM `PeriodsInYear` override owns conversion
and CDM-specific constraints. Publication installs both source files and the
named upstream license/notice files together. Target emitters share this Rune
algorithm and never discover a Strata library during generation.
The strike-schedule override pairs amounts and dates by position using ordinary
Rune state reductions. An explicit partial `DatedValue { value: ..., ... }`
preserves the handwritten Java mapper's missing-date rows; canonical result
validation remains responsible for their required-date errors. It does not sort,
deduplicate, convert currencies or acquire external data. Without indexed list
access, the source folds and their fallback lowering cost O(P*D + P^2).
Codegen's shared counted-reduction analysis recognizes a bounded, linked AST
shape: an adjacent single-use seed/extract alias, zero-based counter and a plain
lookup or non-escaping collection accumulator. TypeScript and Python reuse that
proof to remove temporary step records and prefix copying, preserving their
existing collection admission. Unmatched shapes keep ordinary reduction semantics.
TypeScript also fuses captured lookups when the complete append call chain is
authored, single-result, condition-free Rune. Core's effective declaration targets
and installed project bindings guard this transformation. Input mutation,
external/native calls, dispatch, recursion and conditions prevent fusion. Captured
inputs are prepared once, and the strike mapper then runs in O(P+D) with O(P+D)
allocation. Standalone lookup calls and Python retain their own input preparation;
this does not claim a linear Python caller closure. Editable source projections
retain their readable Rune-like expression form.
For native TypeScript values, reductions whose input and result share one Data
or Choice type annotate the input array with that model's canonical shape.
This prevents a partial constructor seed from erasing optional accumulator fields
through literal inference. Metadata and projection reductions keep their existing
paths; the correction requires no cast through `unknown` or `any`.
Prototype's shared JSON payload panel remains keyboard-focusable with a visible
focus indicator, allowing long input/result arrays to be scrolled without a mouse.
Upstream dispatch bodies and execution coverage are distinct facts. Core dispatch
scopes inherit base declarations, never aliases from sibling variants.
The calculation-period regression closure preserves all upstream selectors and
supplies finite calendar data through an ordinary test-only Rune override. Missing
calendar leaves remain unavailable; independent selectors do not acquire an
invented calendar dependency. Declaration selection expands a transitive dispatch
call to the complete effective family and traverses every selector's dependencies,
using Core's override targets rather than retaining replaced bodies.
Function-boundary built-in aliases reuse the target
profile's native type mapping, including import tracking. Temporal constructors
remain potentially absent in the shared expression-presence analysis, so list
shaping narrows their values without assertions.
The #646 issue table is rendered from that inventory rather than another target-status list.
Source-only preview workers register the current user roots before building and
initialize Core's shared resolution index. A later capture removes the preceding
source roots/exports, preserving a newer curated owner of the same URI. This keeps
namespace overrides effective for input validation and execution and releases
removed overrides. Same-revision requests share an in-flight document build;
hydration and source replacement share one queue across revisions. Builds capture
their source files and version before waiting, and failures release the queue.
Before returning documents, the worker runs Core's namespace and callable-signature
diagnostics. Only override participants lacking dependency scopes are built for
those checks; the complete curated corpus is not rebuilt. Invalid overrides block
preview-based generation and execution until corrected. Worker tests externalize
Core alongside Codegen/project-runtime so these consumers share Core's
generation-local declaration identity registry.

### Portable math library

The Rune math library supplies `rune.math.Log` and `rune.math.Exp` as scalar
`number` library declarations. The TypeScript and Python emitters share the
qualified signature check and call the target's standard math implementation.
Curated observation averaging carries those declarations with its editable
Rune source. The provider bindings supply the observations and weights.

### Materialized code-list enums

Curated publication renders populated CDM lists as Rune sources in
`rune.resources.cdm` from the same pinned catalog used by `LoadCodeList`. The
ordinary serialized bundle and namespace graph carry these reference enums and
their shared `rune.resources.CodeList` synonym source. Each derived file records
its upstream path, scheme and version.

After linking and validating explicit resource bindings, project-runtime prepares
non-empty lists as ordinary enum documents in `rune.resources` and rebinds only
the mapped alias's type reference through Langium. It preserves snapshot bytes,
receipts, declaration identities and constrained-alias guards, and reuses the
curated synonym source when the reference is installed. Core's
`getEnumValueLiteral` interprets the exact `rune.resources.CodeList` synonym;
identifier sanitization and presentation labels must never change external codes.
All enum consumers, including expression conversions and Python projections, use
that shared accessor. Empty lists retain the existing never-value adapter boundary.
Single-file generation uses Core namespace dependencies and the shared Tarjan
components. It topologically orders the SCC condensation graph, retaining stable
order within a cycle and placing the entire cycle before downstream consumers.
The existing type-level cyclic-last policy remains separate. TypeScript also
checks its emitted namespace dependencies for cycles containing a class
inheritance edge. It emits each such component together and orders class
initialization by the linked base types. Namespace entry modules re-export
their original bindings from that shared file. Single-file output orders the
same class declarations within the main module.
XSD references use resolved declaration namespaces for QNames and relative
schema imports, including foreign enum restrictions and complex-type inheritance.
XSD attribute escaping uses numeric references for tabs and line endings so XML
normalization cannot change an external enum code into a different value.

Reference execution catalogs retain the upstream execution-descriptor contract in
project-config. Project-runtime resolves verified catalog links to kind-qualified
Rune function identities and preserves the catalog entry in core provenance.
Studio and the whole-corpus CI gate reuse that reader and the linked worker decoder.
Function argument bundles are distinct from Data objects; selecting a bundle is an
explicit workflow activation, while import alone never changes the active workflow.


## Generated public value views

Generated Data descriptors register with their ancestors as their modules load.
Registration mutates the ancestor descriptor's descendant map rather than a
process-global registry, so independently inlined helpers share only the imported
model objects and unrelated generated bundles remain isolated. Both preview ASTs
and emitted descriptors use Core's `isRuneJsonAssignableType` ancestry rule.
Tagged base-typed JSON selects an available concrete descendant before validating
fields, creating the instance or serializing it; unknown/unloaded and unrelated
types remain errors. Import the bundle barrel to register all generated modules.
Descriptors retain their generated class prototype so nested untagged instances
also preserve their concrete descendant identity. Core's `acceptsRuneJsonChoice`
owns recursive, cycle-safe option acceptance for both descriptors and preview ASTs.

Native built-in descriptors are selected from the TypeScript profile, including
BasicType `time` and `pattern` as well as calendar RecordTypes. The same descriptor
creation path hydrates strings at JSON boundaries; native field/function values
remain Temporal or RegExp instances. The namespace contract exposes an optional
built-in emission hook and the shared naming registry includes those exports for
bundle collision handling. Fixed regex literals depend on linked pattern
destinations, shared by executable and source-facing renderers; ordinary strings
are never guessed to be patterns. Core's `serializeRunePattern` is shared by wire
encoding, generated helpers and Studio worker output; flags fail explicitly.
Switch result arms inherit their enclosing destination, including nested switches,
constructor fields and function arguments. Selector and guard literals retain their
own string types rather than inheriting the switch result's pattern destination.
Value-producing `extract`, `then` and `reduce` bodies inherit that destination too;
predicate bodies, sort keys and callback input expressions do not.
Metadata-wrapped pattern payloads inherit their authored destination as well;
metadata entry strings keep their own type.

Codegen's `ValueApiEmitter` derives input types and lazy field descriptors from
shared linked navigation/metadata facts. `Trade.from`, object fields and deep
selections project zero values to undefined, one to the model/scalar, and multiple
to an array-backed RuneList. Public cardinality aliases and bounded tuples describe
these shapes without RuneView or unwrap. RuneObject proxies cache private RuneValue
field slots; setters and list mutations reuse the shared field normalizer and
validate before committing. Actual projected array results keep array shape during
JSON serialization, including zero/one items. Descriptor-free map/flatMap results
use the same native-value serializer; generated instances recover their own model
and optional codec, while plain callback results recurse without a schema.
Native patterns remain source strings in JSON, unsupported flags and cycles fail
explicitly, and model tags survive Rune JSON serialization. Ordinary JSON retains
structural Choice arm names; only Rune JSON projects those arms to tagged payloads.
The shared list/array flatten operation honors native depth semantics and preserves
chainable, depth-aware result types. Public array sort dispatches by
callback `Function.length`: zero/one parameter selects the shared Rune key-sort
helper, while two or more use native comparison and mutation through the normalizer.
An explicit key comparator retains helper semantics; `sort(undefined, compare)`
forces native comparison for default/rest/bound callbacks with ambiguous lengths.
No-argument sorting stays native. Explicit RuneList/helpers and source projections
retain Rune key-selector semantics.
Public array reverse also uses the checked native mutation path. Callback wrapping
for map/flatMap/filter/every/some forwards the supplied `thisArg` and public receiver;
explicit RuneList helpers retain their Rune collection behavior.
Canonical storage retains declared collection arrays and metadata envelopes for
serialization and equality. Replacing a field detaches old list handles so they
cannot overwrite the replacement. Explicit RuneList
transformations remain collection containers, with project() for count-shaped
results. Plain Shape collection fields accept scalar/array inputs; factory Input
and projected field types retain linked bounds. Executable collection reads and
assignment paths normalize through rune.list rather than assuming native arrays.
`new Trade` retains one proxied model construction.
Each Data emits one public class extending `RuneObject`, which owns factories,
JSON methods and inferred guards. Only linked definitions and model-specific
fields/conditions are emitted per class. Standard `RuneObject.model`/`field`
decorators register each model/field fact once. The shared definition builder lazily
normalizes named `Cardinality` constants or typed range factories to internal
count bounds; `wireCardinality` preserves metadata-envelope presence separately.
Field decorators take cardinality, check, lazy linked type, envelope cardinality
and native reader positionally, omitting unused trailing arguments.
One mapping supplies common constant values and emitted names. It then
merges inherited fields and caches reachable inventories; no generated runtime
selection/check tables duplicate those facts. Linked cardinality analysis still
supplies nonconservative deep bounds. `typescript.decorators: false` emits equivalent
registration calls through that same builder for type-erasing execution hosts.
Metadata is registered on a private
symbol; there is no public runtime `.Type` field. Input/Type/Selections/Deep/Shape
remain type-only merged namespace members. Natural subclassing and type-only model
tags preserve inherited factory/cardinality inference without parent casts.
Runtime inventories remain shared across cyclic models. Shared `is.Model` guards
are module-augmented: RuneObject inputs narrow to instances, unknown/plain data to
structural Shapes. Generated instances use class identity, plain data uses linked
shape checks. Scope-safe queries preserve models named Shape/Input/Type.
Optional TypeScript `serialization: zod` composes the canonical Zod namespace
emitter with the same walks and imports its generated codec companions. Scalar
codecs convert Temporal/RegExp fields; condition lowering shares native-value
operators while retaining Zod diagnostics. The Rune JSON visitor still owns
metadata, Choice envelopes and concrete-type selection. Default exports do not
import Zod. Standalone `zod.codecs` exposes the same bidirectional native schemas.
Default Zod interfaces describe wire values, including pattern source strings;
recursive interfaces must match the schema output instead of inheriting native
TypeScript mappings. Pattern codecs already bridge strings to
`z.instanceof(globalThis.RegExp)`, with native recursive interface outputs and
canonical flag-rejecting serialization.
The shared codec walker checks each concrete linked node using its own companion,
so a base-typed field cannot hide a descendant's constraints. It validates wire
inputs with parse and native values with encode without substituting schema clones
for the runtime's concrete hydration; encoding retains derived-only native fields.
The emitter derives each codec's `node` schema from the same field, cardinality,
metadata and condition builders, replacing only linked child schemas with object
guards. The concrete-model visitor owns recursion. Wire traversal returns parsed
native fields before validating parent conditions, while public codec operations
remain fully recursive. Shape guards share a cache only within one visitor pass;
later serialization rechecks mutations. No descendant subtree is revalidated at
each ancestor merely to dispatch its concrete codec.
Factory materialization and constructor field setters share the same per-pass
shape checks. An input-keyed construction context is removed in `finally`, so
future assignments never inherit trusted construction state. Decorators select
the class's inherited creator, preserving base-runtime ownership across separately
inlined namespaces. Constructor results still receive a shape check before return.
Read normalization reuses already-materialized model proxies without recursively
checking their descendants again. Raw structural children still hydrate and
validate on first read. Setter, list mutation and explicit factory paths retain
fresh validation state; no read cache becomes cross-mutation trust.
The namespace registry carries cycle sets from the canonical walks; Zod folds
foreign lazy parents' attributes and conditions using the same builders as local
parents. Cycle lookup first checks membership in the actual emitted model, so
standalone closures retain their synthetic graph's cycle information even when
their AST nodes keep the original Rune namespace. Native pattern types and constructors use `globalThis.RegExp` to avoid
collisions with authored model names.
Nested Shapes contain structural data and Temporal
values directly; public function signatures do not require `RuneFuncData`.
The normalizer owns only the supplied value
graph, preserves cycles and reuses generated construction guards. Conditions are
separate from shape checks. Field/deep selectors retain descriptors and compose
bounds; ambiguous names require linked declaration identity. The `._.` syntax lens
maps directly to Rune deep navigation and keeps its existing edit transaction.

`expr/deep-paths.ts` owns the canonical direct-first, cycle-protected path selection
used by executable lowering and public views. A generated source string embeds
that same function in exported runtimes; do not maintain another traversal.
Reachable descriptor inventories share metadata across cyclic graphs. No full CDM
object graph is materialized merely by importing generated modules.

Generated factories consume values narrowed by the model guards; Choice-derived
classes use the guarded class/Shape intersection. Property access uses `in`
guards, and Temporal inputs are narrowed before conversion. Public selection
returns retain their descriptor/cardinality relationship through checked guards;
key-selector/comparator tuple arguments avoid casting a generic identity selector.
Generated TypeScript has regression coverage against casts through `unknown` or
to `any`; private proxy assertions remain for conditional cardinality types.

Studio's source documentation styling and hide toggle share the Rune tokenizer.
Hiding uses CodeMirror folds and never rewrites source bytes. Metadata semantics
badges use the existing metadata owner for both declarations and child details.
Required scalar object-grid cells reuse `PreviewFieldControl`, retaining its
validation and schema-derived enum/calendar editors. Export settings and output
are simultaneously mounted in a vertical resizable split with a visible output
heading and panel border. Generation actions stay above the scrolling settings;
settings start at a compact 300px height and output receives the remaining space.
Generate target and Generate all targets preserve active/saved scope semantics.
File, target and layout selectors share ExportSelect's native keyboard behavior
and reserved chevron space.

Runtime descriptor getter types are erased only at the shared execution boundary;
selection generics retain the exact linked model. This prevents TypeScript from
recursively comparing whole cyclic schema graphs merely to validate a descriptor.
A 64-type cyclic compilation regression and the pinned corpus cover this boundary.

Bare extraction/filtering inside a pipeline uses Core's `getOperationArgument` for
shape analysis and the current bound value for execution. An absent explicit
receiver does not imply a collection; scalar pipelines retain scalar results,
while many-valued extraction keeps groups until its declared boundary.

SourceReader retains lexical bindings across callbacks and masks shadowed names.
An outer implicit pipeline/item binding becomes unavailable in a nested Rune
callback; references to it refuse the edit instead of binding to the inner item.
Constructor shorthand shares identifier resolution while preserving its field key.
Serialized origins retain the renderer's outer reserved/authored name sets as
well as each fragment's callback aliases. Rebuilding CST fragments from captured
source reuses that name scope, including unused owner inputs and earlier generated
locals, so edits restore hygienic implicit names in the displayed scope. Legacy callback origins
require a fresh draft, and substituted scalar scopes refuse nonliteral edits
whose binding cannot be recovered safely.
Generated public view constructors use ordinary fields and assignments so the
helper introduces no parameter-property transform requirement for Node type stripping.
Generated Rune JSON support embeds the authoritative Core codec through
`generate:rune-json-runtime`; descriptor adapters supply declaration context.
Core also owns Choice wrapper normalization and wire projection for both generated
values and the linked preview adapter. Wrapper and arm headers remain distinct,
and decoded key metadata survives round trips. Descriptors mark actual Choice
declarations separately from Data inheriting Choice arms, preserving derived Data
identity and fields. Matching wire type headers still require structural guard
checks for external objects.
Plain JSON is the default; instance/view serialization opts into Rune JSON.
TypeScript modules default to shared helpers, and per-namespace callers may
explicitly request inline support. Studio also uses shared Zod preview helpers.
Preview enum options use Core's effective inherited member inventory.

Source documentation recognizes both Rune STRING delimiters and hidden whitespace
or comments between documentation tokens, including after multiline expression
headers. A CodeMirror transaction extension reconciles only the toggle's owned
folds on edits; showing documentation preserves unrelated user folds. Visible
source performs no documentation-range scan.

## Reference loading and derived caches

Curated decimal precision, increment and significant-figure bodies share their
target's decimal admission/rounding support in project-runtime. Increment rounding
retains Java's exact-division failure policy; the published number/float profile
rejects overflow and does not retain BigDecimal formatting. These remain exclusive
language-specific catalog entries selected during publication. Their pinned
handwritten-Java corpus, target execution and Rune override-precedence tests live
under `cdm-rounding`; no model-specific lookup is added to Codegen.

Managed browser opens retain full checksum, manifest, toolchain and closure
verification. The optional `ReferenceTransport.decodeArtifact` port runs the
shared project-runtime decoder in Studio's existing parser worker. Canonical metadata
extraction also records bundled source-pack presence. This flag lets installation
skip documents without a pack, so workspace installation does
not parse every serialized dependency AST again on the UI thread. Derived-cache
version 4 retains this fact under the verified model source hash; older entries
are misses. Native/older transports retain the canonical JSON fallback and the
installer still reads present packs from verified serialized documents and validates
source hashes and publication provenance. Compatibility
review uses the same worker and canonical runtime implementation without adopting
the proposed graph. Studio uses the shared asynchronous decoder's native gzip
stream when available; synchronous hosts and older browsers retain the existing
decoder. Both paths apply the same canonical artifact schema after decompression;
cached bytes still pass checksum verification before either path runs.

Studio deduplicates concurrent immutable-artifact decodes by verified checksum in
a bounded LRU (192 MiB, conservative UTF-16 payload accounting). Cancellation
belongs to each consumer; it cannot cancel another consumer's shared decode.
Failures are not retained. The existing bounded IndexedDB artifact store retains
versioned canonical dependency metadata, compact LSP payloads and ScopeComputation
exports by source digest. Publication declaration indexes are not complete scope
indexes; the worker derives the qualified and enum aliases with Core and caches
them separately from the authored declaration inventory.
Document hashing and derived-cache reads overlap through four worker-side slots;
each slot owns at most one Core graph, and publication document order is retained.
Bump the derived format version when those Core contracts change. Derived cache
storage failure is a miss; no cache can waive compressed-byte verification.

Reference activation publishes the complete verified declaration inventory and
registers serialized documents with the existing deferred parser/index. It does
not reconstruct every reference AST on the UI thread. Namespace demand is routed
by workspace ownership to that pinned document set; it cannot fall back to a
moving server mirror. Linking materializes the selected namespace and transitively
needed models. Before UI publication, that subset passes through Core hydration
so consumers receive linked ASTs with container/reference contracts, not wire
snapshots. Deferred declaration ownership uses the matching workspace file path.
The parser worker closes immutable serialized-reference edges and registers their
roots together through Core's batch deserializer, preserving verified pointers
and cross-document cycles. The deferred linker reuses roots registered by that
batch. Only editable source snapshots rebuild authored references through the
live scope/link boundary; immutable dependencies are not re-resolved by name
before their scopes exist.
Concrete local source models publish only after their reference dependencies have
been linked and included in that same Core hydration batch. Repeated worker
snapshot requests return the complete linked closure, including dependencies
already materialized by a previous consumer. Reference activation links configured
local roots in one worker request, traversing and serializing their union once;
shared dependencies never require a separate snapshot transfer per implementation.
Inventory-only placeholders are an
intentional deferral and do not count as stripped concrete models in the graph's
degraded-reparse guard; concrete source peers retain that corruption protection.
HTTP-parser source URI aliases are accepted only from the current capture's
serialized metadata; unknown or ambiguous snapshot identities remain rejected.
Authored root declarations remain distinct from qualified scope aliases. Linked
reference snapshots survive source-only refreshes only within the same reference
capture; a new capture drops the entire retained graph and resets hydration readiness
so unchanged documents cannot retain pointers into changed dependencies. Reinstalling
an identical parser document set preserves its linked state. Selection/focus and
read-only ownership survive placeholder replacement. Derived LSP/index data stays
out of preview/download semantic worker payloads.

## Responsive reading and diagnostic presentation

Generated export text reads are scoped to the exact captured artifact and path,
including the render before effects settle. Failed reads retain the downloadable
archive and expose an explicit retry; late results cannot replace the active
file. Shared clipboard recovery copy keeps selectable text available when the
browser API is absent or denied. Copy/export feedback belongs to the current
payload revision; pending payload exports reject duplicate clicks. The root
render boundary keeps sanitized reporting and offers an accessible themed reload
action without displaying raw exceptions.
Shared Dockview tabs reference Studio's rendered label/count via `aria-labelledby`,
so dynamic badges remain part of the accessible name without duplicating titles.
Literal whitespace separates titles from counts; a CSS gap alone joins their
underlying text into one word for text-based accessibility checks.
Rendered titles subscribe to native title changes, including collapsed side tabs.
Documentation-toggle names match their visible action; nested Graph landmarks
remain distinct.

Explore reuses its side-group collapse mechanism under measured space pressure;
explicit visibility overrides, manual arrangements and focused preview inputs
remain authoritative. Every native layout snapshot retains automatic expansion
intent in `studioAutomaticPreviewWidths`, separate from unchanged native geometry.
Reload restores that intent and lets actual center space determine when to reopen;
manual visibility clears it. Never redistribute another group's saved width to
serialize a temporary collapse. Workbench-owned size memory survives header remounts.
Center focus hides peers without removing their mounted editors, then restores
split fractions. Explicit Inspect/file navigation shares a reveal action that
exits native Dockview maximization and clears center focus before showing its
destination; Reset also clears focus. File tabs and New file use explicit source
requests, while selection/hydration synchronization remains non-revealing.
Preview focus uses Dockview's native maximize/restore.

`codegen/instances` owns Zod issue translation, including relative union-branch
paths and accepted-form reasons. Studio preserves these through worker messages
and recursive metadata path adaptation; its validation UI only presents them.
The recursive diagnostic schema retains nested choices through saved-record
parsing: failures within one branch belong together, while nested alternatives
remain disjoint choices. Never flatten them into a list of simultaneous failures
or expand a Cartesian product. Nested disclosures preserve this structure without
increasing top-level issue counts or introducing a second validator.

## Curated decimal vector bodies

Publication selects `VectorOperation` and `VectorGrowthOperation` alongside the
rounding entries; Codegen still consumes only supplied project bindings.
TypeScript decimal storage/admission is shared with rounding; Python shares
finite input/output admission and uses standard-library exact fractions. Vector
division owns its distinct 10-place HALF_EVEN rule and skips zero-divisor pairs.
Growth retains exact decimal state between public output conversions. The source
inventory includes shared target helper files, not only catalog entry modules.
Python native-call boundaries materialize primitive collections and enforce their
declared bounds through the canonical cardinality helper before invoking installed
fallbacks or user callbacks. Primitive elements retain their values for native
admission checks; authored Rune function fast paths remain unchanged.
