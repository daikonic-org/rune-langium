# Portable workspaces and versioned reference models

Status: approved in conversation, with the GitHub/POM clarification incorporated.
This is a design, not an implementation plan.

## Intent

Make a Rune project understandable and reproducible from its repository. A person
can open a starter, select released reference models, author local replacements,
save examples and workflows, and build several explicitly selected targets. The
same project configuration serves Studio and headless tooling.

The launcher distinguishes editable workspaces from read-only reference model
dependencies. Starter projects are ordinary GitHub repositories, initially under
`daikonic-org`; they are never presented as curated model packages.

## Decisions and boundaries

The user chose:

- Foundation first, then launcher and presentation, in reviewable changes.
- Unchanged upstream `rune-config.yml`, a tool-neutral `build-config.yml`, and
  shared Studio settings in `studio-config.yml`.
- `build-config.yml` is authoritative for builds. Maven import is one-way;
  there is no Maven export, generated POM, or ongoing POM synchronization.
  POM detection happens when opening a GitHub repository; there is no separate
  Import Maven launcher action.
- Multiple named targets, including several configurations of the same
  generator, with no default target. Existing per-target settings load from and
  serialize to these configurations.
- One release of a given reference model per workspace, selected by GitHub tag,
  and a repository-managed dependency lockfile.
- Explicit local override mappings for any reference. Modify copies the selected
  declaration with its documentation and annotations, rather than its whole file.
- Ordinary Save updates repository-managed working-copy files. Commit and push
  remain distinct. Examples, named workflows, shared layouts and formatting are
  portable. Personal editor/session state remains local.
- Generated code and ordinary exports are ignored by default; projects may opt
  into tracking them. Expected test outputs remain repository-managed fixtures.
- Visible terminology uses **example**, replacing **instance**.
- Prefer Rune implementations over native implementations. Reusable tooling and
  implementations initially live in rune-langium. A future `rune-curated` repo
  may own curated catalogs and publishing, separately from starter repos.
- Partial Maven imports may create editable workspaces. Report unsupported or
  unresolved capabilities; affected targets remain unavailable until repaired.

Specific schema spellings, directories, and implementation boundaries below are
the author's proposed calls, subject to approval of this document.

### Goals

1. Clone/open/save/reopen a project without losing its portable semantics.
2. Share resolution, configuration and generator option validation across Studio,
   browser workers, hosted language services and headless tools.
3. Pin the complete compatible reference dependency closure and verify its bytes.
4. Resolve explicit overrides consistently in navigation, validation, execution,
   generated code and exports, including calls originating in reference models.
5. Import useful Rune/CDM/FpML build conventions without requiring Maven/JVM
   execution in the browser or falsely claiming native implementation support.
6. Preserve Studio's established compact control and type-explorer language.

### Non-goals and anti-goals

- No arbitrary Maven build emulation, plugin execution on import, reverse export,
  or automatic translation of Java source into Rune.
- No promise that every CDM function or payment schedule works merely because
  its declarations load; missing providers remain explicit capabilities.
- No arbitrary same-name shadowing, automatic release upgrades, or concurrent
  releases of one reference model inside a workspace.
- No new Rune syntax for project management and no extra keys placed inside the
  upstream configuration that its reader could discard.
- No account service required to make projects portable; identity syncing is
  outside this scope. Never commit tokens, handles or personal browser state.
- No organization repository creation, publication, merges or deployment as part
  of design approval. Publishing starter repos remains a separate operation.

## Current implementation and upstream evidence

Current source was inspected at master `c5f33690` and the navigation feature
checkout with equivalent application content. Infigraph located symbols, but its
primary index reported old symbol IDs and stale embeddings; current source reads
were used to confirm details.

| Existing seam                                                             | Current behavior and implication                                                                                                                                                                                                   |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WorkspacesPerspective`, `FileLoader`, `WorkspaceSwitcher`, `ModelLoader` | File/Git open, recents, and curated model actions are stacked together; separate project and dependency tasks.                                                                                                                     |
| `workspace/persistence.ts`                                                | IndexedDB holds workspace metadata, model bindings, tabs and Dockview state. File configuration must become authoritative for portable fields.                                                                                     |
| `export-workbench-store.ts`, `ExportSettingsPanel`, `export-request.ts`   | Browser preferences hold export configuration and target-keyed options. Generation captures configuration/source identity. Preserve stale-result protection while introducing named targets.                                       |
| `packages/codegen/src/types.ts`, target descriptors and option schemas    | Existing target options and emitter capability contracts are authoritative. Do not invent a separate YAML options implementation.                                                                                                  |
| `form-presentation-store.ts`, `prototype-view-store.ts`                   | Shared form presentation and personal view preferences need different storage homes.                                                                                                                                               |
| `opfs/instances-fs.ts`, `workspace/tab-state.ts`, Git backing             | Private `.studio` content currently mixes examples/scratch with credentials stored elsewhere in the OPFS workspace root. Do not blanket-track hidden files.                                                                        |
| `local-declaration.ts`, `apps/studio/PRODUCT.md`                          | Modify already creates local source in a distinct namespace, with dispatch-group handling. Existing curated callers continue to reference originals. The new explicit override contract deliberately changes that latter behavior. |
| `curated-schema`, curated fetch/load and artifact publishing              | Immutable cohorts and content hashes already preserve linked dependency identity. Release selection must extend them, not build another hydration/resolution path.                                                                 |

Upstream research inspected Rune main, CDM tree
`1704b23907b3dc4b87ba7a0133cb75aad9b43c77` and FpML tree
`e28b932fb8affb28d99d3388c33a4f66f2f97d28`. These observations are version-specific;
the importer must select compatibility adapters rather than assuming all releases
have the same configuration or native runtime.

### Preserve existing Rune configuration meanings

| Upstream setting                                    | Project behavior                                                                                                                                                          |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model.name`                                        | Default displayed project name and relevant import/export model identity; keep separate from Maven artifact coordinates.                                                  |
| `model.enableExperimentalFeatures`                  | Pass only recognized, supported features through shared language tooling; diagnose unsupported features.                                                                  |
| `model.defaultSerialisationFormat`                  | Default data codec for compatible imports/exports; does not select a generator language. Never label plain JSON as an unsupported upstream envelope.                      |
| `generators.namespaces`                             | Shared generation scope defaults. A one-off export selection does not rewrite this file. An empty upstream list means unrestricted generation.                            |
| `generators.doNotPrune`                             | Preserve specified empty nested objects during applicable builder pruning; it is not dead-type elimination. Do not advertise parity for emitters that lack this behavior. |
| `namespaceConfig.id`, `namespace`, `readOnly`       | Retain upstream identity, namespace selection and read-only semantics.                                                                                                    |
| `namespaceConfig.origin.modelImport`                | Import provenance, such as XSD/CSV; independent of read-only status.                                                                                                      |
| `namespaceConfig.schemaConfig.schema`, `configPath` | Declared schema and serialization mapping location. An upstream classpath location needs an explicit resource mapping, not interpretation as an arbitrary URL.            |
| `dependencies`                                      | Current inspected upstream class is a placeholder; it is not a Git/release resolver. New resolver settings belong in build-config.                                        |

Upstream merges namespace configuration by entry ID, with the project entry
replacing the dependency entry. Preserve that rule; it does not implement symbol
override mappings. Its YAML reader ignores unknown properties and may drop them
on rewriting, so extensions belong in companion files.

## Approaches

### Foundation first — selected

Build file contracts, shared resolution and repository persistence before the
launcher. Then adapt Studio controls and release selection to those contracts.
This establishes a single source of project truth and avoids a second migration
from a temporary UI-only dependency system. The tradeoff is less visible UI work
in the first change.

### Launcher first — considered

Deliver starter and release selectors using browser-managed state, then migrate
to portable configuration. This provides earlier visible progress but requires
transitional behavior, extra migrations and careful reconciliation between two
configurations. The user selected foundation first instead.

## Project files and storage ownership

Proposed conventional layout; directories can be configured and are relative to
the repository root:

```text
rune-config.yml
build-config.yml
build-config.lock.json
studio-config.yml
model/                       editable .rosetta files
resources/                   schemas, code lists and mapping resources
examples/                    example descriptors and plain data payloads
workflows/                   named workflow definitions
layouts/                     shared object/control presentation
tests/expected/              intentional regression output fixtures
generated/                   ignored by default
exports/                     ignored by default
```

Discovery accepts `.yml` or `.yaml` for the three configuration files, preserving
the existing spelling. If both spellings exist, diagnose ambiguity rather than
silently choose one. New files use `.yml`. A project may keep upstream Rune config
in a resource directory; build-config can reference that path without duplicating
its contents. Absence of build-config preserves ordinary source browsing and
scratch exports; the first explicit project-settings Save offers creation.

Repository-managed files contain project semantics, never editor session state.
Personal IndexedDB state retains last-opened project, focused target, selected
example, filters, docking, tab/cursor/scroll state and ephemeral drafts. Generated
artifacts, caches, credentials, permissions/handles and transaction journals stay
outside the commit set. A materialized reference cache is ignored.

Default ignore entries cover `generated/`, `exports/` and the dedicated private
cache/journal directories, not an unbounded `.studio/**` rule that could hide
legacy user data. Preserve existing `.gitignore` content. Tracking a generated
directory is an explicit project choice and ordinary export actions never stage
or commit automatically.

### Save, migration and conflicts

- Shared project settings are read from files into a single validated project
  snapshot. Studio controls and text edits update that snapshot. Invalid YAML
  preserves the last valid runtime snapshot, displays the file error and blocks
  builds that would use unsaved/invalid settings.
- Save writes repository working-copy files using each backing's actual file
  adapter. Browser-only projects use their working-copy file store and can later
  be exported or Git-backed. A saved browser project is not represented as pushed.
- Use a staged-write journal and revision preconditions for multi-file operations
  (Modify, migration, reference upgrades). Publish the new snapshot only after
  completion; recover an interrupted write on reopen. Do not pretend folder or
  Git adapters provide a native cross-file atomic rename.
- External edits, another tab and Git checkout changes invalidate the snapshot.
  Compare revisions before writes; surface conflicts instead of overwriting
  newer files. Cache keys include project revision, lock and override identities.
- A repository configuration wins over an old browser preference. Offer an
  explicit migration preview for browser-only export options, layouts, examples
  and saved model bindings. Never manufacture a reference tag from a floating
  legacy version; resolve exact provenance or mark it unresolved.
- Copy legacy examples into repository paths, verify readback, then mark the
  migration complete. Keep old data until success. Browser preference migration
  is idempotent and does not overwrite an existing named target.
- Source comments and unknown fields in companion files survive supported edits.
  Unsupported schema versions open for inspection, with writes/builds blocked
  until supported. Do not rewrite upstream rune-config simply to save UI state.

## Shared project foundation

Propose an MIT-licensed `packages/project-config` for configuration schemas,
serialization, normalized project snapshots, lock validation and import reports.
It has no React, IndexedDB or browser-only dependency. Filesystem/network adapters
are injected; host applications own credentials and cancellation.

Core retains language and declaration identity. Shared codegen retains generator
semantics, option contracts, dependency walks and artifact identities. Curated
schema retains release/artifact contracts. Studio owns editors and presentation;
its source-available license does not leak into headless project code.

The integration produces one **effective project graph** from local sources,
locked reference sources, resources and validated override maps. Core linking and
all consumers use the same resolution hook. Hosted LSP gets the same versioned
project descriptor through an explicit protocol extension; this does not create a
browser LSP fallback. Do not display replacement behavior in Studio while codegen
or hosted diagnostics still use the original graph.

## Build configuration and named targets

Illustrative schema shape, to be finalized as a shared validated contract:

```yaml
schemaVersion: 1
runeConfig: rune-config.yml
sources:
  - model/**/*.rosetta
resources:
  - path: resources
references:
  cdm:
    repository: https://github.com/finos/common-domain-model
    release: '<selected-release-tag>'
targets:
  application-types:
    generator: typescript
    options:
      layout: barrel
      inputChecks: true
    output: generated/typescript
  reporting-postgres:
    generator: sql
    options:
      dialect: postgres
      inheritance: table-per-type
    output: generated/postgres
  reporting-sqlserver:
    generator: sql
    options:
      dialect: sqlserver
      inheritance: table-per-type
    output: generated/sqlserver
```

The lock also records toolchain/generator implementation versions. Built-in
generator IDs use the installed compatible rune-langium toolchain; a YAML string
does not download or run arbitrary code. Missing providers and incompatible
versions produce capabilities/diagnostics, never silent fallback to another
generator. Initial extension support is registered tooling, not remote plugins.

Target name is independent of generator ID. There is no `defaultTarget` and no
implicit first target. Proposed command behavior: a build requires named targets
or an explicit all-targets flag; Studio offers target selection and Build all.
A remembered UI selection is personal state and cannot become a project default.
Existing library defaults need not be removed, but project execution always
passes an explicitly selected target.

Reuse `GeneratorOptions`, descriptors and schema-owned forms. Existing layout,
SQL, Excel, OpenAPI and other supported options must round-trip without loss;
options not currently exposed in the UI remain editable in YAML. Add missing
validation in the owning generator package, not a competing UI contract.
Constrain options to their generator, and reject invalid values with source
locations. Output paths must stay inside approved project output directories;
overlapping target outputs are errors unless a future explicit composition
contract supports them. Do not overwrite source, config, examples or fixtures.

Each target may explicitly override generation scope; otherwise it uses Rune
namespace defaults. Ad hoc export selection/options remain a run-specific draft.
Save target settings is explicit and uses ordinary project Save. Preview and
download still use identical captured source/config/lock identities; stale async
results cannot become current output after edits or workspace changes.

## Reference releases, locking and upgrades

A release catalog lists GitHub release tags and source commits per reference
model, its compatible dependencies and immutable artifact cohort. Tags are user
choices; artifact versions and Git release tags are not assumed interchangeable.

`build-config.lock.json` stores requested repository/tag, resolved commit,
dependency edges, compatible toolchain identity, immutable manifest/cohort IDs
and content checksums. A resolver reuses the existing curated publication and
hydration contracts. When a release has no published artifact, show source-build
availability or an unavailable reason; never substitute latest.

One selected version per model applies across the dependency closure. Conflicting
direct/transitive requirements produce an actionable conflict with paths; users
select a compatible release set rather than load two model versions. Upstream
Maven dependency versions are evidence for the release adapter, not universal
semver inference. Include exact source-to-artifact version mappings in resolution.

Opening uses the lock without consulting latest. Verify hashes before exposing
artifacts. A missing lock requires an explicit Resolve step; stale or inconsistent
locks block affected builds. Offline opens use verified cached bytes or show a
missing dependency. Explicit upgrade previews dependency, schema, override and
example compatibility changes, then updates configuration and lock together.
Moved tags do not silently replace an existing locked commit.

Publishing release catalogs and immutable artifacts can later move into
`rune-curated` without changing project contracts. Package caches/cohort IDs remain
implementation details; the launcher shows model/release and readable status.

## Explicit local overrides

Mappings are in build-config and refer to canonical declaration identities:
reference model + namespace + declaration kind + name, plus dispatch identity
where needed. The destination is an explicit local declaration identity. Resource
overrides use resource IDs and paths; native bindings use function identity and
an explicit registered implementation/provider. No name-only lookup is sufficient.

Modify creates source for the selected logical declaration in a local namespace,
preserving annotations, documentation, required imports and exact source slices
where possible. A dispatched function is one logical declaration family: retain
its base and variants, possibly in several local files, as existing copy behavior
requires. Do not silently drop variants to meet a one-file interpretation.
Record source provenance and the mapping in the same Save operation. A repeated
Modify opens the existing replacement rather than making another competing copy.

Extend creates an ordinary derived declaration and no replacement mapping.
Unmapped local declarations remain ordinary project declarations.

Resolution redirects every reference to an overridden identity, including
references from other reference models and self-references in copied source.
Keep originals immutable for comparison/provenance. Re-resolve into a fresh,
single project graph; do not mutate cached serialized source artifacts or maintain
a second UI-only graph. Imports/types/kinds and dispatch resolution still obey
Rune rules. Ambiguous mappings, cycles and unavailable destinations are errors.

For a function replacement, require a compatible callable signature before
execution; preserve input/output identity, cardinality and dispatch compatibility.
For structural replacements, validate the effective project as a whole. Removing
a required field may invalidate reference callers; expose those diagnostics and
block affected operations rather than prohibit all intentional schema changes.

Source-only export must disclose the mapping dependency. A portable project ZIP
includes companions/lock. An upstream-tool-compatible Rune source export must
materialize a self-contained effective source tree under original identities,
without duplicate originals/replacements, then parse/link that tree. Until such
materialization is supported, disable that export mode when overrides are active;
do not claim upstream tools will read build-config automatically. Generated
language targets consume the effective graph directly.

Override resources/providers must use the same resolution across validation,
form choice lists, execution and codegen. Local resource wins only through its
explicit mapping; unresolved mappings never silently revert to upstream behavior.

## Code lists, schemas and implementations

CDM's Java runtime includes real providers and business semantics, beyond build
plumbing: code-list loading/transformation, holiday calendars, schedules, decimal
rounding and external observations. FpML includes XSDs, serialization mappings
and XML round-trip fixtures. Import resources as first-class project dependencies.

Use registered codecs/providers with declared resource IDs. Map classpath roots
to portable resource roots. An XML/XSD mapping or genericode transform is usable
only when the corresponding implementation is present. Preserve original resource
bytes/checksums and licenses; never fake a populated calendar or successful schema
validation when a provider is absent.

Assess each implementation against standard Rune expressibility. Port reusable
logic in Rune where semantics match; use narrow shared native primitives for
external data, decimal/calendar operations or unsupported language operations.
Bindings are explicit by function identity. Fixtures must establish null,
cardinality, precision, rounding and failure behavior. There is no automatic
assumption that Java floating/decimal/date behavior equals JavaScript behavior.

Phase one establishes capability reporting and one small real implementation
fixture; broad CDM native parity and a complete bond payment schedule are separate
follow-on slices. A starter claiming schedule execution cannot be published as
working until its required providers and expected-output fixtures pass end to end.

## Maven import contract

After opening a GitHub repository, inspect its existing configuration. If a
build-config file exists, use it without reimporting the POM. If no build-config
exists and a POM is present, offer initialization from the detected build settings
within the repository-open flow. There is no standalone Import Maven action.
Read supported POM configuration and resources into a preview, then create
working-copy files only after confirmation. Preserve the original POM;
future Studio saves do not update it and future POM edits do not affect builds.
Reimport is an explicit diff/merge operation, never overwrite-all.

| Maven concept                                                 | Import handling                                                                                                                                                                                    |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coordinates and dependency declarations                       | Preserve GAV/type/classifier/scope/exclusion evidence; map supported model artifacts to Git release/source identities through catalog adapters. Unmapped coordinates stay reported and unresolved. |
| Properties, parents, dependency management                    | Resolve the supported static subset, with origin information; unresolved interpolation/parents become report items, not guessed values.                                                            |
| Profiles                                                      | Let the user select profiles. Resolve supported activation explicitly; environment-sensitive/JDK/OS/settings activation is disclosed, never inferred from the browser.                             |
| Rune generator plugin executions                              | Map supported plugin/version/goal settings into independently named targets, including relevant source paths, options and output directories. An execution may require several targets.            |
| Sources/resources/filtering                                   | Preserve selected directories and portable resources. Unsupported filters or build-produced inputs remain unresolved capabilities.                                                                 |
| Runtime modules, native classes, arbitrary plugins/lifecycles | Record implementation requirements and unsupported steps. Do not execute them or describe them as successfully translated.                                                                         |

The initial browser importer handles POMs found in opened GitHub repositories and
known Rune/CDM/FpML adapters. Do not invoke Maven or arbitrary plugins. Optional parent
metadata fetching is a bounded, cancellable resolver operation with provenance;
never execute project code for configuration discovery. A user-supplied effective
POM can be imported as data, with the selected profiles/environment recorded.
No requirement to implement every Maven repository/auth/activation mechanism in
the first milestone.

The compatibility report records source location, translated value, unsupported
item, affected target/capability and recovery. Partial imports still create editable
workspaces. Unsupported build-wide steps disable all dependent targets; unrelated
targets remain usable. Missing native implementations disable affected functions,
without unnecessarily disabling pure type generation. Never show successful
validation/execution for a capability that was not performed.

## Examples, workflows and Studio configuration

`studio-config.yml` references conventional `examples/`, `workflows/`, and
`layouts/` paths. It contains shared presentation references, not dock positions,
credentials or selected records. Symbol keys include namespace/kind/name and
owning model; source property paths identify field-level formatting/layout.

Examples have a stable ID, display name, root type identity, payload path and
optional provenance/expected-result references. Payloads remain plain data in the
configured supported codec. User-authored examples survive reference upgrades;
incompatible types are diagnosed without discarding their data. UI labels become
Create example, Examples, Import examples and Save as example.

Named workflows contain an optional function identity, parameter-to-example or
literal bindings, and output definitions. No function preserves the input-to-
payload path. Multiple inputs remain peers. Save a named workflow explicitly;
scratch flows stay personal. Execution results are transient unless saved as an
example or expected fixture; exporting them uses the ignored exports directory.

Shared presentation stores object layout/order/spans and primitive control format
(currency, precision, grouping, date/time display) by canonical symbol/path.
Formatting never mutates semantic values, schema cardinality or validation rules.
Only declared stable identities/paths are persisted; no DOM IDs or XYFlow IDs.

## Launcher and reference selector

Operate mode; inherit the current Daikonic midnight-green surfaces, amber primary
actions, compact controls, type chips and existing SVG brand mark. No rebrand or
new marketing surface. The proposed mockup is in
[launcher mockup](2026-10-23-workspace-launcher/mockup.html).

### Workspace launcher

- Lead with recent workspaces in a compact list: name, backing/repository,
  branch, saved/unsaved state and last opened. Reuse row focus/selection behavior.
- A concise action row offers New workspace, Open folder and Open GitHub.
  Existing file import remains available. POM detection and build-setting
  initialization belong to the GitHub-open flow, not another launcher button.
- Start from example is a separate selectable list of GitHub starter repositories,
  with a details pane showing purpose, included examples, reference releases and
  required capabilities. Mockup starter names are proposals, not existing repos.
- A starter opens as an editable workspace copy with source provenance. It is
  not reference-only. Committing/pushing requires clone/fork into a writable repo;
  offer the existing Git flow when the user chooses to connect. Do not require
  authentication merely to inspect a public starter. Never push to the starter
  source repository merely because its URL was used to begin a workspace.
- Blank, browser-only, folder-backed and Git-backed workspaces remain available.
  Deleting a recent entry does not delete the remote repository.

### Workspace reference models

Reference selection lives in workspace settings and a compact active-workspace
summary, rather than being mixed into the list of project-opening actions. A
searchable model list and release details pane shows the selected model, release,
dependency closure and compatibility. Add reference/Change release are explicit.

Release choices come from the catalog and show release tags rather than internal
cohort names. Compatible transitive selections are visible and explain why they
are required. Pending resolve, downloading, verified cached, unavailable, conflict,
and invalid lock are separate states. Resolution failure preserves the old
working configuration; retries retain selection and context.

### Responsive and accessible behavior

Use a list/detail split on wide surfaces and a single-column drill-in with Back
on narrow screens. Preserve selection between arrangements. Compact density
cannot make touch targets or long repository names unusable. Reuse shared
Select/Combobox, Button, KindBadge, Field and focus primitives; don't introduce
native dropdown chrome beside styled pickers. Status uses text plus icons, not
color alone. Keyboard users can search, select, inspect dependencies and confirm
without drag-and-drop or hover-only actions. Respect reduced motion.

## Delivery slices

1. **Portable foundation:** companion schemas, normalized snapshots, file adapters,
   Save/recovery/conflict contract, options round-trip, lock schema and headless
   consumption. Preserve legacy browsing while migration is explicit.
2. **Reference resolution and effective graph:** release catalog adapters, immutable
   cohort reuse, compatible closure, resource mapping and explicit overrides.
   Integrate LSP/parse/generation/preview seams before claiming replacement works.
3. **One-way Maven import and capability reporting:** real pinned CDM/FpML fixture
   metadata and resources, static profiles, partial imports and repair reports.
4. **Launcher and repository-backed Studio artifacts:** starter discovery/open,
   separate reference picker, example terminology, portable workflows/layouts and
   migration. Starter repo publication is separately authorized after validation.
5. **Implementation coverage:** incremental Rune-first ports with upstream fixtures;
   add executable domain starters only as their dependency/provider closure works.

Each slice has a usable acceptance boundary. Do not hide incomplete reference
resolution or native execution behind a polished launcher. The implementation
plan may split slices further while preserving foundation-first ordering.

## Acceptance and validation

Configuration/persistence:

- Existing target options round-trip UI → YAML → reload → headless generation.
  Two SQL targets retain independent options; no build implicitly chooses one.
- YAML edits and UI changes agree; invalid documents, unknown schema versions,
  conflicting spellings and stale writes show recoverable errors.
- Save/reopen/clone retains sources, examples, workflows, layout/format settings
  and exact dependency resolution. Credentials and personal view state never
  enter the repository artifact set. Failed/interrupted Save retains prior data.
- Migration is idempotent and preserves newer files, legacy examples and settings.
  Ad hoc exports don't overwrite project defaults or existing target definitions.

Resolution/overrides:

- Pin two different workspaces to different releases; each reopens reproducibly.
  Reject incompatible transitive requirements, moved-tag substitutions, hash
  mismatches and mixed cohorts. Exercise offline/missing-cache/upgrade rollback.
- A local function replacement is used by a curated caller in validation and
  execution; generated output agrees. Same-name declarations of different kinds
  cannot collide. Cover dispatch, cycles and nested resource dependencies.
- Extend leaves original callers unchanged. Modify preserves documentation,
  annotations, imports, dispatch variants and provenance, with one explicit map.
- A local code-list/provider replacement changes validation and corresponding UI
  options consistently. Missing providers show unavailable, not invalid/valid.

Import/UX:

- Import pinned CDM/FpML POM fixtures, selected profiles and resources without
  executing plugins; assert translated values and unsupported reports.
- Unsupported execution steps disable only dependent capabilities. Partial
  imports preserve editable source. Import never rewrites an existing POM.
- GitHub-open detects POM settings only when companion build configuration is
  absent. Opening a repository with build-config never reapplies Maven settings,
  and the launcher contains no standalone Maven import action.
- Browser journeys cover blank/open/recent/starter, clone/fork handoff, example
  Save/reopen, reference Add/Change/conflict/retry, target settings round-trip,
  override navigation and narrow list/detail Back. Verify viewport/keyboard/Axe
  checks and visible file readbacks, not only button clicks.
- Execute a real parsed function with a local Rune implementation fixture and
  validate its expected output. Track full CDM schedule/provider coverage
  separately; don't use synthetic success as evidence of business parity.

Run affected shared-package and Studio tests/builds/types plus normal lint,
formatting and hooks during implementation. This documentation change needs link,
syntax and mockup inspection only. It makes no runtime correctness claim.

## Builder-owned choices

The builder may choose YAML CST library, internal store organization, journal
implementation, exact CLI command names, release cache transport, component
composition and test fixture organization. Reuse current packages and adapters
where practical. They may adjust illustrative field spellings before schema
release, with one authoritative schema and migration contract. Scope changes,
dropping approved persistence/override behavior or adding Maven export require a
new product decision.

## Sources

- [Rune configuration classes](https://github.com/finos/rune-dsl/tree/main/rune-runtime/src/main/java/com/regnosys/rosetta/config)
- [Rune configuration reader](https://github.com/finos/rune-dsl/blob/main/rune-runtime/src/main/java/com/regnosys/rosetta/config/RuneConfigurationService.java)
- [Rune Maven generator integration](https://github.com/finos/rune-dsl/blob/main/rune-maven-plugin/src/main/java/com/regnosys/rosetta/maven/AbstractRuneGeneratorMojo.java)
- [CDM Rune configuration](https://github.com/finos/common-domain-model/blob/master/rosetta-source/src/main/resources/rune-config.yml)
- [CDM source POM](https://github.com/finos/common-domain-model/blob/master/rosetta-source/pom.xml)
- [CDM runtime bindings](https://github.com/finos/common-domain-model/blob/master/rosetta-source/src/main/java/org/finos/cdm/CdmRuntimeModule.java)
- [FpML runtime model configuration](https://github.com/rosetta-models/rune-fpml/blob/master/rosetta-source/src/main/java/com/regnosys/runefpml/RuneFpmlModelConfig.java)
- [Maven POM reference](https://maven.apache.org/pom.html)
- [Maven lifecycle](https://maven.apache.org/guides/introduction/introduction-to-the-lifecycle.html)
- [Maven profiles](https://maven.apache.org/guides/introduction/introduction-to-profiles.html)
