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
  const missing = resolveProjectCapabilities(project, []).find((c) =>
    c.id.startsWith('implementation:holiday-calendar:')
  );
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
it('propagates a missing native provider only to its callers and their selected function targets', async () => {
  const { buildEffectiveProject } = await import('../src/effective-project.js');
  const { generatePreviewSchemas } = await import('@rune-langium/codegen/export');
  const native = { model: 'local', namespace: 'impact', kind: 'RosettaFunction', name: 'Native' };
  const project = await createProjectSnapshot(
    'p',
    new Map([
      ['rune-config.yml', 'model: {name: Impact}'],
      [
        'build-config.yml',
        JSON.stringify({
          schemaVersion: 1,
          overrides: [{ kind: 'implementation', source: native, provider: 'missing' }],
          targets: {
            types: { generator: 'json-schema', output: 'generated/types' },
            app: { generator: 'typescript', output: 'generated/app', namespaces: ['impact'] },
            safe: { generator: 'typescript', output: 'generated/safe', namespaces: ['safe'] }
          }
        })
      ],
      [
        'model/impact.rosetta',
        `namespace impact
func Native:
 inputs: value number (1..1)
 output: result number (1..1)
func Caller:
 inputs: value number (1..1)
 output: result number (1..1)
 set result: Native(value)
func Outer:
 inputs: value number (1..1)
 output: result number (1..1)
 set result: Caller(value)`
      ],
      [
        'model/safe.rosetta',
        'namespace safe\nfunc Native:\n inputs: value number (1..1)\n output: result number (1..1)\n set result: value'
      ]
    ]),
    () => []
  );
  const graph = await buildEffectiveProject(project, []);
  expect(graph.diagnostics).toEqual([]);
  const capability = graph.capabilities.find((entry) => entry.id.startsWith('implementation:missing:'))!;
  expect(capability.affectedFunctions.map((fn) => fn.namespace + '.' + fn.name).sort()).toEqual([
    'impact.Caller',
    'impact.Native',
    'impact.Outer'
  ]);
  expect(capability.affectedTargets).toEqual(['app']);
  expect(
    generatePreviewSchemas([...graph.documents], { targetId: 'impact.Outer', projectBindings: graph.bindings })[0]
      ?.executionUnavailable
  ).toMatch(/installed|provider/i);
  expect(
    generatePreviewSchemas([...graph.documents], { targetId: 'safe.Native', projectBindings: graph.bindings })[0]
      ?.executionUnavailable
  ).toBeUndefined();
});

it.each(['number', 'string(minLength: 3)'])(
  'reports an unsupported %s code-list alias as unavailable without rejecting unrelated declarations',
  async (type) => {
    const { buildEffectiveProject } = await import('../src/effective-project.js');
    const { generatePreviewSchemas } = await import('@rune-langium/codegen/export');
    const project = await snapshot(
      [
        {
          kind: 'resource',
          source: { model: 'local', id: 'demo.Currency#RosettaTypeAlias' },
          path: 'resources/codes.json'
        }
      ],
      [
        ['resources/codes.json', '[{"value":"EUR","label":"Euro"}]'],
        [
          'model/quote.rosetta',
          `namespace demo\ntypeAlias Currency: ${type}\ntype Quote:\n currency Currency (1..1)\ntype Safe:\n value string (1..1)`
        ]
      ]
    );
    const graph = await buildEffectiveProject(project, []);
    expect(graph.diagnostics).toEqual([]);
    expect(graph.capabilities.find((c) => c.id.startsWith('resource:'))).toMatchObject({ status: 'unavailable' });
    expect(
      generatePreviewSchemas([...graph.documents], { targetId: 'demo.Quote', projectBindings: graph.bindings })[0]
        ?.status
    ).toBe('unsupported');
    // Pure unrelated declarations remain usable even when one resource cannot be prepared.
    expect(
      generatePreviewSchemas([...graph.documents], { targetId: 'demo.Safe', projectBindings: graph.bindings })[0]
        ?.status
    ).toBe('ready');
  }
);

it('keeps the same explicit code list on the effective local alias after declaration replacement', async () => {
  const { buildEffectiveProject } = await import('../src/effective-project.js');
  const { generatePreviewSchemas } = await import('@rune-langium/codegen/export');
  const project = await snapshot(
    [
      { kind: 'declaration', source: currency, replacement: { ...currency, model: 'local', namespace: 'custom' } },
      { kind: 'resource', source: { model: 'cdm', id: 'demo.Currency#RosettaTypeAlias' }, path: 'resources/codes.json' }
    ],
    [
      ['resources/codes.json', '[{"value":"EUR","label":"Euro"}]'],
      ['model/custom.rosetta', 'namespace custom\ntypeAlias Currency: string']
    ]
  );
  const graph = await buildEffectiveProject(project, [
    {
      uri: 'cdm/demo.rosetta',
      content: 'namespace demo\ntypeAlias Currency: string\ntype Quote:\n currency Currency (1..1)'
    }
  ]);
  expect(graph.diagnostics).toEqual([]);
  expect(
    generatePreviewSchemas([...graph.documents], { targetId: 'demo.Quote', projectBindings: graph.bindings })[0]
      ?.fields[0]
  ).toMatchObject({ kind: 'enum', enumValues: [{ value: 'EUR', label: 'Euro' }] });
});

it('distinguishes multiple bindings to the same provider and captures the installed callback', async () => {
  const second = { ...symbol, name: 'Other' };
  const project = await snapshot(
    [symbol, second].map((source) => ({ kind: 'implementation', source, provider: 'installed' }))
  );
  const provider = { id: 'installed', supports: () => true, invoke: () => 42 };
  const bindings = createProjectBindings(project, [provider]);
  provider.invoke = () => 99;
  expect(bindings.invoke(symbol, [])).toBe(42);
  const capabilities = resolveProjectCapabilities(project, [provider]);
  expect(new Set(capabilities.map((c) => c.id)).size).toBe(2);
});
it('keeps inherited alias code lists in preview choices', async () => {
  const { buildEffectiveProject } = await import('../src/effective-project.js');
  const { generatePreviewSchemas } = await import('@rune-langium/codegen/export');
  const project = await snapshot(
    [
      {
        kind: 'resource',
        source: { model: 'local', id: 'demo.Currency#RosettaTypeAlias' },
        path: 'resources/codes.json'
      }
    ],
    [
      ['resources/codes.json', '[{"value":"EUR","label":"Euro"}]'],
      [
        'model/quote.rosetta',
        'namespace demo\ntypeAlias Currency: string\ntypeAlias InheritedCurrency: Currency\ntype Quote:\n currency InheritedCurrency (1..1)'
      ]
    ]
  );
  const graph = await buildEffectiveProject(project, []);
  expect(graph.diagnostics).toEqual([]);
  expect(
    generatePreviewSchemas([...graph.documents], { targetId: 'demo.Quote', projectBindings: graph.bindings })[0]
      ?.fields[0]
  ).toMatchObject({ kind: 'enum', enumValues: [{ value: 'EUR', label: 'Euro' }] });
});
it('rejects competing declaration and installed implementation mappings for one source', async () => {
  const { projectOverrideRedirects } = await import('../src/override-validation.js');
  expect(
    projectOverrideRedirects([
      { kind: 'declaration', source: symbol, replacement: { ...symbol, model: 'local' } },
      { kind: 'implementation', source: symbol, provider: 'installed' }
    ]).diagnostics
  ).toContainEqual(expect.objectContaining({ code: 'OVERRIDE_AMBIGUOUS' }));
});
it('reports dispatch-specific native implementations as unsupported until their whole family is supported', async () => {
  const project = await snapshot([
    { kind: 'implementation', source: { ...symbol, dispatch: 'Draft' }, provider: 'installed' }
  ]);
  expect(
    resolveProjectCapabilities(project, [{ id: 'installed', supports: () => true, invoke: () => 42 }])[0]
  ).toMatchObject({ status: 'unavailable', reason: expect.stringMatching(/dispatch/i) });
});
