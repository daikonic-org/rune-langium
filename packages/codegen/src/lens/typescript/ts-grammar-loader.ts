// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { createGrammarLoader } from '../grammar-loader.js';
export type { WasmSource } from '../grammar-loader.js';

const grammar = createGrammarLoader('tree-sitter-typescript.wasm');

/** Load the typescript grammar, cached by source reference. */
export const loadTsGrammar = grammar.loadGrammar;
/** Create an independent parser using the cached typescript language. */
export const createTsParser = grammar.createParser;
