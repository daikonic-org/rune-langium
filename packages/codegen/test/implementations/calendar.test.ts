// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Pradeep Mouli

import { beforeAll, expect, it } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { URI, type LangiumDocument } from 'langium';
import { assertValidDocuments, createRuneDslServices } from '@rune-langium/core';
import {
  calendarCases,
  calendarFiles,
  calendarFunctions,
  calendarNamespace
} from '../../../../test/helpers/cdm-calendar.js';
import { GENERATED_MODULE_TEST_TIMEOUT } from '../../../../test/helpers/vitest-budget.js';
import { generateSelected } from '../../src/export.js';
import { generatePythonModule } from '../../src/projection/python-functions.js';
import { compileGeneratedTypeScript } from '../helpers/compiled-typescript.js';
import { runPython } from '../projection/python-test-utils.js';

let docs: LangiumDocument[];
beforeAll(async () => {
  const { RuneDsl } = createRuneDslServices();
  await RuneDsl.shared.workspace.WorkspaceManager.initializeWorkspace([]);
  docs = calendarFiles().map(({ uri, content }) =>
    RuneDsl.shared.workspace.LangiumDocumentFactory.fromString(content, URI.parse(uri))
  );
  for (const doc of docs) RuneDsl.shared.workspace.LangiumDocuments.addDocument(doc);
  await RuneDsl.shared.workspace.DocumentBuilder.build(docs, { eagerLinking: true });
  assertValidDocuments(docs);
});

const codelistWarning = expect.objectContaining({
  code: 'native-implementation-unavailable',
  severity: 'warning',
  message: expect.stringContaining('cdm.base.staticdata.codelist.LoadCodeList')
});

function nativeInput(value: unknown): unknown {
  if (typeof value === 'string' && /^(?:\d{4}|[+-]\d{6})-\d\d-\d\d$/.test(value)) return Temporal.PlainDate.from(value);
  if (typeof value === 'object' && value !== null)
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, nativeInput(child)]));
  return value;
}

it.each(['single-file', 'per-namespace', 'barrel'] as const)(
  'matches the handwritten calendar cases in strict %s TypeScript',
  async (layout) => {
    const { outputs } = await generateSelected(
      docs,
      {
        namespaces: [],
        declarations: calendarFunctions.map((name) => ({ namespace: calendarNamespace, name, kind: 'RosettaFunction' }))
      },
      { target: 'typescript', strict: true, typescript: { layout } }
    );
    expect(outputs.flatMap((file) => file.diagnostics)).toEqual([codelistWarning]);
    const output = outputs.find((file) => file.funcs.some((fn) => fn.name === 'ResolveAdjustableDate'))!;
    const module = compileGeneratedTypeScript(outputs, { entry: output.relativePath });
    for (const test of calendarCases) {
      const fn = output.funcs.find((func) => func.name === test.function)!;
      const result = module[fn.exportName!]!(...fn.parameterNames.map((name) => nativeInput(test.inputs[name])));
      expect(JSON.parse(JSON.stringify(result ?? null)), test.id).toEqual(test.expected);
    }
  },
  GENERATED_MODULE_TEST_TIMEOUT
);

it('executes the same Gregorian and weekend-adjustment cases in standalone Python', () => {
  const python = generatePythonModule(docs);
  expect(python.diagnostics).toEqual([codelistWarning]);
  expect(
    runPython(
      calendarCases.map((test) => ({
        expression: `${python.bindings.get(`${calendarNamespace}.${test.function}`)}(data)`,
        data: test.inputs
      })),
      python.code,
      { includeRuntime: false }
    )
  ).toEqual(calendarCases.map((test) => ({ value: test.expected })));
});
