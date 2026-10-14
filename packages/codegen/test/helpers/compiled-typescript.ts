// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import ts from 'typescript-classic';
import { expect } from 'vitest';
import type { GeneratorOutput } from '../../src/types.js';
import { generatedDirectory } from './generated-directory.js';

/** Compile the emitted file set and let Node resolve its actual module imports. */
export function compileGeneratedTypeScript<
  T extends Record<string, unknown> = Record<string, (...args: unknown[]) => unknown>
>(outputs: readonly GeneratorOutput[], options: { assertions?: string; entry?: string; checkTypes?: boolean } = {}): T {
  const directory = generatedDirectory(join(tmpdir(), 'rune-generated-ts-'));
  const entry = options.entry ?? outputs[0]!.relativePath;
  const require = createRequire(join(directory, 'entry.js'));
  try {
    const compilerOptions: ts.CompilerOptions = {
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      types: []
    };
    for (const output of outputs) {
      const path = join(directory, output.relativePath);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, output.content + (output.relativePath === entry ? '\n' + (options.assertions ?? '') : ''));
      writeFileSync(
        path.replace(/\.ts$/, '.js'),
        ts.transpileModule(output.content, { compilerOptions: { ...compilerOptions, noEmit: false } }).outputText
      );
    }
    if (options.checkTypes !== false) {
      const program = ts.createProgram(
        outputs.map((output) => join(directory, output.relativePath)),
        compilerOptions
      );
      expect(
        ts.getPreEmitDiagnostics(program).map((error) => ts.flattenDiagnosticMessageText(error.messageText, '\n'))
      ).toEqual([]);
    }
    return require(join(directory, entry.replace(/\.ts$/, '.js')));
  } finally {
    for (const output of outputs) delete require.cache[join(directory, output.relativePath.replace(/\.ts$/, '.js'))];
    rmSync(directory, { recursive: true, force: true });
  }
}
