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

The `/references` entry resolves explicit GitHub release requests and loads
locked artifact closures. `resolveProjectReferences` verifies catalog provenance,
parent-required artifact cohorts, exact compiler identities and supported Langium
format before proposing a lock. Its optional cache uses the same verified-byte
contract as `loadLockedReferences`. A catalog can retain several compiled cohorts
for one unchanged source tag; resolution selects a jointly compatible cohort set,
never a second model release or a latest fallback.

Ordinary locked open verifies immutable manifest and compressed artifact SHA-256,
size, model identity and dependency closure without consulting catalogs. All
roots are returned together only after the full closure verifies. Host cache
failures are cache misses; corrupt bytes cannot bypass verification. Native or
browser hosts inject their fetch transport and bounded cache. Studio reuses its
existing IndexedDB cache and saves an explicit upgrade's configuration and lock
through one guarded project Save. Only reference requests affect lock freshness;
source, target and example edits still invalidate build input revisions.

`buildEffectiveProject(snapshot, referenceDocuments)` composes a fresh graph from
configured local sources and verified reference documents. It registers roots
before serialized revival, applies explicit declaration redirects at core's
scope/link boundary and returns diagnostics plus a revision/lock/override receipt.
Local replacement identities use model `local`; kinds are canonical Rune AST
kinds. A base-function map includes its complete dispatch family. The host must
reject diagnostics before execution and acknowledge the receipt before readiness.
Native `buildProject` loads the pinned closure through an injected transport/cache
(or the standard mirror transport), then generates from this effective graph.
Standalone Rune materialization is unavailable when overrides are active; export
the portable project instead. Experimental/pruning semantics remain diagnosed. Resource/provider availability
is separate from language linking; missing native behavior does not make pure
types unavailable.

The pure `/receipt` and `/context` entries let hosts capture and validate the same
receipt without importing a parser. Contexts bind the actual normalized lock and
overrides to their claimed digests. `/resolution` supplies the shared declaration
validation adapter for language services. Hosted semantic synchronization applies
a context at the final retained-model barrier, recreates roots and acknowledges
its receipt after validation. Studio preview, Prototype, download workers and LSP
verify that receipt before adopting results. Managed Modify saves the exact
locked-source copy and explicit mapping together; repeat Modify reuses it.
No Maven process or arbitrary YAML-selected executable runs.

`@rune-langium/project-runtime/browser` exposes the shared staged build transaction
with an injected target generator. It never creates a parser or imports Node
filesystem APIs. Studio supplies its existing download-worker generator for managed captures; the root native
`buildProject` supplies isolated Langium documents. Both use the same input
revision, target validation, toolchain checks, scope expansion and output writes.

## Prepared capabilities and bindings

`resolveProjectCapabilities(snapshot, providers)` reports installed implementation
requirements and resource/codec availability. Providers are registered callbacks
from the host; provider IDs never cause repository JavaScript or plugins to load.
`resolveProjectResource` requires an explicit model/resource mapping into a
configured resource root and returns the captured byte checksum. A matching local
filename alone never shadows a reference resource.

The first data adapter accepts a JSON array of `{value, label}` string entries.
Its resource ID is a kind-qualified Rune alias identity, such as
`quote.Currency#RosettaTypeAlias`, qualified by the mapping's model ID. The runtime
prepares one registry for generated preview choices and validation, including
object arrays and deferred definitions. Unknown formats/IDs remain unavailable;
this does not implement FpML genericode, calendars or XML/XSD validation.

Codegen accepts host-resolved function identities and emits module-scoped binders.
`bindGeneratedProjectModule` connects a newly loaded module to its prepared
registry; rebinding to a different registry is refused. Generated callers use
that same binding, across per-namespace, barrel and single-file TypeScript.
Callbacks never enter generated source. A Promise result is refused before a
synchronous Rune call can treat it as a value. Hosts must prepare asynchronous
data before execution. Financial-calendar/schedule parity is not claimed.

`serializeProjectData` and `importProjectData` currently support plain JSON. An
unsupported configured `model.defaultSerialisationFormat` is an unavailable codec,
not a successful JSON fallback. These ports are for project-aware hosts; legacy
explicit plain-JSON tools remain distinct. Native build/export entry points do not yet apply this registry to every
generator or enforce provider capability gates. Registry availability alone must
not be treated as support in a host that has not adopted those ports.
