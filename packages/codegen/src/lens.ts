// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Browser-safe entry for the expression language lens.
 *
 * Re-exports ONLY the lens bijection. Must never import `./index.js`,
 * `./generator.js`, or anything under `./emit/excel-emitter.js` — same
 * constraint as `./rosetta.ts`. The TypeScript tree-sitter grammar is
 * loaded lazily and cached by `ts-grammar-loader.ts` (see Task 3) — its
 * `node:fs/promises` usage is confined to that one file's default
 * (Node-side) loading path; callers needing the browser path supply
 * WASM bytes explicitly instead (fetched via `fetch()`).
 */
export type { LanguageLens, LensResult, RefusalReason } from './lens/language-lens.js';
export { isInSubsetS, SUBSET_S_TYPES } from './lens/subset.js';
export type { SubsetSType } from './lens/subset.js';
export { renderTs } from './lens/typescript/render-ts.js';
export { parseTs } from './lens/typescript/parse-ts.js';
export { renderPy } from './lens/python/render-py.js';
export { parsePy } from './lens/python/parse-py.js';
export type { WasmSource } from './lens/typescript/ts-grammar-loader.js';

export { renderSourceTs, parseSourceTs } from './lens/typescript/source-lens.js';
export { renderSourceTypeScriptExpression } from './projection/source-typescript-expression.js';
export type { ProjectionOrigin } from './projection/types.js';
export type { SourceTypeScriptOptions, SourceTypeScriptExpression } from './projection/source-typescript-expression.js';
