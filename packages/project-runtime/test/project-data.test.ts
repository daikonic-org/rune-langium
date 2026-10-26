// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli
import { expect, it } from 'vitest';
import { createProjectSnapshot } from '@rune-langium/project-config';
import { serializeProjectData } from '../src/capabilities.js';
it('does not save an explicitly requested unsupported example codec as plain JSON', async () => {
  const snapshot = await createProjectSnapshot('p', new Map([['rune-config.yml', 'model: {name: Example}']]), () => []);
  expect(() => serializeProjectData(snapshot, { amount: 10.12345 }, 'XML')).toThrow(/codec|format/i);
  expect(serializeProjectData(snapshot, { amount: 10.12345 }, 'JSON')).toContain('10.12345');
});
it('uses Rune configuration defaults and the same lossless metadata codec for save/import', async () => {
  const { importProjectData, projectDataCodecStatus } = await import('../src/project-data.js');
  const snapshot = await createProjectSnapshot(
    'p',
    new Map([['rune-config.yml', 'model: {name: Example, defaultSerialisationFormat: RUNE_JSON}']]),
    () => []
  );
  expect(projectDataCodecStatus(snapshot).status).toBe('available');
  const value = { '@type': 'example.Party', name: { value: 'Party', meta: { scheme: 'local' } } };
  expect(() => serializeProjectData(snapshot, value)).toThrow(/declaration context/);
  const wire = JSON.stringify({ '@type': 'example.Party', name: { '@data': 'Party', '@scheme': 'local' } });
  const imported = importProjectData(snapshot, wire, 'example.Party');
  const text = serializeProjectData(snapshot, imported.data);
  expect(JSON.parse(text).name).toEqual({ '@data': 'Party', '@scheme': 'local' });
  expect(importProjectData(snapshot, text, 'example.Party')).toEqual({ data: value, diagnostics: [] });
  expect(JSON.parse(serializeProjectData(snapshot, value, 'JSON'))).toEqual(value);
});
it('serializes and reimports Choice values with explicit linked type and model/version context', async () => {
  const { buildEffectiveProject } = await import('../src/effective-project.js');
  const { importProjectData } = await import('../src/project-data.js');
  const snapshot = await createProjectSnapshot(
    'p',
    new Map([['rune-config.yml', 'model: {name: Example, defaultSerialisationFormat: RUNE_JSON}']]),
    () => []
  );
  const graph = await buildEffectiveProject(snapshot, [
    {
      uri: 'local/model.rosetta',
      content: `namespace example
type Bond:
 amount number (1..1)
  [metadata scheme]
choice Instrument:
 Bond
type Trade:
 instrument Instrument (1..1)
`
    }
  ]);
  const value = { instrument: { bond: { amount: { value: 21, meta: { scheme: 'USD' } } } } };
  const text = serializeProjectData(snapshot, value, 'RUNE_JSON', {
    documents: graph.documents,
    typeFqn: 'example.Trade',
    model: 'Example',
    version: '1.0.0'
  });
  expect(JSON.parse(text)).toMatchObject({
    '@model': 'Example',
    '@version': '1.0.0',
    '@type': 'example.Trade',
    instrument: { '@type': 'example.Bond', amount: { '@data': 21, '@scheme': 'USD' } }
  });
  const result = importProjectData(snapshot, text, 'example.Trade', graph.documents);
  expect(result.diagnostics).toEqual([]);
  expect(result.data).toMatchObject(value);
});
it('imports against an explicit local type replacement without changing source provenance or reference bytes', async () => {
  const { buildEffectiveProject } = await import('../src/effective-project.js');
  const { importProjectData } = await import('../src/project-data.js');
  const source = { model: 'cdm', namespace: 'ref', kind: 'Data', name: 'Payment' };
  const replacement = { model: 'local', namespace: 'custom', kind: 'Data', name: 'Payment' };
  const snapshot = await createProjectSnapshot(
    'p',
    new Map([
      ['rune-config.yml', 'model: {name: Custom, defaultSerialisationFormat: RUNE_JSON}'],
      [
        'build-config.yml',
        JSON.stringify({ schemaVersion: 1, overrides: [{ kind: 'declaration', source, replacement }] })
      ],
      [
        'model/custom.rosetta',
        'namespace custom\ntype Payment:\n amount number (1..1)\n condition Minimum: amount > 10\n'
      ]
    ]),
    () => []
  );
  const references = [{ uri: 'cdm/payment.rosetta', content: 'namespace ref\ntype Payment:\n amount number (1..1)\n' }];
  const before = JSON.stringify(references),
    graph = await buildEffectiveProject(snapshot, references);
  expect(graph.diagnostics).toEqual([]);
  const result = importProjectData(
    snapshot,
    '{"@model":"cdm","@type":"ref.Payment","amount":21}',
    'ref.Payment',
    graph.documents
  );
  expect(result.diagnostics).toEqual([]);
  expect(result.data).toMatchObject({ '@model': 'cdm', '@type': 'ref.Payment', amount: 21 });
  const wire = JSON.parse(
    serializeProjectData(snapshot, result.data, 'RUNE_JSON', {
      documents: graph.documents,
      typeFqn: 'ref.Payment',
      model: 'Custom',
      version: '1.0.0'
    })
  );
  expect(wire).toMatchObject({ '@model': 'Custom', '@type': 'custom.Payment', amount: 21 });
  expect(JSON.stringify(references)).toBe(before);
});

it('uses linked field roles when business attributes share metadata envelope names', async () => {
  const { buildEffectiveProject } = await import('../src/effective-project.js');
  const snapshot = await createProjectSnapshot('p', new Map([['rune-config.yml', 'model: {name: Example}']]), () => []);
  const graph = await buildEffectiveProject(snapshot, [
    {
      uri: 'local/fields.rosetta',
      content: 'namespace example\ntype Business:\n value int (1..1)\n globalReference string (0..1)'
    }
  ]);
  const value = { value: 3, globalReference: 'business-id' };
  const wire = JSON.parse(
    serializeProjectData(snapshot, value, 'RUNE_JSON', {
      documents: graph.documents,
      typeFqn: 'example.Business',
      model: 'Example',
      version: '1'
    })
  );
  expect(wire).toMatchObject(value);
  expect(wire).not.toHaveProperty('@data');
  expect(wire).not.toHaveProperty('@ref');
});

it('rejects linked Rune JSON exports with unsupported envelope siblings while retaining plain JSON', async () => {
  const { buildEffectiveProject } = await import('../src/effective-project.js');
  const snapshot = await createProjectSnapshot('p', new Map([['rune-config.yml', 'model: {name: Example}']]), () => []);
  const graph = await buildEffectiveProject(snapshot, [
    {
      uri: 'local/metadata.rosetta',
      content: 'namespace example\ntype Cash:\n amount number (1..1)\n  [metadata scheme]\n'
    }
  ]);
  expect(graph.diagnostics).toEqual([]);
  const value = { amount: { value: 21, meta: { scheme: 'USD' }, extra: 'retain-me' } };
  const context = { documents: graph.documents, typeFqn: 'example.Cash', model: 'Example', version: '1' };
  expect(() => serializeProjectData(snapshot, value, 'RUNE_JSON', context)).toThrow(/envelope.*supported/);
  expect(JSON.parse(serializeProjectData(snapshot, value, 'JSON', context))).toEqual(value);
});

it('round-trips concrete Choice and derived Data roots through linked assignability checks', async () => {
  const { buildEffectiveProject } = await import('../src/effective-project.js');
  const { importProjectData } = await import('../src/project-data.js');
  const snapshot = await createProjectSnapshot(
    'p',
    new Map([['rune-config.yml', 'model: {name: Example, defaultSerialisationFormat: RUNE_JSON}']]),
    () => []
  );
  const graph = await buildEffectiveProject(snapshot, [
    {
      uri: 'local/model.rosetta',
      content: `namespace example
 type Asset:
  id string (0..1)
 type Bond extends Asset:
  amount number (1..1)
 type Unrelated:
  name string (0..1)
 choice Instrument:
  Bond
`
    }
  ]);
  expect(graph.diagnostics).toEqual([]);
  const context = { documents: graph.documents, model: 'Example', version: '1.0.0' };
  const choice = serializeProjectData(snapshot, { bond: { amount: 21 } }, 'RUNE_JSON', {
    ...context,
    typeFqn: 'example.Instrument#Choice'
  });
  expect(JSON.parse(choice)['@type']).toBe('example.Bond');
  const restored = importProjectData(snapshot, choice, 'example.Instrument#Choice', graph.documents);
  expect(restored.diagnostics).toEqual([]);
  expect(restored.data).toMatchObject({ bond: { amount: 21 } });
  const derived = serializeProjectData(snapshot, { '@type': 'example.Bond', amount: 21 }, 'RUNE_JSON', {
    ...context,
    typeFqn: 'example.Asset'
  });
  const imported = importProjectData(snapshot, derived, 'example.Asset', graph.documents);
  expect(imported.diagnostics).toEqual([]);
  expect(imported.data).toMatchObject({ '@type': 'example.Bond', amount: 21 });
  for (const target of ['example.Asset', 'example.Instrument#Choice']) {
    for (const type of ['example.Unrelated', 'example.Missing']) {
      expect(
        importProjectData(snapshot, JSON.stringify({ '@type': type }), target, graph.documents).diagnostics[0]?.kind
      ).toBe('identity-mismatch');
    }
  }
  expect(importProjectData(snapshot, choice, 'example.Instrument#Choice').diagnostics[0]?.kind).toBe(
    'identity-mismatch'
  );
});

it('round-trips aliased Data and nested Choice roots without losing their declared slots', async () => {
  const { buildEffectiveProject } = await import('../src/effective-project.js');
  const { importProjectData } = await import('../src/project-data.js');
  const snapshot = await createProjectSnapshot(
    'p',
    new Map([['rune-config.yml', 'model: {name: Example, defaultSerialisationFormat: RUNE_JSON}']]),
    () => []
  );
  const graph = await buildEffectiveProject(snapshot, [
    {
      uri: 'local/alias.rosetta',
      content: `namespace example
 type Bond:
  amount number (1..1)
  bond string (1..1)
  instrumentAlias string (1..1)
 typeAlias BondAlias: Bond
 choice Instrument:
  Bond
 typeAlias InstrumentAlias: Instrument
 choice Outer:
  InstrumentAlias
 typeAlias OuterAlias: Outer
`
    }
  ]);
  expect(graph.diagnostics).toEqual([]);
  const bond = { amount: 21, bond: 'business-id', instrumentAlias: 'another-business-id' };
  const cases = [
    ['BondAlias', bond],
    ['InstrumentAlias', { bond }],
    ['OuterAlias', { instrumentAlias: { bond } }]
  ] as const;
  for (const [name, value] of cases) {
    const target = `example.${name}#RosettaTypeAlias`;
    const text = serializeProjectData(snapshot, value, 'RUNE_JSON', {
      documents: graph.documents,
      typeFqn: target,
      model: 'Example',
      version: '1'
    });
    expect(JSON.parse(text)['@type']).toBe('example.Bond');
    const result = importProjectData(snapshot, text, target, graph.documents);
    expect(result.diagnostics).toEqual([]);
    expect(result.data).toMatchObject(value);
  }
});
