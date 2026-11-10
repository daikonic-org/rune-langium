// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import ts from 'typescript-classic';
import { expect } from 'vitest';
import type { GeneratorOutput } from '../../src/types.js';
import { generatedDirectory } from './generated-directory.js';

/** Strict generated-module checks share the ESNext host, without ambient test/browser libraries. */
export function generatedTypeScriptCompilerOptions(overrides: ts.CompilerOptions = {}): ts.CompilerOptions {
  return {
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ESNext,
    lib: ['lib.esnext.d.ts'],
    types: [],
    ...overrides
  };
}

/** Node cannot execute standard decorators yet; lower only modules that contain them. */
export function transpileGeneratedTypeScript(source: string, module = ts.ModuleKind.CommonJS): string {
  const file = ts.createSourceFile('generated.ts', source, ts.ScriptTarget.ESNext, true);
  const decorated = (node: ts.Node): boolean =>
    (ts.canHaveDecorators(node) && !!ts.getDecorators(node)?.length) || !!ts.forEachChild(node, decorated);
  return ts.transpileModule(source, {
    compilerOptions: {
      target: decorated(file) ? ts.ScriptTarget.ES2025 : ts.ScriptTarget.ESNext,
      module
    }
  }).outputText;
}

/** Use the workspace compiler for strict checks of large generated dependency closures. */
function checkWithWorkspaceCompiler(directory: string, files: readonly string[], options: ts.CompilerOptions): void {
  const config = join(directory, 'tsconfig.json');
  const { strict, skipLibCheck, types, erasableSyntaxOnly } = options;
  writeFileSync(
    config,
    JSON.stringify({
      compilerOptions: {
        target: 'ESNext',
        module: 'Node16',
        lib: ['ESNext'],
        strict,
        skipLibCheck,
        types,
        erasableSyntaxOnly,
        noEmit: true
      },
      files
    })
  );
  const compilerPackage = createRequire(import.meta.url).resolve('typescript/package.json');
  const compiler = join(dirname(compilerPackage), 'bin', 'tsc');
  const result = spawnSync(process.execPath, [compiler, '-p', config], { encoding: 'utf8' });
  if (result.error) throw result.error;
  expect(result.status, result.stdout + result.stderr).toBe(0);
}

/** Compile the emitted file set and let Node resolve its actual module imports. */
export function compileGeneratedTypeScript<
  T extends Record<string, unknown> = Record<string, (...args: unknown[]) => unknown>
>(
  outputs: readonly GeneratorOutput[],
  options: {
    assertions?: string;
    entry?: string;
    checkTypes?: boolean | 'workspace';
    erasableSyntaxOnly?: boolean;
  } = {}
): T {
  const directory = generatedDirectory(join(tmpdir(), 'rune-generated-ts-'));
  const entry = options.entry ?? outputs[0]!.relativePath;
  const require = createRequire(join(directory, 'entry.js'));
  try {
    const compilerOptions = generatedTypeScriptCompilerOptions({
      module: ts.ModuleKind.CommonJS,
      erasableSyntaxOnly: options.erasableSyntaxOnly
    });
    for (const output of outputs) {
      const path = join(directory, output.relativePath);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, output.content + (output.relativePath === entry ? '\n' + (options.assertions ?? '') : ''));
      writeFileSync(path.replace(/\.ts$/, '.js'), transpileGeneratedTypeScript(output.content));
    }
    if (options.checkTypes === 'workspace') {
      checkWithWorkspaceCompiler(
        directory,
        outputs.map((output) => output.relativePath),
        compilerOptions
      );
    } else if (options.checkTypes !== false) {
      const program = ts.createProgram(
        outputs.map((output) => join(directory, output.relativePath)),
        compilerOptions
      );
      expect(
        ts.getPreEmitDiagnostics(program).map((error) => {
          const position =
            error.file && error.start !== undefined ? error.file.getLineAndCharacterOfPosition(error.start) : undefined;
          return `${position ? `${error.file!.fileName}:${position.line + 1}: ` : ''}${ts.flattenDiagnosticMessageText(error.messageText, '\n')}${position ? ` [${error.file!.text.split('\n')[position.line]?.trim()}]` : ''}`;
        })
      ).toEqual([]);
    }
    return require(join(directory, entry.replace(/\.ts$/, '.js')));
  } finally {
    for (const output of outputs) delete require.cache[join(directory, output.relativePath.replace(/\.ts$/, '.js'))];
    rmSync(directory, { recursive: true, force: true });
  }
}
