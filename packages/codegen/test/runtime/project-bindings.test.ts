// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { beforeAll, describe, it, expect } from 'vitest';
import {
  createRuneDslServices,
  assertValidDocuments,
  isRosettaFunction,
  isRosettaModel,
  type RosettaFunction
} from '@rune-langium/core';
import { URI, type LangiumDocument } from 'langium';
import { generate } from '../../src/export.js';
import { compileGeneratedTypeScript } from '../helpers/compiled-typescript.js';
import {
  applyProjectPreviewBindings,
  validateProjectPreviewBindings,
  createProjectBindingRegistry,
  bindGeneratedProjectModule
} from '../../src/runtime/project-bindings.js';
import type { FormPreviewSchema } from '../../src/types.js';
const currency = { model: 'cdm', namespace: 'demo', kind: 'RosettaTypeAlias', name: 'Currency' };
const schema: FormPreviewSchema = {
  schemaVersion: 1,
  targetId: 'demo.Trade',
  title: 'Trade',
  kind: 'data',
  status: 'ready',
  fields: [
    {
      path: 'currency',
      label: 'Currency',
      kind: 'string',
      typeSymbol: 'typeAlias:demo.Currency',
      required: true
    }
  ]
};
it('uses the same resolved code list in generated schema choices and nested data validation', () => {
  const bindings = createProjectBindingRegistry({
    codeLists: [{ symbol: currency, values: [{ value: 'EUR', label: 'Euro' }] }]
  });
  const preview = applyProjectPreviewBindings(schema, bindings);
  expect(preview.fields[0]).toMatchObject({ kind: 'enum', enumValues: [{ value: 'EUR', label: 'Euro' }] });
  expect(validateProjectPreviewBindings(preview, { currency: 'USD' }, bindings)).toEqual([
    { path: 'currency', message: expect.stringMatching(/USD/) }
  ]);
  expect(validateProjectPreviewBindings(preview, { currency: 'EUR' }, bindings)).toEqual([]);
  expect(schema.fields[0]?.kind).toBe('string');
});
it('does not convert an unavailable resource into an empty valid code list', () => {
  const bindings = createProjectBindingRegistry({
    codeLists: [{ symbol: currency, unavailable: 'Currency data is not installed.' }]
  });
  expect(applyProjectPreviewBindings(schema, bindings)).toMatchObject({ status: 'unsupported' });
  expect(() => validateProjectPreviewBindings(schema, { currency: 'USD' }, bindings)).toThrow(/not installed/);
});
describe('native implementations', () => {
  let document: LangiumDocument;
  let external: RosettaFunction;
  beforeAll(async () => {
    const { RuneDsl, shared } = createRuneDslServices();
    await shared.workspace.WorkspaceManager.initializeWorkspace([]);
    document = RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
      `namespace demo
func External:
 inputs: value number (1..1)
 output: result number (1..1)
func Caller:
 inputs: value number (1..1)
 output: result number (1..1)
 set result: External(value)`,
      URI.parse('file:///native.rosetta')
    );
    await RuneDsl.shared.workspace.DocumentBuilder.build([document]);
    expect(document.parseResult.parserErrors).toEqual([]);
    if (!isRosettaModel(document.parseResult.value)) throw new Error('Expected parsed Rune model');
    external = document.parseResult.value.elements.filter(isRosettaFunction).find((node) => node.name === 'External')!;
  });
  it.each(['per-namespace', 'barrel', 'single-file'] as const)(
    'runs an emitted caller through an explicitly bound native function in %s layout',
    async (layout) => {
      const symbol = { model: 'cdm', namespace: 'demo', kind: 'RosettaFunction', name: 'External' };
      const outputs = await generate(document, {
        target: 'typescript',
        typescript: { layout },
        projectBindings: new Map([[external, symbol]])
      });
      const module = compileGeneratedTypeScript<Record<string, unknown>>(outputs, {
        entry:
          layout === 'barrel'
            ? 'index.ts'
            : layout === 'single-file'
              ? 'model.ts'
              : outputs.find((output) => output.funcs.some((fn) => fn.name === 'Caller'))!.relativePath
      });
      const registry = createProjectBindingRegistry({
        implementations: [{ symbol, invoke: (args) => Number(args[0]) + 2 }]
      });
      bindGeneratedProjectModule(module, registry);
      const caller = module.Caller as (value: number) => number;
      expect(caller(10)).toBe(12);
      expect(() =>
        bindGeneratedProjectModule(
          module,
          createProjectBindingRegistry({ implementations: [{ symbol, invoke: () => 99 }] })
        )
      ).toThrow(/bound|project/i);
      expect(caller(10)).toBe(12);
    }
  );
});
it('validates code lists through object lists and deferred definitions, and preserves raw values', () => {
  const bindings = createProjectBindingRegistry({
    codeLists: [{ symbol: currency, values: [{ value: 'EUR', label: 'Euro' }] }]
  });
  const nested: FormPreviewSchema = {
    ...schema,
    fields: [
      {
        kind: 'array',
        path: 'trades',
        label: 'Trades',
        required: false,
        children: [
          {
            kind: 'object',
            path: 'trades[]',
            label: 'Trade',
            required: false,
            children: [],
            definitionId: 'demo.Trade'
          }
        ]
      }
    ],
    definitions: { 'demo.Trade': { fields: schema.fields } }
  };
  const raw = { trades: [{ currency: 'EUR' }, { currency: 'USD' }] };
  const preview = applyProjectPreviewBindings(nested, bindings);
  expect(validateProjectPreviewBindings(preview, raw, bindings)).toEqual([
    { path: 'trades[1].currency', message: expect.stringMatching(/USD/) }
  ]);
  expect(raw.trades[1]?.currency).toBe('USD');
  expect(applyProjectPreviewBindings(preview, bindings)).toEqual(preview);
});
it.each(['typescript', 'zod', 'json-schema'] as const)(
  'exports the same code-list membership constraint in %s',
  async (target) => {
    const services = createRuneDslServices();
    await services.shared.workspace.WorkspaceManager.initializeWorkspace([]);
    const document = services.shared.workspace.LangiumDocumentFactory.fromString(
      'namespace codes\ntypeAlias Currency: string\ntype Quote:\n currency Currency (1..1)',
      URI.parse('file:///codes.rosetta')
    );
    await services.shared.workspace.DocumentBuilder.build([document]);
    assertValidDocuments([document]);
    const bindings = createProjectBindingRegistry({
      codeLists: [{ symbol: { ...currency, namespace: 'codes' }, values: [{ value: 'EUR', label: 'Euro' }] }]
    });
    const outputs = await generate(document, { target, projectResources: bindings });
    if (target === 'typescript') {
      compileGeneratedTypeScript(outputs, {
        assertions:
          'const allowed: Currency = "EUR";\n// @ts-expect-error unsupported code\nconst rejected: Currency = "USD";\nconst quote: Quote = {currency: "EUR"};\n// @ts-expect-error unsupported field code\nconst invalidQuote: Quote = {currency: "USD"};'
      });
    } else if (target === 'zod') {
      const module = compileGeneratedTypeScript<{ QuoteSchema: { safeParse(value: unknown): { success: boolean } } }>(
        outputs
      );
      expect(module.QuoteSchema.safeParse({ currency: 'EUR' }).success).toBe(true);
      expect(module.QuoteSchema.safeParse({ currency: 'USD' }).success).toBe(false);
    } else {
      const { Ajv2020 } = await import('ajv/dist/2020.js');
      const schema = JSON.parse(outputs[0]!.content);
      const validate = new Ajv2020({ strict: false }).compile({ ...schema, $ref: '#/$defs/Quote' });
      expect(validate({ currency: 'EUR' })).toBe(true);
      expect(validate({ currency: 'USD' })).toBe(false);
    }
  }
);

it('validates code-list metadata values at their real payload paths, including list items', () => {
  const bindings = createProjectBindingRegistry({
    codeLists: [{ symbol: currency, values: [{ value: 'EUR', label: 'Euro' }] }]
  });
  const wrapped = { ...schema.fields[0]!, metadata: { kind: 'field' as const, payloadShape: null } };
  const preview: FormPreviewSchema = {
    ...schema,
    fields: [
      wrapped,
      { kind: 'array', path: 'codes', label: 'Codes', required: false, children: [{ ...wrapped, path: 'codes[]' }] }
    ]
  };
  expect(
    validateProjectPreviewBindings(
      preview,
      { currency: { value: 'EUR', meta: { scheme: 'ISO' } }, codes: [{ value: 'USD', meta: {} }] },
      bindings
    )
  ).toEqual([{ path: 'codes[0].value', message: expect.stringContaining('USD') }]);
});
