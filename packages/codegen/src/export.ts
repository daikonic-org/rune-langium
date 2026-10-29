// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * @packageDocumentation
 *
 * Generate TypeScript, Zod, JSON Schema, and form-preview metadata from parsed
 * Rune DSL documents.
 *
 * @remarks
 * Import this API from `@rune-langium/codegen/export`; the package root is empty.
 * Inbound import and Rosetta rendering APIs use separate subpaths.
 *
 * Use `generate()` when you need emitted files for a concrete target, and
 * `generatePreviewSchemas()` when UI tooling needs structured field metadata and
 * source maps for a selected data type. This package expects parsed Langium
 * documents from `@rune-langium/core`.
 */

/**
 * @rune-langium/codegen/export — Outbound code-generation public API.
 *
 * This module is the outbound (Rune → target-language) entry point,
 * imported via the `@rune-langium/codegen/export` subpath (spec 021 Phase 2
 * Addendum's subpath restructure — the outbound surface used to live at
 * the package's main barrel `.`, which is now empty; every consumer of
 * these exports migrates to this subpath). Internal modules
 * (cycle-detector, topo-sort, diagnostics, etc.) are not exported from the
 * public ESM surface here; the package also ships a CLI via `bin`, and the
 * inbound (source → Rune) surface lives at `@rune-langium/codegen/import`.
 *
 * FR-001 (public API surface).
 */

import type { LangiumDocument } from 'langium';
import type { ExportSelection, GeneratorOutput, GeneratorOptions, GeneratePreviewSchemaOptions } from './types.js';
import { runGenerate, IMPLEMENTED_TARGETS } from './generator.js';
import { generatePreviewSchemas as runGeneratePreviewSchemas } from './preview-schema.js';
import { resolveExportSelection, type ResolvedExportSelection } from './selection/declaration-selection.js';

export { IMPLEMENTED_TARGETS };
export {
  NATIVE_IMPLEMENTATIONS,
  resolveNativeImplementation,
  nativeFunctionShape,
  describeNativeFunction
} from './implementations/index.js';
export type {
  NativeFunctionShape,
  NativeParameterShape,
  NativeImplementation,
  NativeImplementationResolution,
  ImplementationLanguage,
  NativeImplementationBody
} from './implementations/index.js';
export { normalizePreviewInputs, adaptPreviewData, projectRuneJsonData } from './preview-schema.js';
export { expandPreviewField, metadataPreviewField, previewTypeSymbol } from './preview-references.js';
export {
  collectDeclarationDependencies,
  declarationKey,
  resolveExportSelection,
  unknownExportSelectionDiagnostics
} from './selection/declaration-selection.js';
export type { ResolvedExportSelection } from './selection/declaration-selection.js';
export { resolveEffectiveProjectTargetId } from './selection/declaration-selection.js';

export type {
  FormPreviewKind,
  FunctionPreviewOutput,
  FormPreviewSchema,
  GeneratePreviewSchemaOptions,
  GeneratorOptions,
  ExportDeclarationSelection,
  ExportSelection,
  GeneratorOutput,
  GeneratorDiagnostic,
  CodeListValue,
  PreviewField,
  PreviewFieldKind,
  PreviewSourceMapEntry,
  SourceMapEntry,
  Target,
  TargetDescriptor,
  GeneratedFunc
} from './types.js';
export { GeneratorError, TARGET_DESCRIPTORS } from './types.js';

// 018 Phase 0 Task 0.2 — whole-model emitter contract + discriminator.
// Re-exported alongside the existing namespace-emitter types so
// downstream packages (the studio's codegen worker, future SQL/Excel/
// Markdown/GraphQL emitter packages) can implement either contract
// without reaching into the package's internals.
export type {
  WholeModelEmitter,
  WholeModelEmitterConstructor,
  NamespaceEmitter,
  NamespaceEmitterConstructor,
  NamespaceEmitterOptions
} from './emit/namespace-emitter.js';
export { isWholeModelEmitter } from './emit/namespace-emitter.js';

// 019 Phase 0.5.1 — LanguageProfile + GenericModelEmitter so future
// emitter authors (Phase 0.5.2 Zod, 0.5.3 TypeScript, 0.5.4 JSON Schema,
// Phase 2 SQL/Markdown) can register their per-target metadata without
// reaching into the package's internals.
export type { LanguageProfile } from './emit/language-profile.js';
export { GenericModelEmitter } from './emit/generic-model-emitter.js';

// Per-target option blocks (019 spec §3.1).
export type { ZodOptions, TypescriptOptions, JsonSchemaOptions, SqlOptions, MarkdownOptions } from './types.js';

// Excel option block — Zod schema is the source of truth (the studio's
// Download config modal renders it via @zod-to-form). 019 spec §5.1.
export { ExcelOptionsSchema, resolveExcelSheets } from './options/excel-options.js';
export type { ExcelOptions, ExcelSheetToggles } from './options/excel-options.js';

export type { RuneTypeAlias, Condition, TypeParam } from './types/type-alias.js';
export type { RuneRule } from './types/rule.js';
export type { RuneReport } from './types/report.js';
export type { RuneAnnotationDecl, AnnotationAttribute } from './types/annotation.js';
export type { RuneLibraryFunc, LibraryFuncParam } from './types/library-func.js';
export type { NamespaceManifest, NamespaceRegistry } from './emit/namespace-registry.js';
export { RUNTIME_HELPER_JS_SOURCE } from './helpers.js';

/**
 * Generate code from one or more parsed Langium documents.
 *
 * This is the primary entry point for the code generator. It accepts
 * a single document or an array of documents and normalizes them before
 * passing to the internal generator pipeline.
 *
 * @param documents - One or more parsed Langium documents with resolved ASTs.
 * @param options - Optional generator options (target, strict, headerComment).
 * @returns Array of GeneratorOutput sorted by relativePath ascending.
 * @throws GeneratorError when strict mode is enabled and any error diagnostic is produced.
 *
 * @example
 * ```ts
 * import { generate } from '@rune-langium/codegen/export';
 * const outputs = await generate(doc, { target: 'zod' });
 * ```
 */
export async function generate(
  documents: LangiumDocument | LangiumDocument[],
  options?: GeneratorOptions
): Promise<GeneratorOutput[]> {
  const docs = Array.isArray(documents) ? documents : [documents];
  return runGenerate(docs, options ?? {});
}

/** Files and the dependency-closed receipt produced by a selected export. */
export interface SelectedGeneration {
  outputs: GeneratorOutput[];
  selection: ResolvedExportSelection;
}

/**
 * Generate a declaration-scoped export and return the exact selection receipt
 * used by generation. This lets callers present or archive the dependency
 * closure without resolving the source workspace a second time.
 */
export async function generateSelected(
  documents: LangiumDocument | LangiumDocument[],
  selection: ExportSelection,
  options?: Omit<GeneratorOptions, 'selection'>
): Promise<SelectedGeneration> {
  const docs = Array.isArray(documents) ? documents : [documents];
  const resolvedSelection = resolveExportSelection(docs, selection);
  const outputs = await runGenerate(docs, { ...options, selection }, resolvedSelection);
  return { outputs, selection: resolvedSelection };
}

/**
 * Generate structured form-preview schemas from one or more parsed Langium documents.
 *
 * The returned schemas preserve field metadata and source-map information so
 * Studio can render an inspector/form preview and navigate back to source.
 *
 * @param documents - One or more parsed Langium documents with resolved ASTs.
 * @param options - Optional preview generation options such as `targetId` and `maxDepth`.
 * @returns Array of `FormPreviewSchema` objects sorted by target id.
 */
export function generatePreviewSchemas(
  documents: LangiumDocument | LangiumDocument[],
  options?: GeneratePreviewSchemaOptions
) {
  return runGeneratePreviewSchemas(documents, options);
}

export { emitStandaloneZodSchema } from './emit/standalone-schema.js';

export { selectTypeScriptProjection } from './projection/typescript.js';
export {
  createPythonProjectionContext,
  projectPythonFunction,
  projectPythonCondition,
  generatePythonModule,
  selectPythonProjection
} from './projection/python-functions.js';
export { projectPythonExpression } from './projection/python.js';
export type { PythonModule } from './projection/python-functions.js';
export type { PythonProjectionContext } from './projection/context.js';
export type { GeneratedProjection, ProjectionSubject, EmittedProjection } from './projection/types.js';

export type { TemporalWireFormat } from './expr/temporal-conversions.js';

export {
  validateTargetOptions,
  getGeneratorCapabilities,
  getTargetLayouts,
  TARGET_OPTIONS_SCHEMAS
} from './options/target-options.js';

export * from './runtime/project-bindings.js';

export { renderCodeListEnum } from './runtime/code-list-enum.js';
export { getTargetRelativePath } from './emit/namespace-walker.js';
