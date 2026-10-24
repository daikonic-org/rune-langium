# Portable project configuration

MIT-licensed, host-neutral configuration contracts for Rune projects. There is no
dependency on React, browser storage, the language parser or codegen. Declaration\nidentity schemas come from the pure core/project-contract subpath. Hosts inject target
validation through `TargetValidator`.

`discoverProjectConfig` accepts `.yml` or `.yaml`, rejecting competing spellings.
`parseBuildConfig` and `parseStudioConfig` validate schema version 1. Their update
functions preserve comments and unknown fields while changing schema-owned values.
YAML duplicate keys, aliases and merges are diagnosed rather than guessed.
Invalid documents cannot be rewritten by these APIs.

`normalizeProject` reads companion and upstream Rune configuration without
rewriting Rune settings or choosing a default target. Hosts must check diagnostics
before executing or publishing snapshots. Missing companions permit legacy source
browsing; a missing explicitly configured Rune settings file is an error.
`mergeNamespaceConfig` applies upstream whole-entry replacement by ID.

Dependency locks use `build-config.lock.json` with `schemaVersion: 1`. The parser
validates structure; compatible dependency resolution, content integrity and
toolchain compatibility belong to the project runtime.

`validateOutputPaths` rejects traversal, private/protected destinations and
overlapping targets using portable case-insensitive directory boundaries.
`normalizeProjectPath` performs lexical normalization only; filesystem adapters
must also enforce resolved-path containment before writing.

`ProjectFileAdapter` binds IO to one working copy with compare-and-set revisions.
`saveProject` prepares a private journal, checks all preconditions, writes files,
and reads every result back before reporting success. Interrupted operations stay
recoverable; `recoverProjectSave` refuses newer third-party bytes. This is durable
recovery, not a claim that the host filesystem supports atomic multi-file writes.
Hosts map `PROJECT_SAVE_JOURNAL_PATH` to private backing storage outside Git,
and invoke recovery only while holding workspace ownership. Listing project files
must exclude this storage and credentials. A failed Save must not publish a new
execution snapshot.

`readProjectFiles` captures raw files and revisions, with a verification callback;
invalid YAML remains repairable. `createProjectSnapshot` validates proposed files,
and `readProjectSnapshot` verifies the working copy again before publication.
Snapshots use SHA-256 content identity. Structural configuration errors block
activation; generator/output diagnostics scoped to a target remain visible and
block that target through `projectDiagnosticsForTargets`, allowing independent
valid targets to run. Studio retains its previous valid snapshot on activation
failure and discards results after workspace disposal.

Adapters may implement `writeBinary` for installed binary generators; hosts without
it return a capability diagnostic rather than encode workbook bytes as text.
`projectBytesRevision` hashes original bytes, while `projectFileRevision` hashes
UTF-8 text. Output collisions diagnose every participating target, and snapshot
validation protects actual `.rosetta` paths even with root-wide source globs.


## Static GitHub initialization metadata

inspectMavenProject reads bounded local POM metadata and proposes absent native
settings; it performs no IO, parent download, Maven/plugin execution or environment
activation. Profile selection is explicit. Static parent properties, dependency
management, source/resource paths and Rune generator execution metadata retain
origin paths and coordinate/classifier/scope/exclusion evidence.

The supported Rune plugin metadata versions are the pinned 10.10.0, 10.7.0 and
legacy 9.76.2 adapters. Java generator/setup metadata creates unavailable Java
targets, never an inferred TypeScript equivalent. Unknown plugins, build-produced
inputs, filtering, unresolved parents/properties and Java classes remain report
items. XML entity declarations and oversized/recursive input are bounded.

The proposed build.importReport path links a portable compatibility report.
Its bytes participate in project revision identity and are protected from output.
A minimal Rune configuration is proposed only when no selected existing Rune
settings are available. Existing build-config.yml/.yaml always wins, and opened
POM bytes remain untouched. There is no standalone Maven import action or POM
export/synchronization.

The runtime mapMavenReferences adapter consumes explicit release-catalog
mavenArtifacts coordinates; Maven versions never become guessed Git tags.
Old catalogs without those mappings remain unresolved. Inspection may be partial
while the project remains editable; unavailable targets retain scoped diagnostics.


Reviewed initialization can pass read-only input revisions and an exact repository
file list to saveProject. These preconditions are persisted in the recovery
journal and verified before preparation, resumption and final readback. Inputs
are never written; changed POMs or newly added companions require a fresh review.
The normal build snapshot still ignores later POM edits after initialization.

The versioned ProjectImportReportSchema is also the read contract for persisted
reports. parseProjectImportReport diagnoses malformed evidence without rerunning
POM inspection. Current target/function readiness comes from native diagnostics
and effective-project capabilities; historical unsupported notes survive a local
repair without becoming a permanent execution gate.

## Portable examples and removals

`readExamples(snapshot)` reads only typed `*.example.json` descriptors beneath
`studio.examples`. Each descriptor binds a stable ID to a full declaration identity,
a relative payload path and an explicit codec. Missing types/payloads, duplicate IDs
and unavailable codecs produce diagnostics without deleting the original bytes.
Personal `.studio` data is never discovered or copied into this directory.

`saveProject` accepts writes and explicit `{path, remove: true, expectedRevision}`
removals through the same CAS journal. Recovery verifies removed paths remain absent
and refuses files recreated by another writer. Read-only input preconditions still
apply to the complete transaction.
