// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { describe, expect, it } from 'vitest';
import {
  isRosettaStringLiteral,
  isRosettaSymbolReference,
  parseExpression,
  type AnnotationRef
} from '@rune-langium/core';
import ts from 'typescript-classic';
import type { GeneratorDiagnostic } from '../../src/types.js';
import { renderMetadataOperation } from '../../src/expr/metadata-operation.js';
import {
  fieldMetadataKind,
  hasFieldMetadata,
  metadataName,
  metadataNames,
  metadataRuntimeSource
} from '../../src/expr/metadata-runtime.js';
import type { ExpressionTranspilerContext } from '../../src/expr/transpiler.js';
import { RUNTIME_HELPER_JS_SOURCE } from '../../src/helpers.js';

function parse(source: string) {
  const result = parseExpression(source);
  expect(result.hasErrors, `expected '${source}' to parse without errors`).toBe(false);
  return result.value;
}

function context(): ExpressionTranspilerContext {
  const diagnostics: GeneratorDiagnostic[] = [];
  return {
    selfName: 'input',
    emitMode: 'ts-expression',
    conditionName: 'Metadata',
    typeName: 'Metadata',
    attributeTypes: new Map([['value', 'string']]),
    diagnostics
  };
}

describe('metadata expression rendering', () => {
  it('classifies key and template as type metadata while retaining field metadata', () => {
    expect(metadataNames.has('scheme')).toBe(true);
    expect(metadataName.key).toBe('externalKey');
    const scheme = { annotation: { $refText: 'metadata' }, attribute: { $refText: 'scheme' } } as AnnotationRef;
    const key = { annotation: { $refText: 'metadata' }, attribute: { $refText: 'key' } } as AnnotationRef;
    expect(hasFieldMetadata({ annotations: [scheme] })).toBe(true);
    expect(fieldMetadataKind({ annotations: [scheme] })).toBe('field');
    expect(hasFieldMetadata({ annotations: [key] })).toBe(false);
    expect(fieldMetadataKind({ annotations: [key] })).toBeUndefined();
    const schemeThenReference = {
      annotations: [scheme, { annotation: { ref: { name: 'metadata' } }, attribute: { ref: { name: 'reference' } } }]
    } as { annotations: readonly AnnotationRef[] };
    expect(fieldMetadataKind(schemeThenReference)).toBe('reference');
    const runtime = ts.transpileModule(metadataRuntimeSource(true), {
      reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ESNext }
    });
    expect(runtime.diagnostics).toHaveLength(0);
    expect(metadataRuntimeSource(true, true)).toContain('export const runeWithMeta');
    expect(metadataRuntimeSource(true, true)).toContain('export const runeToField');
    expect(metadataRuntimeSource(true, true)).toContain('export const runeToReference');
    expect(metadataRuntimeSource(true, true)).toContain('export type RuneReferenceWithMeta');
  });

  it('retains the argument and evaluated with-meta entries', () => {
    const expression = parse('value with-meta { scheme: "urn:x" }');
    const rendered = renderMetadataOperation(expression, context(), (child, ctx) => {
      if (isRosettaSymbolReference(child)) return `${ctx.selfName}.${child.symbol.$refText}`;
      if (isRosettaStringLiteral(child)) return JSON.stringify(child.value);
      throw new Error(`unexpected child ${child.$type}`);
    });

    expect(rendered).toBe('rune.withMeta(input.value, { "scheme": "urn:x" }, "value")');
    const evaluate = Function(
      'input',
      `${RUNTIME_HELPER_JS_SOURCE}
; return ${rendered}`
    ) as (input: { value: string }) => unknown;
    expect(evaluate({ value: 'v' })).toEqual({
      value: 'v',
      meta: { scheme: 'urn:x' }
    });

    const evaluateUndefined = Function(
      'input',
      `${RUNTIME_HELPER_JS_SOURCE}
; return rune.withMeta(input.value, { location: undefined })`
    ) as (input: { value: undefined }) => unknown;
    expect(evaluateUndefined({ value: undefined })).toBeUndefined();

    const evaluateArray = Function(
      'input',
      `${RUNTIME_HELPER_JS_SOURCE}
; return rune.withMeta(input.values, { scheme: "urn:x" })`
    ) as (input: { values: string[] }) => unknown;
    expect(evaluateArray({ values: ['a', 'b'] })).toEqual([
      { value: 'a', meta: { scheme: 'urn:x' } },
      { value: 'b', meta: { scheme: 'urn:x' } }
    ]);

    const evaluateTypes = Function(
      'input',
      `${RUNTIME_HELPER_JS_SOURCE}
; return rune.withMeta(input.value, { key: "k", scheme: "urn:x" })`
    ) as (input: { value: { field: string } }) => unknown;
    expect(evaluateTypes({ value: { field: 'v' } })).toEqual({
      value: { field: 'v', meta: { externalKey: 'k' } },
      meta: { scheme: 'urn:x' }
    });

    const evaluateReference = Function(
      'input',
      `${RUNTIME_HELPER_JS_SOURCE}
; return rune.withMeta(input.value, { address: "party-1" })`
    ) as (input: { value: string }) => unknown;
    expect(evaluateReference({ value: 'party' })).toEqual({ value: 'party', reference: { reference: 'party-1' } });

    const evaluateExternalReference = Function(
      'input',
      `${RUNTIME_HELPER_JS_SOURCE}
; return rune.withMeta(input.value, { reference: "party-2" })`
    ) as (input: { value: string }) => unknown;
    expect(evaluateExternalReference({ value: 'party' })).toEqual({ value: 'party', externalReference: 'party-2' });
  });

  it('converts as-key metadata into a reference object', () => {
    const expression = parse('value as-key');
    const rendered = renderMetadataOperation(expression, context(), (child, ctx) =>
      isRosettaSymbolReference(child) ? `${ctx.selfName}.${child.symbol.$refText}` : 'undefined'
    );
    expect(rendered).toBe('rune.asKey(input.value, "value")');
    const evaluate = Function(
      'input',
      `${RUNTIME_HELPER_JS_SOURCE}
; return ${rendered}`
    ) as (input: { value: { meta: { globalKey: string; externalKey: string } } }) => unknown;
    expect(evaluate({ value: { meta: { globalKey: 'global', externalKey: 'external' } } })).toEqual({
      globalReference: 'global',
      externalReference: 'external'
    });

    const evaluateArray = Function(
      'input',
      `${RUNTIME_HELPER_JS_SOURCE}
; return rune.asKey(input.values)`
    ) as (input: { values: Array<{ value: { meta: { externalKey: string } } }> }) => unknown;
    expect(
      evaluateArray({ values: [{ value: { meta: { externalKey: 'a' } } }, { value: { meta: { externalKey: 'b' } } }] })
    ).toEqual([{ externalReference: 'a' }, { externalReference: 'b' }]);

    const evaluateMissing = Function(
      'input',
      `${RUNTIME_HELPER_JS_SOURCE}
; return rune.asKey(input.value)`
    ) as (input: { value: undefined }) => unknown;
    expect(evaluateMissing({ value: undefined })).toEqual({});
  });

  it('converts wrapper kinds in the JavaScript runtime and rejects unresolved field payloads', () => {
    const field = Function(
      'value',
      `${RUNTIME_HELPER_JS_SOURCE}
; return runeToField(value, 'reference')`
    );
    const reference = Function(
      'value',
      `${RUNTIME_HELPER_JS_SOURCE}
; return runeToReference(value, 'field')`
    );
    const values = [{ value: 0 }, { value: 2, meta: { scheme: 'unit' } }];
    expect(field(values)).toEqual([{ value: 0, meta: {} }, values[1]]);
    expect(reference([{ value: 0, meta: {} }, values[1]])).toEqual([{ value: 0, meta: {} }, values[1]]);
    expect(() => field({ externalReference: 'key' })).toThrow(/without a value/);
    expect(() => field([{ value: 0 }, { externalReference: 'key' }])).toThrow(/without a value/);
  });

  it('normalizes values for field and reference metadata attributes', () => {
    const evaluate = Function(
      'input',
      `${RUNTIME_HELPER_JS_SOURCE}
; return [runeToField(input.field, 'field'), runeToReference(input.reference), runeToReference(input.pure, 'reference'), runeToField(input.pure)]`
    ) as (input: { field: string; reference: number; pure: { externalReference: string } }) => unknown;
    const existingField = { value: 'existing', meta: { scheme: 'urn:x' } };
    const existingReference = { externalReference: 'ref' };
    expect(evaluate({ field: existingField as never, reference: 7, pure: existingReference })).toEqual([
      existingField,
      { value: 7 },
      existingReference,
      { value: existingReference, meta: {} }
    ]);

    const evaluateArray = Function(
      'input',
      `${RUNTIME_HELPER_JS_SOURCE}
; return [runeToField(input.values), runeToReference(input.references)]`
    ) as (input: { values: string[]; references: number[] }) => unknown;
    expect(evaluateArray({ values: ['a', 'b'], references: [1, 2] })).toEqual([
      [
        { value: 'a', meta: {} },
        { value: 'b', meta: {} }
      ],
      [{ value: 1 }, { value: 2 }]
    ]);
  });
});
