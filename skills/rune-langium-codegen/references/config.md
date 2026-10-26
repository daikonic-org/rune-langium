# Configuration

## GeneratePreviewSchemaOptions

Options for `generatePreviewSchemas()`.

`targetId` narrows generation to a single data type / form target. When
omitted, schemas are generated for every data target in the document set;
targets that cannot produce a preview schema are marked as unsupported.

### Properties

#### projectBindings

**Type:** `{ implementationSymbols: { model: string; namespace: string; kind: string; name: string; dispatch?: string }[]; implementationStatus: any; codeList: any; codeListForType: any; validateCode: any; invokeByKey: (key: string, args: readonly unknown[]) => unknown; invoke: any }`

#### targetId

Generate only the schema for this fully-qualified target id.

**Type:** `string`

#### maxDepth

Maximum recursion depth to follow when expanding nested object fields.

**Type:** `number`

## GeneratorOptions

Options for a generation run.
FR-001 (target selection), FR-022 (strict mode).

### Properties

#### projectResources

Prepared resource lookup from the active project, never parsed configuration.

**Type:** `Pick<{ implementationSymbols: { model: string; namespace: string; kind: string; name: string; dispatch?: string }[]; implementationStatus: any; codeList: any; codeListForType: any; validateCode: any; invokeByKey: (key: string, args: readonly unknown[]) => unknown; invoke: any }, "codeListForType">`

#### projectBindings

Host-resolved native bindings. Configuration and executable callbacks never enter generated source.

**Type:** `ReadonlyMap<RosettaFunction, { model: string; namespace: string; kind: string; name: string; dispatch?: string }>`

#### target

Selects the emitter pipeline. Defaults to 'zod'.

**Type:** `Target`

#### strict

If true, any GeneratorDiagnostic with severity 'error' causes
generate() to throw a GeneratorError instead of returning a partial result.
FR-022.

**Type:** `boolean`

#### headerComment

Optional string prepended to each emitted file's header comment.
Do NOT set when requiring byte-identical output (SC-007).

**Type:** `string`

#### namespaces

Optional namespace allowlist (019 spec §5.1/§5.3). When present, only
these namespaces are emitted; everything else in the parsed workspace
is dropped before registry-build + walk. When absent, all namespaces
are emitted (existing behavior — CLI / direct callers see no change).

The caller is responsible for passing a dependency-closed set — the
studio's Download modal computes the transitive closure (§5.2) so
emitted code never references a dropped namespace. A non-closed set
passed directly may produce output with unresolved imports.

**Type:** `readonly string[]`

#### selection

Optional top-level declaration roots for a dependency-closed export.

**Type:** `ExportSelection`

#### zod

**Type:** `{ layout?: "per-namespace" | "barrel" | "single-file" }`

#### typescript

**Type:** `{ layout?: "per-namespace" | "barrel" | "single-file"; inputChecks?: boolean }`

#### json-schema

**Type:** `{ layout?: "per-namespace" | "single-file" }`

#### sql

**Type:** `{ dialect?: "postgres" | "sqlserver"; inheritance?: "single-table" | "table-per-type"; enumStrategy?: "check" | "table"; layout?: "per-namespace" | "single-file" }`

#### markdown

**Type:** `{ layout?: "per-namespace" | "barrel" }`

#### excel

**Type:** `{ sheets: { types: boolean; enums: boolean; typeAliases: boolean; conditions: boolean } }`

#### openapi

**Type:** `{ format?: "json" | "yaml"; crud?: boolean | { types: string[] } }`

## NamespaceEmitterOptions

Options passed to a `NamespaceEmitter` constructor.

Extends `GeneratorOptions` with one Phase-0.5 knob: `suppressBoilerplate`.
When true, the emitter must NOT inline shared runtime helpers (e.g.,
Zod's `runeCheckOneOf`, `runeCount`, `runeAttrExists`) in each per-
namespace output — the wrapping `GenericModelEmitter` emits them once
via the Profile's runtime sidecar instead. Default false; today's
behavior is preserved when this flag is unset.

Emitters that have no runtime helpers (TypeScript, JSON Schema) may
ignore the flag — accepting it is enough to satisfy the contract.

019 spec §3.2.

### Properties

#### suppressBoilerplate

**Type:** `boolean`

#### functionInputs

Validate the adapted function input structure without evaluating Data conditions.

**Type:** `boolean`

#### metadataInputs

Preserve metadata envelopes while retaining ordinary Data condition validation.

**Type:** `boolean`

#### projectResources

Prepared resource lookup from the active project, never parsed configuration.

**Type:** `Pick<{ implementationSymbols: { model: string; namespace: string; kind: string; name: string; dispatch?: string }[]; implementationStatus: any; codeList: any; codeListForType: any; validateCode: any; invokeByKey: (key: string, args: readonly unknown[]) => unknown; invoke: any }, "codeListForType">`

#### projectBindings

Host-resolved native bindings. Configuration and executable callbacks never enter generated source.

**Type:** `ReadonlyMap<RosettaFunction, { model: string; namespace: string; kind: string; name: string; dispatch?: string }>`

#### target

Selects the emitter pipeline. Defaults to 'zod'.

**Type:** `Target`

#### strict

If true, any GeneratorDiagnostic with severity 'error' causes
generate() to throw a GeneratorError instead of returning a partial result.
FR-022.

**Type:** `boolean`

#### headerComment

Optional string prepended to each emitted file's header comment.
Do NOT set when requiring byte-identical output (SC-007).

**Type:** `string`

#### namespaces

Optional namespace allowlist (019 spec §5.1/§5.3). When present, only
these namespaces are emitted; everything else in the parsed workspace
is dropped before registry-build + walk. When absent, all namespaces
are emitted (existing behavior — CLI / direct callers see no change).

The caller is responsible for passing a dependency-closed set — the
studio's Download modal computes the transitive closure (§5.2) so
emitted code never references a dropped namespace. A non-closed set
passed directly may produce output with unresolved imports.

**Type:** `readonly string[]`

#### selection

Optional top-level declaration roots for a dependency-closed export.

**Type:** `ExportSelection`

#### zod

**Type:** `{ layout?: "per-namespace" | "barrel" | "single-file" }`

#### typescript

**Type:** `{ layout?: "per-namespace" | "barrel" | "single-file"; inputChecks?: boolean }`

#### json-schema

**Type:** `{ layout?: "per-namespace" | "single-file" }`

#### sql

**Type:** `{ dialect?: "postgres" | "sqlserver"; inheritance?: "single-table" | "table-per-type"; enumStrategy?: "check" | "table"; layout?: "per-namespace" | "single-file" }`

#### markdown

**Type:** `{ layout?: "per-namespace" | "barrel" }`

#### excel

**Type:** `{ sheets: { types: boolean; enums: boolean; typeAliases: boolean; conditions: boolean } }`

#### openapi

**Type:** `{ format?: "json" | "yaml"; crud?: boolean | { types: string[] } }`

## ZodOptions

## TypescriptOptions

## JsonSchemaOptions

## SqlOptions

## MarkdownOptions

## ExcelOptions