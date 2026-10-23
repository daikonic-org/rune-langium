// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import type { EmittedProjection } from './projection/types.js';
import type { TemporalWireFormat } from './expr/temporal-conversions.js';
import type {
  ZodOptions,
  TypescriptOptions,
  JsonSchemaOptions,
  SqlOptions,
  MarkdownOptions
} from './options/target-options-schema.js';
import type { ExcelOptions } from './options/excel-options.js';
import type { OpenApiOptions } from './options/openapi-options.js';

/**
 * Supported generator targets.
 * - `zod`         — FR-002–FR-014 (US1, per-namespace)
 * - `json-schema` — FR-019 (per-namespace)
 * - `typescript`  — FR-020 (per-namespace; includes `func` emission)
 * - `sql`         — 018 Phase 2 (per-namespace DDL emitter)
 * - `markdown`    — 018 Phase 2 (per-namespace docs emitter)
 * - `excel`       — 018 Phase 1 (whole-model binary emitter, .xlsx)
 * - `graphql`     — 018 Phase 3 (whole-model SDL emitter)
 * - `openapi`     — 021 Phase 2b (per-namespace; OAS 3.1, composes the
 *                   JSON Schema emitter's own output + adds constraint
 *                   keywords, funcs→operations, optional CRUD paths)
 * - `xsd`         — 021 Phase 3 (per-namespace; W3C XML Schema documents,
 *                   a from-scratch emitter symmetric to the inbound XSD
 *                   reader — no func/operation emission, XSD has no RPC
 *                   verb model)
 *
 * The authoritative contract for each target is `TARGET_DESCRIPTORS[target].contract`;
 * Copilot review on PR #165 caught that this header comment originally listed
 * sql/markdown as whole-model, which contradicted the registry.
 *
 * Each target dispatches through one of two emitter contracts:
 *   - NamespaceEmitter (current): one output file per namespace.
 *   - WholeModelEmitter (018 Task 0.2): one output for the whole model.
 *
 * Task 0.4 wires the dispatch.
 */
export type Target =
  | 'zod'
  | 'json-schema'
  | 'typescript'
  | 'sql'
  | 'markdown'
  | 'excel'
  | 'graphql'
  | 'openapi'
  | 'xsd';

/**
 * Per-target option blocks (019 spec §3.1). Each block carries
 * target-specific knobs — `layout` selects per-namespace vs whole-model
 * emission; per-target enums like SQL `dialect` and `inheritance`
 * stay nested under their own block.
 */
export type {
  ZodOptions,
  TypescriptOptions,
  JsonSchemaOptions,
  SqlOptions,
  MarkdownOptions
} from './options/target-options-schema.js';

/**
 * Options for a generation run.
 * FR-001 (target selection), FR-022 (strict mode).
 */
export interface GeneratorOptions {
  /** Selects the emitter pipeline. Defaults to 'zod'. */
  target?: Target;
  /**
   * If true, any GeneratorDiagnostic with severity 'error' causes
   * generate() to throw a GeneratorError instead of returning a partial result.
   * FR-022.
   */
  strict?: boolean;
  /**
   * Optional string prepended to each emitted file's header comment.
   * Do NOT set when requiring byte-identical output (SC-007).
   */
  headerComment?: string;
  /**
   * Optional namespace allowlist (019 spec §5.1/§5.3). When present, only
   * these namespaces are emitted; everything else in the parsed workspace
   * is dropped before registry-build + walk. When absent, all namespaces
   * are emitted (existing behavior — CLI / direct callers see no change).
   *
   * The caller is responsible for passing a dependency-closed set — the
   * studio's Download modal computes the transitive closure (§5.2) so
   * emitted code never references a dropped namespace. A non-closed set
   * passed directly may produce output with unresolved imports.
   */
  namespaces?: readonly string[];
  /** Optional top-level declaration roots for a dependency-closed export. */
  selection?: ExportSelection;

  // 019 spec §3.1 — per-target option blocks. Each emitter reads its
  // own slot. TS structural typing narrows access via `options[target]`
  // when callers know the target ahead of time.
  zod?: ZodOptions;
  typescript?: TypescriptOptions;
  'json-schema'?: JsonSchemaOptions;
  sql?: SqlOptions;
  markdown?: MarkdownOptions;
  // Excel is the first option block defined by a Zod schema (the modal
  // renders it via @zod-to-form). `ExcelOptions` is inferred from
  // `ExcelOptionsSchema` in ./options/excel-options.ts.
  excel?: ExcelOptions;
  // 021 Phase 2b — OpenAPI emitter options (format + opt-in CRUD
  // generation). `OpenApiOptions` is inferred from `OpenApiOptionsSchema`
  // in ./options/openapi-options.ts, same Zod-schema-as-SSoT pattern as Excel.
  openapi?: OpenApiOptions;
  // 021 Phase 3 — no per-target option block yet; the XSD emitter has no
  // configurable knobs (unlike Excel/OpenAPI's Zod-schema option blocks).
}

/** Serializable identity for a selected top-level Rune declaration. */
export interface ExportDeclarationSelection {
  namespace: string;
  name: string;
  kind: string;
}

/** Namespace and declaration roots requested for an export. */
export interface ExportSelection {
  /** Namespaces whose declarations are all export roots. */
  namespaces: readonly string[];
  /** Individual declaration roots, combined with whole selected namespaces. */
  declarations: readonly ExportDeclarationSelection[];
}

/**
 * One source-map entry: maps an output line back to a source location.
 * FR-024 (source maps).
 */
export interface SourceMapEntry {
  /** Output line number (zero-based). */
  outputLine: number;
  /** URI of the source Rune document. */
  sourceUri: string;
  /** Source line number (one-based). */
  sourceLine: number;
  /** Source character offset (one-based). */
  sourceChar: number;
}

/**
 * A generator-time diagnostic (not a Langium validation diagnostic).
 * FR-025 (diagnostics).
 */
export interface GeneratorDiagnostic {
  /** Severity of the diagnostic. */
  severity: 'error' | 'warning' | 'info';
  /** Human-readable message describing the issue. */
  message: string;
  /** Short diagnostic code (e.g. 'unresolved-ref', 'unknown-attribute'). */
  code: string;
  /** Source URI where the issue was detected, if known. */
  sourceUri?: string;
  /** Source line (one-based), if known. */
  line?: number;
  /** Source character offset (one-based), if known. */
  char?: number;
}

/**
 * Metadata for a single emitted Rune `func` (TypeScript target only).
 * FR-028–FR-032 (function declarations, US6).
 */
export interface GeneratedFunc {
  /** Rune input names in positional API order; used by named form adapters. */
  parameterNames: string[];
  /** Generated precondition-only export, when inputChecks is enabled. */
  inputCheckExportName?: string;
  /** Actual module export when the Rune name collides with a type declaration. */
  exportName?: string;
  /** The func's identifier as declared in the Rune model. */
  name: string;
  /**
   * The relative output path of the module file containing this func
   * (same as the enclosing GeneratorOutput.relativePath).
   */
  relativePath: string;
  /**
   * The full text of just the emitted function declaration (subset of
   * GeneratorOutput.content). Useful for unit-testing the emitter in
   * isolation without parsing the full file.
   */
  fileContents: string;
  /**
   * Source-map entries scoped to this function's output lines.
   * A subset of the enclosing GeneratorOutput.sourceMap.
   */
  sourceMap: SourceMapEntry[];
}

/**
 * One emitted output file from the generator.
 * FR-001 (output structure).
 */
export interface GeneratorOutput {
  /** Shared companion files follow model files in previews and downloads. */
  artifactRole?: 'support';
  /** Source-bound implementation fragments recorded by the target emitter. */
  projections?: EmittedProjection[];
  /** Relative path of the emitted file (e.g. 'cdm/base/math.zod.ts'). */
  relativePath: string;
  /** Full text content of the emitted file. */
  content: string;
  /** Source-map entries for this file. */
  sourceMap: SourceMapEntry[];
  /** Diagnostics produced during generation of this file. */
  diagnostics: GeneratorDiagnostic[];
  /**
   * Emitted function declarations for this namespace.
   * Non-empty only when target === 'typescript' (FR-028, FR-031).
   * Empty array for 'zod' and 'json-schema' targets — funcs are silently
   * skipped (FR-031).
   */
  funcs: GeneratedFunc[];
  /**
   * Optional binary payload (018 Task 0.1). When present, `content` may
   * be empty and consumers should prefer `binary` for I/O — e.g. the
   * Excel target emits a single `.xlsx` workbook as raw bytes, not text.
   */
  binary?: Uint8Array;
  /**
   * Optional MIME type hint for the output (018 Task 0.1). Used by
   * download UIs and file writers to set Content-Type correctly. The
   * three text targets ('zod', 'typescript', 'json-schema') omit this
   * and rely on file-extension inference upstream.
   */
  mimeType?: string;
}

export type PreviewFieldKind = 'string' | 'number' | 'boolean' | 'enum' | 'object' | 'array' | 'unknown';

export interface PreviewFieldBase {
  /** Kind-qualified declared Rune type identity for presentation preferences. */
  typeSymbol?: string;
  path: string;
  label: string;
  required: boolean;
  cardinality?: { min?: number; max?: number | 'unbounded' };
  description?: string;
}

export interface PreviewScalarField extends PreviewFieldBase {
  kind: 'string' | 'number' | 'boolean';
  /** Canonical ISO wire format; form values remain strings. */
  format?: TemporalWireFormat;
}

export interface PreviewEnumField extends PreviewFieldBase {
  kind: 'enum';
  enumValues: Array<{ value: string; label: string }>;
}

export interface PreviewObjectField extends PreviewFieldBase {
  kind: 'object';
  /** Deferred body in FormPreviewSchema.definitions; expand one level on demand. */
  definitionId?: string;
  /** Fully-qualified Rune type resolved for this object input. */
  referencedTypeFqn?: string;
  /** Fully-qualified concrete types assignable to this reference. */
  assignableTypeFqns?: string[];
  children: PreviewField[];
  /**
   * `children[].path` values that are Choice-ancestor-derived arms requiring
   * "exactly one present" enforcement, for a NESTED object field expanded
   * from a Data-extends-Choice / typeAlias-extends-Choice reference (e.g.
   * `Trade.constituent: BasketConstituent` where `BasketConstituent extends
   * Observable`). Mirrors `FormPreviewSchema.choiceArmPaths` — see that
   * field's doc comment for the full rationale — but scoped to this
   * object's own children instead of the schema root. Omitted (not an
   * empty array) when there's no Choice ancestor.
   */
  choiceArmPaths?: string[];
}

export interface PreviewArrayField extends PreviewFieldBase {
  kind: 'array';
  children: [PreviewField];
}

export interface PreviewUnknownField extends PreviewFieldBase {
  kind: 'unknown';
}

export type PreviewField =
  | PreviewScalarField
  | PreviewEnumField
  | PreviewObjectField
  | PreviewArrayField
  | PreviewUnknownField;

export interface PreviewSourceMapEntry {
  fieldPath: string;
  sourceUri: string;
  sourceLine: number;
  sourceChar: number;
}

export type FormPreviewKind = 'data' | 'typeAlias' | 'choice' | 'function';

/** The declared result identity for a function preview schema. */
export interface FunctionPreviewOutput {
  typeFqn: string;
  kind: 'data' | 'choice';
  cardinality: { min: number; max: number | 'unbounded' };
}

export interface FormPreviewSchema {
  schemaVersion: 1;
  targetId: string;
  title: string;
  kind?: FormPreviewKind;
  status: 'ready' | 'unsupported';
  fields: PreviewField[];
  /** Finite, namespace-qualified bodies for recursive and deep object fields. */
  definitions?: Record<string, Pick<FormPreviewSchema, 'fields' | 'choiceArmPaths' | 'sourceMap'>>;
  /**
   * The resolved result type for a function. This remains available when the
   * function belongs to a lazily hydrated curated bundle instead of the local
   * workspace model list.
   */
  functionOutput?: FunctionPreviewOutput;
  /** Execution capability from the same normalized function facts used by the emitter. */
  executionUnavailable?: string;
  /** Declared output field, including scalar results and the Rune return name. */
  result?: PreviewField;
  unsupportedFeatures?: string[];
  sourceMap?: PreviewSourceMapEntry[];
  /**
   * `fields[].path` values that are Choice-ancestor-derived arms requiring
   * "exactly one present" enforcement (a Data-extends-Choice or
   * typeAlias-extends-Choice schema's own top-level `kind` stays
   * `undefined`/`'typeAlias'` — only a genuine `choice`-kind schema's
   * `kind` is `'choice'` — so this field is what lets a consumer like
   * `validatePreviewSample` generalize the enforcement without relying on
   * `kind`). Omitted (not an empty array) when there's no Choice ancestor.
   */
  choiceArmPaths?: string[];
}

/**
 * Options for `generatePreviewSchemas()`.
 *
 * `targetId` narrows generation to a single data type / form target. When
 * omitted, schemas are generated for every data target in the document set;
 * targets that cannot produce a preview schema are marked as unsupported.
 */
export interface GeneratePreviewSchemaOptions {
  /** Generate only the schema for this fully-qualified target id. */
  targetId?: string;
  /** Maximum recursion depth to follow when expanding nested object fields. */
  maxDepth?: number;
}

/**
 * Static descriptor for a generator target. Single source of truth used
 * by UI surfaces (the studio targets table — 018 Task 0.7) to render
 * labels + decide between Preview / Download affordances. The runtime
 * `contract` mirrors which emitter interface the target implements
 * (`NamespaceEmitter` vs `WholeModelEmitter` — see Task 0.2).
 *
 * @see TARGET_DESCRIPTORS for the registry of all seven targets.
 */
export type TargetDescriptor = {
  /** Human-facing name (rendered in the studio targets table). */
  label: string;
  /** Which emitter contract this target implements. */
  contract: 'namespace' | 'whole-model';
  /** Short description for UI tooltips and downloads. */
  desc: string;
  /** File extension applied by `getTargetRelativePath`. */
  extension: string;
  /**
   * Optional MIME type. Required for whole-model binary targets where
   * file-extension inference isn't enough; omitted for text targets
   * (consumers fall back to extension-based detection).
   */
  mimeType?: string;
};

/**
 * Registry of all generator targets. The studio reads this to render
 * the targets table; `runGenerate` reads it to pick the dispatch path.
 * Keep in sync with the {@link Target} union — TS exhaustiveness check
 * on `Record<Target, ...>` enforces this at compile time.
 *
 * 018 Phase 0 Task 0.3. Phases 1-3 add the missing emitter
 * implementations; this registry is the contract those phases land
 * against.
 */
export const TARGET_DESCRIPTORS: Record<Target, TargetDescriptor> = {
  zod: {
    label: 'Zod',
    contract: 'namespace',
    desc: 'Runtime validation schemas',
    extension: '.zod.ts'
  },
  typescript: {
    label: 'TypeScript',
    contract: 'namespace',
    desc: 'Type-only interfaces',
    extension: '.ts'
  },
  'json-schema': {
    label: 'JSON Schema',
    contract: 'namespace',
    desc: 'Draft 2020-12 schema documents',
    extension: '.schema.json'
  },
  sql: {
    label: 'SQL',
    contract: 'namespace',
    desc: 'DDL (Postgres / SQL Server)',
    extension: '.sql'
  },
  markdown: {
    label: 'Markdown',
    contract: 'namespace',
    desc: 'Reference documentation',
    extension: '.md'
  },
  excel: {
    label: 'Excel',
    contract: 'whole-model',
    desc: 'Data dictionary workbook',
    extension: '.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  },
  graphql: {
    label: 'GraphQL SDL',
    contract: 'whole-model',
    desc: 'Schema definition language',
    extension: '.graphql',
    mimeType: 'application/graphql'
  },
  openapi: {
    label: 'OpenAPI',
    contract: 'namespace',
    desc: 'OAS 3.1 document (schemas + func operations)',
    // Default extension; the emitter overrides per-output relativePath
    // to `.openapi.yaml` ONLY when `options.openapi.format === 'yaml'` —
    // CORRECTED (review finding): there is no output-path override in the
    // generator API to derive a format from an explicit `.yaml`/`.yml`
    // request; `options.openapi.format` is the sole selector. See
    // openapi-emitter.ts's `resolveFormat`.
    extension: '.openapi.json'
  },
  xsd: {
    label: 'XSD',
    contract: 'namespace',
    desc: 'W3C XML Schema document (types, enums, constraints)',
    extension: '.xsd'
  }
};

/**
 * Thrown when strict mode is enabled and any error diagnostic is produced.
 * FR-022.
 */
export class GeneratorError extends Error {
  /** The diagnostics that caused this error. */
  readonly diagnostics: GeneratorDiagnostic[];

  constructor(message: string, diagnostics: GeneratorDiagnostic[]) {
    super(message);
    this.name = 'GeneratorError';
    this.diagnostics = diagnostics;
  }
}
