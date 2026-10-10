// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import type { LangiumDocument } from 'langium';
import { Temporal } from '@js-temporal/polyfill';
import { z } from 'zod';
import ts from 'typescript-classic';
import { emitStandaloneZodSchema } from '../../src/emit/standalone-schema.js';
import { normalizePreviewInputs } from '../../src/preview-schema.js';
import { RUNTIME_HELPER_JS_SOURCE } from '../../src/helpers.js';

/** Exercise the same ISO/metadata boundary as Studio before calling typed generated functions. */
export function functionInputs(
  documents: LangiumDocument[],
  targetId: string,
  inputs: Record<string, unknown>
): Record<string, unknown> {
  const result = emitStandaloneZodSchema(documents, targetId, { functionInputs: true });
  if (result.diagnostics.some((entry) => entry.severity === 'error'))
    throw new Error(JSON.stringify(result.diagnostics));
  const source = result.code.replace(/^import .*;$/gm, '').replace(/^export /gm, '');
  const javascript = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  }).outputText;
  const { schema, wrappers } = new Function(
    'z',
    'Temporal',
    `${RUNTIME_HELPER_JS_SOURCE}\n${javascript}\nreturn { schema: ${result.schemaName}, wrappers: { field: runeToField, reference: runeToReference } };`
  )(z, Temporal);
  return schema.parse(normalizePreviewInputs(documents, targetId, inputs, wrappers));
}
