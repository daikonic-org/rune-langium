// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { Language, Parser } from 'web-tree-sitter';

/** Grammar bytes in browsers, or an optional filesystem path in Node. */
export type WasmSource = Uint8Array | string;

/** One last-source cache per grammar; equal bytes in different objects still reload. */
export function createGrammarLoader(wasmFile: string): {
  loadGrammar(source?: WasmSource): Promise<Language>;
  createParser(source?: WasmSource): Promise<Parser>;
} {
  let cachedLanguage: Language | undefined;
  let cachedSource: WasmSource | undefined;

  async function loadGrammar(source?: WasmSource): Promise<Language> {
    if (cachedLanguage && source === cachedSource) return cachedLanguage;
    await Parser.init();
    const bytes = source instanceof Uint8Array ? source : await readWasmBytes(source, wasmFile);
    const language = await Language.load(bytes);
    cachedLanguage = language;
    cachedSource = source;
    return language;
  }

  async function createParser(source?: WasmSource): Promise<Parser> {
    const language = await loadGrammar(source);
    const parser = new Parser();
    parser.setLanguage(language);
    return parser;
  }

  return { loadGrammar, createParser };
}

async function readWasmBytes(pathOverride: string | undefined, wasmFile: string): Promise<Uint8Array> {
  // Keep Node builtins lazy: browser callers supply bytes and never enter this branch.
  let path = pathOverride;
  if (path === undefined) {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    path = require.resolve('@vscode/tree-sitter-wasm/package.json').replace(/package\.json$/, `wasm/${wasmFile}`);
  }
  const { readFile } = await import('node:fs/promises');
  const buf = await readFile(path);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}
