// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { it, expect } from 'vitest';
import { createProjectSnapshot } from '@rune-langium/project-config';
import { resolveProjectResource } from '../src/resources.js';
import { resolveProjectCapabilities, createProjectBindings, serializeProjectData } from '../src/capabilities.js';
const symbol = { model: 'cdm', namespace: 'demo', kind: 'RosettaFunction', name: 'HolidayCalendar' };
const currency = { model: 'cdm', namespace: 'demo', kind: 'RosettaTypeAlias', name: 'Currency' };
async function snapshot(overrides: unknown[], extra: [string, string][] = []) {
  return createProjectSnapshot(
    'p',
    new Map([
      ['rune-config.yml', 'model: {name: Example}'],
      [
        'build-config.yml',
        JSON.stringify({
          schemaVersion: 1,
          overrides,
          targets: {
            types: { generator: 'json-schema', output: 'generated/types' },
            app: { generator: 'typescript', output: 'generated/app' }
          }
        })
      ],
      ...extra
    ]),
    () => []
  );
}
it('uses only explicit resource mappings and retains the captured byte checksum', async () => {
  const resource = { model: 'cdm', id: 'demo.Currency#RosettaTypeAlias' };
  const original = await snapshot([], [['resources/currency.json', '["USD"]']]);
  expect(resolveProjectResource(original, resource)).toMatchObject({ code: 'RESOURCE_UNAVAILABLE' });
  const mapped = await snapshot(
    [{ kind: 'resource', source: resource, path: 'resources/currency.json' }],
    [['resources/currency.json', '["USD"]']]
  );
  expect(resolveProjectResource(mapped, resource)).toEqual({
    path: 'resources/currency.json',
    checksum: mapped.fileRevisions.get('resources/currency.json')
  });
});
it('reports a missing holiday provider without blocking a pure type target', async () => {
  const project = await snapshot([{ kind: 'implementation', source: symbol, provider: 'holiday-calendar' }]);
  const missing = resolveProjectCapabilities(project, []).find((c) => c.id === 'implementation:holiday-calendar');
  expect(missing).toMatchObject({ status: 'unavailable', affectedFunctions: [symbol] });
  expect(missing?.affectedTargets).not.toContain('types');
  expect(missing?.reason).toMatch(/installed|registered/i);
});
it('prepares one explicit code list for both form choices and runtime validation', async () => {
  const project = await snapshot(
    [
      {
        kind: 'resource',
        source: { model: 'cdm', id: 'demo.Currency#RosettaTypeAlias' },
        path: 'resources/currency.json'
      }
    ],
    [
      [
        'resources/currency.json',
        JSON.stringify([
          { value: 'USD', label: 'US Dollar' },
          { value: 'EUR', label: 'Euro' }
        ])
      ]
    ]
  );
  const bindings = createProjectBindings(project, []);
  expect(bindings.codeList(currency)).toEqual([
    { value: 'USD', label: 'US Dollar' },
    { value: 'EUR', label: 'Euro' }
  ]);
  expect(bindings.validateCode(currency, 'GBP')).toMatchObject({ path: '', message: expect.stringMatching(/GBP/) });
  expect(bindings.validateCode(currency, 'USD')).toBeUndefined();
});
it('binds only the selected installed provider, rejects asynchronous results and keeps identity kinds separate', async () => {
  const project = await snapshot([{ kind: 'implementation', source: symbol, provider: 'fixture.calendar' }]);
  const bindings = createProjectBindings(project, [
    { id: 'fixture.calendar', supports: (s) => s.kind === 'RosettaFunction', invoke: (args) => args[0] }
  ]);
  expect(bindings.invoke(symbol, [42])).toBe(42);
  expect(() => bindings.invoke({ ...symbol, kind: 'RosettaEnumeration' }, [42])).toThrow(/unavailable|binding/i);
  const asynchronous = createProjectBindings(project, [
    { id: 'fixture.calendar', supports: () => true, invoke: () => Promise.resolve(42) }
  ]);
  expect(() => asynchronous.invoke(symbol, [])).toThrow(/synchronous|async/i);
});
it('does not claim an unsupported configured codec can serialize data', async () => {
  const project = await createProjectSnapshot(
    'p',
    new Map([['rune-config.yml', 'model: {name: Example, defaultSerialisationFormat: XML}']]),
    () => []
  );
  expect(() => serializeProjectData(project, { value: 42 })).toThrow(/codec|format|XML/);
  expect(resolveProjectCapabilities(project, [])).toContainEqual(
    expect.objectContaining({ id: 'codec:XML', status: 'unavailable' })
  );
});
it('keeps the linked graph usable and generates choices from an explicitly mapped local alias resource', async () => {
  const { buildEffectiveProject } = await import('../src/effective-project.js');
  const { generatePreviewSchemas, validateProjectPreviewBindings } = await import('@rune-langium/codegen/export');
  const project = await snapshot(
    [
      {
        kind: 'resource',
        source: { model: 'local', id: 'demo.Currency#RosettaTypeAlias' },
        path: 'resources/currency.json'
      }
    ],
    [
      ['resources/currency.json', JSON.stringify([{ value: 'EUR', label: 'Euro' }])],
      ['model/quote.rosetta', 'namespace demo\ntypeAlias Currency: string\ntype Quote:\n currency Currency (1..1)']
    ]
  );
  const graph = await buildEffectiveProject(project, []);
  expect(graph.diagnostics).toEqual([]);
  const schema = generatePreviewSchemas([...graph.documents], {
    targetId: 'demo.Quote',
    projectBindings: graph.bindings
  })[0]!;
  expect(schema.fields[0]).toMatchObject({ kind: 'enum', enumValues: [{ value: 'EUR', label: 'Euro' }] });
  expect(validateProjectPreviewBindings(schema, { currency: 'USD' }, graph.bindings)).toHaveLength(1);
});
