# Portable project configuration

MIT-licensed, host-neutral configuration contracts for Rune projects. There is no
dependency on React, browser storage, core or codegen. Hosts inject target
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
