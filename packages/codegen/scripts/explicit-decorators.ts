// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { createRequire } from 'node:module';

const ts = createRequire(import.meta.url)('typescript-classic') as typeof import('typescript-classic');
const DECORATOR_USAGE_RE = /@(?:instrument|trace|debug|info|warn)\(/;

/** Lower only the existing explicit instrumentation decorators for supported runtimes. */
export function lowerExplicitDecorators(code: string, id: string) {
  if (!id.endsWith('.ts') || !DECORATOR_USAGE_RE.test(code)) return null;
  const { outputText, sourceMapText } = ts.transpileModule(code, {
    fileName: id,
    compilerOptions: {
      target: ts.ScriptTarget.ES2025,
      module: ts.ModuleKind.ESNext,
      sourceMap: true,
      verbatimModuleSyntax: true
    }
  });
  return { code: outputText, map: sourceMapText ? JSON.parse(sourceMapText) : null };
}
