// SPDX-License-Identifier: FSL-1.1-ALv2
// Copyright (c) 2026 Pradeep Mouli

import {
  renderSourceTs,
  parseSourceTs,
  renderSourceTypeScriptExpression,
  renderPy,
  parsePy,
  type ProjectionOrigin
} from '@rune-langium/codegen/lens';
import type { RosettaExpression } from '@rune-langium/core';
import { withInstrumentation } from '../services/instrumentation/core.js';
import { getTsWasmBytes } from './ts-wasm-asset.js';
import { getPyWasmBytes } from './py-wasm-asset.js';

/** Narrow inverse contracts, independent of generated display coverage. */
export const FOREIGN_LENSES = {
  typescript: { label: 'TypeScript', render: renderSourceTs, parse: parseSourceTs, getWasmBytes: getTsWasmBytes },
  python: {
    label: 'Python',
    render: renderPy,
    parse: (text: string, wasm: Uint8Array, _origin?: ProjectionOrigin) => parsePy(text, wasm),
    getWasmBytes: getPyWasmBytes
  }
};

/** Origins are text/regions only and can cross the worker boundary safely. */
export const expressionOrigin = withInstrumentation(
  function expressionOrigin(
    language: keyof typeof FOREIGN_LENSES,
    expression: RosettaExpression
  ): ProjectionOrigin | undefined {
    return language === 'typescript' ? renderSourceTypeScriptExpression(expression).origin : undefined;
  },
  { op: 'expressionOrigin' }
);
