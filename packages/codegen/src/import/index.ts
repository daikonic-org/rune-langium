// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Public API for inbound code generation — `@rune-langium/codegen/import`
 * (spec 021 Phase 2 Addendum's subpath restructure).
 *
 * `importModel(source, options)` is the primary entry point. Phase 1
 * implements `from: 'json-schema'`; Phase 2 adds `from: 'openapi'` (OAS
 * 3.0.x / 3.1, JSON or YAML); Phase 2c adds `from: 'sql'` (tree-sitter,
 * `sql-reader.ts`); Phase 3 adds `from: 'xsd'` (`fast-xml-parser`,
 * `xsd-reader.ts`). The remaining sources named in spec.md's CLI surface
 * (`typescript` | `python`) are follow-up work (US2/US4) and are rejected
 * here with a clear "not yet supported" error, matching the CLI's own
 * error contract (spec.md's CLI Surface section: "the other values error
 * with 'not yet supported'").
 *
 * `importModel` is `async` — `sql-reader.ts`'s `readSql` loads the
 * `web-tree-sitter` WASM grammar (`sql-grammar-loader.ts`), an inherently
 * asynchronous operation; the JSON Schema/OpenAPI/XSD readers remain
 * synchronous internally (`fast-xml-parser` has no async loading step) but
 * are awaited here uniformly so every source shares one entry-point
 * signature.
 *
 * Also re-exports the `SourceModel`/`ConstraintIR` type vocabulary
 * (source-model.ts), import diagnostics (diagnostics.ts), and the CLI's
 * `runImport` action body (cli.ts) — the full inbound public surface the
 * `/import` subpath is required to carry.
 */

import { renderModel } from '../emit/rosetta/rosetta-render-core.js';
import { buildModel } from './ast-builder.js';
import { readJsonSchema } from './sources/json-schema-reader.js';
import { readOpenApi, parseOpenApiDocument } from './sources/openapi-reader.js';
import { readXsd } from './sources/xsd-reader.js';
import type { ImportDiagnostic } from './diagnostics.js';
import type { SourceModel } from './source-model.js';
import type { WasmSource } from './sources/sql-grammar-loader.js';

export { runImport } from './cli.js';
export type { ImportCommandOptions } from './cli.js';
export type { ImportDiagnostic, ImportDiagnosticOpts } from './diagnostics.js';
export { pushDiagnostic } from './diagnostics.js';
export { JsonSchemaImportOptionsSchema } from '../options/json-schema-import-options.js';
export { OpenApiImportOptionsSchema } from '../options/openapi-import-options.js';
export { SqlImportOptionsSchema } from '../options/sql-import-options.js';
export { XsdImportOptionsSchema } from '../options/xsd-import-options.js';
export type {
  SourceKind,
  SourceCardinality,
  Literal,
  ConstraintIR,
  SourceAttribute,
  SourceType,
  SourceEnumValue,
  SourceEnum,
  SourceModel
} from './source-model.js';

export type ImportSourceKind = 'json-schema' | 'openapi' | 'typescript' | 'sql' | 'python' | 'xsd';

export interface ImportOptions {
  from: ImportSourceKind;
  /** Overrides namespace derivation (e.g. from a JSON Schema `$id`). Required for `from: 'sql'` — SQL DDL has no namespace concept of its own to derive from. */
  namespace?: string;
  /** Suppress synonym annotations entirely. Default: emit (MVP round-trip-fidelity default). */
  synonyms?: boolean;
  /** Structural import only — skip expression translation (constraints produce no conditions). Default: translate. */
  conditions?: boolean;
  /**
   * How to handle an untranslatable source construct. Default: `'stub'`
   * (emit a stub condition + diagnostic — the current, and only
   * implemented, behavior). `'skip'`/`'error'` are recorded here as the
   * spec'd CLI surface but not yet implemented by the translation layer —
   * selecting them is rejected with a clear error rather than silently
   * behaving like `'stub'`.
   */
  onUntranslatable?: 'stub' | 'skip' | 'error';
  /** `from: 'sql'` only (spec.md CLI `--sql-dialect`, matching the outbound SQL emitter's `SqlDialectName`). Default: `'postgres'`. */
  sqlDialect?: 'postgres' | 'sqlserver';
  /** `from: 'json-schema' | 'openapi'` only. Default: true (current behavior — import every def regardless of reachability). */
  includeUnreferencedDefs?: boolean;
  /** `from: 'openapi'` only. Default: true (current behavior — always convert paths into funcs). */
  includeOperations?: boolean;
  /** `from: 'xsd'` only. Default: false (current behavior — top-level elements are never their own type). */
  importTopLevelElements?: boolean;
  /**
   * `from: 'sql'` only. Overrides the SQL reader's default `web-tree-sitter`
   * WASM loading (which resolves the grammar from disk via `node:fs` — Node
   * only). Browser callers must fetch `@l1xnan/tree-sitter-sql`'s
   * `tree-sitter-sql.wasm` themselves (e.g. via Vite's `?url` asset
   * convention) and supply the bytes here; omitted, the default Node path
   * is used (CLI/tests, and the only path exercised until this option
   * existed).
   */
  wasmSource?: WasmSource;
}

export interface ImportResult {
  /** The rendered `.rune` source text — guaranteed to parse with zero errors (the inbound hard invariant). */
  text: string;
  model: SourceModel;
  diagnostics: ImportDiagnostic[];
}

const SUPPORTED_SOURCES: ReadonlySet<ImportSourceKind> = new Set(['json-schema', 'openapi', 'sql', 'xsd']);

/**
 * Imports a source-format document into a `.rune` model.
 *
 * @param source - The raw source text: JSON Schema document text for
 *   `from: 'json-schema'`; OpenAPI 3.0.x/3.1 document text (JSON or YAML,
 *   auto-detected) for `from: 'openapi'`; SQL DDL (`CREATE TABLE`
 *   statements) for `from: 'sql'`; an XSD document (a single `xs:schema`
 *   root) for `from: 'xsd'`.
 * @param options - Import options; `from` selects the source reader.
 *   `from: 'sql'` requires `namespace` (SQL DDL has no namespace concept
 *   of its own to derive one from, unlike the other sources' `$id`/
 *   `info.title`/`targetNamespace` fallback).
 */
export async function importModel(source: string, options: ImportOptions): Promise<ImportResult> {
  if (!SUPPORTED_SOURCES.has(options.from)) {
    throw new Error(
      `rune-codegen import: --from '${options.from}' is not yet supported (implemented: 'json-schema', 'openapi', 'sql', 'xsd'; ` +
        `'typescript'/'python' are follow-up work).`
    );
  }
  if (options.onUntranslatable !== undefined && options.onUntranslatable !== 'stub') {
    throw new Error(
      `rune-codegen import: --on-untranslatable '${options.onUntranslatable}' is not yet supported ` +
        `(Phase 1 always stubs an untranslatable construct + emits a diagnostic).`
    );
  }
  if (options.from === 'sql' && options.namespace === undefined) {
    throw new Error(
      `rune-codegen import: --from 'sql' requires --namespace (SQL DDL has no namespace concept of its own to derive one from).`
    );
  }
  if (options.sqlDialect !== undefined && options.sqlDialect !== 'postgres' && options.sqlDialect !== 'sqlserver') {
    throw new Error(
      `rune-codegen import: --sql-dialect '${options.sqlDialect}' is not supported (implemented: 'postgres', 'sqlserver').`
    );
  }

  const readerOptions = {
    ...(options.namespace !== undefined && { namespace: options.namespace }),
    ...(options.conditions === false && { skipConditions: true }),
    ...(options.includeUnreferencedDefs !== undefined && { includeUnreferencedDefs: options.includeUnreferencedDefs }),
    ...(options.includeOperations !== undefined && { includeOperations: options.includeOperations }),
    ...(options.importTopLevelElements !== undefined && { importTopLevelElements: options.importTopLevelElements })
  };

  const { model, diagnostics: readerDiagnostics } = await (options.from === 'sql'
    ? (await import('./sources/sql-reader.js')).readSql(source, {
        namespace: options.namespace!,
        dialect: options.sqlDialect ?? 'postgres',
        ...(options.wasmSource !== undefined && { wasmSource: options.wasmSource }),
        ...readerOptions
      })
    : options.from === 'openapi'
      ? Promise.resolve(readOpenApi(parseOpenApiDocument(source), readerOptions))
      : options.from === 'xsd'
        ? Promise.resolve(readXsd(source, readerOptions))
        : Promise.resolve(readJsonSchema(parseJsonSchemaSource(source) as never, readerOptions)));

  const built = buildModel(model, { emitSynonyms: options.synonyms ?? true });
  const text = renderModel(
    { name: model.namespace, version: '0.0.0', elements: built.elements },
    { declarations: [built.synonymSourceDeclaration, built.operationAnnotationDeclaration] }
  );

  return { text, model, diagnostics: [...readerDiagnostics, ...built.diagnostics] };
}

/** `from: 'json-schema'` only ever accepted strict JSON (spec.md's Source Parser Dependencies table lists YAML as OpenAPI-only, T4's addition) — preserved unchanged here rather than widened to `parseOpenApiDocument`'s JSON-or-YAML auto-detection. */
function parseJsonSchemaSource(source: string): unknown {
  try {
    return JSON.parse(source);
  } catch (err) {
    throw new Error(
      `rune-codegen import: input is not valid JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
