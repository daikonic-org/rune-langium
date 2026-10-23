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
