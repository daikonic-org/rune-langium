// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

/**
 * Type-level assertions for the Target union and GeneratorOutput shape.
 * Task 0.1 of spec 018 (additional codegen targets) — extends the Target
 * union to include the four planned new emitters and adds optional
 * `binary` + `mimeType` fields so non-text outputs (e.g. .xlsx) can
 * travel through the same pipeline as the text-only targets.
 */

import { describe, it, expectTypeOf } from 'vitest';
import type { Target, GeneratorOutput } from '../src/types.js';

describe('Target union (018 Task 0.1; 021 Phase 2b added openapi; 021 Phase 3 added xsd)', () => {
  it('includes all target identifiers', () => {
    expectTypeOf<Target>().toEqualTypeOf<
      'zod' | 'json-schema' | 'typescript' | 'python' | 'sql' | 'markdown' | 'excel' | 'graphql' | 'openapi' | 'xsd'
    >();
  });
});

describe('GeneratorOutput (018 Task 0.1)', () => {
  it('has optional binary and mimeType fields', () => {
    const o: GeneratorOutput = {
      relativePath: 'x',
      content: '',
      sourceMap: [],
      diagnostics: [],
      funcs: [],
      binary: new Uint8Array([1, 2, 3]),
      mimeType: 'application/octet-stream'
    };
    expectTypeOf(o.binary).toEqualTypeOf<Uint8Array | undefined>();
    expectTypeOf(o.mimeType).toEqualTypeOf<string | undefined>();
  });
});
