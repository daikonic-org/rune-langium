// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * @packageDocumentation
 *
 * Parse `.rosetta` source into typed ASTs, build cross-file workspaces, and
 * serialize models back to source text.
 *
 * @remarks
 * Use `parse()` for a single self-contained document, `parseWorkspace()` when
 * files reference each other, and `createRuneDslServices()` when you need raw
 * Langium services for custom tooling. The serializer exports are best for
 * AST-driven workflows, tests, and code transformations that do not need to
 * preserve original formatting.
 */

// Core AST surface + namespace-merged domain ops, from a single barrel.
// domain.ts re-exports everything from ast.ts (interfaces, type guards, reflection,
// terminals, union types) and adds a merged `namespace` per member-container type, so
// `Data` is both the interface type AND the ops namespace: Data.getAttributes(node), etc.
export * from './generated/domain.js';

// Parse API
export { parse, parseWorkspace } from './api/parse.js';
export type { ParseResult } from './api/parse.js';
export { parseExpression } from './api/parse-expression.js';
export type { ExpressionParseResult } from './api/parse-expression.js';

// Shared language resources
export { BASE_TYPE_FILES, BASICTYPES_ROSETTA, ANNOTATIONS_ROSETTA } from './stdlib/base-types.js';
export { addLegacyAnnotations } from './stdlib/legacy-annotations.js';

// Services
export { createRuneDslServices, RuneDslModule, RuneDslSharedModule } from './services/rune-dsl-module.js';
export type { RuneDslServices } from './services/rune-dsl-module.js';
export { RuneDslIndexManager } from './services/rune-dsl-index-manager.js';
export { RuneDslLinker } from './services/rune-dsl-linker.js';
export type { DeferredModelProvider } from './services/rune-dsl-linker.js';
export { RuneDslScopeProvider } from './services/rune-dsl-scope-provider.js';
export { RuneDslValidator } from './services/rune-dsl-validator.js';
export { RuneStoreHydrator } from './services/rune-store-hydrator.js';
export { RuneDslParser, createRuneDslParser, insertImplicitBrackets } from './services/rune-dsl-parser.js';

// Generated module essentials — needed for LSP server integration
export { RuneDslLanguageMetaData } from './generated/module.js';
export { RuneDslGeneratedModule, RuneDslGeneratedSharedModule } from './generated/module.js';

// Domain substrate
export type { Dehydrated } from './serializer/dehydrated.js';

// Source adapters
export { parsedAdapter } from './adapters/parsed-adapter.js';
export { curatedAdapter } from './adapters/curated-adapter.js';

// Serializer
export {
  compactLspModelJson,
  readLspModelMetadata,
  LSP_MODEL_SYNC_METHOD,
  LSP_REQUEST_TIMEOUT_MS
} from './serializer/lsp-model.js';
export type { LspModelUpdate } from './serializer/lsp-model.js';
export { RUNE_SERIALIZE_OPTIONS, runeBigIntReplacer, serializeRuneModel } from './serializer/rune-serialize.js';
export { preserveCstText } from './serializer/preserve-cst-text.js';
export {
  deserializeRuneModel,
  hydrateModelDocument,
  hydrateModelDocuments
} from './serializer/hydrate-model-document.js';
export type { HydrateServices, HydrateOptions } from './serializer/hydrate-model-document.js';

// Utility functions
export {
  getNodeSourceRegion,
  getFunctionImplementationRegion,
  getExpressionRegions,
  findExpressionOwner,
  getExpressionOwners
} from './utils/source-regions.js';
export type { SourceRegion, ExpressionRegion } from './utils/source-regions.js';
export { isOptional, isSingular, isPlural, isRequired, toConstraintString } from './utils/cardinality-utils.js';
export {
  getOptions,
  getEffectiveConditions,
  getChoiceOptionPaths,
  choiceOptionFieldName
} from './utils/choice-utils.js';
export { assertValidDocuments } from './serializer/assert-valid-documents.js';
export {
  hasGeneratedInput,
  setGeneratedInputIfAbsent,
  getFunctionSignature,
  getOperationArgument,
  resolveOperationType,
  type IntrinsicTypeName,
  resolveTypeAliases,
  getFunctionInputs,
  getFunctionOutput
} from './utils/expression-utils.js';

// Structural analysis (spec 2026-05-14 §5.2 — cross-namespace dep graph)
export {
  getElementNamespace,
  collectNamespaceDependencies,
  closeNamespaceDependencies
} from './analysis/cross-namespace-refs.js';

// Naming utilities
export { qualifiedExportPath } from './naming/qualified-export-path.js';
export { namespaceFromSource, namespaceFromModelName } from './naming/namespace.js';

// Collection utilities
export { indexById, fromIndex } from './collections/index-by-id.js';

export { getEnumValues } from './utils/enum-utils.js';

export { getExpressionScope } from './utils/expression-scope.js';
export type { ExpressionScopeEntry } from './utils/expression-scope.js';

export { getSourceComments } from './api/source-comments.js';
export type { SourceComment } from './api/source-comments.js';

export { getAnnotationDefinitions } from './api/annotation-definitions.js';
export type { AnnotationDefinitionIdentity } from './api/annotation-definitions.js';

export { buildImportAliasMap, importAliasCandidates } from './naming/import-aliases.js';
export type { NamespaceImport } from './naming/import-aliases.js';
