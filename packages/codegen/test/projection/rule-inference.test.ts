// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { AstUtils, URI } from 'langium';
import { Temporal } from '@js-temporal/polyfill';
import {
  BASICTYPES_ROSETTA,
  createRuneDslServices,
  assertValidDocuments,
  isRosettaRule,
  isRosettaImplicitVariable,
  type RosettaModel
} from '@rune-langium/core';
import { expressionType } from '../../src/expr/navigation.js';
import { generate } from '../../src/export.js';
import { createPythonProjectionContext, generatePythonModule } from '../../src/projection/python-functions.js';
import { compileGeneratedTypeScript } from '../helpers/compiled-typescript.js';
import { runPython } from './python-test-utils.js';

describe('linked rule inference through generated APIs', () => {
  const { RuneDsl } = createRuneDslServices();
  const factory = RuneDsl.shared.workspace.LangiumDocumentFactory;
  const fixture = new URL('../../../../test/fixtures/regressions/rule-inference/', import.meta.url);
  const documents = [
    factory.fromString<RosettaModel>(BASICTYPES_ROSETTA, URI.parse('file:///basics.rosetta')),
    ...['types.rosetta', 'rules.rosetta'].map((name) =>
      factory.fromString<RosettaModel>(readFileSync(new URL(name, fixture), 'utf8'), URI.parse(`file:///${name}`))
    )
  ];
  beforeAll(async () => {
    await RuneDsl.shared.workspace.DocumentBuilder.build(documents, { validation: false });
    assertValidDocuments(documents);
  });

  it('preserves scalar selector types in literal and default switch branches', () => {
    const rule = documents[2]!.parseResult.value.elements.find(
      (node) => isRosettaRule(node) && node.name === 'LiteralSelector'
    )!;
    const items = [...AstUtils.streamAllContents(rule)].filter(isRosettaImplicitVariable);
    expect(items).toHaveLength(2);
    expect(items.map((item) => expressionType(item)?.name)).toEqual(['string', 'string']);
  });

  it('strictly compiles TypeScript and executes chained rules and Choice input rules', async () => {
    const outputs = await generate(documents, { target: 'typescript' });
    expect(outputs.flatMap((output) => output.diagnostics.filter((entry) => entry.severity === 'error'))).toEqual([]);
    const entry = outputs.find((output) => output.content.includes('export function extractReadKind('))!.relativePath;
    const runtime = compileGeneratedTypeScript<{
      extractDefaultRegistration: (input: object) => Temporal.PlainDate | undefined;
      extractAliasedRegistration: (input: object) => Temporal.PlainDate | undefined;
      extractLiteralSelector: (input: object) => string;
      extractManyKinds: (input: object) => string[];
      extractReadKind: (input: object) => string[];
      extractRegistration: (input: object) => Temporal.PlainDate[];
      validateIsRegistered: (input: object) => boolean;
    }>(outputs, { entry });
    const registeredOn = Temporal.PlainDate.from('2026-01-01');
    const vehicle = { powered: { engine: { kind: 'electric' }, specification: { textValue: 'A', registeredOn } } };
    expect(runtime.extractReadKind({ vehicle })).toEqual(['electric']);
    expect(runtime.extractManyKinds({ vehicle })).toEqual(['electric']);
    expect(runtime.extractManyKinds({ vehicle: { pedal: { weight: 10 } } })).toEqual([]);
    expect(runtime.extractReadKind({ vehicle: { pedal: { weight: 10 } } })).toEqual([]);
    expect(runtime.extractRegistration(vehicle)).toEqual([registeredOn]);
    expect(runtime.extractDefaultRegistration({ vehicle })).toEqual(registeredOn);
    expect(runtime.extractDefaultRegistration({ vehicle: { pedal: { weight: 10 } } })).toBeUndefined();
    expect(runtime.extractAliasedRegistration(vehicle.powered)).toEqual(registeredOn);
    expect(runtime.extractLiteralSelector(vehicle.powered)).toBe('electric');
    expect(runtime.extractLiteralSelector({ ...vehicle.powered, engine: { kind: 'diesel' } })).toBe('diesel');
    expect(runtime.validateIsRegistered(vehicle)).toBe(true);
    expect(runtime.validateIsRegistered({ pedal: { weight: 10 } })).toBe(false);
  });

  it('executes the same rule chains and implicit Choice inputs in Python', () => {
    const module = generatePythonModule(documents);
    const context = createPythonProjectionContext(documents, { uri: '', nodeId: '', region: { from: 0, to: 0 } });
    const rules = documents[2]!.parseResult.value.elements.filter(isRosettaRule);
    const readKind = context.name(rules.find((rule) => rule.name === 'ReadKind')!);
    const isRegistered = context.name(rules.find((rule) => rule.name === 'IsRegistered')!);
    const manyKinds = context.name(rules.find((rule) => rule.name === 'ManyKinds')!);
    const named = (name: string) => context.name(rules.find((rule) => rule.name === name)!);
    const vehicle = {
      powered: { engine: { kind: 'electric' }, specification: { textValue: 'A', registeredOn: '2026-01-01' } }
    };
    expect(
      runPython(
        [
          { expression: `${named('DefaultRegistration')}(data) is not None`, data: { vehicle } },
          { expression: `${named('DefaultRegistration')}(data)`, data: { vehicle: { pedal: { weight: 10 } } } },
          { expression: `${named('AliasedRegistration')}(data) is not None`, data: vehicle.powered },
          { expression: `${named('LiteralSelector')}(data)`, data: vehicle.powered },
          { expression: `${named('LiteralSelector')}(data)`, data: { ...vehicle.powered, engine: { kind: 'diesel' } } },
          { expression: `${manyKinds}(data)`, data: { vehicle } },
          { expression: `${manyKinds}(data)`, data: { vehicle: { pedal: { weight: 10 } } } },
          { expression: `${readKind}(data)`, data: { vehicle } },
          { expression: `${readKind}(data)`, data: { vehicle: { pedal: { weight: 10 } } } },
          { expression: `${isRegistered}(data)`, data: vehicle },
          { expression: `${isRegistered}(data)`, data: { pedal: { weight: 10 } } }
        ],
        module.code,
        { includeRuntime: false }
      )
    ).toEqual([
      { value: true },
      { value: null },
      { value: true },
      { value: 'electric' },
      { value: 'diesel' },
      { value: ['electric'] },
      { value: [] },
      { value: ['electric'] },
      { value: [] },
      { value: true },
      { value: false }
    ]);
  });
});
