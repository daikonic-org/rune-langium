# Rune project runtime

MIT-licensed composition of portable configuration, the Rune parser and installed
code generators. The `/browser` entry is host-neutral. Native filesystem discovery is
available separately from `@rune-langium/project-runtime/node`.

`buildProject(snapshot, { targets: ['postgres', 'sql-server'] }, adapter)` builds
named targets; `{ targets: 'all' }` explicitly selects all targets. There is no
default target or fallback generator. Per-target options are validated by
codegen's schemas. Target namespace scopes override upstream Rune generator
scope defaults; an empty namespace list is unrestricted. Exact namespace names
and dotted-prefix wildcards (such as `cdm.*`) use the same core matcher as
Studio’s curated dependency closure. Standard-library scopes remain recognized
without exporting primitive definitions as user model roots.

Sources use positive, project-relative glob patterns, including braces and
`**`, matched by picomatch. Each build creates an isolated language-service
instance, loads the standard library and links all selected source files in one
graph. Generation uses the existing dependency-closed export API. Syntax,
linking, selected-target, toolchain or output-path failures prevent output writes.
All selected outputs are generated in memory before persistence. Backing IO
failures may leave partial output files; the result reports only completed
writes and never reports success for that case.

`openLocalProject(root)` reads and validates the same snapshot as Studio. Its
Node adapter rejects traversal, outside-root symlinks and writes through internal
symlink aliases. SHA-256 revisions, descriptor checks and readback protect normal
concurrent edits; they do not turn the host filesystem into an atomic transaction
or an adversarial filesystem sandbox. Binary generators retain their bytes.

Native journals use a resolved-project-keyed directory beneath
`$XDG_CACHE_HOME/rune-langium/projects`, or `~/.cache/rune-langium/projects`.
Hosts can provide `privateRoot` outside the working copy. Journals are never
listed as project files or copied into Git. Browser hosts retain their existing
OPFS ownership coordination. This package neither stages nor commits files.

Reference/override resolution is the next subsystem: until it supplies a verified
effective graph, configured references or overrides return an explicit
unavailable diagnostic. Unsupported experimental/pruning semantics also remain
diagnosed. No Maven process or arbitrary YAML-selected executable runs.

`@rune-langium/project-runtime/browser` exposes the shared staged build transaction
with an injected target generator. It never creates a parser or imports Node
filesystem APIs. Studio supplies its existing network generator; the root native
`buildProject` supplies isolated Langium documents. Both use the same input
revision, target validation, toolchain checks, scope expansion and output writes.
