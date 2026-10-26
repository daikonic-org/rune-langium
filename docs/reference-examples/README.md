# Importing reference examples

Prototype → **Examples** → **Reference examples…** browses JSON payloads from the
workspace's loaded reference model. At phone widths, open the Examples tab first.
The importer reads the verified source commit attached to the active reference
capture. Tagged releases retain their ordinary lock; a Nightly source commit is
in-memory provenance, not a new project pin.

Choose files, inspect their full type and payload, then import into the library.
Rune JSON headers identify the model and qualified type; a bare symbol name never
selects a declaration. Older JSON requires explicit selection of its object type.
Version mismatches and missing version headers require acknowledgement. This
acknowledgement does not change the selected reference or relax validation.

Each successfully saved example owns a descriptor and payload under the configured
examples directory. Provenance includes model, repository, release, commit, path
and input format. Payloads are saved as canonical JSON with metadata envelopes;
the original format is recorded separately. Reimporting the same model/commit/path/type
retains the existing library object, including local edits. Same-named examples
from different paths remain separate and receive unique display names.

Bulk import never binds an input or replaces the active workflow. Select a grid
row to choose an input explicitly. Per-file failures leave successful imports
available; a failed Save retains the object and its existing grid **Retry** action.
Missing types, changed references and unavailable workers prevent a false success.
Ordinary example saves can refresh project capture without clearing the importer.

## Formats and upstream inventory

| Artifact | Discovery / decoding | Type and semantic support |
| --- | --- | --- |
| CDM `rosetta-source/src/main/resources/ingest/output/**/*.json` | Supported JSON/RUNE_JSON object payloads | Exact model/type headers; active Rune structural/condition validation. Some upstream translations are intentionally incomplete. |
| CDM `rosetta-source/src/main/resources/functions/**/*.json` | Object payloads supported; execution descriptors excluded | Headerless arguments require explicit type selection. A function execution descriptor is not an object payload. |
| CDM `examples/samples/**/*.json` | Supported object payloads | Same type/version rules. Legal documents retain their original upstream data and references. |
| Other reference repositories' `examples`, `samples`, `testdata`, `test-data` trees | Supported JSON object payloads at the active commit | No implicit selection of another repository or release. Missing object types are reported. |
| JSON arrays / primitive argument files | Existing Workflow input import supports them; repository library browser requires an object file | A whole array is not silently relabeled as a scalar object. |
| RUNE_JSON `@data`, keys, schemes, global/external/scoped references | Shared Core wire codec; metadata retained as canonical envelopes | Shared declared-type adapter handles Data inheritance and Choice discriminators. It does not dereference external objects or fabricate missing reference targets. |
| FpML/XML confirmations, messages and processes | **Not yet an example codec** | XML parsing alone cannot supply a CDM translation, FpML namespace/version binding or cross-document reference semantics. |
| PDFs, build files, test-pack/pipeline/execution descriptors, generated output | Excluded | Never treated as example payloads. |

The upstream Rune serialization rules are documented in
[FINOS Rune DSL](https://github.com/finos/rune-dsl/blob/main/website/docs/serialization/serialization.mdx).
The pinned [CDM fixture](../../test/fixtures/third-party/cdm-examples/README.md)
verifies byte identity, metadata and reference preservation. It is an incomplete
bullet-payments translation, not evidence of a valid trade or complete schedule.

## FpML/XML milestone (remaining work under #647)

Before enabling an XML import option:

1. Bind the XML namespace/view/version and root document kind to an explicitly
   selected FpML reference release; distinguish trade, confirmation and process
   messages. Never infer a CDM release from an XML filename.
2. Reuse the workspace's explicit synonym/translation functions and resource
   mappings. Importing an FpML-shaped object and translating it into CDM are
   separate operations; missing implementations/resources must remain visible.
3. Specify preservation of IDs, href references, coding-scheme URIs and document
   provenance, with errors for unresolved or conflicting references.
4. Use a bounded XML reader with external entity/network expansion disabled and
   report unsupported shapes without partially replacing a workflow input.
5. Add pinned licensed FpML fixtures, namespace/version mismatch cases, ordinary
   workspace Save/reopen and end-to-end translation/validation journeys.

The XML milestone remains explicit; neither an existing XSD importer nor generated
FpML classes establishes that these instance-document semantics are implemented.

## Shared APIs

`@rune-langium/core/serialization` owns JSON/RUNE_JSON wire conversion.
`@rune-langium/codegen/export` exposes `adaptPreviewData` for an already linked,
effective document graph; it supplies canonical metadata/Choice values and maps
validation paths back to source values. Native `importProjectData` accepts that
graph as its optional fourth argument. Rune object serialization can receive an
explicit linked type/model/version context; it projects canonical Choice slots
back to concrete Rune wire objects. The parser-free encoder alone is a metadata
codec and refuses ambiguous typed containers instead of guessing their type. Studio runs the same adapter in its existing
preview worker, with normal readiness, cancellation and exact-receipt guards.
`@rune-langium/project-runtime/examples` owns bounded public Git object reads,
example path discovery, identity checks and stable provenance keys. Starters reuse
the same byte/hash reader rather than maintaining a second downloader.

Unknown model fields and unused keys/references are retained, not silently pruned.
The Rune encoder refuses mixed/conflicting or unsupported metadata representations
rather than overwriting information; saving canonical JSON remains available.


The encoder retains ephemeral roles when decoding explicit wire markers or
projecting linked declarations. These roles are not written into workspace JSON.
After JSON persistence, ambiguous `value`/`meta`/reference-shaped records require
linked context again; a context-free export fails instead of treating business
attributes as metadata. Kind-qualified function input-set imports use the same
adapter and remain distinct from same-named Data declarations.
