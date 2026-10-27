# Reference build resources

The audited sources are CDM commit `1704b23907b3dc4b87ba7a0133cb75aad9b43c77`,
rune-fpml 3.5.0 (`675b4ca8faa27f71e345f127e890202b08456750`) and Rune DSL 10.10.0
(`8ff5a7b39031876ef06c901102c8d96cf90236c4`). These are bounded inventories, not
claims about every upstream release.

CDM's `rosetta-source/src/main/resources/codelist/json/` contains 229 JSON lists.
The upstream `CodeList` model has `identification` (scheme URI/version) and `codes`
(value/description/source/effectiveDate/deprecatedDate). Its 238 XML-tree files
include original genericode sources and schema companions; CDM supplies an XSL
conversion. Canonical URIs identify a scheme and must not be used as retrieval
URLs. `LoadCodeList(domain)` is native. At this CDM commit,
`ValidateFpMLCodingSchemeDomain(code, domain)` already has a Rune body calling
that loader (its missing-list branch returns `False`, despite an older prose
description). Specialized `FpMLCodingScheme(domain: ...)` aliases also
carry a condition. Loading a JSON file alone does not implement those functions.

FpML's `rune-config.yml` declares two `namespaceConfig`/`schemaConfig` entries
pointing to confirmation and recordkeeping `xml-config/*.json`. Its audited tree
contains no CDM-style code-list directory. Rune's integration config retains
`model`, `dependencies` and `generators`; Maven packaging is not the authoritative
workspace configuration.

| Artifact | Current support | Remaining integration |
| --- | --- | --- |
| Rune sources / declaration identity | Existing reference closure, linking and explicit overrides | Upstream dialect changes need their own audited cohort |
| Flat JSON code list | Prepared by shared project runtime as a canonical Rune enum for implemented generators and Prototype | Empty lists retain the previous never-value adapter boundary |
| CDM CodeList JSON | Explicit `cdm-json` mapping; version/scheme checked; labels, descriptions and dates retained | Automatic parameterized coding-scheme/domain resolution is not enabled |
| Referenced GitHub code-list file | `readReferenceCodeList` verifies exact Git commit/blob and returns bytes, origin and decoded entries for Save | No dedicated resource browser in Studio yet |
| Genericode XML / XSL | Retain as repository files | No genericode reader or XSL execution; no silent conversion |
| FpML XML configuration / XSD | Keep upstream configuration/resource files | XML instance translation remains the #647 milestone |
| Holiday calendars / native engines | Explicit installed providers and capability diagnostics | Concrete engines/data dependencies are tracked by #646 |

## Canonical enum materialization

A non-empty, explicitly mapped list becomes a normal Rune enum in the captured
project graph. The mapped alias keeps its identity and points to that enum. Native
builds, managed Studio generation and Prototype therefore see the same declaration;
SQL, XSD, OpenAPI and Excel do not need a separate code-list implementation.
The enum builder and source renderer are shared with schema imports.

An enum member's Rune identifier is separate from its external code. Materialized
enums use the reserved `rune.resources.CodeList` synonym source:

```rosetta
namespace rune.resources
synonym source CodeList
enum Basis:
  ACT_360 displayName "Actual / 360"
    [synonym CodeList value "ACT/360"]
```

Core's `getEnumValueLiteral` is authoritative for these literal codes. Emitters,
Prototype, enum expressions, switches and `to-enum` use it. Display labels never
become wire values. Other synonym sources retain their existing mapping semantics.
Sanitized member-name collisions are disambiguated while preserving both codes.
Native signature matching also compares these wire values, so unchanged member
names cannot select a bundled implementation for a different code contract.
Generated enum names are derived from the complete declaration identity, and
single-file bundles order namespace dependencies before their consumers.

These documents belong to a fresh resolved graph. They do not overwrite upstream
sources or create/edit workspace files. The original resource bytes, source
provenance and checksum remain in the ordinary snapshot and Save/reopen contract.
Descriptions and effective/deprecation dates remain available in the prepared
registry; historical values stay selectable. Empty lists retain the existing
never-value bindings for TypeScript, Zod and JSON Schema; other resource targets
remain explicitly unavailable for that case.

The existing guard still rejects constrained/parameterized aliases. Materializing
an enum does not erase a Rune condition, implement `LoadCodeList(domain)`, choose
an upstream version, or publish additional curated artifacts. Those integrations
remain open under #645.

## Explicit resource mapping

Keep upstream `rune-config.yml` fields intact. Build/runtime resource selection is
in `build-config.yml`; presentation preferences belong in `studio-config.yml`.

```yaml
schemaVersion: 1
resources:
  - path: resources
overrides:
  - kind: resource
    source:
      model: local
      id: example.OptionType#RosettaTypeAlias
    path: resources/option-type-1-0.json
    codeList:
      format: cdm-json
      canonicalUri: http://www.fpml.org/coding-scheme/option-type
      version: 1-0
    provenance:
      model: cdm
      repository: https://github.com/finos/common-domain-model
      release: nightly
      commit: 1704b23907b3dc4b87ba7a0133cb75aad9b43c77
      path: rosetta-source/src/main/resources/codelist/json/option-type-1-0.json
```

`example.OptionType` in this example is a plain string alias. The existing guard
continues to reject arbitrary constrained/parameterized aliases; the adapter does
not erase their Rune conditions. Resource source identity and upstream file origin
are distinct: a local alias may deliberately use a CDM file.

Copy the selected file into the configured resource root and Save it with the
mapping. Source commit information records the copied file's origin, not a
persisted Nightly model pin. Later local edits are captured by the ordinary file
revision/checksum and retain the origin as provenance. No background refresh
replaces edited bytes. Missing/duplicate mappings, invalid data, wrong versions
and incompatible aliases produce availability errors, not unrestricted strings.

Native builds and Studio consume the same captured snapshot and prepared binding
registry. Resources participate in input revisions, Save/readback and repository
file import/export; binary and unadapted files retain their bytes. Saved copies
work offline. Fetching a new upstream file needs GitHub connectivity; no new
resource cache or curated R2 payload format is claimed by this change.

Lists with more than 30 choices use a searchable control. Unknown existing values
remain visible and fail validation. Deprecated values retain their date label and
remain selectable for historical data. Effective/deprecation dates are not
silently compared to the current clock; a business-date rule must be explicit.

The Apache-2.0 option-type fixture under `test/fixtures/third-party/cdm-codelists`
retains upstream payload/license/notice bytes and SHA-256 provenance. It is used
in native-generation and desktop/mobile Prototype tests. Publication of additional
curated artifact families and automatic domain bindings remain open under #645;
these support boundaries must remain visible until those integrations pass.
