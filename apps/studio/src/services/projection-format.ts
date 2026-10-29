// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import type { GeneratedProjection } from '@rune-langium/codegen/export';
import { withInstrumentation } from './instrumentation/core.js';

let pythonFormatter: Promise<typeof import('@wasm-fmt/ruff_fmt')> | undefined;

async function loadPythonFormatter() {
  if (!pythonFormatter) {
    pythonFormatter = (
      import.meta.env.SSR
        ? import('@wasm-fmt/ruff_fmt/node')
        : import('@wasm-fmt/ruff_fmt/vite').then(async (module) => {
            await module.default();
            return module;
          })
    ).catch((error) => {
      pythonFormatter = undefined;
      throw error;
    });
  }
  return pythonFormatter;
}

function unwrapBody(code: string, indent: number): string {
  return code
    .split('\n')
    .slice(1)
    .map((line) => line.slice(indent))
    .join('\n')
    .trimEnd();
}

/** Format only generated display text; wrappers never appear in the editor. */
export const formatGeneratedProjection = withInstrumentation(
  async function formatGeneratedProjection(
    projection: GeneratedProjection,
    kind: 'function' | 'condition'
  ): Promise<GeneratedProjection> {
    const code = projection.code;
    if (!code.trim()) return projection;
    let formatted: string;
    if (projection.language === 'typescript') {
      const [{ format }, typescript, estree] = await Promise.all([
        import('prettier/standalone'),
        import('prettier/plugins/typescript'),
        import('prettier/plugins/estree')
      ]);
      const statements = projection.syntax === 'statements' || (projection.syntax === undefined && kind === 'function');
      // A constructor wrapper accepts Rune's super() spelling without rewriting it.
      const wrapper = statements
        ? `class $Projection extends $Base { constructor() {\n${code}\n} }`
        : `const $projection = ${code};`;
      const result = await format(wrapper, {
        parser: 'typescript',
        plugins: [typescript, estree],
        printWidth: 100,
        tabWidth: 2,
        singleQuote: true,
        arrowParens: 'avoid',
        trailingComma: 'none'
      });
      formatted = statements
        ? unwrapBody(
            result.slice(
              result.indexOf('{', result.indexOf('constructor')) + 1,
              result.lastIndexOf('}', result.lastIndexOf('}') - 1)
            ),
            4
          )
        : result
            .slice(result.indexOf('=') + 1)
            .trim()
            .replace(/;$/, '');
    } else {
      const { format } = await loadPythonFormatter();
      const wrapper =
        kind === 'function'
          ? `def _projection():\n${code
              .split('\n')
              .map((line) => '    ' + line)
              .join('\n')}\n`
          : `_projection = ${code}\n`;
      const result = format(wrapper, 'projection.py', { line_width: 100, indent_width: 4 });
      formatted = kind === 'function' ? unwrapBody(result, 4) : result.slice(result.indexOf('=') + 1).trim();
    }
    return { ...projection, code: formatted };
  },
  { op: 'formatGeneratedProjection' }
);
