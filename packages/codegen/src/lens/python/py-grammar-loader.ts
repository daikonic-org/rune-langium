// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { createGrammarLoader } from '../grammar-loader.js';
export type { WasmSource } from '../grammar-loader.js';

const grammar = createGrammarLoader('tree-sitter-python.wasm');

/** Load the python grammar, cached by source reference. */
export const loadPyGrammar = grammar.loadGrammar;
/** Create an independent parser using the cached python language. */
export const createPyParser = grammar.createParser;
