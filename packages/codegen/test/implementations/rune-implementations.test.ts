// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { beforeAll, expect, it } from 'vitest';
import { URI, AstUtils } from 'langium';
import {
  ANNOTATIONS_ROSETTA,
  BASICTYPES_ROSETTA,
  assertValidDocuments,
  createRuneDslServices,
  isRosettaFunction,
  isRosettaSymbolReference
} from '@rune-langium/core';
import { Temporal } from '@js-temporal/polyfill';
import { generate, generatePreviewSchemas } from '../../src/export.js';
import { generatePythonModule } from '../../src/projection/python-functions.js';
import { compileGeneratedTypeScript } from '../helpers/compiled-typescript.js';
import { runPython } from '../projection/python-test-utils.js';
import {
  cdmEventReference,
  cdmDateReference,
  cdmRuneImplementationSources
} from '../../../../test/helpers/cdm-rune-implementations.js';

async function documents() {
  const { RuneDsl } = createRuneDslServices();
  await RuneDsl.shared.workspace.WorkspaceManager.initializeWorkspace([]);
  const docs = [
    BASICTYPES_ROSETTA,
    ANNOTATIONS_ROSETTA,
    cdmEventReference,
    cdmDateReference,
    ...cdmRuneImplementationSources.values()
  ].map((source, index) =>
    RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(
      source,
      URI.parse(`inmemory:///rune-impl-${index}.rosetta`)
    )
  );
  for (const document of docs) RuneDsl.shared.workspace.LangiumDocuments.addDocument(document);
  await RuneDsl.shared.workspace.DocumentBuilder.build(docs, { validation: true, eagerLinking: true });
  expect(docs.flatMap((doc) => [...doc.parseResult.parserErrors, ...doc.parseResult.lexerErrors])).toEqual([]);
  assertValidDocuments(docs);
  return docs;
}

let docs: Awaited<ReturnType<typeof documents>>;
beforeAll(async () => {
  docs = await documents();
});

it('links upstream callers to the Rune overrides instead of native fallbacks', () => {
  for (const document of docs.slice(2, 4)) {
    const calls = AstUtils.streamAllContents(document.parseResult.value).filter(isRosettaSymbolReference);
    for (const call of calls) {
      if (!['EmptyExecutionDetails', 'EmptyTransferHistory', 'PopOffDateList'].includes(call.symbol.$refText)) continue;
      const target = call.symbol.ref;
      expect(isRosettaFunction(target) && target.$container.overridden && target.operations.length > 0).toBe(true);
    }
  }
});

it.each(['single-file', 'per-namespace', 'barrel'] as const)(
  'executes the same Rune sources as standalone strict TypeScript (%s)',
  async (layout) => {
    const outputs = await generate(docs, { target: 'typescript', strict: true, typescript: { layout } });
    expect(outputs.flatMap((output) => output.diagnostics)).toEqual([]);
    for (const name of ['ClearExecution', 'ClearHistory', 'EmptyExecutionDetails', 'EmptyTransferHistory', 'Pop']) {
      const output = outputs.find((output) => output.funcs.some((func) => func.name === name))!;
      const func = output.funcs.find((func) => func.name === name)!;
      const runtime = compileGeneratedTypeScript(outputs, { entry: output.relativePath });
      const invoke = runtime[func.exportName!]!;
      if (name === 'ClearExecution') expect(invoke()).toBe(true);
      else if (name === 'ClearHistory') expect(invoke()).toBe(0);
      else if (name === 'EmptyExecutionDetails') expect(invoke()).toBeUndefined();
      else if (name === 'EmptyTransferHistory') expect(invoke()).toEqual([]);
      else {
        for (const input of [
          [],
          ['2024-02-29'],
          ['2024-02-29', '2024-02-29'],
          ['2024-03-01', '2024-02-29', '2024-03-01']
        ]) {
          const values = input.map((value) => Temporal.PlainDate.from(value));
          const result = invoke(values);
          expect(Array.isArray(result) && result.map(String)).toEqual(input.slice(0, -1));
          expect(values.map(String)).toEqual(input);
        }
      }
    }
  }
);

it('executes the same Rune sources in Python and exposes them as available to preview', () => {
  const python = generatePythonModule(docs);
  expect(python.diagnostics).toEqual([]);
  expect(
    runPython(
      [
        { expression: `${python.bindings.get('cdm.event.common.ClearExecution')}()` },
        { expression: `${python.bindings.get('cdm.event.common.ClearHistory')}()` },
        { expression: `${python.bindings.get('cdm.event.common.EmptyExecutionDetails')}()` },
        { expression: `${python.bindings.get('cdm.event.common.EmptyTransferHistory')}()` },
        { expression: `${python.bindings.get('cdm.base.datetime.Pop')}([])` },
        { expression: `${python.bindings.get('cdm.base.datetime.Pop')}(['2024-02-29'])` },
        { expression: `${python.bindings.get('cdm.base.datetime.Pop')}(['2024-02-29', '2024-02-29'])` }
      ],
      python.code,
      { includeRuntime: false }
    )
  ).toEqual([
    { value: true },
    { value: 0 },
    { value: null },
    { value: [] },
    { value: [] },
    { value: [] },
    { value: ['2024-02-29'] }
  ]);
  const preview = generatePreviewSchemas(docs);
  for (const id of ['cdm.event.common.ClearExecution', 'cdm.event.common.ClearHistory', 'cdm.base.datetime.Pop'])
    expect(preview.find((schema) => schema.targetId === id)?.executionUnavailable).toBeUndefined();
});
